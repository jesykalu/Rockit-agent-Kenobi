import {
  get,
  put,
  del,
  list,
  head,
  issueSignedToken,
  presignUrl,
} from "@vercel/blob";
import { planRanges } from "./fast-review";
import { reviewText } from "./contextual-review";
import { createHash } from "node:crypto";
import type { AssetFile } from "./types";
export async function saveAsset(
  id: string,
  index: number,
  file: AssetFile,
  output = false,
): Promise<AssetFile> {
  const key = `reviews/${id}/${output ? "output-text" : "source-text"}/${index}.json`;
  await put(key, JSON.stringify(file), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    multipart: true,
  });
  const masked = reviewText(file.text),
    chunkOffsets: number[] = [];
  for (let offset = 0; offset < masked.length; offset += 24000)
    if (masked.slice(offset, offset + 26000).trim()) chunkOffsets.push(offset);
  return {
    ...file,
    chunkOffsets,
    reviewRanges: planRanges(file.text),
    content: "",
    text: "",
    storageKey: key,
    textLength: file.text.length,
    textHash: createHash("sha256")
      .update(file.content)
      .update(file.text)
      .digest("hex"),
  };
}
export async function loadAsset(file: AssetFile): Promise<AssetFile> {
  if (!file.storageKey) return file;
  const blob = await get(file.storageKey, { access: "private" });
  if (!blob || blob.statusCode !== 200)
    throw new Error("Stored source is unavailable. Retry later.");
  const full = (await new Response(blob.stream).json()) as AssetFile;
  if (
    createHash("sha256")
      .update(full.content)
      .update(full.text)
      .digest("hex") !== file.textHash
  )
    throw new Error("Stored source checksum mismatch. Export refused.");
  return full;
}
export async function privateUrl(key: string) {
  const token = await issueSignedToken({
    validUntil: Date.now() + 600000,
    pathname: key,
    operations: ["get"],
  });
  return (
    await presignUrl(token, {
      operation: "get",
      access: "private",
      pathname: key,
      validUntil: Date.now() + 300000,
    })
  ).presignedUrl;
}
export async function removeAssets(id: string) {
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `reviews/${id}/`, cursor, limit: 1000 });
    if (page.blobs.length) await del(page.blobs.map((b) => b.url));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}
