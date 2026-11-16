export function selectReviewMode(value: unknown): {
  mode: "local" | "ai";
  engine?: "fast-v2";
} {
  if (value === "local") return { mode: "local", engine: undefined };
  if (value === "ai") return { mode: "ai", engine: undefined };
  if (value === "fast") return { mode: "ai", engine: "fast-v2" };
  throw new Error("Choose an available assessment method.");
}
