import { requireUser } from "@/lib/auth";
import { readJob, readOutput } from "@/lib/store";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const job = await readJob(id, requireUser(request));
    if (job.status !== "complete")
      return Response.json(
        { error: "Execute an approved review before downloading." },
        { status: 409 },
      );
    const bytes = await readOutput(id);
    const part = Number(new URL(request.url).searchParams.get("part") || 0),
      chunk = 1_000_000;
    if (!Number.isInteger(part) || part < 0 || part * chunk >= bytes.length)
      return Response.json(
        { error: "Invalid download part." },
        { status: 400 },
      );
    return new Response(
      new Uint8Array(bytes.subarray(part * chunk, (part + 1) * chunk)),
      {
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Total-Parts": String(Math.ceil(bytes.length / chunk)),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return Response.json({ error: "Output not found." }, { status: 404 });
  }
}
