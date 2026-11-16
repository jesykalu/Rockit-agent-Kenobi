import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Job } from "./types";
import postgres from "postgres";
import { AsyncLocalStorage } from "node:async_hooks";
let client: ReturnType<typeof postgres> | undefined;
const transaction = new AsyncLocalStorage<ReturnType<typeof postgres>>();
function database() {
  if (process.env.VERCEL && !process.env.DATABASE_URL)
    throw new Error(
      "Vercel deployment requires DATABASE_URL. Connect Postgres and run db:setup.",
    );
  if (!process.env.DATABASE_URL) return null;
  client ??= postgres(process.env.DATABASE_URL, {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
  });
  return transaction.getStore() || client;
}
const root = () => path.resolve(process.env.KENOBI_DATA_DIR || ".kenobi");
function jobPath(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid job ID.");
  return path.join(root(), id);
}
export async function saveJob(job: Job) {
  const sql = database();
  if (sql) {
    await sql`insert into kenobi_private.reviews (id, owner, document) values (${job.id},${job.owner},${sql.json(job as unknown as postgres.JSONValue)}::jsonb) on conflict(id) do update set document=excluded.document`;
    return;
  }
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const target = jobPath(job.id) + ".json",
    temp = target + "." + randomUUID();
  await writeFile(temp, JSON.stringify(job), { mode: 0o600 });
  await rename(temp, target);
}
export async function readJob(id: string, owner: string): Promise<Job> {
  jobPath(id);
  const sql = database();
  if (sql) {
    const rows =
      await sql`select document from kenobi_private.reviews where id=${id} and owner=${owner}`;
    if (!rows.length) throw new Error("Review not found.");
    return rows[0].document as Job;
  }
  const job = JSON.parse(await readFile(jobPath(id) + ".json", "utf8")) as Job;
  if (job.owner !== owner) throw new Error("Review not found.");
  return job;
}
export async function writeOutput(id: string, bytes: Uint8Array) {
  const sql = database();
  if (sql) {
    await sql`update kenobi_private.reviews set output=${Buffer.from(bytes)} where id=${id}`;
    return;
  }
  await writeFile(jobPath(id) + ".zip", bytes, { mode: 0o600 });
}
export async function readOutput(id: string): Promise<Buffer> {
  const sql = database();
  if (sql) {
    const rows =
      await sql`select output from kenobi_private.reviews where id=${id}`;
    if (!rows[0]?.output) throw new Error("Output not found.");
    return rows[0].output as Buffer;
  }
  return readFile(jobPath(id) + ".zip");
}
export async function deleteJob(id: string) {
  const sql = database();
  if (sql) {
    await sql`delete from kenobi_private.reviews where id=${id}`;
    return;
  }
  await rm(jobPath(id) + ".json", { force: true });
  await rm(jobPath(id) + ".zip", { force: true });
}
// Filesystem lock works across workers on the same persistent volume. Crashed operations
// leave a lock for operator investigation instead of silently executing twice.
export async function locked<T>(id: string, fn: () => Promise<T>) {
  jobPath(id);
  const sql = database();
  if (sql)
    return sql.begin(async (tx) => {
      const rows =
        await tx`select pg_try_advisory_xact_lock(hashtext(${id})) as acquired`;
      if (!rows[0].acquired)
        throw new Error(
          "This review is being processed. Retry after it finishes.",
        );
      return transaction.run(tx as unknown as ReturnType<typeof postgres>, fn);
    }) as Promise<T>;
  const lock = jobPath(id) + ".lock";
  try {
    await mkdir(lock);
  } catch {
    throw new Error("This review is being processed. Retry after it finishes.");
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
