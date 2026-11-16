import { NextResponse } from "next/server";
import { requireUser, sameOrigin } from "@/lib/auth";
import { readJob, saveJob, locked, writeOutput } from "@/lib/store";
import { verifyApproval } from "@/lib/review";
import { exportProcessing } from "@/lib/durable-review";
import { startReview } from "@/lib/start-review";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const owner = requireUser(request);
    sameOrigin(request);
    const { id } = await params;
    let queued = false;
    await locked(id, async () => {
      const job = await readJob(id, owner);
      if (job.status === "complete") return;
      verifyApproval(job);
      if (job.processing) return;
      job.processing = exportProcessing(job);
      await saveJob(job);
      queued = true;
    });
    if (queued) await startReview(id, owner);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Export failed. No output was released.",
      },
      { status: 400 },
    );
  }
}
