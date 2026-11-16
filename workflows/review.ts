import { advanceReview, failReview } from "../lib/durable-review";
export async function runReview(
  id: string,
  owner: string,
  generation: string,
  phase: string,
  cursor: number,
) {
  "use workflow";
  try {
    while (true) {
      const result = await step(id, owner, generation, `${phase}:${cursor}`);
      if (result.done) return;
      phase = result.phase;
      cursor = result.cursor;
    }
  } catch (error) {
    await failed(
      id,
      owner,
      generation,
      error instanceof Error
        ? error.message.slice(0, 300)
        : "Processing failed",
    );
  }
}
async function step(
  id: string,
  owner: string,
  generation: string,
  expected: string,
) {
  "use step";
  return advanceReview(id, owner, generation, expected);
}
async function failed(
  id: string,
  owner: string,
  generation: string,
  reason: string,
) {
  "use step";
  await failReview(id, owner, generation, reason);
}
