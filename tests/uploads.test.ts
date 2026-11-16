import { it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  validateManifest,
  startUpload,
  saveChunk,
  consumeUpload,
  discardUpload,
  readChunk,
} from "../lib/uploads";
import { MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from "../lib/upload-limits";
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "kenobi-upload-test-"));
  vi.stubEnv("KENOBI_DATA_DIR", directory);
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("VERCEL", "");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
it("allows 25 MB total and rejects oversized, duplicate and unsafe manifests", () => {
  expect(
    validateManifest([{ name: "large.pdf", size: MAX_UPLOAD_BYTES }]).size,
  ).toBe(MAX_UPLOAD_BYTES);
  expect(() =>
    validateManifest([
      { name: "large.pdf", size: MAX_UPLOAD_BYTES },
      { name: "extra.txt", size: 1 },
    ]),
  ).toThrow("25 MB");
  expect(() => validateManifest([{ name: "../secret", size: 1 }])).toThrow(
    "Unsafe",
  );
  expect(() =>
    validateManifest([
      { name: "same.txt", size: 1 },
      { name: "same.txt", size: 1 },
    ]),
  ).toThrow("Duplicate");
});
it("reassembles files across chunk boundaries and consumes the session once", async () => {
  const first = Buffer.alloc(UPLOAD_CHUNK_BYTES - 5, 65),
    second = Buffer.from("second file data");
  const data = Buffer.concat([first, second]);
  const { id } = await startUpload("alice", [
    { name: "first.txt", size: first.length },
    { name: "second.txt", size: second.length },
  ]);
  await saveChunk(id, "alice", 1, data.subarray(UPLOAD_CHUNK_BYTES));
  await expect(consumeUpload(id, "alice")).rejects.toThrow("incomplete");
  await saveChunk(id, "alice", 0, data.subarray(0, UPLOAD_CHUNK_BYTES));
  // Retrying an already received part does not append or duplicate it.
  await saveChunk(id, "alice", 0, data.subarray(0, UPLOAD_CHUNK_BYTES));
  const files = await consumeUpload(id, "alice");
  expect(Buffer.from(files[0].bytes)).toEqual(first);
  expect(Buffer.from(files[1].bytes)).toEqual(second);
  await expect(consumeUpload(id, "alice")).rejects.toThrow();
});
it("rejects other owners, incorrect part sizes and out-of-range indexes", async () => {
  const { id } = await startUpload("alice", [{ name: "a.txt", size: 3 }]);
  await expect(saveChunk(id, "bob", 0, Buffer.from("abc"))).rejects.toThrow(
    "not found",
  );
  await expect(consumeUpload(id, "bob")).rejects.toThrow("not found");
  await expect(discardUpload(id, "bob")).rejects.toThrow();
  await expect(saveChunk(id, "alice", 0, Buffer.from("ab"))).rejects.toThrow(
    "incorrect size",
  );
  await expect(saveChunk(id, "alice", 1, Buffer.from("abc"))).rejects.toThrow(
    "Invalid upload part",
  );
  await saveChunk(id, "alice", 0, Buffer.from("abc"));
  await discardUpload(id, "alice");
});
it("refuses expired sessions", async () => {
  const { id } = await startUpload("alice", [{ name: "a.txt", size: 3 }]);
  const file = path.join(directory, `upload-${id}`, "manifest.json");
  const upload = JSON.parse(await readFile(file, "utf8"));
  upload.expiresAt = Date.now() - 1;
  await writeFile(file, JSON.stringify(upload));
  await expect(saveChunk(id, "alice", 0, Buffer.from("abc"))).rejects.toThrow(
    "expired",
  );
});
it("bounds each request body below the platform payload limit", async () => {
  await expect(
    readChunk(
      new Request("http://localhost", {
        method: "PUT",
        body: Buffer.alloc(UPLOAD_CHUNK_BYTES + 1),
      }),
    ),
  ).rejects.toThrow("exceeds 1 MB");
});
it.skipIf(!process.env.KENOBI_TEST_DATABASE_URL)(
  "persists and reassembles an upload over 4 MB through Supabase",
  async () => {
    vi.stubEnv("DATABASE_URL", process.env.KENOBI_TEST_DATABASE_URL!);
    const data = Buffer.alloc(5_100_003, 42);
    const { id } = await startUpload("upload-integration-test", [
      { name: "large.bin", size: data.length },
    ]);
    try {
      for (
        let offset = 0, part = 0;
        offset < data.length;
        offset += UPLOAD_CHUNK_BYTES, part++
      )
        await saveChunk(
          id,
          "upload-integration-test",
          part,
          data.subarray(offset, offset + UPLOAD_CHUNK_BYTES),
        );
      await expect(consumeUpload(id, "other-user")).rejects.toThrow(
        "not found",
      );
      const files = await consumeUpload(id, "upload-integration-test");
      expect(Buffer.from(files[0].bytes)).toEqual(data);
      await expect(
        consumeUpload(id, "upload-integration-test"),
      ).rejects.toThrow("not found");
    } finally {
      await discardUpload(id, "upload-integration-test");
    }
  },
  60000,
);
