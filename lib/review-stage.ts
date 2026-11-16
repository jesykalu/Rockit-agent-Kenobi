import type { Job } from "./types";
export function reviewStage(status?: Job["status"]): number {
  if (status === "review") return 1;
  if (status === "approved" || status === "complete") return 2;
  return 0;
}
export function assessmentProgress(
  p: NonNullable<Job["processing"]>,
  mode: Job["mode"],
) {
  const second = p.phase === "assess" || p.phase === "verify-assess";
  const first = p.phase === "discover" || p.phase === "verify-discover";
  const twoPasses = mode === "ai" && (first || second);
  return {
    max: Math.max(1, p.total * (twoPasses ? 2 : 1)),
    value: p.cursor + (twoPasses && second ? p.total : 0),
    label: twoPasses ? `Pass ${second ? 2 : 1} of 2` : "Current stage",
  };
}
