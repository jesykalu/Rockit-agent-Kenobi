# Faster contextual review

## Intent and authority
Implement the user's requested faster Kenobi review, targeting one tenth of assessment time without reducing measured detection quality. The user explicitly requested design, plan and execution after the proposed redesign. Human approval and exact-source edits remain mandatory. Speed is a measured target, never an unverified product promise.

## Approaches
1. More concurrency only: already implemented; leaves hundreds of redundant requests.
2. Larger sections with two exhaustive passes: preserves the old algorithm but repeats discovery overhead.
3. Selected: combined context/findings in larger bounded sections, then targeted cross-context reconciliation. Preserve the old engine for comparison and rollback. Native implementation with a fresh final reviewer is the builder's choice to keep tightly coupled changes coherent.

## Architecture
New optional engine `fast-v2`, pinned on each processing job. Existing jobs without that version retain their existing worker semantics. New jobs use it only when KENOBI_REVIEW_ENGINE=fast-v2. Keep current OpenAI model and strict structured output, no model downgrade.

Plan contiguous source ranges of at most 120,000 UTF-16 characters, preferring newline boundaries within the final 6,000 characters, with 2,000-character overlap. Omit only all-whitespace or already-disclosed embedded binary data, using offset-preserving masking. No source code, CSS, dependencies newly excluded, or content sampled. Validate range coverage before completion. File parsing into semantic ASTs and dependency attestation are deferred; no safe-to-skip heuristic is introduced. Existing 25MB individual-file and 2GB package bounds remain.

Every main range produces entities, exact findings, and exact quotes requiring wider context in one request. Merge deterministically by source order. Cross-context pass searches every source for discovered entities and known terms and includes all ambiguous quotes. Merge nearby candidate windows; review them with the full shared evidence. No candidate truncation: fail explicitly if safety limits are exceeded. The cross-context pass can add findings, never silently remove first-pass findings. The post-export residual review runs the same full main scan and reconciliation on generated output with original context.

Persist per-range results in private Blob under the job namespace. Fingerprint source text, source path, engine/prompt version, model, terms, purpose and prior context. Never share caches across jobs/owners; incomplete or invalid results are not cached. Retries reuse completed ranges even if a sibling request failed. Max four concurrent requests initially; benchmark may justify eight within provider limits. In-flight legacy jobs are not automatically migrated.

Evidence validation requires nonempty exact source substrings and non-noop replacements. Preserve positional offsets, syntax checks, review controls, explicit approval hash and export checks. Overlapping/conflicting proposals are reported for human review rather than silently hidden. Invalid evidence is an error requiring retry/manual review, never a clean result.

Coverage/metrics record engine version, total/planned/completed ranges, AI requests/cache hits and elapsed time. User labels describe stages, not misleading resets. A fast job exposes 'Reviewing content' then 'Checking cross-file context'; stage progress does not claim time remaining.

## Verification and rollout
Unit tests: full-range coverage at boundaries, Unicode, minified source, embedded data, cross-file aliases, uncertainty, repeated occurrences, overlap handling, cache isolation/invalidation, failed batch/replay, legacy compatibility and approval gate. Run full suite, typecheck, build and fresh review.

A live benchmark compares baseline and candidate on the same seeded source, same model, same concurrency, with exact known risk evidence and benign CSS controls; measure cold-run wall time and requests, not just theoretical call reduction. Include a larger sparse-risk prototype fixture and a dense multi-file fixture. Both must detect all seeded high-risk facts; candidate cannot lose baseline detected seeded facts or introduce source/syntax errors. Report measured results and limits honestly. A small synthetic benchmark cannot prove universal no-regression. Do not switch the production default if these quality checks fail. A 10x claim requires measured >=10x speed on an explicitly named fixture; otherwise report the target unmet and keep the candidate opt-in.

## Non-goals
No guarantee of perfect confidentiality, no 1GB individual-document support, no image/OCR capability, no full project production-readiness certification. No automatic edits or approval bypass. No changes to active user review results.

## Builder-check decisions
- Coverage takes priority: the first implementation retains full shared-context verification for multi-range inputs. Targeted windows are a utility for future evaluated optimisation, not a basis for skipping source. Single-range inputs can finish after the combined pass because all source context is present together. Independent full residual review still runs after export.
- Store engine in assessment metadata; export copies it even if environment defaults change.
- Run at least three paired cold trials for the latency fixture, alternate baseline/candidate ordering, report individual and median timings; every run must pass seeded quality checks. Dense multi-file correctness case supplements the timing fixture.
