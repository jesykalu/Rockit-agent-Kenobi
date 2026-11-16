import { requireUser, sameOrigin } from "@/lib/auth";
import { saveChunk, readChunk, discardUpload } from "@/lib/uploads";
type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, { params }: Context) {
  try {
    const owner = requireUser(request);
    sameOrigin(request);
    const { id } = await params;
    const part = Number(new URL(request.url).searchParams.get("part"));
    await saveChunk(id, owner, part, await readChunk(request));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: 400 },
    );
  }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    const owner = requireUser(request);
    sameOrigin(request);
    await discardUpload((await params).id, owner);
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "Could not discard upload." },
      { status: 400 },
    );
  }
}
