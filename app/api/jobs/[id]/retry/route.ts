import { randomUUID } from "node:crypto";
import { requireUser, sameOrigin } from "@/lib/auth";
import { locked, readJob, saveJob } from "@/lib/store";
import { startReview } from "@/lib/start-review";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const owner = requireUser(request);
    sameOrigin(request);
    const { id } = await params;
    await locked(id, async () => {
      const job = await readJob(id, owner);
      if (!job.processing) throw new Error("No assessment to resume.");
      if (
        !job.processing.error &&
        Date.now() - Date.parse(job.processing.updatedAt) < 180000
      )
        throw new Error("Processing is still active. Please wait.");
      job.processing.generation = randomUUID();
      job.processing.error = undefined;
      job.processing.updatedAt = new Date().toISOString();
      await saveJob(job);
    });
    await startReview(id, owner);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not resume review." },
      { status: 400 },
    );
  }
}
