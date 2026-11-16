import { expect, it } from "vitest";
import { reviewStage } from "../lib/review-stage";
it("keeps uploading and assessment before review and approval", () => {
  expect(reviewStage()).toBe(0);
  expect(reviewStage("uploading")).toBe(0);
  expect(reviewStage("processing")).toBe(0);
  expect(reviewStage("review")).toBe(1);
  expect(reviewStage("approved")).toBe(2);
  expect(reviewStage("complete")).toBe(2);
});
