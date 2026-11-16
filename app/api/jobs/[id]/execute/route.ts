import { NextResponse } from "next/server";
import { requireUser, sameOrigin } from "@/lib/auth";
import { readJob, saveJob, locked, writeOutput } from "@/lib/store";
import { buildExport } from "@/lib/export";
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
    await locked(id, async () => {
      const job = await readJob(id, owner);
      if (job.status === "complete") return;
      const { bytes, report } = await buildExport(job);
      await writeOutput(id, bytes);
      await saveJob({ ...job, status: "complete", report });
    });
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
