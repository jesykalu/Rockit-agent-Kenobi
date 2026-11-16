import { NextResponse } from "next/server";
import { requireUser, sameOrigin } from "@/lib/auth";
import { readJob, saveJob, locked } from "@/lib/store";
import { approve } from "@/lib/review";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const owner = requireUser(request);
    sameOrigin(request);
    const { id } = await params;
    const input = await request.json();
    await locked(id, async () => {
      const job = await readJob(id, owner);
      await saveJob(approve(job, { ...input, reviewer: owner }));
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Approval failed." },
      { status: 400 },
    );
  }
}
