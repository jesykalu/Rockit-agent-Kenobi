import { it, expect, vi, afterEach } from "vitest";
import { extract } from "../lib/ingest";
import { assess, approve, sourceDigest } from "../lib/review";
import { buildExport } from "../lib/export";
import type { Job } from "../lib/types";
const reply = (value: unknown, status = "completed") =>
  new Response(
    JSON.stringify({
      status,
      output: [
        { content: [{ type: "output_text", text: JSON.stringify(value) }] },
      ],
    }),
  );
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("shares discovered client context across files and validates every exact edit", async () => {
  vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
  const files = await Promise.all([
    extract(
      "brief.txt",
      Buffer.from("Northstar Bank commissioned Project Cedar."),
    ),
    extract(
      "notes.html",
      Buffer.from("<p>Cedar launches in Bristol next quarter.</p>"),
    ),
  ]);
  const requests: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      const input = JSON.parse(body.input);
      if (body.instructions.includes("Discover client"))
        return reply({
          entities: [
            {
              original: input.path === "brief.txt" ? "Project Cedar" : "Cedar",
              type: "project",
              meaning: "Client engagement codename",
            },
          ],
        });
      expect(
        input.sharedEvidence.some((e: any) => e.original === "Project Cedar"),
      ).toBe(true);
      return reply({
        findings: [
          {
            original: input.path === "brief.txt" ? "Northstar Bank" : "Cedar",
            replacement:
              input.path === "brief.txt" ? "A retail bank" : "The programme",
            category: "Client identity",
            reason: "Identifies the client engagement.",
            suggestion: "Use a neutral description.",
            confidence: "high",
          },
          {
            original: "invented source",
            replacement: "example",
            category: "Client",
            reason: "unsupported",
            suggestion: "remove",
            confidence: "low",
          },
        ],
      });
    }),
  );
  const result = await assess(files, [], true);
  expect(result.findings).toHaveLength(2);
  expect(result.warnings.some((w) => w.includes("discarded"))).toBe(true);
  expect(
    result.findings.every(
      (f) =>
        files.find((x) => x.path === f.path)!.text.slice(f.start, f.end) ===
        f.original,
    ),
  ).toBe(true);
  expect(requests.every((r) => r.store === false && r.text.format.strict)).toBe(
    true,
  );
  expect(result.assessment?.context).toHaveLength(2);
});
it("fails closed for an incomplete response and never substitutes a basic scan", async () => {
  vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply({ entities: [] }, "incomplete")),
  );
  await expect(
    assess(
      [await extract("test.txt", Buffer.from("Client-specific material"))],
      [],
      true,
    ),
  ).rejects.toThrow("did not finish");
});
it("reassesses generated output and refuses release if contextual verification fails", async () => {
  vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 429 })),
  );
  const file = await extract(
    "test.txt",
    Buffer.from("Client reference retained"),
  );
  const job: Job = {
    id: "test",
    owner: "test",
    createdAt: "now",
    source: "upload",
    sourceHash: sourceDigest([file]),
    status: "review",
    mode: "ai",
    clientTerms: [],
    files: [file],
    findings: [],
    warnings: [],
  };
  const approved = approve(job, {
    reviewer: "test",
    sourceHash: job.sourceHash,
    acknowledged: true,
    brand: false,
    decisions: [],
  });
  await expect(buildExport(approved)).rejects.toThrow("usage or rate limit");
});
