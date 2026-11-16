import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser, sameOrigin } from "@/lib/auth";
import { readJob, saveJob, locked, deleteJob } from "@/lib/store";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const job = await readJob((await params).id, requireUser(request));
    return NextResponse.json({
      ...job,
      files: job.files.map(({ content, ...rest }) => rest),
    });
  } catch {
    return NextResponse.json({ error: "Review not found." }, { status: 404 });
  }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    const owner = requireUser(request);
    sameOrigin(request);
    const { id } = await params;
    const input = await request.json();
    await locked(id, async () => {
      const job = await readJob(id, owner);
      if (job.status !== "review")
        throw new Error("Approved reviews are locked.");
      if (input.type === "draft") {
        const draft = z
          .object({
            brand: z.boolean(),
            decisions: z
              .array(
                z.object({
                  id: z.string(),
                  decision: z.enum(["accept", "reject"]),
                  replacement: z.string().max(10000),
                }),
              )
              .max(2000),
          })
          .parse(input);
        if (
          new Set(draft.decisions.map((d) => d.id)).size !==
            draft.decisions.length ||
          draft.decisions.some((d) => !job.findings.some((f) => f.id === d.id))
        )
          throw new Error("Invalid draft decisions.");
        job.draft = draft;
        await saveJob(job);
        return;
      }
      const file = job.files.find((f) => f.path === input.path);
      if (
        !file ||
        typeof input.original !== "string" ||
        !input.original ||
        typeof input.replacement !== "string" ||
        input.replacement.length > 10000
      )
        throw new Error("Choose a file and supply the exact text to replace.");
      let start = file.text.indexOf(input.original),
        added = 0;
      while (start >= 0) {
        const end = start + input.original.length;
        if (
          !job.findings.some(
            (f) => f.path === file.path && start < f.end && end > f.start,
          )
        ) {
          job.findings.push({
            id: randomUUID(),
            path: file.path,
            original: input.original,
            replacement: input.replacement,
            reason: "Added by the reviewer.",
            category: "Reviewer finding",
            source: "reviewer",
            start,
            end,
            line: file.text.slice(0, start).split("\n").length,
          });
          added++;
        }
        start = file.text.indexOf(input.original, end);
      }
      if (!added)
        throw new Error("Text was not found or overlaps an existing finding.");
      await saveJob(job);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not add finding.",
      },
      { status: 400 },
    );
  }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    const owner = requireUser(request);
    sameOrigin(request);
    const { id } = await params;
    await locked(id, async () => {
      await readJob(id, owner);
      await deleteJob(id);
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Could not delete this review." },
      { status: 400 },
    );
  }
}
