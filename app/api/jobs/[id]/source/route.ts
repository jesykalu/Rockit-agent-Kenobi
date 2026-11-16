import { loadAsset } from "@/lib/asset-storage";
import { requireUser } from "@/lib/auth";
import { readJob } from "@/lib/store";
import { sourcePage } from "@/lib/source-page";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const job = await readJob((await params).id, requireUser(request));
    const query = new URL(request.url).searchParams;
    const fileIndex = Number(query.get("file") || 0);
    if (!Number.isInteger(fileIndex) || !job.files[fileIndex])
      throw new Error("File not found");
    job.files[fileIndex] = await loadAsset(job.files[fileIndex]);
    return Response.json(
      sourcePage(
        job,
        Number(query.get("file") || 0),
        Number(query.get("page") || 0),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Source page not found." }, { status: 404 });
  }
}
