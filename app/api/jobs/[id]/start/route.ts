import { head } from "@vercel/blob";
import { requireUser, sameOrigin } from "@/lib/auth";
import { locked, readJob, saveJob } from "@/lib/store";
import { processing } from "@/lib/durable-review";
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
      if (job.status !== "uploading")
        throw new Error("This upload has already been queued.");
      for (const input of job.inputs || []) {
        const blob = await head(input.key);
        if (blob.size !== input.size)
          throw new Error(
            "Upload incomplete. Retry the upload before starting.",
          );
      }
      job.status = "processing";
      job.processing = processing("index");
      job.processing.engine = job.reviewEngine || job.processing.engine;
      await saveJob(job);
    });
    await startReview(id, owner);
    return Response.json({ id });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not start review." },
      { status: 400 },
    );
  }
}
