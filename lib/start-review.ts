import { start } from "workflow/api";
import { runReview } from "../workflows/review";
import { readJob } from "./store";
export async function startReview(id: string, owner: string) {
  const job = await readJob(id, owner),
    p = job.processing;
  if (!p) throw new Error("No queued work.");
  const run = await start(runReview, [
    id,
    owner,
    p.generation,
    p.phase,
    p.cursor,
  ]);
  return run.runId;
}
