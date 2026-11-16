import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { z } from "zod";
import { database, locked } from "./store";
import { safePath } from "./ingest";
import { MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from "./upload-limits";

const manifestSchema = z
  .array(
    z.object({
      name: z.string().min(1).max(240),
      size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    }),
  )
  .min(1)
  .max(1500);
interface Upload {
  id: string;
  owner: string;
  files: z.infer<typeof manifestSchema>;
  size: number;
  expiresAt: number;
}
function location(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid upload ID.");
  return path.resolve(process.env.KENOBI_DATA_DIR || ".kenobi", `upload-${id}`);
}
export function validateManifest(input: unknown) {
  const files = manifestSchema.parse(input);
  files.forEach((f) => safePath(f.name));
  if (new Set(files.map((f) => f.name.toLowerCase())).size !== files.length)
    throw new Error(
      "Duplicate file names. Upload a ZIP to preserve folder paths.",
    );
  const size = files.reduce((sum, f) => sum + f.size, 0);
  if (size > MAX_UPLOAD_BYTES)
    throw new Error(
      "Upload limit is 25 MB in total. Choose a smaller file set.",
    );
  return { files, size };
}
export async function startUpload(owner: string, input: unknown) {
  const { files, size } = validateManifest(input);
  const upload: Upload = {
    id: randomUUID(),
    owner,
    files,
    size,
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
  const sql = database();
  if (sql) {
    await sql`delete from kenobi_private.uploads where expires_at < now()`;
    await sql`insert into kenobi_private.uploads (id,owner,manifest,expires_at) values (${upload.id},${owner},${sql.json(upload as unknown as postgres.JSONValue)},${new Date(upload.expiresAt)})`;
  } else {
    const root = path.dirname(location(upload.id));
    await mkdir(root, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(root))
      if (/^upload-[a-f0-9-]{36}$/.test(entry)) {
        try {
          const old = JSON.parse(
            await readFile(path.join(root, entry, "manifest.json"), "utf8"),
          ) as Upload;
          if (old.expiresAt < Date.now())
            await rm(path.join(root, entry), { recursive: true, force: true });
        } catch {
          /* An incomplete local session is not trusted. */
        }
      }
    await mkdir(location(upload.id), { mode: 0o700 });
    await writeFile(
      path.join(location(upload.id), "manifest.json"),
      JSON.stringify(upload),
      { mode: 0o600 },
    );
  }
  return { id: upload.id, chunkBytes: UPLOAD_CHUNK_BYTES };
}
async function getUpload(id: string, owner: string): Promise<Upload> {
  const directory = location(id);
  const sql = database();
  let upload: Upload;
  if (sql) {
    const rows =
      await sql`select manifest from kenobi_private.uploads where id=${id} and owner=${owner}`;
    if (!rows.length)
      throw new Error("Upload not found or expired. Upload again.");
    upload = rows[0].manifest as Upload;
  } else
    upload = JSON.parse(
      await readFile(path.join(directory, "manifest.json"), "utf8"),
    ) as Upload;
  if (upload.owner !== owner || upload.expiresAt < Date.now())
    throw new Error("Upload not found or expired. Upload again.");
  return upload;
}
export async function saveChunk(
  id: string,
  owner: string,
  part: number,
  bytes: Uint8Array,
) {
  await locked(id, async () => {
    const upload = await getUpload(id, owner);
    if (
      !Number.isInteger(part) ||
      part < 0 ||
      part >= Math.ceil(upload.size / UPLOAD_CHUNK_BYTES)
    )
      throw new Error("Invalid upload part.");
    const expected = Math.min(
      UPLOAD_CHUNK_BYTES,
      upload.size - part * UPLOAD_CHUNK_BYTES,
    );
    if (bytes.byteLength !== expected)
      throw new Error("Upload part has an incorrect size. Retry the upload.");
    const sql = database();
    if (sql)
      await sql`insert into kenobi_private.upload_parts (upload_id,part,bytes) values (${id},${part},${Buffer.from(bytes)}) on conflict(upload_id,part) do update set bytes=excluded.bytes`;
    else
      await writeFile(path.join(location(id), String(part)), bytes, {
        mode: 0o600,
      });
  });
}
export async function discardUpload(id: string, owner: string) {
  const sql = database();
  location(id);
  if (sql)
    await sql`delete from kenobi_private.uploads where id=${id} and owner=${owner}`;
  else {
    await getUpload(id, owner);
    await rm(location(id), { recursive: true, force: true });
  }
}
export async function consumeUpload(id: string, owner: string) {
  return locked(id, async () => {
    const upload = await getUpload(id, owner),
      count = Math.ceil(upload.size / UPLOAD_CHUNK_BYTES),
      sql = database();
    const parts: Buffer[] = [];
    if (sql) {
      const rows =
        await sql`select part,bytes from kenobi_private.upload_parts where upload_id=${id} order by part`;
      if (rows.length !== count)
        throw new Error("Upload is incomplete. Retry the upload.");
      for (let i = 0; i < count; i++) {
        if (rows[i].part !== i) throw new Error("Upload is incomplete.");
        parts.push(rows[i].bytes as Buffer);
      }
    } else
      for (let i = 0; i < count; i++) {
        try {
          parts.push(await readFile(path.join(location(id), String(i))));
        } catch {
          throw new Error("Upload is incomplete. Retry the upload.");
        }
      }
    for (let i = 0; i < count; i++)
      if (
        parts[i].length !==
        Math.min(UPLOAD_CHUNK_BYTES, upload.size - i * UPLOAD_CHUNK_BYTES)
      )
        throw new Error("Upload part size mismatch.");
    const bytes = Buffer.concat(parts);
    let offset = 0;
    const entries = upload.files.map((file) => {
      const entry = {
        name: file.name,
        bytes: new Uint8Array(bytes.subarray(offset, offset + file.size)),
      };
      offset += file.size;
      return entry;
    });
    await discardUpload(id, owner);
    return entries;
  });
}
export async function readChunk(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing upload data.");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > UPLOAD_CHUNK_BYTES) {
        await reader.cancel();
        throw new Error("Upload part exceeds 1 MB.");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts);
}
