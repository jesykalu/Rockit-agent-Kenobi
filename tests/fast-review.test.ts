import { expect, it } from "vitest";
import {
  planRanges,
  contextRanges,
  validateAnalysis,
  analysisKey,
} from "../lib/fast-review";
it("covers every character in minified and Unicode text with bounded overlapping ranges", () => {
  const text = "const demo='銀行';".repeat(30000);
  const ranges = planRanges(text);
  expect(ranges.length).toBeGreaterThan(1);
  let end = 0;
  for (const r of ranges) {
    expect(r.offset).toBeLessThanOrEqual(end);
    expect(r.length).toBeLessThanOrEqual(120000);
    expect(r.offset + r.length).toBeGreaterThan(end);
    end = r.offset + r.length;
  }
  expect(end).toBe(text.length);
  expect(planRanges("   ")).toEqual([]);
});
it("merges nearby context matches and visits distant repeated references", () => {
  const text = "Cedar nearby Cedar" + "x".repeat(10000) + "cedar";
  const ranges = contextRanges(text, ["Cedar", "Cedar"]);
  expect(ranges).toHaveLength(2);
  expect(ranges[0].offset).toBe(0);
  expect(ranges[1].offset + ranges[1].length).toBe(text.length);
});
it("rejects invented evidence and no-op edits", () => {
  const result = {
    entities: [],
    findings: [
      {
        original: "Acme",
        replacement: "Acme",
        category: "Client",
        reason: "Client name",
        suggestion: "Generalise",
        confidence: "high" as const,
      },
    ],
    uncertain: [],
  };
  expect(() => validateAnalysis("a.txt", "Acme", result)).toThrow();
  expect(() =>
    validateAnalysis("a.txt", "Other", {
      ...result,
      findings: [{ ...result.findings[0], replacement: "a bank" }],
    }),
  ).toThrow();
});
it("keys include path, context, terms, model and source", () => {
  const input = {
    path: "a.txt",
    text: "Acme",
    terms: [],
    purpose: "initial",
    priorContext: [],
    model: "model",
  };
  const key = analysisKey(input);
  for (const change of [
    { path: "b.txt" },
    { text: "Other" },
    { terms: ["Acme"] },
    { purpose: "residual" },
    { model: "other" },
    { priorContext: [{ original: "Acme" }] },
  ])
    expect(analysisKey({ ...input, ...change })).not.toBe(key);
});
