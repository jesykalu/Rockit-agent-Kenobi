import { requireUser, sameOrigin } from "@/lib/auth";
import { startUpload } from "@/lib/uploads";
export async function POST(request: Request) {
  try {
    const owner = requireUser(request);
    sameOrigin(request);
    const input = await request.json();
    return Response.json(await startUpload(owner, input.files));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not start upload.",
      },
      { status: 400 },
    );
  }
}
