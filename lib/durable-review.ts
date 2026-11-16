import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { ZipFile } from "yazl";
import { put, get } from "@vercel/blob";
import { readJob, saveJob, locked } from "./store";
import { loadAsset, saveAsset } from "./asset-storage";
import { indexInput, readEntry } from "./large-ingest";
import {
  discoverChunk,
  reviewChunk,
  reviewText,
  aiConfiguration,
  REVIEW_VERSION,
} from "./contextual-review";
import { scanFile, sourceDigest, verifyApproval } from "./review";
import { exportFile, BRAND_CSS } from "./export";
import { extract } from "./ingest";
import type { Job, Finding } from "./types";
export function processing(
  phase: NonNullable<Job["processing"]>["phase"],
  total = 0,
): NonNullable<Job["processing"]> {
  return {
    phase,
    cursor: 0,
    total,
    updatedAt: new Date().toISOString(),
    generation: randomUUID(),
    context: [],
    chunks: [],
    findings: [],
  };
}
function chunks(job: Job, output = false) {
  const p = job.processing!;
  p.chunks = [];
  for (const [file, f] of (output ? p.outputs! : job.files).entries())
    if (f.kind !== "binary") {
      const offsets =
        f.chunkOffsets ||
        Array.from(
          { length: Math.ceil((f.textLength ?? f.text.length) / 24000) },
          (_, i) => i * 24000,
        );
      for (const offset of offsets) p.chunks.push({ file, offset });
    }
  p.cursor = 0;
  p.total = p.chunks.length;
  p.context = [];
  p.findings = [];
}
function cursor(job: Job) {
  return {
    phase: job.processing?.phase || "done",
    cursor: job.processing?.cursor || 0,
    done: !job.processing,
  };
}
export async function advanceReview(
  id: string,
  owner: string,
  generation: string,
  expected: string,
) {
  return locked(id, async () => {
    const job = await readJob(id, owner),
      p = job.processing;
    if (!p || p.generation !== generation)
      return { ...cursor(job), done: true };
    if (`${p.phase}:${p.cursor}` !== expected) return cursor(job);
    p.error = undefined;
    if (p.phase === "index") {
      if (!job.inventory) {
        const inventory = [];
        for (const [i, input] of (job.inputs || []).entries())
          inventory.push(...(await indexInput(input, i)));
        if (
          new Set(inventory.map((e) => e.path.toLowerCase())).size !==
          inventory.length
        )
          throw new Error("Duplicate archive paths are not accepted.");
        job.inventory = inventory;
        p.total = inventory.length;
      } else if (p.cursor < job.inventory.length) {
        while (
          p.cursor < job.inventory.length &&
          job.inventory[p.cursor].excluded
        ) {
          job.excludedCount = (job.excludedCount || 0) + 1;
          p.cursor++;
        }
        if (p.cursor < job.inventory.length) {
          const entry = job.inventory[p.cursor],
            file = await readEntry(job, entry);
          job.files.push(await saveAsset(id, p.cursor, file));
          p.cursor++;
        }
      } else {
        if (!job.files.some((f) => f.kind !== "binary"))
          throw new Error(
            "No reviewable source files. Inspect excluded files or upload a supported asset.",
          );
        job.sourceHash = sourceDigest(job.files);
        chunks(job);
        p.phase = job.mode === "ai" ? "discover" : "assess";
        job.warnings.push(
          "Dependencies, Git history, caches and unsupported binaries are excluded. Check the source-file list for individual exclusions. Images and original document metadata are not assessed.",
        );
      }
    } else if (p.phase === "export") {
      verifyApproval(job);
      if (p.cursor < job.files.length) {
        const index = p.cursor,
          file = await loadAsset(job.files[index]);
        if (file.kind !== "binary") {
          const out = await exportFile(job, file, index),
            key = `reviews/${id}/export-files/${index}`;
          await put(key, Buffer.from(out.bytes), {
            access: "private",
            addRandomSuffix: false,
            allowOverwrite: true,
            multipart: true,
          });
          const metadata = await saveAsset(
            id,
            index,
            await extract(out.filename, out.bytes),
            true,
          );
          p.outputs!.push({ ...metadata, exportKey: key });
        } else if (job.approval!.retainedFiles?.includes(file.path)) {
          const key = `reviews/${id}/export-files/${index}`;
          await put(key, Buffer.from(file.content, "base64"), {
            access: "private",
            addRandomSuffix: false,
            allowOverwrite: true,
            multipart: true,
          });
          p.outputs!.push({ ...job.files[index], exportKey: key });
        }
        p.cursor++;
      } else {
        chunks(job, true);
        p.phase = job.mode === "ai" ? "verify-discover" : "verify-assess";
      }
    } else if (p.phase === "package") {
      verifyApproval(job);
      if (job.approval!.retainedFiles?.length)
        job.warnings.push(
          `${job.approval!.retainedFiles.length} unassessed binary assets were retained unchanged by explicit human approval.`,
        );
      const report = {
        contextualCheck: job.mode === "ai",
        changedFiles: p.outputs!.filter(
          (f) =>
            f.textHash !==
            job.files.find((source) => source.path === f.path)?.textHash,
        ).length,
        excludedFiles:
          (job.excludedCount || 0) +
          job.files.filter(
            (f) =>
              f.kind === "binary" &&
              !job.approval!.retainedFiles?.includes(f.path),
          ).length,
        residualFindings: p.findings!.length,
        residualDetails: p.findings!,
        rejectedFindings: job.approval!.decisions.filter(
          (d) => d.decision === "reject",
        ).length,
        warnings: job.warnings,
      };
      const zip = new ZipFile();
      for (const f of p.outputs!)
        zip.addReadStreamLazy(`asset/${f.path}`, {}, async (cb) => {
          try {
            const blob = await get(f.exportKey!, { access: "private" });
            if (!blob || blob.statusCode !== 200)
              throw new Error("Export file unavailable.");
            cb(null, Readable.fromWeb(blob.stream as never));
          } catch (e) {
            cb(e as Error, undefined as never);
          }
        });
      zip.addBuffer(
        Buffer.from(
          JSON.stringify(
            {
              jobId: id,
              approvedAt: job.approval!.at,
              approvalHash: job.approval!.hash,
              sourceHash: job.sourceHash,
              assessmentMode: job.mode,
              contextualCheck: report.contextualCheck,
              changedFiles: report.changedFiles,
              excludedFiles: report.excludedFiles,
              residualFindings: report.residualFindings,
              rejectedFindings: report.rejectedFindings,
              notice:
                "Human-reviewed output. Not a guarantee of confidentiality or production readiness.",
            },
            null,
            2,
          ),
        ),
        "review-report.json",
      );
      zip.addBuffer(
        Buffer.from(
          "Reinstall dependencies and test the exported application before reuse. Excluded files, images and original metadata need separate review. Original source paths are preserved. The private workspace contains remaining risk evidence.",
        ),
        "READ-ME.txt",
      );
      if (job.approval!.brand) {
        zip.addBuffer(Buffer.from(BRAND_CSS), "kenobi-brand/accenture.css");
        zip.addFile(
          process.cwd() + "/public/accenture-logo.png",
          "kenobi-brand/accenture-logo.png",
        );
      }
      zip.end();
      const key = `reviews/${id}/reviewed-output.zip`;
      await put(key, zip.outputStream as Readable, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        multipart: true,
      });
      job.outputKey = key;
      job.report = report;
      job.status = "complete";
      job.processing = undefined;
    } else {
      const residual = p.phase.startsWith("verify-"),
        discovery = p.phase.endsWith("discover");
      if (p.cursor < p.chunks.length) {
        const section = p.chunks[p.cursor],
          file = await loadAsset(
            (residual ? p.outputs! : job.files)[section.file],
          );
        const text = reviewText(file.text).slice(
          section.offset,
          section.offset + 26000,
        );
        if (text.trim()) {
          if (discovery && job.mode === "ai") {
            const entities = await discoverChunk(
              file.path,
              text,
              job.clientTerms,
            );
            for (const e of entities)
              if (!p.context.some((c) => c.original === e.original))
                p.context.push(e);
            if (JSON.stringify(p.context).length > 100000)
              throw new Error(
                "Too much distinct client context for one assessment. Narrow the source scope. Completed progress is retained.",
              );
          } else if (!discovery) {
            const items: Partial<Finding>[] =
              job.mode === "ai"
                ? await reviewChunk(
                    file.path,
                    text,
                    job.clientTerms,
                    p.context,
                    residual ? "residual" : "initial",
                    job.assessment?.context,
                  )
                : [];
            items.push(...scanFile({ ...file, text }, job.clientTerms));
            for (const item of items) {
              if (
                !item.original ||
                item.original === item.replacement ||
                !text.includes(item.original) ||
                item.replacement!.length > 10000
              ) {
                job.warnings.push(
                  `${file.path}: a suggestion did not match the source and needs manual inspection.`,
                );
                continue;
              }
              let at = text.indexOf(item.original);
              while (at >= 0) {
                const start = section.offset + at,
                  end = start + item.original.length;
                if (
                  !p.findings!.some(
                    (f) =>
                      f.path === file.path && start < f.end && end > f.start,
                  )
                )
                  p.findings!.push({
                    ...item,
                    id: randomUUID(),
                    path: file.path,
                    start,
                    end,
                    line: file.text.slice(0, start).split("\n").length,
                    source: item.source || "ai",
                  } as Finding);
                at = text.indexOf(item.original, at + item.original.length);
              }
            }
            if (p.findings!.length > 2000)
              throw new Error(
                "This assessment exceeds 2,000 findings. Narrow the source scope. Completed progress is retained.",
              );
          }
        }
        p.cursor++;
      } else if (discovery) {
        p.cursor = 0;
        p.phase = residual ? "verify-assess" : "assess";
      } else if (residual) {
        p.phase = "package";
        p.cursor = 0;
        p.total = 1;
      } else {
        job.findings = p.findings!;
        job.status = "review";
        if (job.mode === "ai")
          job.assessment = {
            version: REVIEW_VERSION,
            provider: "OpenAI",
            model: aiConfiguration().model,
            reviewedChunks: p.chunks.length,
            context: p.context,
            purpose: "initial",
          };
        job.processing = undefined;
      }
    }
    if (job.processing) job.processing.updatedAt = new Date().toISOString();
    job.warnings = [...new Set(job.warnings)];
    await saveJob(job);
    return cursor(job);
  });
}
export async function failReview(
  id: string,
  owner: string,
  generation: string,
  reason = "A processing step failed",
) {
  await locked(id, async () => {
    const job = await readJob(id, owner);
    if (job.processing?.generation === generation) {
      job.processing.error = `${reason}. Your source and completed steps are saved. Retry to continue from the last checkpoint.`;
      await saveJob(job);
    }
  });
}
