import { it, expect } from "vitest";
import { selectReviewMode } from "../lib/review-mode";
it("keeps the existing default and permits an explicit fast preview", () => {
  expect(selectReviewMode("ai")).toEqual({ mode: "ai", engine: undefined });
  expect(selectReviewMode("fast")).toEqual({ mode: "ai", engine: "fast-v2" });
  expect(selectReviewMode("local")).toEqual({
    mode: "local",
    engine: undefined,
  });
  expect(() => selectReviewMode("unknown")).toThrow();
});
