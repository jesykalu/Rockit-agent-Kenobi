import { it, expect } from "vitest";
import { extract } from "../lib/ingest";
import { scanFile, approve, applyDecisions, sourceDigest } from "../lib/review";
import { acceptRemaining, findingCopy } from "../lib/review-copy";
import type { Job } from "../lib/types";
it("does not mistake CSS spacing for financial margin; retains financial findings", async () => {
  const f = await extract(
    "test.html",
    Buffer.from(
      "<style>body { margin: 0; padding: 0; } p {margin: 0 auto;} div {margin: 12px;}</style><p>margin: 25%; revenue: 120000</p>",
    ),
  );
  const findings = scanFile(f, []);
  expect(findings.some((x) => x.original.includes("margin: 0"))).toBe(false);
  expect(findings.some((x) => x.original.includes("margin: 12px"))).toBe(false);
  expect(findings.some((x) => x.original.includes("margin: 25%"))).toBe(true);
});
it("bulk decisions preserve custom replacements and explicit retained risks through execution", async () => {
  const f = await extract(
    "test.html",
    Buffer.from("<p>Acme. Fee £12,000. person@client.com</p>"),
  );
  const findings = scanFile(f, ["Acme"]);
  const decisions = acceptRemaining(findings, {
    [findings[0].id]: {
      id: findings[0].id,
      decision: "accept",
      replacement: "A retail organisation",
    },
    [findings[1].id]: {
      id: findings[1].id,
      decision: "reject",
      replacement: findings[1].replacement,
    },
  });
  expect(Object.keys(decisions)).toHaveLength(3);
  const job: Job = {
    id: "test",
    owner: "owner",
    createdAt: new Date().toISOString(),
    source: "upload",
    sourceHash: sourceDigest([f]),
    status: "review",
    mode: "local",
    clientTerms: ["Acme"],
    files: [f],
    findings,
    warnings: [],
  };
  const approved = approve(job, {
    reviewer: "owner",
    sourceHash: job.sourceHash,
    acknowledged: true,
    brand: false,
    decisions: Object.values(decisions),
  });
  job.status = "approved";
  const output = applyDecisions(f, findings, approved.approval!.decisions);
  expect(JSON.stringify(output)).toContain("A retail organisation");
  expect(JSON.stringify(output)).toContain("£12,000");
  expect(JSON.stringify(output)).not.toContain("person@client.com");
  expect(findingCopy(findings[0]).title).toBe("Client or project name");
});
