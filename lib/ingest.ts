import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import type { AssetFile } from "./types";

export const MAX_BYTES = 25_000_000;
const MAX_EXPANDED = 60_000_000;
export function safePath(path: string) {
  if (
    !path ||
    path.length > 240 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((p) => !p || p === ".." || p === ".") ||
    /[\x00-\x1f:]/.test(path)
  )
    throw new Error("Unsafe file path in upload.");
  return path;
}
export function unpack(bytes: Uint8Array): Record<string, Uint8Array> {
  let total = 0,
    count = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      safePath(f.name.replace(/\/$/, ""));
      total += f.originalSize;
      if (++count > 2000 || total > MAX_EXPANDED || f.originalSize > MAX_BYTES)
        throw new Error(
          "Archive exceeds 2,000 entries or 60 MB expanded size.",
        );
      return !f.name.endsWith("/");
    },
  });
  return files;
}
function xmlText(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) =>
    k === "a:t"
      ? [String(v)]
      : Array.isArray(v)
        ? v.flatMap(xmlText)
        : xmlText(v),
  );
}
export async function extract(
  path: string,
  bytes: Uint8Array,
): Promise<AssetFile> {
  safePath(path);
  const file: AssetFile = {
    path,
    content: Buffer.from(bytes).toString("base64"),
    kind: "binary",
    text: "",
    warnings: [],
  };
  if (/\.pdf$/i.test(path)) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(bytes));
    try {
      const result = await extractText(doc, { mergePages: false });
      file.text = (result.text as string[])
        .map((t, i) => `Page ${i + 1}\n${t}`)
        .join("\n\n");
      if (!(result.text as string[]).some((t) => t.trim()))
        throw new Error("No readable PDF text. OCR is required before review.");
      file.kind = "pdf";
      file.warnings.push(
        "PDF export rebuilds extracted text. Original images, layout, annotations, forms, attachments and metadata are not retained. Text inside images is not assessed.",
      );
    } finally {
      await doc.loadingTask.destroy();
    }
  } else if (/\.pptx$/i.test(path)) {
    const parts = unpack(bytes);
    const parser = new XMLParser({
      ignoreAttributes: true,
      processEntities: false,
      parseTagValue: false,
    });
    const slides = Object.keys(parts)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!slides.length)
      throw new Error("No readable slides in PowerPoint file.");
    file.text = slides
      .map(
        (p, i) =>
          `Slide ${i + 1}\n${xmlText(parser.parse(Buffer.from(parts[p]).toString("utf8"))).join("\n")}`,
      )
      .join("\n\n");
    file.kind = "pptx";
    file.warnings.push(
      "PowerPoint export rebuilds slide text. Original images, charts, speaker notes, embedded files, masters and metadata are discarded; their content is not assessed.",
    );
  } else {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text.includes("\0")) throw new Error("binary");
      file.text = text;
      file.kind = "text";
    } catch {
      file.warnings.push(
        "Binary content cannot be reviewed by this version and will be excluded from the export.",
      );
    }
  }
  if (file.text.length > 500_000)
    throw new Error(
      `A file exceeds the 500,000 character review limit. Split it before uploading.`,
    );
  return file;
}
export async function ingestUploads(
  uploads: { name: string; bytes: Uint8Array }[],
) {
  const entries: { name: string; bytes: Uint8Array }[] = [];
  for (const upload of uploads) {
    if (/\.zip$/i.test(upload.name)) {
      for (const [name, bytes] of Object.entries(unpack(upload.bytes)))
        entries.push({ name, bytes });
    } else entries.push(upload);
  }
  if (entries.length > 1500) throw new Error("Maximum 1,500 files per review.");
  const names = new Set<string>();
  const results: AssetFile[] = [];
  for (const entry of entries) {
    safePath(entry.name);
    if (names.has(entry.name.toLowerCase()))
      throw new Error("Duplicate file paths in upload.");
    names.add(entry.name.toLowerCase());
    if (
      /(^|\/)(\.git|node_modules|\.next|vendor|dist|build)(\/|$)/.test(
        entry.name,
      )
    ) {
      results.push({
        path: entry.name,
        content: "",
        kind: "binary",
        text: "",
        warnings: [
          "History, dependencies and generated build files are excluded. Rebuild from reviewed source.",
        ],
      });
    } else results.push(await extract(entry.name, entry.bytes));
  }
  return results;
}
export async function githubFiles(
  url: string,
): Promise<{ name: string; bytes: Uint8Array }[]> {
  const match = url.match(
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)\/?(?:\.git)?$/,
  );
  if (!match)
    throw new Error(
      "Use a GitHub repository URL. Other Git hosts can be uploaded as ZIP files.",
    );
  const slug = `${match[1]}/${match[2]}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (process.env.GITHUB_READ_TOKEN)
    headers.Authorization = `Bearer ${process.env.GITHUB_READ_TOKEN}`;
  async function get(path: string) {
    const res = await fetch(`https://api.github.com/repos/${slug}/${path}`, {
      headers,
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
    if (!res.ok)
      throw new Error(
        `GitHub read failed (${res.status}). Check URL and read-token access.`,
      );
    return res.json();
  }
  const repo = await get("");
  const tree = await get(
    `git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`,
  );
  if (tree.truncated)
    throw new Error(
      "GitHub returned an incomplete tree. Upload a bounded ZIP instead.",
    );
  const blobs = (
    tree.tree as {
      path: string;
      type: string;
      sha: string;
      size?: number;
      mode: string;
    }[]
  ).filter((n) => n.type !== "tree");
  if (blobs.some((n) => n.type !== "blob" || n.mode === "120000"))
    throw new Error(
      "Submodules or symlinks require a flattened ZIP for complete review.",
    );
  if (
    blobs.length > 1500 ||
    blobs.reduce((s, b) => s + (b.size || 0), 0) > MAX_BYTES
  )
    throw new Error(
      "Repository exceeds 1,500 files or 25 MB. Upload the relevant source as a ZIP.",
    );
  const files = [];
  for (const blob of blobs) {
    const data = await get(`git/blobs/${blob.sha}`);
    if (data.encoding !== "base64")
      throw new Error("GitHub returned unsupported file encoding.");
    files.push({
      name: safePath(blob.path),
      bytes: Buffer.from(data.content, "base64"),
    });
  }
  return files;
}
