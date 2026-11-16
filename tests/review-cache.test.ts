import { it, expect, vi } from "vitest";
const blobs = vi.hoisted(() => new Map<string, string>());
vi.mock("@vercel/blob", () => ({
  get: vi.fn(async (key: string) =>
    blobs.has(key)
      ? { statusCode: 200, stream: new Response(blobs.get(key)).body }
      : null,
  ),
  put: vi.fn(async (key: string, value: string) => {
    blobs.set(key, value);
  }),
}));
import { cachedRange } from "../lib/review-cache";
it("caches completed work privately per job and retries failed work", async () => {
  const valid = (v: unknown) => v as { ok: boolean };
  const produce = vi.fn(async () => ({ ok: true }));
  await cachedRange("job-a", "key", produce, valid);
  expect((await cachedRange("job-a", "key", produce, valid)).hit).toBe(true);
  expect(produce).toHaveBeenCalledTimes(1);
  await cachedRange("job-b", "key", produce, valid);
  expect(produce).toHaveBeenCalledTimes(2);
  const fail = vi.fn(async () => {
    throw new Error("timeout");
  });
  await expect(cachedRange("job-a", "failed", fail, valid)).rejects.toThrow(
    "timeout",
  );
  expect((await cachedRange("job-a", "failed", produce, valid)).hit).toBe(
    false,
  );
});
