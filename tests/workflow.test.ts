import { describe, it, expect, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { zipSync, unzipSync } from "fflate";
import { extract, ingestUploads, safePath, unpack } from "../lib/ingest";
import {
  scanFile,
  approve,
  applyDecisions,
  sourceDigest,
  verifyApproval,
} from "../lib/review";
import { buildExport } from "../lib/export";
import { authenticate, sameOrigin } from "../lib/auth";
import type { Job } from "../lib/types";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  saveJob,
  readJob,
  locked,
  deleteJob,
  writeOutput,
  readOutput,
} from "../lib/store";

async function fixture(): Promise<Job> {
  const file = await extract(
    "index.html",
    Buffer.from(
      "<html><body><h1>Acme Bank</h1><p>Fee £50,000. Contact jill@acme.com</p></body></html>",
    ),
  );
  return {
    id: randomUUID(),
    owner: "reviewer",
    createdAt: new Date().toISOString(),
    source: "upload",
    sourceHash: sourceDigest([file]),
    status: "review",
    mode: "local",
    clientTerms: ["Acme Bank"],
    files: [file],
    findings: scanFile(file, ["Acme Bank"]),
    warnings: [],
  };
}
function approveAll(job: Job) {
  return approve(job, {
    reviewer: "reviewer",
    sourceHash: job.sourceHash,
    acknowledged: true,
    brand: true,
    decisions: job.findings.map((f) => ({
      id: f.id,
      decision: "accept",
      replacement: f.replacement,
    })),
  });
}
afterEach(() => vi.unstubAllEnvs());
it.skipIf(!process.env.KENOBI_TEST_DATABASE_URL)(
  "round-trips a complete approved review through Postgres",
  async () => {
    vi.stubEnv("DATABASE_URL", process.env.KENOBI_TEST_DATABASE_URL!);
    const job = await fixture();
    try {
      await saveJob(job);
      const stored = await readJob(job.id, job.owner);
      expect(stored.files[0].text).toBe(job.files[0].text);
      await expect(readJob(job.id, "other-owner")).rejects.toThrow("not found");
      await locked(job.id, async () => {
        await saveJob(approveAll(stored));
      });
      const approved = await readJob(job.id, job.owner);
      verifyApproval(approved);
      const { bytes, report } = await buildExport(approved);
      await locked(job.id, async () => {
        await writeOutput(job.id, bytes);
        await saveJob({ ...approved, status: "complete", report });
      });
      expect((await readJob(job.id, job.owner)).status).toBe("complete");
      expect(new Uint8Array(await readOutput(job.id))).toEqual(bytes);
    } finally {
      await deleteJob(job.id);
    }
  },
  30000,
);
describe("approval boundary", () => {
  it("blocks execution without human approval", async () => {
    await expect(buildExport(await fixture())).rejects.toThrow(
      "Human approval",
    );
  });
  it("requires a decision for every finding and acknowledgement", async () => {
    const job = await fixture();
    expect(() =>
      approve(job, {
        reviewer: "x",
        sourceHash: job.sourceHash,
        acknowledged: true,
        brand: false,
        decisions: [],
      }),
    ).toThrow("every finding");
    expect(() => approve(job, {})).toThrow();
  });
  it("rejects duplicate decisions and stale source hashes", async () => {
    const job = await fixture();
    const approved = approveAll(job);
    expect(() =>
      approve(job, { ...approved.approval, sourceHash: "stale" }),
    ).toThrow("Source has changed");
    const decisions = [
      ...approved.approval!.decisions,
      approved.approval!.decisions[0],
    ];
    expect(() =>
      approve(job, {
        ...approved.approval,
        sourceHash: job.sourceHash,
        decisions,
      }),
    ).toThrow("every finding");
  });
  it("binds approval to exact source and replacements", async () => {
    const job = approveAll(await fixture());
    job.approval!.decisions[0].replacement = "tampered";
    expect(() => verifyApproval(job)).toThrow("changed");
    const other = approveAll(await fixture());
    other.files[0].text += "new secret";
    expect(() => verifyApproval(other)).toThrow("changed");
  });
  it("binds approval to finding locations", async () => {
    const job = approveAll(await fixture());
    job.findings[0].start++;
    expect(() => verifyApproval(job)).toThrow("changed");
  });
  it("does not allow approved plans to be edited", async () => {
    const job = approveAll(await fixture());
    expect(() => approve(job, {})).toThrow("already been approved");
  });
});
describe("reviewed export", () => {
  it("applies exact edits, brands HTML, and does not leak evidence in the report", async () => {
    const job = approveAll(await fixture());
    const { bytes, report } = await buildExport(job);
    const output = unzipSync(bytes);
    const html = Buffer.from(output["asset/index.html"]).toString();
    expect(html).not.toContain("Acme Bank");
    expect(html).not.toContain("50,000");
    expect(html).not.toContain("jill@");
    expect(html).toContain('alt="Accenture"');
    expect(report.changedFiles).toBe(1);
    expect(Buffer.from(output["review-report.json"]).toString()).not.toContain(
      "acme",
    );
    expect(job.files[0].text).toContain("Acme Bank");
  });
  it("retains rejected edits and reports them honestly", async () => {
    const job = await fixture();
    const decisions = job.findings.map((f) => ({
      id: f.id,
      decision: "reject",
      replacement: f.replacement,
    }));
    const approved = approve(job, {
      reviewer: "reviewer",
      sourceHash: job.sourceHash,
      acknowledged: true,
      brand: false,
      decisions,
    });
    const { bytes, report } = await buildExport(approved);
    expect(Buffer.from(unzipSync(bytes)["asset/index.html"]).toString()).toBe(
      job.files[0].text,
    );
    expect(report.rejectedFindings).toBe(job.findings.length);
    expect(report.residualFindings).toBeGreaterThan(0);
  });
  it("rejects overlapping edits", async () => {
    const job = await fixture();
    const finding = job.findings[0];
    expect(() =>
      applyDecisions(
        job.files[0],
        [finding, { ...finding, id: "duplicate" }],
        [
          { id: finding.id, decision: "accept", replacement: "x" },
          { id: "duplicate", decision: "accept", replacement: "x" },
        ],
      ),
    ).toThrow("Overlapping");
  });
  it("excludes unknown binary data", async () => {
    const job = await fixture();
    job.files.push(await extract("private.bin", new Uint8Array([0, 255, 0])));
    job.sourceHash = sourceDigest(job.files);
    const { bytes, report } = await buildExport(approveAll(job));
    expect(unzipSync(bytes)["asset/private.bin"]).toBeUndefined();
    expect(report.excludedFiles).toBe(1);
  });
  it("rebuilds PDF and PPTX and re-extracts reviewed text", async () => {
    for (const kind of ["pdf", "pptx"] as const) {
      const job = await fixture();
      job.files[0] = {
        ...job.files[0],
        kind,
        path: `source.${kind}`,
        text: "Acme Bank\nDeal value £50,000",
      };
      job.findings = scanFile(job.files[0], job.clientTerms);
      job.sourceHash = sourceDigest(job.files);
      const { bytes } = await buildExport(approveAll(job));
      const output = unzipSync(bytes);
      const key = Object.keys(output).find((p) => p.endsWith(`.${kind}`))!;
      const reread = await extract(key, output[key]);
      expect(reread.text).toContain("Example organisation");
      expect(reread.text).not.toContain("Acme Bank");
      expect(reread.text).not.toContain("50,000");
      if (process.env.KENOBI_QA_OUTPUT_DIR)
        await writeFile(
          path.join(process.env.KENOBI_QA_OUTPUT_DIR, `sample.${kind}`),
          output[key],
        );
    }
  });
});
describe("untrusted input and access", () => {
  it("isolates owners and serializes review mutations", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kenobi-test-"));
    vi.stubEnv("KENOBI_DATA_DIR", dir);
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("VERCEL", "");
    try {
      const job = await fixture();
      await saveJob(job);
      await expect(readJob(job.id, "someone-else")).rejects.toThrow(
        "not found",
      );
      expect((await readJob(job.id, job.owner)).id).toBe(job.id);
      await locked(job.id, async () => {
        await expect(locked(job.id, async () => {})).rejects.toThrow(
          "being processed",
        );
      });
      await deleteJob(job.id);
      await expect(readJob(job.id, job.owner)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("rejects traversal and archive bombs", () => {
    expect(() => safePath("../secret")).toThrow();
    expect(() => safePath("a\\b")).toThrow();
    expect(() => unpack(zipSync({ "../secret": Buffer.from("x") }))).toThrow();
  });
  it("rejects duplicate paths and excludes git history", async () => {
    await expect(
      ingestUploads([
        { name: "a.txt", bytes: Buffer.from("a") },
        { name: "a.txt", bytes: Buffer.from("b") },
      ]),
    ).rejects.toThrow("Duplicate");
    const files = await ingestUploads([
      { name: ".git/config", bytes: Buffer.from("private history") },
    ]);
    expect(files[0].kind).toBe("binary");
    expect(files[0].content).toBe("");
  });
  it("requires valid configured credentials and exact origin", () => {
    vi.stubEnv("KENOBI_USERS", JSON.stringify({ reviewer: "a".repeat(32) }));
    vi.stubEnv("KENOBI_ORIGIN", "https://kenobi.example");
    expect(authenticate(new Request("https://kenobi.example"))).toBeNull();
    const request = new Request("https://kenobi.example", {
      headers: {
        authorization: `Basic ${Buffer.from(`reviewer:${"a".repeat(32)}`).toString("base64")}`,
        origin: "https://kenobi.example",
      },
    });
    expect(authenticate(request)).toBe("reviewer");
    expect(() => sameOrigin(request)).not.toThrow();
    expect(() =>
      sameOrigin(
        new Request("https://kenobi.example", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toThrow();
  });
});

it("binds explicit binary retention to approval and preserves approved binary bytes", async () => {
  const job = await fixture();
  const binary = await extract(
    "generic-asset.bin",
    new Uint8Array([0, 1, 2, 255]),
  );
  job.files.push(binary);
  job.sourceHash = sourceDigest(job.files);
  const approved = approve(job, {
    reviewer: "reviewer",
    sourceHash: job.sourceHash,
    acknowledged: true,
    brand: false,
    retainedFiles: [binary.path],
    decisions: job.findings.map((f) => ({
      id: f.id,
      decision: "accept",
      replacement: f.replacement,
    })),
  });
  const output = await buildExport(approved);
  expect(unzipSync(output.bytes)["asset/generic-asset.bin"]).toEqual(
    new Uint8Array([0, 1, 2, 255]),
  );
  approved.approval!.retainedFiles = [];
  expect(() => verifyApproval(approved)).toThrow();
});
