import type { Job } from "./types";
export function reviewStage(status?: Job["status"]): number {
  if (status === "review") return 1;
  if (status === "approved" || status === "complete") return 2;
  return 0;
}
