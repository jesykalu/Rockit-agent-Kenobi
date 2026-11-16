export interface AssetFile {
  path: string;
  content: string;
  kind: "text" | "pdf" | "pptx" | "binary";
  text: string;
  warnings: string[];
  storageKey?: string;
  textLength?: number;
  textHash?: string;
  chunkOffsets?: number[];
  reviewRanges?: { offset: number; length: number }[];
  exportKey?: string;
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
  status: "uploading" | "processing" | "review" | "approved" | "complete";
  mode: "local" | "ai";
  clientTerms: string[];
  files: AssetFile[];
  findings: Finding[];
  warnings: string[];
  processing?: {
    engine?: "fast-v2";
    metrics?: { uncachedResults: number; cacheHits: number; startedAt: string };
    phase:
      | "index"
      | "discover"
      | "assess"
      | "export"
      | "verify-discover"
      | "verify-assess"
      | "package";
    cursor: number;
    total: number;
    error?: string;
    findings?: Finding[];
    updatedAt: string;
    runId?: string;
    generation: string;
    context: NonNullable<Job["assessment"]>["context"];
    chunks: { file: number; offset: number; length?: number }[];
    outputs?: AssetFile[];
  };
  inputs?: { path: string; key: string; size: number }[];
  outputKey?: string;
  excludedCount?: number;
  inventory?: {
    path: string;
    input: number;
    offset?: number;
    compressed?: number;
    size: number;
    method?: number;
    crc?: number;
    excluded?: string;
  }[];
  assessment?: {
    engine?: "fast-v2";
    metrics?: { uncachedResults: number; cacheHits: number; elapsedMs: number };
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
  draft?: { decisions: Decision[]; brand: boolean; retainedFiles?: string[] };
  approval?: {
    reviewer: string;
    at: string;
    hash: string;
    decisions: Decision[];
    brand: boolean;
    acknowledged: true;
    retainedFiles?: string[];
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
