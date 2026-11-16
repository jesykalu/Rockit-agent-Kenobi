import type { Job } from "./types";
import { SOURCE_PAGE_CHARS } from "./upload-limits";
export function sourcePage(job: Job, fileIndex: number, page: number) {
  if (
    !Number.isInteger(fileIndex) ||
    fileIndex < 0 ||
    fileIndex >= job.files.length
  )
    throw new Error("File not found.");
  const text = job.files[fileIndex].text,
    totalPages = Math.max(1, Math.ceil(text.length / SOURCE_PAGE_CHARS));
  if (!Number.isInteger(page) || page < 0 || page >= totalPages)
    throw new Error("Source page not found.");
  const start = page * SOURCE_PAGE_CHARS,
    end = Math.min(text.length, start + SOURCE_PAGE_CHARS);
  return {
    text: text.slice(start, end),
    page,
    totalPages,
    start,
    end,
    totalChars: text.length,
  };
}
