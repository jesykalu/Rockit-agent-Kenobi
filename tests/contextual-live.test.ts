import { it, expect } from "vitest";
import { extract } from "../lib/ingest";
import { assess, approve, sourceDigest } from "../lib/review";
import { buildExport } from "../lib/export";
import { unzipSync } from "fflate";
import type { Job } from "../lib/types";
it.skipIf(!process.env.KENOBI_LIVE_AI_TEST)(
  "detects an unnamed fictional engagement and exports approved generalisations",
  async () => {
    const files = await Promise.all([
      extract(
        "brief.html",
        Buffer.from(
          "<html><head><style>body {margin: 0; padding: 0;} .card {margin: 0 auto;}</style></head><body><h1>Northstar Bank branch transformation</h1><p>Prepared exclusively for Northstar Bank. Project Cedar will replace its legacy system BranchBridge across 43 Bristol branches in Q4 2027. The unreleased strategy is to close the least profitable branches before the merger announcement. Our preferred-supplier agreement guarantees a 17% discount for the next three years.</p><p>Reusable approach: interview staff, map customer journeys, prototype and test.</p></body></html>",
        ),
      ),
      extract(
        "implementation.txt",
        Buffer.from(
          "Cedar rollout playbook. BranchBridge connects to https://staff.northstar.example/internal. The sponsor is Maya Chen, Northstar transformation director. Reusable method: validate accessibility and performance before release.",
        ),
      ),
    ]);
    const result = await assess(files, [], true);

    const originals = result.findings.map((f) => f.original).join("\n");
    expect(originals).toContain("Northstar");
    expect(originals).toContain("Cedar");
    expect(originals).toContain("BranchBridge");
    expect(
      result.findings.some((f) =>
        /discount|preferred-supplier|17%/.test(f.original),
      ),
    ).toBe(true);
    expect(
      result.findings.some((f) => /merger|close the least/.test(f.original)),
    ).toBe(true);
    expect(result.findings.some((f) => /margin:/.test(f.original))).toBe(false);
    const job: Job = {
      id: "synthetic-ai-eval",
      owner: "test",
      createdAt: new Date().toISOString(),
      source: "synthetic fixtures",
      sourceHash: sourceDigest(files),
      status: "review",
      mode: "ai",
      clientTerms: [],
      files,
      ...result,
    };
    const approved = approve(job, {
      reviewer: "test",
      sourceHash: job.sourceHash,
      acknowledged: true,
      brand: false,
      decisions: job.findings.map((f) => ({
        id: f.id,
        decision: "accept",
        replacement: f.replacement,
      })),
    });
    const exported = await buildExport(approved);
    const zip = unzipSync(exported.bytes);
    const all = Object.entries(zip)
      .filter(([path]) => path.startsWith("asset/"))
      .map(([, v]) => Buffer.from(v).toString())
      .join("\n");
    expect(all).not.toContain("Northstar");
    expect(all).not.toContain("Cedar");
    expect(all).not.toContain("BranchBridge");
    expect(all).toContain("margin: 0 auto;");
    expect(all).toContain(
      "interview staff, map customer journeys, prototype and test",
    );
    expect(exported.report.contextualCheck).toBe(true);
    console.log(
      JSON.stringify({
        liveAI: true,
        model: result.assessment?.model,
        findings: result.findings.length,
        contextClues: result.assessment?.context.length,
        client: true,
        project: true,
        internalSystem: true,
        commercial: true,
        strategy: true,
        layoutPreserved: true,
        postCheck: true,
        residual: exported.report.residualFindings,
      }),
    );
  },
  240000,
);
