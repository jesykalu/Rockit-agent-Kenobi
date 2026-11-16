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
    changedFiles: number;
    excludedFiles: number;
    residualFindings: number;
    residualDetails: Finding[];
    rejectedFindings: number;
    warnings: string[];
  };
}
