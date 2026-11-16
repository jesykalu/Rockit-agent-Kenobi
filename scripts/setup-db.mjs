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
  console.log("Kenobi review storage is ready.");
} finally {
  await sql.end();
}
