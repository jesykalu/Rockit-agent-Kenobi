import { requireUser } from "@/lib/auth";
import { readJob } from "@/lib/store";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const job = await readJob((await params).id, requireUser(request));
    const exclusions = (job.inventory || [])
      .filter((f) => f.excluded)
      .map((f) => ({ path: f.path, reason: f.excluded, size: f.size }));
    return Response.json(exclusions, {
      headers: {
        "Content-Disposition":
          'attachment; filename="kenobi-private-exclusions.json"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "Review not found." }, { status: 404 });
  }
}
