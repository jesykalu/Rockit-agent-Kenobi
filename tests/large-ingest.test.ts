import { it, expect, vi, afterEach } from "vitest";
import { zipSync } from "fflate";
import { indexInput, HttpReader, exclusion } from "../lib/large-ingest";
vi.mock("../lib/asset-storage", () => ({
  privateUrl: async () => "https://fixture.invalid/archive",
}));
afterEach(() => vi.unstubAllGlobals());
it("indexes a virtual 1 GB ZIP through bounded ranges without loading its body", async () => {
  const small = Buffer.from(
    zipSync(
      { "app.html": Buffer.from("<p>Reusable prototype</p>") },
      { level: 0 },
    ),
  );
  const eocd = small.length - 22,
    centralOffset = small.readUInt32LE(eocd + 16),
    gap = 1_100_000_000;
  const prefix = small.subarray(0, centralOffset),
    tail = Buffer.from(small.subarray(centralOffset));
  tail.writeUInt32LE(centralOffset + gap, tail.length - 22 + 16);
  const size = small.length + gap;
  let transferred = 0,
    requests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) => {
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range)!;
      const start = Number(a),
        end = Number(b) + 1;
      expect(end - start).toBeLessThanOrEqual(262144);
      requests++;
      transferred += end - start;
      const result = Buffer.alloc(end - start);
      for (const [offset, data] of [
        [0, prefix],
        [centralOffset + gap, tail],
      ] as const) {
        const lo = Math.max(start, offset),
          hi = Math.min(end, offset + data.length);
        if (hi > lo) data.copy(result, lo - start, lo - offset, hi - offset);
      }
      return new Response(result, { status: 206 });
    }),
  );
  const result = await indexInput(
    { path: "prototype.zip", key: "fixture", size },
    0,
  );
  expect(result).toHaveLength(1);
  expect(result[0].path).toBe("app.html");
  expect(transferred).toBeLessThan(2_000_000);
  expect(requests).toBeLessThan(10);
});
it("reports excluded dependencies and oversized individual files explicitly", () => {
  expect(exclusion("prototype/node_modules/library/index.js", 100)).toContain(
    "Dependency",
  );
  expect(exclusion("prototype/src/page.tsx", 100)).toBeUndefined();
  expect(exclusion("large.pdf", 50_000_000)).toContain("Not assessed");
});
