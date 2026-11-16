# Faster Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and benchmark a faster full-coverage contextual review engine with human approval unchanged.
**Architecture:** Versioned range planner and combined AI analysis, followed by context reconciliation. Durable per-range private caches and legacy fallback.
**Tech Stack:** TypeScript, Next.js, Vercel Workflow/Blob, Postgres, OpenAI Responses, Vitest.
**Spec:** docs/superpowers/specs/2026-11-16-fast-review-design.md

## Global Constraints
- Max range 120,000 characters, overlap 2,000; newline boundary search 6,000.
- Same model; no content sampling; exact-source evidence; explicit human approval.
- Engine selected by KENOBI_REVIEW_ENGINE=fast-v2 and pinned per job.
- Do not alter running legacy jobs. No production default without quality gate.

## Review Focus
- Long minified lines and Unicode: no lost intervals or infinite loops.
- Cross-file references found late: all literal occurrences revisited with shared context.
- Dense findings/output truncation: error, never marked complete.
- Failed concurrent siblings: completed results survive and are not requested again.
- Legacy approvals and residual exports: no change to source hash or approval contract.

### Task 1: Range planning and source evidence
Files: create lib/fast-review.ts, tests/fast-review.test.ts.
Interfaces: planRanges(text:string): {offset:number,length:number}[]; contextRanges(text:string,terms:string[]): same ranges; combine evidence validates exact substrings.
- [ ] Write boundary, coverage, empty/masked content and merged context-window tests; run red.
- [ ] Implement planner with newline preferences, overlap and coverage accounting; run green.
- [ ] Commit planner.

### Task 2: Combined model and cached results
Files: lib/fast-review.ts, lib/contextual-review.ts, lib/review-cache.ts, tests/fast-review.test.ts.
Interfaces: analyzeRange(path,text,terms,purpose,priorContext) returns {entities,findings,uncertain}; cachedRange(jobId,key,producer) persists validated result and returns cache hit information.
- [ ] Write combined schema/evidence, model-failure and cache fingerprint tests; run red.
- [ ] Implement combined prompt using existing rules and modelJson. Cache only valid completed responses; preserve all occurrence mapping.
- [ ] Verify failure/retry and source integrity; commit.

### Task 3: Durable integration and UI
Files: lib/types.ts, lib/durable-review.ts, lib/asset-storage.ts, lib/review-stage.ts, app/workspace.tsx, tests/durable-review.test.ts, tests/review-stage.test.ts.
Interfaces: optional processing.engine='fast-v2', chunk.length; source range metadata, reconciliation quotes and metrics. Legacy fields remain compatible.
- [ ] Add failing integration cases for combined first pass, cross-context second pass, replay, failed sibling cache and approval gating.
- [ ] Pin engine, plan ranges, batch combined calls, merge exact evidence, build reconciliation ranges, keep local rules and residual review. Reuse source loads per batch.
- [ ] Label fast phases correctly; test legacy and fast progress. Run suite/typecheck/build; commit.

### Task 4: Benchmark, independent review and rollout
Files: scripts/benchmark-review.ts, tests/fixtures/review-benchmark.ts, outputs report copied outside repo.
- [ ] Create seeded sparse/dense fixtures and expected evidence before model runs.
- [ ] Run both engines against identical fixtures/model; record elapsed time, requests and seeded recall/false positives.
- [ ] Fresh whole-branch reviewer checks design and implementation; fix important findings with regression tests.
- [ ] Enable fast engine only if quality gate passes; claim 10x only if measured. Smoke-test hosted upload/assessment/approval/export where deployed. Preserve existing jobs.
- [ ] Commit report and publish tested source; report limitations and measured result.
