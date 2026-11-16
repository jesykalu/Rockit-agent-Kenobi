import {
  RandomAccessReader,
  fromRandomAccessReader,
  type ZipFile,
} from "yauzl";
import { Readable } from "node:stream";
import { inflateRawSync, crc32 } from "node:zlib";
import { privateUrl } from "./asset-storage";
import { safePath, extract } from "./ingest";
import type { Job } from "./types";
export const MAX_PACKAGE_BYTES = 2_000_000_000;
export const MAX_ENTRY_BYTES = 25_000_000;
export function exclusion(path: string, size: number) {
  if (
    /(^|\/)(node_modules|\.git|\.next|\.cache|coverage|__pycache__)(\/|$)/.test(
      path,
    )
  )
    return "Dependency, history or generated cache; regenerate from the reviewed source.";
  if (size > MAX_ENTRY_BYTES)
    return "Individual extracted file exceeds 25 MB; requires a separate large-document pipeline. Not assessed or exported.";
  return undefined;
}
export class HttpReader extends RandomAccessReader {
  constructor(
    private url: string,
    private size: number,
  ) {
    super();
  }
  private cache = new Map<number, Buffer>();
  _readStreamForRange(start: number, end: number) {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > this.size
    )
      throw new Error("Invalid archive range.");
    const self = this;
    return Readable.from(
      (async function* () {
        const block = 262144;
        for (let at = start; at < end;) {
          const base = Math.floor(at / block) * block;
          let data = self.cache.get(base);
          if (!data) {
            const last = Math.min(self.size, base + block) - 1;
            const r = await fetch(self.url, {
              headers: { Range: `bytes=${base}-${last}` },
              signal: AbortSignal.timeout(60000),
            });
            if (r.status !== 206)
              throw new Error("Storage did not honor a bounded range read.");
            data = Buffer.from(await r.arrayBuffer());
            if (data.length !== last - base + 1)
              throw new Error("Incomplete archive range.");
            if (self.cache.size >= 16)
              self.cache.delete(self.cache.keys().next().value!);
            self.cache.set(base, data);
          }
          const n = Math.min(end - at, data.length - (at - base));
          yield data.subarray(at - base, at - base + n);
          at += n;
        }
      })(),
    );
  }
}
export async function indexInput(
  input: NonNullable<Job["inputs"]>[number],
  index: number,
) {
  if (!/\.zip$/i.test(input.path))
    return [
      {
        path: safePath(input.path),
        input: index,
        size: input.size,
        excluded: exclusion(input.path, input.size),
      },
    ];
  const url = await privateUrl(input.key);
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    fromRandomAccessReader(
      new HttpReader(url, input.size),
      input.size,
      { lazyEntries: true, autoClose: true, strictFileNames: true },
      (e, z) => (e ? reject(e) : resolve(z)),
    ),
  );
  const inventory: NonNullable<Job["inventory"]> = [];
  let expanded = 0,
    count = 0;
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", resolve);
    zip.on("entry", (entry) => {
      try {
        if (++count > 100000)
          throw new Error("Archive exceeds 100,000 entries.");
        const path = safePath(entry.fileName.replace(/\/$/, ""));
        expanded += entry.uncompressedSize;
        if (expanded > 10_000_000_000)
          throw new Error("Archive exceeds 10 GB expanded.");
        if (entry.generalPurposeBitFlag & 1)
          throw new Error("Encrypted archives are unsupported.");
        if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
          throw new Error("Symbolic links are not accepted.");
        if (!entry.fileName.endsWith("/"))
          inventory.push({
            path,
            input: index,
            offset: entry.relativeOffsetOfLocalHeader,
            compressed: entry.compressedSize,
            size: entry.uncompressedSize,
            method: entry.compressionMethod,
            crc: entry.crc32,
            excluded: exclusion(path, entry.uncompressedSize),
          });
        zip.readEntry();
      } catch (e) {
        zip.close();
        reject(e);
      }
    });
    zip.readEntry();
  });
  return inventory;
}
export async function readEntry(
  job: Job,
  entry: NonNullable<Job["inventory"]>[number],
) {
  if (entry.excluded)
    return {
      path: entry.path,
      content: "",
      text: "",
      kind: "binary" as const,
      warnings: [entry.excluded],
    };
  const input = job.inputs![entry.input];
  const url = await privateUrl(input.key);
  let bytes: Buffer;
  if (entry.offset === undefined) {
    const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error("Source unavailable.");
    bytes = Buffer.from(await r.arrayBuffer());
  } else {
    const reader = new HttpReader(url, input.size);
    async function read(start: number, end: number) {
      const parts: Buffer[] = [];
      for await (const part of reader._readStreamForRange(start, end))
        parts.push(Buffer.from(part));
      return Buffer.concat(parts);
    }
    const header = await read(entry.offset, entry.offset + 30);
    if (header.readUInt32LE(0) !== 0x04034b50)
      throw new Error("Invalid archive entry.");
    const start =
      entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    if (entry.compressed! > MAX_ENTRY_BYTES * 2)
      throw new Error("Compressed entry exceeds bounded decoder allowance.");
    const compressed = await read(start, start + entry.compressed!);
    bytes =
      entry.method === 0
        ? compressed
        : entry.method === 8
          ? inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES })
          : (() => {
              throw new Error("Unsupported ZIP compression.");
            })();
    if (crc32(bytes) !== entry.crc)
      throw new Error("Archive checksum mismatch.");
  }
  if (bytes.length !== entry.size || bytes.length > MAX_ENTRY_BYTES)
    throw new Error("Source size mismatch.");
  try {
    return await extract(entry.path, bytes);
  } catch {
    return {
      path: entry.path,
      content: bytes.toString("base64"),
      text: "",
      kind: "binary" as const,
      warnings: [
        "Text extraction failed. This file was not assessed; check it separately before choosing to retain it.",
      ],
    };
  }
}
