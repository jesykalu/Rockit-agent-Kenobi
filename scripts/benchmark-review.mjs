// Hosted benchmark: credentials stay in the existing private connection files.
// Run from workspace parent: node kenobi/scripts/benchmark-review.mjs
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import postgres from "../node_modules/postgres/src/index.js";
import { put } from "../node_modules/@vercel/blob/dist/client.js";
import ts from "../node_modules/typescript/lib/typescript.js";
const a = JSON.parse(fs.readFileSync("work/production-auth.json"));
const auth =
  "Basic " + Buffer.from(a.username + ":" + a.password).toString("base64");
const sql = postgres(fs.readFileSync("work/kenobi-db-url.txt", "utf8").trim(), {
  max: 1,
  prepare: false,
});
async function api(path, body, method = "POST") {
  const r = await fetch(a.origin + path, {
    method,
    headers: {
      authorization: auth,
      origin: a.origin,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || String(r.status));
  return j;
}
let seeds = [
  "Northstar Bank",
  "Cedar",
  "BranchBridge",
  "17%",
  "£48 million",
  "jane.smith@northstar.example",
];
const statements = [
  "<h1>Confidential: Northstar Bank prototype</h1>",
  "<p>Our confidential client project is Project Cedar.</p>",
  "<p>Client-only proprietary system: BranchBridge.</p>",
  "<p>Confidential contract discount: 17%.</p>",
  "<p>Non-public revenue forecast: £48 million.</p>",
  "<p>Private client contact: jane.smith@northstar.example</p>",
];
let text =
  "<html><style>.card { margin: 0 auto; padding: 8px; }</style><body>\n";
for (let i = 0; i < 4500; i++) {
  if (i % 750 === 0) text += statements[i / 750] + "\n";
  text += `<section id="item-${i}"><p>Reusable interface component with accessible navigation and responsive layout.</p></section>\n`;
}
text += "</body></html>";
let files = [{ name: "synthetic-prototype.html", bytes: Buffer.from(text) }];
const fixture = process.env.BENCHMARK_CASE || "sparse";
if (fixture === "dense") {
  files = [
    {
      name: "brief.txt",
      bytes: Buffer.from(
        "Confidential engagement: Northstar Bank commissioned Project Cedar. The client is also referred to internally as Maple. The proprietary system is BranchBridge. Non-public revenue forecast: £48 million. Private client contact: jane.smith@northstar.example.",
      ),
    },
    {
      name: "app.js",
      bytes: Buffer.from(
        'const customer = "Maple"; const discount = "17%"; const system = "BranchBridge"; console.log(customer, discount, system);',
      ),
    },
    {
      name: "settings.json",
      bytes: Buffer.from(
        JSON.stringify({
          client: "Northstar Bank",
          project: "Cedar",
          contract: "Confidential contract discount: 17%.",
        }),
      ),
    },
  ];
  seeds = [...seeds, "Maple"];
}
const reportFile = `outputs/fast-review-benchmark-${fixture}.json`;

async function run(engine) {
  let id;
  const started = Date.now();
  try {
    const prepared = await api("/api/assets", {
      files: files.map((f) => ({ name: f.name, size: f.bytes.length })),
      mode: "ai",
      terms: [],
    });
    id = prepared.id;
    for (let i = 0; i < files.length; i++)
      await put(prepared.uploads[i].key, files[i].bytes, {
        access: "private",
        token: prepared.uploads[i].token,
        multipart: true,
      });
    if (engine === "legacy") await api(`/api/jobs/${id}/start`, {});
    else {
      // Only this synthetic test job is seeded with the optional engine; no production default or user job changes.
      await sql.begin(async (tx) => {
        const rows =
          await tx`select document from kenobi_private.reviews where id=${id}`;
        const j = rows[0].document;
        j.status = "processing";
        j.processing = {
          engine: "fast-v2",
          phase: "index",
          cursor: 0,
          total: 0,
          updatedAt: new Date().toISOString(),
          generation: randomUUID(),
          context: [],
          chunks: [],
          findings: [],
          error: "Start synthetic candidate benchmark",
          metrics: {
            uncachedResults: 0,
            cacheHits: 0,
            startedAt: new Date().toISOString(),
          },
        };
        await tx`update kenobi_private.reviews set document=${tx.json(j)}::jsonb where id=${id}`;
      });
      await api(`/api/jobs/${id}/retry`, {});
    }
    let previous = "";
    for (let i = 0; i < 480; i++) {
      const j = await api(`/api/jobs/${id}`, undefined, "GET");
      if (j.processing?.error) throw new Error(j.processing.error);
      const state = j.processing
        ? `${j.processing.phase}:${j.processing.cursor}/${j.processing.total}`
        : j.status;
      if (previous !== state) {
        console.log(engine, state);
        previous = state;
      }
      if (j.status === "review") {
        const missing = seeds.filter(
          (s) => !j.findings.some((f) => f.original.includes(s)),
        );
        const falseSpacing = j.findings.some(
          (f) =>
            f.original.includes("margin:") || f.original.includes("padding:"),
        );
        const sensitiveRanges = statements.map((statement) => ({
          start: text.indexOf(statement),
          end: text.indexOf(statement) + statement.length,
        }));
        const benignFindings = j.findings.filter((f) =>
          fixture === "sparse"
            ? !sensitiveRanges.some((r) => f.start < r.end && f.end > r.start)
            : f.original.includes("console.log"),
        );
        let exactEvidence = true,
          validSyntax = true;
        for (const f of files) {
          let source = f.bytes.toString();
          const findings = j.findings
            .filter((x) => x.path === f.name)
            .sort((a, b) => b.start - a.start);
          for (const finding of findings) {
            if (source.slice(finding.start, finding.end) !== finding.original)
              exactEvidence = false;
            source =
              source.slice(0, finding.start) +
              finding.replacement +
              source.slice(finding.end);
          }
          if (f.name.endsWith(".js")) {
            const checked = ts.transpileModule(source, {
              fileName: f.name,
              reportDiagnostics: true,
              compilerOptions: {
                allowJs: true,
                target: ts.ScriptTarget.ES2022,
              },
            });
            if (
              checked.diagnostics?.some(
                (d) => d.category === ts.DiagnosticCategory.Error,
              )
            )
              validSyntax = false;
          }
          if (f.name.endsWith(".json")) {
            try {
              JSON.parse(source);
            } catch {
              validSyntax = false;
            }
          }
        }
        const result = {
          engine,
          elapsedMs: Date.now() - started,
          bytes: files.reduce((n, f) => n + f.bytes.length, 0),
          findings: j.findings.length,
          missing,
          falseSpacing,
          benignFindings: benignFindings.length,
          benignExamples: benignFindings.slice(0, 3).map((f) => f.original),
          exactEvidence,
          validSyntax,
          assessment: j.assessment
            ? {
                model: j.assessment.model,
                version: j.assessment.version,
                reviewedChunks: j.assessment.reviewedChunks,
                metrics: j.assessment.metrics,
              }
            : undefined,
        };
        console.log(JSON.stringify(result));
        return result;
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    throw new Error("Benchmark deadline exceeded");
  } finally {
    if (id) await api(`/api/jobs/${id}`, undefined, "DELETE");
  }
}
const results = [];
try {
  for (
    let trial = 0;
    trial < Number(process.env.BENCHMARK_PAIRS || 3);
    trial++
  ) {
    for (const engine of trial % 2
      ? ["fast-v2", "legacy"]
      : ["legacy", "fast-v2"]) {
      results.push({ trial, ...(await run(engine)) });
      fs.writeFileSync(
        reportFile,
        JSON.stringify({ fixture, concurrency: 4, results }, null, 2),
      );
    }
  }
} finally {
  await sql.end();
}
const quality = results.every(
  (r) =>
    r.missing.length === 0 &&
    !r.falseSpacing &&
    r.exactEvidence &&
    r.validSyntax &&
    (r.engine !== "fast-v2" || r.benignFindings === 0),
);
fs.writeFileSync(
  reportFile,
  JSON.stringify(
    { fixture, concurrency: 4, qualityPassed: quality, results },
    null,
    2,
  ),
);
console.log(JSON.stringify({ qualityPassed: quality }));
if (!quality) process.exitCode = 1;
