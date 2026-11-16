# Kenobi
<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
The owner and colleagues reviewing client assets for reuse. The user confirmed a hosted shared tool.

## Product Purpose
Extract Kenobi from Rockit into an independent tool: ingest assets, identify client/commercial/financial sensitivity, propose exact changes, collect human decisions, then export reviewed assets with Accenture branding.

## Operating Context
PDF, HTML, uploaded code, Git repositories and PowerPoint. Human review must occur before execution. Originals remain unchanged. Each signed-in user owns their reviews; cross-user assignment is an open future decision.

## Capabilities and Constraints
Reuse Rockit's cleansing categories and brand assets. New standalone implementation retains Next.js. Shared deployment requires authentication, persistent private storage and recorded approval identity. The user selected Vercel team acn-rx-geek-out. Hosted storage uses Postgres with transaction locks; per-user access keys protect the pilot over HTTPS. Enterprise SSO remains undecided. PDF/PPTX exports reconstruct text rather than preserving original layouts. Image/OCR review is not implemented; disclose omissions.

## Brand Commitments
Kenobi name, Accenture purple and existing Accenture logo from the reference repository. Preserve the existing Kenobi dark review interface vocabulary.

## Evidence on Hand
Reference repository jesykalu/v0-rockit-web-experience, commit 20da0e59db1e5f3a130e768525f7b9eb9ee7190d. Cleansing categories and logo are extracted directly; execution and persistence are decoupled from the registry.

## Product Principles
- No execution before explicit approval.
- Record concrete evidence and exact replacements.
- Expose scan gaps and unresolved findings.
- Never describe a partial scan as guaranteed cleansing.
