import { expect, it } from "vitest";
import { reviewStage, assessmentProgress } from "../lib/review-stage";
it("keeps uploading and assessment before review and approval", () => {
  expect(reviewStage()).toBe(0);
  expect(reviewStage("uploading")).toBe(0);
  expect(reviewStage("processing")).toBe(0);
  expect(reviewStage("review")).toBe(1);
  expect(reviewStage("approved")).toBe(2);
  expect(reviewStage("complete")).toBe(2);
});

it("keeps assessment progress continuous between AI passes", () => {
  const base = { total: 176, cursor: 176 };
  const first = assessmentProgress(
    { ...base, phase: "discover" } as Parameters<typeof assessmentProgress>[0],
    "ai",
  );
  const second = assessmentProgress(
    { ...base, cursor: 0, phase: "assess" } as Parameters<
      typeof assessmentProgress
    >[0],
    "ai",
  );
  expect(first.value).toBe(second.value);
  expect(second.max).toBe(352);
  expect(second.label).toBe("Pass 2 of 2");
  expect(
    assessmentProgress(
      { ...base, phase: "assess" } as Parameters<typeof assessmentProgress>[0],
      "local",
    ).max,
  ).toBe(176);
});
