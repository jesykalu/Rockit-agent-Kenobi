import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import PptxGenJS from "pptxgenjs";
import { zipSync } from "fflate";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Job, Finding, AssetFile } from "./types";
import { extract } from "./ingest";
import { applyDecisions, assess, verifyApproval } from "./review";

export const BRAND_DESCRIPTION =
  "HTML: add an Accenture header and purple/white typography stylesheet. PDF and PowerPoint: rebuild reviewed text in an Accenture template. Code: include an opt-in Accenture CSS file and logo, without automatically rewiring application components. Original document images, notes, metadata and layout are discarded. Unsupported binary files are excluded. Source filenames are preserved for code imports; inspect them before sharing.";
const BRAND_CSS =
  ":root{--kenobi-brand:#A100FF}body{font-family:Arial,sans-serif;color:#18121e;background:#fff}h1,h2,h3,a{color:#7500c0}.kenobi-brand{padding:20px 32px;border-bottom:1px solid #ddd}.kenobi-brand img{width:140px;height:auto}button,input[type=submit]{background:#7500c0;color:#fff}";
function wrap(text: string, measure: (s: string) => number, max: number) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const char of paragraph) {
      if (measure(line + char) > max && line) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}
async function pdf(text: string, brand: boolean, logo: Uint8Array) {
  const doc = await PDFDocument.create();
  doc.setTitle("Reviewed asset");
  doc.setAuthor(brand ? "Accenture" : "");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const mark = brand ? await doc.embedPng(logo) : null;
  let page = doc.addPage([595, 842]),
    y = 770;
  function header() {
    if (mark)
      page.drawImage(mark, {
        x: 42,
        y: 790,
        width: 70,
        height: (70 * mark.height) / mark.width,
      });
  }
  header();
  for (const line of wrap(text, (s) => font.widthOfTextAtSize(s, 11), 511)) {
    if (y < 48) {
      page = doc.addPage([595, 842]);
      y = 770;
      header();
    }
    page.drawText(line, {
      x: 42,
      y,
      size: 11,
      font,
      color: rgb(0.09, 0.06, 0.12),
    });
    y -= 16;
  }
  return doc.save();
}
async function pptx(text: string, brand: boolean, logo: Uint8Array) {
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.author = brand ? "Accenture" : "";
  deck.subject = "Reviewed text";
  deck.title = "Reviewed asset";
  const lines = wrap(text, (s) => s.length, 90);
  for (let i = 0; i < lines.length; i += 16) {
    const slide = deck.addSlide();
    slide.background = { color: "FFFFFF" };
    if (brand)
      slide.addImage({
        data: `data:image/png;base64,${Buffer.from(logo).toString("base64")}`,
        x: 0.55,
        y: 0.25,
        w: 0.9,
        h: 0.535,
      });
    slide.addText(lines.slice(i, i + 16).join("\n"), {
      x: 0.55,
      y: 1.1,
      w: 12.1,
      h: 5.8,
      fontFace: "Arial",
      fontSize: 20,
      color: "18121E",
      breakLine: false,
      margin: 0,
      paraSpaceAfter: 4,
    });
  }
  return new Uint8Array(
    (await deck.write({ outputType: "arraybuffer" })) as ArrayBuffer,
  );
}
export async function buildExport(job: Job) {
  verifyApproval(job);
  const approval = job.approval!;
  const entries: Record<string, Uint8Array> = {};
  const logo = new Uint8Array(
    await readFile(path.join(process.cwd(), "public/accenture-logo.png")),
  );
  let changedFiles = 0,
    excludedFiles = 0,
    residualFindings = 0;
  const warnings = [...job.warnings];
  const outputFiles: AssetFile[] = [];
  for (let i = 0; i < job.files.length; i++) {
    const file = job.files[i];
    if (file.kind === "binary") {
      excludedFiles++;
      continue;
    }
    let text = applyDecisions(file, job.findings, approval.decisions);

    const changed = text !== file.text;
    let bytes: Uint8Array,
      filename = file.path;
    if (file.kind === "pdf") {
      bytes = await pdf(text, approval.brand, logo);
      filename = `document-${i + 1}.pdf`;
    } else if (file.kind === "pptx") {
      bytes = await pptx(text, approval.brand, logo);
      filename = `presentation-${i + 1}.pptx`;
    } else {
      if (approval.brand && /\.html?$/i.test(file.path)) {
        const header = `<header class="kenobi-brand"><img alt="Accenture" src="data:image/png;base64,${Buffer.from(logo).toString("base64")}"></header>`;
        text = /<body\b[^>]*>/i.test(text)
          ? text.replace(/<body\b[^>]*>/i, (m) => m + header)
          : header + text;
        text += `\n<style>${BRAND_CSS}</style>`;
      }
      bytes = Buffer.from(text, "utf8");
    }
    entries[`asset/${filename}`] = bytes;
    outputFiles.push(await extract(filename, bytes));
    if (
      changed ||
      file.kind !== "text" ||
      (approval.brand && /\.html?$/i.test(file.path))
    )
      changedFiles++;
  }
  if (approval.brand) {
    entries["kenobi-brand/accenture.css"] = Buffer.from(BRAND_CSS);
    entries["kenobi-brand/accenture-logo.png"] = logo;
  }
  const checked = await assess(
    outputFiles,
    job.clientTerms,
    job.mode === "ai",
    "residual",
    job.assessment?.context,
  );
  const residualDetails = checked.findings;
  residualFindings = residualDetails.length;
  warnings.push(...checked.warnings);
  const rejectedFindings = approval.decisions.filter(
    (d) => d.decision === "reject",
  ).length;
  const report = {
    contextualCheck: job.mode === "ai",
    changedFiles,
    excludedFiles,
    residualFindings,
    residualDetails,
    rejectedFindings,
    warnings,
  };
  // Shareable manifest intentionally contains no original strings, filenames or replacements.
  entries["review-report.json"] = Buffer.from(
    JSON.stringify(
      {
        jobId: job.id,
        approvedAt: approval.at,
        approvalHash: approval.hash,
        sourceHash: job.sourceHash,
        changedFiles,
        excludedFiles,
        residualFindings,
        rejectedFindings,
        assessmentMode: job.mode,
        contextualCheck: job.mode === "ai",
        brandApplied: approval.brand,
        notice:
          "Reviewed output, not a guarantee of confidentiality. Inspect before sharing. Detailed evidence remains in the private review workspace.",
      },
      null,
      2,
    ),
  );
  entries["READ-ME.txt"] = Buffer.from(
    "Kenobi reviewed output\n\nFiles under asset/ contain the approved edits. Binary files and Git history are excluded. PDFs and presentations are rebuilt from extracted text, not layout-preserving redactions. Branding files are under kenobi-brand/; application code must explicitly import them. Source paths may retain sensitive names. Reinstall dependencies and test source code before use. Revoke any exposed credentials. Rejected findings and detected residual risks are counted in review-report.json. This export is not a certification that all sensitive information has been found.\n",
  );
  return { bytes: zipSync(entries), report };
}
