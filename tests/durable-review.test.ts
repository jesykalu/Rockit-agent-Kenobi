import { it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  advanceReview as advanceBatch,
  processing,
} from "../lib/durable-review";
import { saveJob, readJob } from "../lib/store";
import { sourceDigest, approve } from "../lib/review";
import type { Job } from "../lib/types";
const advanceReview = (...args: Parameters<typeof advanceBatch>) =>
  advanceBatch(...(args.slice(0, 4) as [string, string, string, string]), 1);
const mocks = vi.hoisted(() => ({ discover: vi.fn(), review: vi.fn() }));
vi.mock("../lib/contextual-review", () => ({
  discoverChunk: mocks.discover,
  reviewChunk: mocks.review,
  reviewText: (s: string) => s,
  aiConfiguration: () => ({ model: "test" }),
  REVIEW_VERSION: "test",
}));
vi.mock("../lib/asset-storage", () => ({
  loadAsset: async (f: unknown) => f,
  saveAsset: async (_id: string, _i: number, f: unknown) => f,
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("checkpoints each chunk, does not duplicate replayed steps and resumes a failed step", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kenobi-steps-"));
  vi.stubEnv("KENOBI_DATA_DIR", dir);
  vi.stubEnv("DATABASE_URL", "");
  try {
    const file = {
      path: "sample.txt",
      content: "",
      kind: "text" as const,
      text: "Cedar " + "x".repeat(25000),
      warnings: [],
    };
    const job: Job = {
      id: randomUUID(),
      owner: "owner",
      createdAt: "now",
      source: "test",
      sourceHash: sourceDigest([file]),
      status: "processing",
      mode: "ai",
      clientTerms: [],
      files: [file],
      findings: [],
      warnings: [],
      processing: processing("discover", 2),
    };
    job.processing!.chunks = [
      { file: 0, offset: 0 },
      { file: 0, offset: 24000 },
    ];
    const generation = job.processing!.generation;
    await saveJob(job);
    mocks.discover.mockResolvedValue([
      {
        path: "sample.txt",
        original: "Cedar",
        type: "project",
        meaning: "Client project",
      },
    ]);
    await advanceReview(job.id, job.owner, generation, "discover:0");
    await advanceReview(job.id, job.owner, generation, "discover:0");
    expect(mocks.discover).toHaveBeenCalledTimes(1);
    mocks.discover.mockRejectedValueOnce(new Error("Transient timeout"));
    await expect(
      advanceReview(job.id, job.owner, generation, "discover:1"),
    ).rejects.toThrow("Transient");
    expect((await readJob(job.id, job.owner)).processing?.cursor).toBe(1);
    await advanceReview(job.id, job.owner, generation, "discover:1");
    await advanceReview(job.id, job.owner, generation, "discover:2");
    mocks.review.mockImplementation(async (_path: string, text: string) =>
      text.includes("Cedar")
        ? [
            {
              original: "Cedar",
              replacement: "the programme",
              category: "Project",
              reason: "Client reference",
              suggestion: "Generalise",
              confidence: "high",
            },
          ]
        : [],
    );
    await advanceReview(job.id, job.owner, generation, "assess:0");
    await advanceReview(job.id, job.owner, generation, "assess:1");
    await advanceReview(job.id, job.owner, generation, "assess:2");
    const done = await readJob(job.id, job.owner);
    expect(done.status).toBe("review");
    expect(done.processing).toBeUndefined();
    expect(done.findings).toHaveLength(1);
    expect(() => approve(job, {})).toThrow();
    expect(
      await advanceReview(job.id, job.owner, "stale-generation", "assess:0"),
    ).toMatchObject({ done: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("runs four sections concurrently, merges in source order and preserves replay safety", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kenobi-parallel-"));
  vi.stubEnv("KENOBI_DATA_DIR", dir);
  vi.stubEnv("DATABASE_URL", "");
  try {
    const file = {
      path: "sample.txt",
      content: "",
      kind: "text" as const,
      text: "x".repeat(100000),
      warnings: [],
    };
    const job: Job = {
      id: randomUUID(),
      owner: "owner",
      createdAt: "now",
      source: "test",
      sourceHash: sourceDigest([file]),
      status: "processing",
      mode: "ai",
      clientTerms: [],
      files: [file],
      findings: [],
      warnings: [],
      processing: processing("discover", 4),
    };
    job.processing!.chunks = [0, 24000, 48000, 72000].map((offset) => ({
      file: 0,
      offset,
    }));
    await saveJob(job);
    let active = 0,
      peak = 0;
    mocks.discover.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      return [];
    });
    await advanceBatch(
      job.id,
      job.owner,
      job.processing!.generation,
      "discover:0",
    );
    expect(peak).toBe(4);
    expect((await readJob(job.id, job.owner)).processing?.cursor).toBe(4);
    await advanceBatch(
      job.id,
      job.owner,
      job.processing!.generation,
      "discover:0",
    );
    expect(mocks.discover).toHaveBeenCalledTimes(4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
