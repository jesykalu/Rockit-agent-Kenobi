import {
  analyzeRange,
  analysisKey,
  analysisSchema,
  planRanges,
  validateAnalysis,
  FAST_VERSION,
} from "./fast-review";
import { cachedRange } from "./review-cache";
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
    engine:
      process.env.KENOBI_REVIEW_ENGINE === "fast-v2" ? "fast-v2" : undefined,
    metrics: {
      uncachedResults: 0,
      cacheHits: 0,
      startedAt: new Date().toISOString(),
    },
    cursor: 0,
    total,
    updatedAt: new Date().toISOString(),
    generation: randomUUID(),
    context: [],
    chunks: [],
    findings: [],
  };
}
export function exportProcessing(job: Job): NonNullable<Job["processing"]> {
  return {
    ...processing("export", job.files.length),
    engine: job.assessment?.engine,
    outputs: [],
  };
}
export async function prepareChunks(job: Job, output = false) {
  const p = job.processing!;
  p.chunks = [];
  for (const [file, f] of (output ? p.outputs! : job.files).entries())
    if (f.kind !== "binary") {
      if (p.engine === "fast-v2" && job.mode === "ai") {
        const ranges = f.reviewRanges || planRanges((await loadAsset(f)).text);
        for (const range of ranges) p.chunks.push({ file, ...range });
        continue;
      }
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
  concurrency = 4,
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
        await prepareChunks(job);
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
        await prepareChunks(job, true);
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
        const sections = p.chunks.slice(
          p.cursor,
          p.cursor + Math.max(1, Math.min(4, concurrency)),
        );
        const loaded = new Map<number, ReturnType<typeof loadAsset>>();
        const settled = await Promise.allSettled(
          sections.map(async (section) => {
            if (!loaded.has(section.file))
              loaded.set(
                section.file,
                loadAsset((residual ? p.outputs! : job.files)[section.file]),
              );
            const file = await loaded.get(section.file)!;
            const text = reviewText(file.text).slice(
              section.offset,
              section.offset + (section.length || 26000),
            );
            const fast = p.engine === "fast-v2" && job.mode === "ai";
            const purpose = residual
              ? ("residual" as const)
              : ("initial" as const);
            let entities: NonNullable<Job["assessment"]>["context"] = [];
            let items: Partial<Finding>[] = [];
            let hit: boolean | undefined;
            if (text.trim() && fast) {
              const key = analysisKey({
                path: file.path,
                text,
                terms: job.clientTerms,
                purpose,
                model: aiConfiguration().model,
                priorContext: job.assessment?.context || [],
                phase: discovery ? "combined" : "verify",
                context: discovery ? [] : p.context,
              });
              const result = await cachedRange(
                id,
                key,
                async () =>
                  discovery
                    ? analyzeRange(
                        file.path,
                        text,
                        job.clientTerms,
                        purpose,
                        job.assessment?.context,
                      )
                    : {
                        entities: [],
                        uncertain: [],
                        findings: await reviewChunk(
                          file.path,
                          text,
                          job.clientTerms,
                          p.context,
                          purpose,
                          job.assessment?.context,
                        ),
                      },
                (value) =>
                  validateAnalysis(
                    file.path,
                    text,
                    analysisSchema.parse(value),
                  ),
              );
              entities = result.value.entities.map((e) => ({
                ...e,
                path: file.path,
              }));
              entities.push(
                ...result.value.uncertain.map((original) => ({
                  path: file.path,
                  original,
                  type: "uncertain",
                  meaning:
                    "Ambiguous passage: check against all client context and flag for human inspection.",
                })),
              );
              items = result.value.findings;
              hit = result.hit;
            } else if (text.trim()) {
              if (discovery && job.mode === "ai")
                entities = await discoverChunk(
                  file.path,
                  text,
                  job.clientTerms,
                );
              if (job.mode === "ai") hit = false;
              if (!discovery && job.mode === "ai")
                items = await reviewChunk(
                  file.path,
                  text,
                  job.clientTerms,
                  p.context,
                  purpose,
                  job.assessment?.context,
                );
            }
            return { section, file, text, entities, items, hit };
          }),
        );
        const failure = settled.find(
          (r): r is PromiseRejectedResult => r.status === "rejected",
        );
        if (failure) throw failure.reason;
        const results = settled.flatMap((r) =>
          r.status === "fulfilled" ? [r.value] : [],
        );
        for (const { section, file, text, entities, items, hit } of results) {
          if (p.metrics && hit !== undefined) {
            if (hit) p.metrics.cacheHits++;
            else p.metrics.uncachedResults++;
          }
          if (text.trim()) {
            if (discovery && job.mode === "ai") {
              for (const e of entities)
                if (
                  !p.context.some(
                    (c) => c.original === e.original && c.type === e.type,
                  )
                )
                  p.context.push(e);
              if (entities.some((e) => e.type === "uncertain"))
                job.warnings.push(
                  `${file.path}: ambiguous passages were included in shared-context verification and need human inspection.`,
                );
              if (JSON.stringify(p.context).length > 100000)
                throw new Error(
                  "Too much distinct client context for one assessment. Narrow the source scope. Completed progress is retained.",
                );
            }
            if (!discovery || p.engine === "fast-v2") {
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
                  else if (
                    !p.findings!.some(
                      (f) =>
                        f.path === file.path &&
                        f.start === start &&
                        f.end === end &&
                        f.replacement === item.replacement,
                    )
                  )
                    job.warnings.push(
                      `${file.path}: overlapping or conflicting proposals require manual inspection; the first exact edit was retained.`,
                    );
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
        }
      } else if (discovery) {
        p.cursor =
          p.engine === "fast-v2" &&
          p.chunks.length <= 1 &&
          !p.context.some((e) => e.type === "uncertain")
            ? p.chunks.length
            : 0;
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
            version: p.engine === "fast-v2" ? FAST_VERSION : REVIEW_VERSION,
            engine: p.engine,
            metrics: p.metrics
              ? {
                  uncachedResults: p.metrics.uncachedResults,
                  cacheHits: p.metrics.cacheHits,
                  elapsedMs: Date.now() - Date.parse(p.metrics.startedAt),
                }
              : undefined,
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
