export interface AssetFile {
  path: string;
  content: string;
  kind: "text" | "pdf" | "pptx" | "binary";
  text: string;
  warnings: string[];
}
export interface Finding {
  id: string;
  path: string;
  category: string;
  reason: string;
  original: string;
  replacement: string;
  start: number;
  end: number;
  line: number;
  source: "rule" | "ai" | "reviewer";
  suggestion?: string;
  confidence?: "high" | "medium" | "low";
}
export interface Decision {
  id: string;
  decision: "accept" | "reject";
  replacement: string;
}
export interface Job {
  owner: string;
  id: string;
  createdAt: string;
  source: string;
  sourceHash: string;
  status: "review" | "approved" | "complete";
  mode: "local" | "ai";
  clientTerms: string[];
  files: AssetFile[];
  findings: Finding[];
  warnings: string[];
  assessment?: {
    version: string;
    provider: string;
    model: string;
    reviewedChunks: number;
    context: {
      path: string;
      original: string;
      type: string;
      meaning: string;
    }[];
    purpose: string;
  };
  draft?: { decisions: Decision[]; brand: boolean };
  approval?: {
    reviewer: string;
    at: string;
    hash: string;
    decisions: Decision[];
    brand: boolean;
    acknowledged: true;
  };
  report?: {
    contextualCheck?: boolean;
    changedFiles: number;
    excludedFiles: number;
    residualFindings: number;
    residualDetails: Finding[];
    rejectedFindings: number;
    warnings: string[];
  };
}
