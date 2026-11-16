# Kenobi — standalone asset review

Kenobi identifies potentially sensitive client, commercial and financial information, proposes exact replacements, waits for human approval, then exports a separate reviewed copy. It is extracted from the cleansing policy and interaction model in Rockit, with a new standalone execution boundary.

## Run locally

Use Node 22. Copy `.env.example` to `.env.local`; configure `KENOBI_USERS` with a unique random access key per colleague (24+ characters) and set `KENOBI_ORIGIN=http://127.0.0.1:3000`. Generate keys with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000 and enter the configured username and access key in the browser sign-in prompt. Without `DATABASE_URL`, local development stores private snapshots in `.kenobi/` (gitignored). This fallback is explicitly disabled on Vercel. Never use development credentials on the hosted site.

## Vercel deployment

1. Import this repository into Vercel as a Next.js project with Node 22.
2. Connect a Supabase Postgres database via Vercel Storage. Set `DATABASE_URL` to its pooled connection URL with TLS enabled. Use Supabase’s transaction pooler connection string (port 6543); prepared statements are disabled. The table lives in an unexposed private schema with RLS enabled and public access revoked. Connect as the schema owner on the server. Use a database dedicated to Kenobi; the application role must not be shared with untrusted tools.
3. Pull development environment variables locally and run `npm run db:setup` once. The script creates only the `kenobi_private.reviews` table and its owner index. Do the same against any separate preview/production database.
4. Set `KENOBI_USERS` to a JSON object mapping colleague usernames to unique random access keys. Set `KENOBI_ORIGIN` to the exact canonical HTTPS origin, without a trailing slash. Preview deployments must have their own exact origin; requests from other origins are refused.
5. Set `AZURE_FOUNDRY_ENDPOINT`, `AZURE_FOUNDRY_API_KEY`, and `AI_MODEL_ASSESSMENT` for semantic assessment. The endpoint must support the Anthropic Messages request format used by the reference Rockit agent. No live model is selected or contacted until AI review is explicitly selected.
6. Optionally set `GITHUB_READ_TOKEN` to a fine-grained read-only token scoped to repositories approved for all tool users. A shared token grants every authenticated tool user read access to those repositories. Do not reuse a broad personal token.
7. Deploy. The app refuses sign-in when auth/origin settings are missing, and refuses persistent operations on Vercel without Postgres.

Direct uploads are capped at 4 MB to fit Vercel's request limit; GitHub imports are capped at 25 MB, 1,500 files. Extracted text is limited to 1.5 MB and reviews to 2,000 findings. Oversized inputs are rejected rather than silently truncated. Download ZIPs use authenticated 1 MB parts. Long model reviews may exceed the configured 300-second function duration; split large source sets. No background queue is included in this release.

## Workflow and approval

- Upload code, HTML, text PDF, PPTX or ZIP; alternatively connect a GitHub repository. ZIP uploads support snapshots from other Git hosts.
- Supply known client names and project terms. Choose limited local pattern scanning or Azure AI semantic review. Local mode is not a substitute for a full contextual assessment.
- Inspect the source text, add missed findings, edit replacement text, and explicitly accept or keep each finding. Rejected findings are counted as retained risks.
- Choose branding and acknowledge coverage limitations. Approval records the authenticated username, timestamp, exact replacement decisions, and a source-bound hash. Approved plans are locked.
- Execute separately. The server verifies approval and the source snapshot before applying deterministic edits. Database transactions and advisory locks prevent simultaneous executions across Vercel instances.
- Download the reviewed assets and a summary. Evidence and original sensitive values remain in the private review, not the export report. Delete a review to remove its originals, findings, approval and output from active storage; database provider backups follow the provider's retention policy.

## What is preserved, rebuilt or excluded

| Input | Result |
| --- | --- |
| Source code / text | Exact approved text edits, original paths preserved. Reinstall dependencies and run the source project's checks. No source code is executed by Kenobi. |
| HTML | Exact approved edits plus optional Accenture header and stylesheet. Uploaded HTML is never rendered in the review UI. |
| PDF | New text-only PDF, not an in-place redaction. Original images, forms, annotations, attachments, metadata and layout are omitted. Current PDF font supports Western European text; unsupported characters cause export to fail rather than disappear silently. |
| PPTX | New editable text slides; original layout, images, charts, notes, masters, comments, macros and embedded objects are omitted. Legacy `.ppt` must first be converted to `.pptx`. |
| Binary assets, images, generated files, dependencies, Git history | Excluded and explicitly reported. Image/OCR analysis is not implemented. |

Accenture branding uses the supplied Rockit logo asset, purple `#A100FF`, and system-font fallbacks. Code exports include opt-in branding assets; automatic framework-specific component rewiring is not implemented. Original filenames may remain sensitive because renaming can break imports. AI can propose code/CSS changes, but all are subject to exact human review. Raster client logos are not retained. Inline images and remote image references in HTML still require explicit review/removal.

There is no guarantee that all sensitive information is detected. Residual pattern scans and rejected-finding counts are shown before download. Exposed credentials must be revoked or rotated separately. Do not treat a reviewed ZIP as a compliance certification.

## Shared-use boundaries

Each user can access only their own jobs. Approval identity comes from the authenticated account, not a submitted form field. Sign-in currently uses per-user access keys over HTTPS; enterprise SSO, reviewer assignment, immutable external audit retention, rate limiting, automatic expiration, OCR and asynchronous workers remain deployment-hardening work. This release is a pilot for a small trusted group, not an enterprise production service. Restrict project access and database access accordingly. Never paste real credentials into issue reports.

## Provenance

Reference: `jesykalu/v0-rockit-web-experience` at `20da0e59db1e5f3a130e768525f7b9eb9ee7190d`.

- `lib/cleansing-template.ts`: copied from `lib/kenobi/cleansing-template.ts` (risk categories and prompt policy).
- `public/accenture-logo.png`: copied from `public/images/accenture-symbol.png`; the original root logo had a baked-in checkerboard.
- Human decisions and source snapshots follow the reference Kenobi spec/plan model. New exact-edit execution avoids further unreviewed LLM rewrites after approval.
- Rockit's registry, Supabase management auth, Azure Blob uploads, publishing, Vercel password APIs and automatic GitHub writes are intentionally not required by this standalone app.

The source repository contains no license granting general redistribution. Treat this as a private extraction for the repository owner; verify brand asset rights before broader distribution.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

Tests cover approval bypass, stale/tampered snapshots, rejected/overlapping changes, binary exclusion, safe archive paths, authentication/origin checks, and PDF/PPTX export-and-reimport. The optional KENOBI_TEST_DATABASE_URL test verifies a complete approval/export round trip against Postgres, including JSONB encoding and canonical approval hashes. Live Azure checks require model credentials.
