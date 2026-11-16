// ─────────────────────────────────────────────────────────────────────────────
// KENOBI — the Rockit asset white-labelling agent.
// "These aren't the client assets you're looking for."
//
// This file is Kenobi's editable "skill set" — the cleansing rules and the
// Accenture reskin targets. Edit THIS file to change what the risk assessment
// recommends and what Kenobi does when it cleanses an asset. No other code needs
// to change: add/remove/reword rules, or adjust the brand targets, right here.
// ─────────────────────────────────────────────────────────────────────────────

export interface CleansingRule {
  id: string;
  detect: string; // what Kenobi looks for
  action: string; // what Kenobi does about it
  severity: "must-fix" | "recommended";
}

export interface CleansingCategory {
  category: string;
  description: string;
  rules: CleansingRule[];
}

// ── Accenture reskin targets (applied when creating the white-labelled version) ──
// Change these to update the brand Kenobi reskins assets to.
export const RESKIN_TARGETS = {
  // Accenture primary brand colour (purple). Client colour tokens/variables are remapped to this.
  primaryColor: "#A100FF",
  // Optional accent (Rockit fern green). Set to null to use purple only.
  accentColor: "#3DB19A" as string | null,
  // Client logos are removed and replaced with the Accenture logo.
  logo: "Accenture logo",
  // Preferred font. Graphik is Accenture's brand font (licensed — supply web-font files);
  // until then Kenobi uses the fallback.
  font: "Graphik",
  fontFallback: "Inter",
};

// ── The cleansing skill set (grouped by category) ──
export const CLEANSING_CATEGORIES: CleansingCategory[] = [
  {
    category: "Client branding & identity",
    description:
      "Remove every visible trace of the client's brand and replace with Accenture.",
    rules: [
      {
        id: "logo",
        detect: "Client logos or logo image files",
        action: "Remove and replace with the Accenture logo",
        severity: "must-fix",
      },
      {
        id: "name",
        detect: "Client name / brand in text, headings, titles, copy",
        action: "Replace with a neutral placeholder or remove",
        severity: "must-fix",
      },
      {
        id: "product",
        detect: "Client product names, project names or codenames",
        action: "Genericise or remove",
        severity: "must-fix",
      },
      {
        id: "urls",
        detect: "Client domains, URLs, email addresses",
        action: "Remove or replace with placeholders",
        severity: "must-fix",
      },
      {
        id: "meta",
        detect: "Favicon, page title, meta tags referencing the client",
        action: "Replace with Accenture/neutral values",
        severity: "must-fix",
      },
      {
        id: "imagery",
        detect: "Client photos, brand imagery or brand icons",
        action: "Remove or replace with neutral imagery",
        severity: "must-fix",
      },
    ],
  },
  {
    category: "Accenture reskin",
    description: "Apply Accenture look and feel in place of the client's.",
    rules: [
      {
        id: "colors",
        detect: "Client colour scheme / brand colour tokens in CSS",
        action: `Remap to the Accenture palette (primary ${RESKIN_TARGETS.primaryColor})`,
        severity: "must-fix",
      },
      {
        id: "logo-apply",
        detect: "Header/footer branding slots",
        action: "Place the Accenture logo",
        severity: "must-fix",
      },
      {
        id: "font",
        detect: "Client / non-Accenture fonts",
        action: `Apply ${RESKIN_TARGETS.font} (fallback ${RESKIN_TARGETS.fontFallback})`,
        severity: "recommended",
      },
    ],
  },
  {
    category: "Client data & confidential content",
    description: "Strip anything that is or looks like real client data.",
    rules: [
      {
        id: "figures",
        detect: "Real client data, financials, figures, deal sizes",
        action: "Remove",
        severity: "must-fix",
      },
      {
        id: "pii",
        detect: "PII — names, emails, phone numbers of client individuals",
        action: "Remove",
        severity: "must-fix",
      },
      {
        id: "commercial",
        detect: "Commercial, pricing or proposal specifics",
        action: "Remove",
        severity: "must-fix",
      },
      {
        id: "sampledata",
        detect: "Sample data that looks real",
        action: "Replace with clearly synthetic / dummy data",
        severity: "must-fix",
      },
    ],
  },
  {
    category: "Existence sensitivity",
    description:
      "Neutralise anything that reveals the engagement itself exists.",
    rules: [
      {
        id: "implied",
        detect:
          "Text implying the engagement exists (e.g. 'M&A screening for [client]')",
        action: "Genericise so no client/engagement is implied",
        severity: "must-fix",
      },
      {
        id: "coderefs",
        detect: "Client references in code comments, README or config",
        action: "Remove or genericise",
        severity: "must-fix",
      },
    ],
  },
  {
    category: "Technical hygiene",
    description: "Remove secrets and client-specific technical wiring.",
    rules: [
      {
        id: "secrets",
        detect: "Hardcoded secrets, API keys or tokens",
        action: "Remove",
        severity: "must-fix",
      },
      {
        id: "endpoints",
        detect: "Client-specific API endpoints or connection strings",
        action: "Remove or replace with placeholders",
        severity: "must-fix",
      },
      {
        id: "analytics",
        detect: "Analytics IDs tied to the client",
        action: "Remove",
        severity: "recommended",
      },
    ],
  },
];

// Category names only — used by the risk assessment to group its recommendations.
export const CLEANSING_CATEGORY_NAMES = CLEANSING_CATEGORIES.map(
  (c) => c.category,
);

// A compact, human-readable rendering of the skill set — used to build Kenobi's
// prompt and to show reviewers what the agent will check for.
export function renderCleansingSkills(): string {
  const brand = `Accenture brand targets: primary colour ${RESKIN_TARGETS.primaryColor}${RESKIN_TARGETS.accentColor ? `, accent ${RESKIN_TARGETS.accentColor}` : ""}, ${RESKIN_TARGETS.logo}, font ${RESKIN_TARGETS.font} (fallback ${RESKIN_TARGETS.fontFallback}).`;
  const cats = CLEANSING_CATEGORIES.map((c) => {
    const rules = c.rules
      .map((r) => `  - [${r.severity}] ${r.detect} → ${r.action}`)
      .join("\n");
    return `${c.category} — ${c.description}\n${rules}`;
  }).join("\n\n");
  return `${cats}\n\n${brand}`;
}
