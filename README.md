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
3. Pull development environment variables locally and run `npm run db:setup` once. The script creates the private review table and upload-staging tables with their indexes. Do the same against any separate preview/production database.
4. Set `KENOBI_USERS` to a JSON object mapping colleague usernames to unique random access keys. Set `KENOBI_ORIGIN` to the exact canonical HTTPS origin, without a trailing slash. Preview deployments must have their own exact origin; requests from other origins are refused.
5. Set `OPENAI_API_KEY` as a server-only Production secret and `OPENAI_REVIEW_MODEL=gpt-4.1-2025-04-14`. Contextual AI review is the default. Extracted text and source paths are sent to OpenAI Responses with `store:false`; this is not a promise of zero provider retention. No API key reaches the browser. If the connection is missing or fails, the app does not silently fall back to a basic scan. The operator may explicitly select basic pattern scanning.
6. Optionally set `GITHUB_READ_TOKEN` to a fine-grained read-only token scoped to repositories approved for all tool users. A shared token grants every authenticated tool user read access to those repositories. Do not reuse a broad personal token.
7. Deploy. The app refuses sign-in when auth/origin settings are missing, and refuses persistent operations on Vercel without Postgres.

Browser packages are capped at **2 GB total**. Uploads go directly to a private Vercel Blob store using per-object, size-limited client tokens. The API never receives the archive body. ZIP indexing uses bounded HTTP range reads; extraction reads one file at a time and validates paths, compression, sizes and CRC. Archives are limited to 100,000 entries and 10 GB expanded. Dependencies, Git history and caches are excluded with a downloadable private exclusion inventory. **Individual extracted files remain limited to 25 MB**; this release is not a general 1 GB PDF/individual-document processor. Oversized files are explicitly unassessed and excluded. GitHub URL imports retain the 25 MB limit; use a source ZIP for large prototypes.

Source bodies and exports live in private object storage; Postgres stores metadata, decisions, context and checkpoints. Assessment and export run as Vercel durable workflows. Each AI chunk has its own timeout and automatic retries; no overall four-minute assessment deadline applies. Closing the browser does not stop processing. The review URL and last-review link recover progress; stalled jobs can resume from their last checkpoint. Retries use a generation token and expected stage/cursor to prevent duplicate edits. Up to 2,000 findings are supported per review. Large source sets may take much longer and incur model/storage/workflow usage charges.

Binary files are unassessed. A reviewer can explicitly retain listed binary assets unchanged after checking them separately; that selection is bound into approval. Oversized/dependency exclusions cannot be reintroduced this way. Exports preserve code paths and approved assets and include the Accenture CSS/logo for opt-in use. Export rejects edits that introduce JavaScript/TypeScript syntax errors or invalid JSON into previously valid files, without executing uploaded code. This is not a production-readiness certification: dependencies must be restored and application-specific builds, tests and functional checks still need to run before deployment.

## Workflow and approval

- Upload code, HTML, text PDF, PPTX or ZIP; alternatively connect a GitHub repository. ZIP uploads support snapshots from other Git hosts.
- Known client names and project terms are optional clues. Contextual review first discovers evidence across every text chunk, then assesses each chunk using shared client context. Findings explain the risk, exact proposed generalisation and confidence. Invalid or overlapping evidence is disclosed. Local mode is not a substitute for contextual assessment.
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

Tests cover approval bypass, stale/tampered snapshots, rejected/overlapping changes, binary exclusion, safe archive paths, authentication/origin checks, and PDF/PPTX export-and-reimport. The optional KENOBI_TEST_DATABASE_URL test verifies a complete approval/export round trip against Postgres, including JSONB encoding and canonical approval hashes. Checkpoint tests verify replay safety, failed-step recovery and approval gating. The range-reader test indexes a virtual 1 GB ZIP without materialising its body. The opt-in live OpenAI evaluation requires `OPENAI_API_KEY`, `OPENAI_REVIEW_MODEL` and `KENOBI_LIVE_AI_TEST=1`. It uses fictional material only and checks client, project, internal-system, commercial and strategy detection without supplied names, then approval/export and a second contextual check.

## Contextual assessment and output verification

The model receives untrusted source evidence and cannot execute tools or fetch links. Only exact source substrings become edits; unsupported suggestions are discarded with a coverage warning. Hosted assessment uses independent durable steps and per-call timeouts. Failed steps are retried and checkpointed; failures are visible without releasing an incomplete review. The synchronous adapter used by isolated tests retains a bounded deadline. Embedded base64 binary payloads are masked with equal-length spaces for assessment, preserving text edit offsets; these images are not inspected.

The context disclosure shows inferred client clues with source paths. Output verification re-extracts each generated document and reassesses generated text with the same contextual engine before releasing the ZIP. This is a read-only check: it never introduces unapproved edits. Remaining findings stay in the private report; the shareable report contains counts only. A failed verification prevents release. Images, original document metadata and visual logos are not inspected. Source paths are assessed as context but are not automatically renamed. PDFs/PPTX are rebuilt; code execution and application-specific test suites remain the owner's responsibility.

API integration references: [Responses structured output](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1).

## Large-package hosting

Create and link a **private** Vercel Blob store in the same team/region; `BLOB_READ_WRITE_TOKEN` must exist in Production. `workflow` integrates through `next.config.ts`. Its internal `/.well-known/workflow/` routes bypass Basic auth because the Workflow SDK authenticates queue traffic. All user-facing upload, start, retry, source, approval, download and deletion endpoints still require authentication and ownership. Workflow events carry job IDs/cursors, not source text. Private object URLs are signed only after authorisation and expire after a short interval. Delete a review to delete its object-storage prefix and database record. Incomplete uploads also consume storage until deleted.

The build uses webpack because this environment's Turbopack build stalled with the Workflow plugin. Do not switch back without a deployment test. Before calling this production-ready, add enterprise identity, retention/usage budgets, wider representative corpus evaluation and isolated application build/test validation.

### Faster contextual review (preview)

The optional **Faster contextual review — preview** method uses the same OpenAI model, larger bounded source ranges, combined discovery/findings and full shared-context verification for multi-range inputs. Ambiguous passages remain visible for human inspection. Completed range responses are cached privately within the review so a failed sibling does not repeat successful work. Existing jobs keep their engine, including during export.

This is not a 10× speed guarantee. The 2026-11-16 paired sparse-prototype benchmark measured a median 44.503 seconds for the existing engine and 14.895 seconds for the candidate (~2.99×). All six seeded facts were found in each candidate run, with no benign findings in that fixture. This is limited synthetic evidence, not proof of universal detection parity. The existing method remains the default. Input/source coverage limitations and approval requirements are unchanged.

Internal metrics `uncachedResults` and `cacheHits` count committed results, not all provider attempts. Wall-clock benchmark results include upload, queueing, indexing and assessment; export is tested separately. See `docs/superpowers/specs/2026-11-16-fast-review-design.md` and the corresponding implementation plan for decisions and constraints.

Shared helper accounts may be added through the server-only `KENOBI_HELPER_USERS` JSON mapping without replacing `KENOBI_USERS`. Primary account names take precedence. People using the same shared username share review access; personal usernames retain separate review ownership.
