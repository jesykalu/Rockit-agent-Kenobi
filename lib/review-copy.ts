import type { Finding, Decision } from "./types";

// CSS spacing is layout, not a commercial margin. Keep percentage-based financial
// margins outside style blocks eligible for review.
export function isCssMargin(text: string) {
  return /^margin\s*:\s*(?:-?(?:\d*\.)?\d+(?:px|rem|em|vh|vw)|0|auto|initial|inherit|unset|var\([^)]*\)|calc\([^)]*\))(?:\s+(?:-?(?:\d*\.)?\d+(?:px|rem|em|vh|vw)|0|auto)){0,3}\s*(?:;|})/i.test(
    text,
  );
}
export function findingCopy(f: Finding) {
  if (f.source === "rule" && isCssMargin(f.original))
    return {
      title: "Page spacing — incorrectly flagged",
      risk: "This controls spacing on the page. It is not a financial margin. An earlier scan incorrectly flagged it.",
      action:
        "Choose Keep original to preserve the layout. Upload the file again to run the corrected scan.",
    };
  if (f.source !== "rule")
    return {
      title: f.category,
      risk: f.reason,
      action:
        "Check the exact text below. You can accept the suggestion, write your own replacement, or keep the original.",
    };
  if (f.replacement === "Example organisation")
    return {
      title: "Client or project name",
      risk: "This name matches a client, project or engagement you asked us to look for. Sharing it could identify the work or organisation.",
      action:
        "Replace the name with a neutral example name so the material can be reused.",
    };
  if (f.replacement === "person@example.invalid")
    return {
      title: "Email address",
      risk: "This email address could identify a person or client.",
      action:
        "Replace it with a fictional email address that cannot receive mail.",
    };
  if (f.replacement === "[financial amount removed]")
    return {
      title: "Financial amount",
      risk: "This amount could reveal a price, fee, revenue figure or deal value.",
      action:
        "Remove the amount and put the words “[financial amount removed]” in its place.",
    };
  if (f.replacement === "[commercial detail removed]")
    return {
      title: "Commercial information",
      risk: "This text may reveal pricing, discounts, revenue or profit information.",
      action:
        "Replace the highlighted text with “[commercial detail removed]”. You can write a more suitable neutral description instead.",
    };
  return {
    title: "Possible password or access key",
    risk: "This text may give someone access to an account or system.",
    action:
      "Remove the exposed value and ask the account owner to replace the original password or key. Editing this file alone does not disable it. For code, check that your replacement keeps it working.",
  };
}
export function acceptRemaining(
  findings: Finding[],
  decisions: Record<string, Decision>,
) {
  const next = { ...decisions };
  for (const f of findings)
    if (!next[f.id] && !(f.source === "rule" && isCssMargin(f.original)))
      next[f.id] = { id: f.id, decision: "accept", replacement: f.replacement };
  return next;
}
