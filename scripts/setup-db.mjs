import postgres from "postgres";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  await sql`create schema if not exists kenobi_private`;
  await sql`revoke all on schema kenobi_private from public`;
  await sql`create table if not exists kenobi_private.reviews (
    id uuid primary key,
    owner text not null,
    document jsonb not null,
    output bytea,
    created_at timestamptz not null default now()
  )`;
  await sql`create index if not exists kenobi_reviews_owner_idx on kenobi_private.reviews(owner)`;
  await sql`alter table kenobi_private.reviews enable row level security`;
  await sql`revoke all on kenobi_private.reviews from public`;
  await sql`create table if not exists kenobi_private.uploads (
    id uuid primary key, owner text not null, manifest jsonb not null, expires_at timestamptz not null
  )`;
  await sql`create table if not exists kenobi_private.upload_parts (
    upload_id uuid not null references kenobi_private.uploads(id) on delete cascade,
    part integer not null check(part >= 0), bytes bytea not null check(octet_length(bytes) <= 1000000),
    primary key(upload_id,part)
  )`;
  await sql`create index if not exists kenobi_upload_expiry_idx on kenobi_private.uploads(expires_at)`;
  await sql`alter table kenobi_private.uploads enable row level security`;
  await sql`alter table kenobi_private.upload_parts enable row level security`;
  await sql`revoke all on kenobi_private.uploads, kenobi_private.upload_parts from public`;
  console.log("Kenobi review storage is ready.");
} finally {
  await sql.end();
}
