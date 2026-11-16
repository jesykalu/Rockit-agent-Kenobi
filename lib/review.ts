import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { isCssMargin } from "./review-copy";
import { contextualReview } from "./contextual-review";
import type { AssetFile, Finding, Job, Decision } from "./types";

export const digest = (value: unknown) =>
  createHash("sha256")
    .update(
      JSON.stringify(value, (_key, item) => {
        // JSONB preserves values but not object-key insertion order.
        if (item && typeof item === "object" && !Array.isArray(item))
          return Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, item[key]]),
          );
        return item;
      }),
    )
    .digest("hex");
export const sourceDigest = (files: AssetFile[]) =>
  digest(
    files.map((f) => ({
      path: f.path,
      content: f.content,
      text: f.text,
      kind: f.kind,
    })),
  );
const rules: {
  category: string;
  pattern: RegExp;
  replacement: string;
  reason: string;
}[] = [
  {
    category: "Client data & confidential content",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: "person@example.invalid",
    reason: "Email address may identify a client or individual.",
  },
  {
    category: "Client data & confidential content",
    pattern:
      /(?:[$£€]\s?\d[\d,.]*(?:\s?(?:million|billion|thousand|[mkbn]+))?\b|\b(?:USD|GBP|EUR)\s?\d[\d,.]*)/gi,
    replacement: "[financial amount removed]",
    reason: "Financial amount may disclose pricing, revenue or deal value.",
  },
  {
    category: "Client data & confidential content",
    pattern:
      /\b(?:pricing|margin|revenue|contract value|discount|day rate|commercial terms)\s*[:=]\s*[^\n<>]{1,120}/gi,
    replacement: "[commercial detail removed]",
    reason: "Commercial terms or financial performance.",
  },
  {
    category: "Technical hygiene",
    pattern:
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g,
    replacement: "REDACTED_SECRET",
    reason:
      "Potential credential. Remove it and revoke or rotate the original credential; editing this copy does not invalidate it.",
  },
  {
    category: "Technical hygiene",
    pattern:
      /(?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]\s*["'][^"'\n]{6,}["']/gi,
    replacement: "",
    reason:
      "Possible hardcoded secret. Review a syntax-safe replacement and rotate the original credential.",
  },
];
export function scanFile(file: AssetFile, terms: string[]): Finding[] {
  const findings: Finding[] = [];
  function add(
    start: number,
    end: number,
    category: string,
    replacement: string,
    reason: string,
  ) {
    if (findings.some((f) => start < f.end && end > f.start)) return;
    findings.push({
      id: randomUUID(),
      path: file.path,
      category,
      reason,
      original: file.text.slice(start, end),
      replacement,
      start,
      end,
      line: file.text.slice(0, start).split("\n").length,
      source: "rule",
    });
  }
  for (const rule of rules)
    for (const m of file.text.matchAll(
      new RegExp(rule.pattern.source, rule.pattern.flags),
    )) {
      if (/^[^@]+@[^@]+\.invalid$/i.test(m[0])) continue;
      if (isCssMargin(m[0])) continue;
      add(
        m.index!,
        m.index! + m[0].length,
        rule.category,
        rule.replacement,
        rule.reason,
      );
    }
  for (const term of terms.filter((t) => t.trim().length > 1)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const m of file.text.matchAll(new RegExp(escaped, "gi")))
      add(
        m.index!,
        m.index! + m[0].length,
        "Client branding & identity",
        "Example organisation",
        "Known client, project or engagement reference.",
      );
  }
  return findings.sort((a, b) => a.start - b.start);
}
export async function assess(
  files: AssetFile[],
  terms: string[],
  useAI: boolean,
  purpose: "initial" | "residual" = "initial",
  priorContext: NonNullable<Job["assessment"]>["context"] = [],
) {
  const local = files.flatMap((f) => scanFile(f, terms));
  const warnings = files.flatMap((f) =>
    f.warnings.map((w) => `${f.path}: ${w}`),
  );
  if (!useAI)
    return {
      assessment: undefined,
      findings: local,
      warnings: [
        ...warnings,
        "Limited local scan: detects supplied names and common patterns only. It does not assess client context. Images, original metadata and filenames require manual review.",
      ],
    };
  const result = await contextualReview(files, terms, purpose, priorContext);
  // Contextual proposals take precedence; retain non-overlapping local safeguards.
  const findings = [
    ...result.findings,
    ...local.filter(
      (f) =>
        !result.findings.some(
          (a) => a.path === f.path && f.start < a.end && f.end > a.start,
        ),
    ),
  ];
  if (findings.length > 2000)
    throw new Error(
      "More than 2,000 findings. Split this source set; no incomplete review was saved.",
    );
  return {
    ...result,
    findings: findings.sort(
      (a, b) => a.path.localeCompare(b.path) || a.start - b.start,
    ),
    warnings: [
      ...warnings,
      ...result.warnings,
      "AI findings are suggestions, not certification. Human review is required before sharing.",
    ],
  };
}
export const approvalSchema = z.object({
  reviewer: z.string().trim().min(1).max(120),
  sourceHash: z.string(),
  acknowledged: z.literal(true),
  brand: z.boolean(),
  decisions: z.array(
    z.object({
      id: z.string(),
      decision: z.enum(["accept", "reject"]),
      replacement: z.string().max(10000),
    }),
  ),
});
export function approve(job: Job, input: unknown): Job {
  if (job.status !== "review")
    throw new Error(
      "This job has already been approved. Start a new review to change it.",
    );
  const parsed = approvalSchema.parse(input);
  if (
    parsed.sourceHash !== job.sourceHash ||
    sourceDigest(job.files) !== job.sourceHash
  )
    throw new Error("Source has changed. A fresh review is required.");
  const ids = new Set(parsed.decisions.map((d) => d.id));
  if (
    ids.size !== job.findings.length ||
    ids.size !== parsed.decisions.length ||
    job.findings.some((f) => !ids.has(f.id))
  )
    throw new Error(
      "Explicitly accept or reject every finding before approval.",
    );
  for (const finding of job.findings) {
    const decision = parsed.decisions.find((d) => d.id === finding.id)!;
    if (
      decision.decision === "accept" &&
      decision.replacement === finding.original
    )
      throw new Error(
        "An accepted change must differ from the original. Reject it to keep the original text.",
      );
  }
  const approval = {
    reviewer: parsed.reviewer,
    at: new Date().toISOString(),
    decisions: parsed.decisions,
    brand: parsed.brand,
    acknowledged: true as const,
  };
  return {
    ...job,
    status: "approved",
    approval: {
      ...approval,
      hash: digest({
        sourceHash: job.sourceHash,
        findings: job.findings,
        ...approval,
      }),
    },
  };
}
export function verifyApproval(job: Job) {
  if (!job.approval || !["approved", "complete"].includes(job.status))
    throw new Error("Human approval is required before execution.");
  const { hash, ...approval } = job.approval;
  if (
    sourceDigest(job.files) !== job.sourceHash ||
    digest({
      sourceHash: job.sourceHash,
      findings: job.findings,
      ...approval,
    }) !== hash
  )
    throw new Error(
      "Approval or source snapshot has changed. Execution refused.",
    );
}
export function applyDecisions(
  file: AssetFile,
  findings: Finding[],
  decisions: Decision[],
): string {
  let result = file.text;
  const selected = findings
    .filter(
      (f) =>
        f.path === file.path &&
        decisions.find((d) => d.id === f.id)?.decision === "accept",
    )
    .sort((a, b) => b.start - a.start);
  let previous = file.text.length;
  for (const finding of selected) {
    if (
      finding.end > previous ||
      file.text.slice(finding.start, finding.end) !== finding.original
    )
      throw new Error("Overlapping or stale edits. Review again.");
    const replacement = decisions.find((d) => d.id === finding.id)!.replacement;
    result =
      result.slice(0, finding.start) + replacement + result.slice(finding.end);
    previous = finding.start;
  }
  return result;
}
