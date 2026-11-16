import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import { extract } from "../lib/ingest";
import { assess, approve, sourceDigest } from "../lib/review";
import { sourcePage } from "../lib/source-page";
import { buildExport } from "../lib/export";
import { MAX_REVIEW_TEXT_BYTES, SOURCE_PAGE_CHARS } from "../lib/upload-limits";
import type { Job } from "../lib/types";
it("reviews text beyond both former limits and preserves the end of the file in export", async () => {
  const padding = "<!-- neutral padding -->\n".repeat(80000);
  const original = `<html><body>${padding}<p>Acme Bank fee £12,000</p></body></html>`;
  expect(Buffer.byteLength(original)).toBeGreaterThan(1_500_000);
  const file = await extract("large.html", Buffer.from(original));
  expect(file.text).toBe(original);
  const result = await assess([file], ["Acme Bank"], false);
  expect(result.findings).toHaveLength(2);
  expect(result.findings.every((f) => f.start > 1_500_000)).toBe(true);
  const job: Job = {
    id: randomUUID(),
    owner: "test",
    createdAt: new Date().toISOString(),
    source: "upload",
    sourceHash: sourceDigest([file]),
    status: "review",
    mode: "local",
    clientTerms: ["Acme Bank"],
    files: [file],
    ...result,
  };
  const first = sourcePage(job, 0, 0),
    last = sourcePage(job, 0, first.totalPages - 1);
  expect(first.text.length).toBe(SOURCE_PAGE_CHARS);
  expect(last.text).toContain("Acme Bank");
  let reconstructed = "";
  for (let page = 0; page < first.totalPages; page++)
    reconstructed += sourcePage(job, 0, page).text;
  expect(reconstructed).toBe(original);
  const approved = approve(job, {
    reviewer: "test",
    sourceHash: job.sourceHash,
    acknowledged: true,
    brand: false,
    decisions: job.findings.map((f) => ({
      id: f.id,
      decision: "accept",
      replacement: f.replacement,
    })),
  });
  const { bytes } = await buildExport(approved);
  const output = Buffer.from(unzipSync(bytes)["asset/large.html"]).toString();
  expect(output).toContain(padding);
  expect(output).not.toContain("Acme Bank");
  expect(output).not.toContain("12,000");
  expect(output.endsWith("</body></html>")).toBe(true);
  expect(() => sourcePage(job, -1, 0)).toThrow();
  expect(() => sourcePage(job, 0, first.totalPages)).toThrow();
});
it("accepts the full 25 MB text allowance and refuses expansion beyond it", async () => {
  expect(
    (await extract("at-limit.txt", Buffer.alloc(MAX_REVIEW_TEXT_BYTES, 32)))
      .text.length,
  ).toBe(MAX_REVIEW_TEXT_BYTES);
  await expect(
    extract("too-large.txt", Buffer.alloc(MAX_REVIEW_TEXT_BYTES + 1, 32)),
  ).rejects.toThrow("25 MB");
});
