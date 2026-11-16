import { randomUUID } from "node:crypto";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { z } from "zod";
import { requireUser, sameOrigin } from "@/lib/auth";
import { saveJob } from "@/lib/store";
import { safePath } from "@/lib/ingest";
import { MAX_PACKAGE_BYTES } from "@/lib/large-ingest";
import { aiConfiguration } from "@/lib/contextual-review";
import type { Job } from "@/lib/types";
export async function POST(request: Request) {
  try {
    const owner = requireUser(request);
    sameOrigin(request);
    const input = z
      .object({
        files: z
          .array(
            z.object({
              name: z.string(),
              size: z.number().int().positive().max(MAX_PACKAGE_BYTES),
            }),
          )
          .min(1)
          .max(1500),
        mode: z.enum(["local", "ai"]),
        terms: z.array(z.string()).max(100),
      })
      .parse(await request.json());
    if (input.files.reduce((n, f) => n + f.size, 0) > MAX_PACKAGE_BYTES)
      throw new Error("Maximum package size is 2 GB.");
    if (input.mode === "ai" && !aiConfiguration().configured)
      throw new Error("Contextual AI is not configured.");
    const id = randomUUID(),
      inputs = input.files.map((f, i) => ({
        path: safePath(f.name),
        key: `reviews/${id}/inputs/${i}`,
        size: f.size,
      }));
    if (new Set(inputs.map((i) => i.path.toLowerCase())).size !== inputs.length)
      throw new Error("Duplicate filenames. Use a ZIP to preserve paths.");
    const job: Job = {
      id,
      owner,
      createdAt: new Date().toISOString(),
      source: `${inputs.length} uploaded asset(s)`,
      status: "uploading",
      mode: input.mode,
      clientTerms: input.terms,
      files: [],
      findings: [],
      warnings: [],
      sourceHash: "",
      inputs,
    };
    await saveJob(job);
    const uploads = await Promise.all(
      inputs.map(async (input) => ({
        key: input.key,
        token: await generateClientTokenFromReadWriteToken({
          pathname: input.key,
          maximumSizeInBytes: input.size,
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: Date.now() + 24 * 60 * 60 * 1000,
        }),
      })),
    );
    return Response.json({ id, uploads });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not prepare upload." },
      { status: 400 },
    );
  }
}
