# Kenobi faster review: implementation and measured results

16 November 2026. Built using the installed Superpowers design, planning, test-driven implementation and fresh-review workflow.

## Outcome
Implemented an optional faster contextual engine. **The requested 10× speed target was not achieved.** The existing engine remains the default; the new method is an opt-in preview. No universal claim of unchanged detection quality is supported by this small synthetic evaluation.

## Paired hosted benchmark
Same pinned model (`gpt-4.1-2025-04-14`), concurrency limit four, fresh review/cache for each run. Timing includes upload, queueing, indexing and assessment. Engine order alternated across three sparse-fixture pairs. Inputs contained only synthetic material.

| Fixture | Existing engine | Candidate | Quality checks |
|---|---:|---:|---|
| 539,283-byte sparse HTML prototype, run 1 | 47.112 s | 24.767 s | Both found all six seeds; candidate zero benign findings |
| Same fixture, run 2 | 41.625 s | 14.895 s | Both found all six seeds; candidate zero benign findings |
| Same fixture, run 3 | 44.503 s | 14.771 s | Both found all six seeds; candidate zero benign findings |
| Median | **44.503 s** | **14.895 s** | **2.99× faster** |
| 520-byte dense three-file fixture, one pair | 26.753 s | 27.972 s | All eight seeds found; exact evidence and JavaScript/JSON syntax checks passed |

Sparse fixture covers client name, project, proprietary system, discount, financial forecast and personal contact, positioned throughout repetitive UI markup. Dense fixture adds a cross-file alias and confidential acquisition strategy. The old engine incorrectly flagged repeated benign text in the sparse fixture (216–310 findings); the candidate did not. Credential-shaped test transmission was rejected by automatic review, so credential coverage remains local-test evidence rather than a hosted-model benchmark claim.

The earlier 120k-character candidate measured 54.773 s versus 27.368 s on one pair; it motivated the larger input experiment. It is not pooled into the three-pair result.

## What changed
- Combined context discovery and proposed findings in one main request per range.
- Larger source ranges, bounded to 600,000 UTF-16 characters and 600,000 UTF-8 bytes of JSON-encoded text, with overlap and newline-aware boundaries.
- Full shared-context verification remains for multi-range assets and ambiguous single-range assets. No source sampling or new dependency/content exclusions.
- Exact source evidence validation; conflicting edits and ambiguous passages remain visible for human inspection.
- Private, per-review result caching. Successful siblings settle before a failed batch retries.
- Engine version persists through approval, export and retries. Existing jobs are unaffected.
- Human accept/edit/retain and explicit approval remain unchanged.

## Decisions and limitations
- Used a feature branch in the existing clean checkout rather than a duplicate worktree, to preserve deployment configuration; no concurrent implementers shared the checkout.
- Kept comprehensive second-pass verification because literal-only targeted follow-up can miss indirect cross-file references. This limits speedup but avoids that known coverage regression.
- Enlarged the original 120k range after its benchmark fell short. Larger ranges may take longer individually or fail on dense output; failures are surfaced rather than treated as a clean review.
- Did not implement semantic AST extraction, cross-file small-file packing, or model-input deduplication of repeated components. These are remaining optimisation work requiring separate quality validation, not completed features.
- `uncachedResults` counts results committed without cache reuse, not all API attempts. Timing is the primary speed evidence.
- Existing 25MB individual file, 2GB package, text-only assessment and document reconstruction limitations remain.

## Independent review
A fresh reviewer found two important issues: uncertain evidence propagation and incomplete benchmark gating. Uncertain evidence now enters shared context and human-review warnings. The benchmark now includes a dense cross-file case, repeated cold timing pairs, exact-source checks, benign controls and syntax validation, and fails its quality gate on misses or invalid output. A sibling-cache race and JSON-escaped input bounds were also fixed with regression tests. Request accounting was relabelled to match what is actually measured.

## Practical use
Select **Faster contextual review — preview** under Assessment method for a new review. This does not restart or alter existing reviews. Its measured advantage is on the larger sparse fixture; small multi-file reviews may see no benefit.

A stronger claim of quality parity needs a representative corpus and independent human annotations. A 10× claim needs new measured results; this implementation does not justify it.
