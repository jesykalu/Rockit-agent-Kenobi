import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser, sameOrigin } from "@/lib/auth";
import { ingestUploads, githubFiles, MAX_BYTES } from "@/lib/ingest";
import { assess, sourceDigest } from "@/lib/review";
import { saveJob } from "@/lib/store";
import type { Job } from "@/lib/types";
import { consumeUpload } from "@/lib/uploads";
import { MAX_REVIEW_TEXT_BYTES } from "@/lib/upload-limits";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const owner = requireUser(request);
    sameOrigin(request);
    if (Number(request.headers.get("content-length") || 0) > 4_100_000)
      throw new Error(
        "This request is too large. Refresh the page to use the 25 MB uploader.",
      );
    const form = await request.formData();
    const repo = String(form.get("repo") || "").trim();
    const uploadId = String(form.get("upload_id") || "");
    const uploads = form
      .getAll("files")
      .filter((f): f is File => f instanceof File && f.size > 0);
    if ((repo && (uploads.length || uploadId)) || (uploadId && uploads.length))
      throw new Error("Choose a repository or uploaded files, not both.");
    if (!repo && !uploads.length && !uploadId)
      throw new Error("Choose files or supply a GitHub repository URL.");
    if (uploads.reduce((s, f) => s + f.size, 0) > 4_000_000)
      throw new Error("Refresh the page to use the 25 MB uploader.");
    const entries = repo
      ? await githubFiles(repo)
      : uploadId
        ? await consumeUpload(uploadId, owner)
        : await Promise.all(
            uploads.map(async (f) => ({
              name: f.name,
              bytes: new Uint8Array(await f.arrayBuffer()),
            })),
          );
    const files = await ingestUploads(entries);
    if (
      files.reduce((sum, f) => sum + Buffer.byteLength(f.text, "utf8"), 0) >
      MAX_REVIEW_TEXT_BYTES
    )
      throw new Error(
        "Extracted source exceeds the 25 MB review allowance. Choose a smaller source set.",
      );
    if (!files.some((f) => f.kind !== "binary"))
      throw new Error(
        "No reviewable text was found. Use HTML, code, text-based PDFs or PPTX files.",
      );
    const terms = String(form.get("terms") || "")
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 100);
    const mode = form.get("mode") || "ai";
    if (mode !== "ai" && mode !== "local")
      throw new Error(
        "Choose contextual review or explicitly select basic pattern scanning.",
      );
    const useAI = mode === "ai";
    const { findings, warnings, ...assessment } = await assess(
      files,
      terms,
      useAI,
    );
    if (findings.length > 2000)
      throw new Error(
        "More than 2,000 findings. Split this source set for a manageable review.",
      );
    const job: Job = {
      id: randomUUID(),
      owner,
      createdAt: new Date().toISOString(),
      source: repo || `${entries.length} uploaded file(s)`,
      sourceHash: sourceDigest(files),
      status: "review",
      mode: useAI ? "ai" : "local",
      clientTerms: terms,
      files,
      findings,
      warnings,
      ...assessment,
    };
    await saveJob(job);
    return NextResponse.json({ id: job.id });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not assess this asset.",
      },
      { status: 400 },
    );
  }
}
