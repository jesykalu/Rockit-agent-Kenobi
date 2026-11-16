"use client";
import { put as uploadBlob } from "@vercel/blob/client";
import { useEffect, useState, useRef } from "react";
import type { Job, Decision } from "@/lib/types";
import { MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from "@/lib/upload-limits";
import { reviewStage, assessmentProgress } from "@/lib/review-stage";
import { findingCopy, acceptRemaining } from "@/lib/review-copy";
type ViewJob = Omit<Job, "files"> & {
  files: (Omit<Job["files"][number], "content" | "text"> & {
    textLength: number;
  })[];
};
export default function Workspace({
  ai,
}: {
  ai: { configured: boolean; provider: string; model: string };
}) {
  const [job, setJob] = useState<ViewJob | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const [decisions, setDecisions] = useState<Record<string, Decision>>({}),
    [brand, setBrand] = useState(true),
    [ack, setAck] = useState(false);
  const [selected, setSelected] = useState(""),
    [mode, setMode] = useState("ai");
  const [retainedFiles, setRetainedFiles] = useState<string[]>([]);
  const [draftState, setDraftState] = useState("Saved");
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const draftVersion = useRef(0);
  const [sourcePage, setSourcePage] = useState(0);
  const [source, setSource] = useState<{
    text: string;
    page: number;
    totalPages: number;
    start: number;
    end: number;
    totalChars: number;
  } | null>(null);
  const [customEditing, setCustomEditing] = useState<Record<string, boolean>>(
    {},
  );
  const [customText, setCustomText] = useState<Record<string, string>>({});
  const [sourceError, setSourceError] = useState("");
  const [lastReview, setLastReview] = useState<string | null>(null);
  useEffect(() => {
    setLastReview(localStorage.getItem("kenobi-last-review"));
  }, []);
  useEffect(() => {
    if (!job?.processing) return;
    const timer = setInterval(
      () => load(job.id).catch((e) => setError(e.message)),
      4000,
    );
    return () => clearInterval(timer);
  }, [job?.id, !!job?.processing]);
  async function load(id: string) {
    const res = await fetch(`/api/jobs/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setJob(data);
    localStorage.setItem("kenobi-last-review", id);
    setSelected((s) => s || data.files[0]?.path || "");
    const saved = data.approval || data.draft;
    if (saved) {
      setDecisions(
        Object.fromEntries(saved.decisions.map((d: Decision) => [d.id, d])),
      );
      setBrand(saved.brand);
      setRetainedFiles(saved.retainedFiles || []);
    }
  }
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("review");
    if (id) load(id).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!job || !selected || job.processing) return;
    const controller = new AbortController();
    const fileIndex = job.files.findIndex((f) => f.path === selected);
    setSource(null);
    setSourceError("");
    fetch(`/api/jobs/${job.id}/source?file=${fileIndex}&page=${sourcePage}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setSource(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setSourceError(error.message);
      });
    return () => controller.abort();
  }, [job?.id, selected, sourcePage, !!job?.processing]);
  useEffect(() => {
    if (!job || job.status !== "review") return;
    const version = ++draftVersion.current;
    setDraftState("Saving draft…");
    const timer = setTimeout(() => {
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(async () => {
          await post(
            `/api/jobs/${job.id}`,
            {
              type: "draft",
              brand,
              retainedFiles,
              decisions: Object.values(decisions),
            },
            "PATCH",
          );
          if (version === draftVersion.current) setDraftState("Draft saved");
        })
        .catch(() => {
          if (version === draftVersion.current)
            setDraftState(
              "Draft not saved. Change a decision to retry; keep this page open.",
            );
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [decisions, brand, retainedFiles, job?.id, job?.status]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (job?.status === "review" && draftState !== "Draft saved") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draftState, job?.status]);
  async function action(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Retry this action.",
      );
    } finally {
      setBusy("");
    }
  }
  async function post(url: string, body?: unknown, method = "POST") {
    const response = await fetch(url, {
      method,
      headers:
        body instanceof FormData ? {} : { "Content-Type": "application/json" },
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  }
  const reviewed = job?.findings.filter((f) => decisions[f.id]).length || 0;
  const editable = job?.status === "review";
  const selectedFile = job?.files.find((f) => f.path === selected);
  const visible = job?.findings.filter((f) => f.path === selected) || [];
  return (
    <div className="shell">
      <header className="topbar">
        <a className="wordmark" href="/">
          Kenobi<span>Asset review</span>
        </a>
        <span className="private-label">Private review workspace</span>
      </header>
      <main>
        <nav className="steps" aria-label="Review progress">
          {["Upload & assess", "Review changes", "Approve & export"].map(
            (s, i) => (
              <span
                key={s}
                aria-current={
                  reviewStage(job?.status) === i ? "step" : undefined
                }
              >
                <b>{i + 1}</b>
                {s}
              </span>
            ),
          )}
        </nav>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        {busy && (
          <div role="status" className="status">
            {busy} Please keep this page open.
          </div>
        )}
        {!job ? (
          <>
            <div className="intro">
              <h1>
                Make it ready
                <br />
                for its next audience.
              </h1>
              <p>
                Find sensitive information. Review the proposed changes. Create
                an Accenture-branded copy when you’re ready.
              </p>
            </div>
            {lastReview && (
              <p>
                <a href={`?review=${lastReview}`}>Return to your last review</a>
              </p>
            )}
            <div className="intake-grid">
              <form
                className="intake"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  action("Preparing your upload.", async () => {
                    const files = form
                      .getAll("files")
                      .filter(
                        (f): f is File => f instanceof File && f.size > 0,
                      );
                    if (files.length && String(form.get("repo") || "").trim())
                      throw new Error(
                        "Choose uploaded files or a repository, not both.",
                      );
                    if (files.length) {
                      const total = files.reduce((n, f) => n + f.size, 0);
                      if (total > 2_000_000_000)
                        throw new Error("Package limit is 2 GB.");
                      const prepared = await post("/api/assets", {
                        files: files.map((f) => ({
                          name: f.name,
                          size: f.size,
                        })),
                        mode,
                        terms: String(form.get("terms") || "")
                          .split(/[,\n]/)
                          .map((t) => t.trim())
                          .filter(Boolean),
                      });
                      history.replaceState(null, "", `?review=${prepared.id}`);
                      localStorage.setItem("kenobi-last-review", prepared.id);
                      for (const [i, file] of files.entries()) {
                        setBusy(
                          `Uploading file ${i + 1} of ${files.length}: connecting to storage.`,
                        );
                        await uploadBlob(prepared.uploads[i].key, file, {
                          access: "private",
                          token: prepared.uploads[i].token,
                          multipart: true,
                          onUploadProgress: ({ percentage }) =>
                            setBusy(
                              `Uploading file ${i + 1} of ${files.length}: ${Math.round(percentage)}%.`,
                            ),
                        });
                      }
                      setBusy(
                        "Upload complete. Queuing background assessment.",
                      );
                      await post(`/api/jobs/${prepared.id}/start`);
                      await load(prepared.id);
                      return;
                    }
                    setBusy("Upload complete. Assessing your asset.");
                    const data = await post("/api/jobs", form);
                    history.replaceState(null, "", `?review=${data.id}`);
                    await load(data.id);
                  });
                }}
              >
                <h2>Add your source</h2>
                <label htmlFor="files">Upload files or a codebase ZIP</label>
                <input
                  id="files"
                  name="files"
                  type="file"
                  multiple
                  aria-describedby="file-help"
                />
                <p className="hint" id="file-help">
                  HTML, code, text-based PDF, PPTX or ZIP. Packages up to 2 GB;
                  individual files up to 25 MB are assessed. Larger files and
                  dependency folders are listed as excluded. GitHub imports: up
                  to 25 MB. Legacy .ppt files need conversion to .pptx.
                </p>
                <div className="separator">or connect a repository</div>
                <label htmlFor="repo">GitHub repository URL</label>
                <input
                  id="repo"
                  name="repo"
                  type="url"
                  placeholder="https://github.com/organisation/repository"
                />
                <p className="hint">
                  Private repositories use the host’s read-only GitHub token.
                  Upload a ZIP for other Git hosts.
                </p>
                <label htmlFor="terms">
                  Known client names or project terms (optional)
                </label>
                <textarea
                  id="terms"
                  name="terms"
                  rows={3}
                  placeholder="Optional clues. AI also looks for client details you have not named."
                />
                <label htmlFor="mode">Assessment method</label>
                <select
                  id="mode"
                  name="mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                >
                  <option value="local">
                    Local patterns — limited coverage
                  </option>
                  <option value="ai">Contextual AI review — OpenAI</option>
                </select>
                <p className="hint">
                  {mode === "ai"
                    ? ai.configured
                      ? `Text and source paths are sent to ${ai.provider} (${ai.model}) to identify client context, propose generalisations and check the exported text. Images and original document metadata are not assessed.`
                      : "Contextual review is not connected. Ask your administrator to configure OpenAI. A basic scan cannot assess client confidentiality."
                    : "Stays on this server. Finds supplied names, email addresses, common financial terms and credential patterns. It will miss contextual risks."}
                </p>
                <button
                  className="primary"
                  disabled={!!busy || (mode === "ai" && !ai.configured)}
                >
                  Review asset
                </button>
              </form>
              <aside className="explanation">
                <h2>You decide what changes.</h2>
                <p>
                  Each finding includes the source text and a proposed
                  replacement. Edit it, accept it, or keep the original.
                </p>
                <ol>
                  <li>
                    <strong>Find the sensitive details</strong>
                    <p>
                      Client identity, commercial terms, financial information,
                      engagement references and credentials.
                    </p>
                  </li>
                  <li>
                    <strong>Approve a concrete plan</strong>
                    <p>
                      No edits run until you review every finding and approve
                      the change set.
                    </p>
                  </li>
                  <li>
                    <strong>Download a separate copy</strong>
                    <p>
                      Your original stays untouched. The export includes a
                      review summary and any outstanding risk counts.
                    </p>
                  </li>
                </ol>
                <div className="coverage">
                  <h3>Document handling</h3>
                  <p>
                    PDFs and PowerPoint are rebuilt from reviewed text. Original
                    imagery, layout, notes and embedded objects are discarded.
                    Text inside images needs a separate review.
                  </p>
                </div>
              </aside>
            </div>
          </>
        ) : job.processing || job.status === "uploading" ? (
          <section className="approval">
            <h1>
              {job.processing?.error
                ? "Assessment paused"
                : job.status === "uploading"
                  ? "Upload not yet complete"
                  : "Processing in the background"}
            </h1>
            {job.processing ? (
              <>
                <p>
                  {
                    {
                      index: "Indexing source files",
                      discover:
                        "Identifying client context — next, we use it to propose changes",
                      assess:
                        "Finding sensitive information and proposing changes — your review is next",
                      export: "Applying approved changes",
                      "verify-discover": "Checking exported client context",
                      "verify-assess": "Reviewing remaining risks",
                      package: "Packaging your download",
                    }[job.processing.phase]
                  }
                </p>
                <progress
                  max={assessmentProgress(job.processing, job.mode).max}
                  value={assessmentProgress(job.processing, job.mode).value}
                  aria-label="Assessment progress across both passes"
                />
                <p role="status">
                  {assessmentProgress(job.processing, job.mode).label}:{" "}
                  {job.processing.cursor} of {job.processing.total || "…"}{" "}
                  sections completed.
                </p>
                <p>
                  You can close this page. Processing continues on the server,
                  and completed steps are saved. Bookmark this page to return.
                </p>
                {job.processing.error && (
                  <p role="alert">{job.processing.error}</p>
                )}
                {(job.processing.error ||
                  Date.now() - Date.parse(job.processing.updatedAt) >
                    180000) && (
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      action("Resuming saved assessment.", async () => {
                        await post(`/api/jobs/${job.id}/retry`);
                        await load(job.id);
                      })
                    }
                  >
                    Retry from saved progress
                  </button>
                )}
              </>
            ) : (
              <p>
                The upload was interrupted before assessment started. Start a
                new review and select the source again.
              </p>
            )}
            <a href="/">Start another review</a>
            <details className="delete">
              <summary>Delete this review and its uploaded files</summary>
              <p>
                This permanently removes the uploaded source and saved
                assessment.
              </p>
              <button
                disabled={!!busy}
                onClick={() =>
                  action("Deleting review.", async () => {
                    await post(`/api/jobs/${job.id}`, undefined, "DELETE");
                    location.href = "/";
                  })
                }
              >
                Delete review permanently
              </button>
            </details>
          </section>
        ) : (
          <>
            <div className="review-title">
              <div>
                <h1>
                  {job.status === "review"
                    ? "Review the changes"
                    : job.status === "approved"
                      ? "Your plan is approved"
                      : "Your reviewed copy is ready"}
                </h1>
                <p>
                  {job.files.length} files · {job.findings.length} findings ·{" "}
                  {job.mode === "ai"
                    ? "Contextual AI assessment"
                    : "Limited local assessment"}
                </p>
              </div>
              <a className="text-link" href="/">
                Start another review
              </a>
            </div>
            {job.status === "complete" && (
              <div className="approval result">
                <p>
                  <strong>{job.report?.changedFiles} files changed.</strong>{" "}
                  {job.report?.excludedFiles} excluded ·{" "}
                  {job.report?.rejectedFindings} findings retained ·{" "}
                  {job.report?.residualFindings} remaining potential risks.
                </p>
                <p>
                  {job.report?.contextualCheck
                    ? "A second contextual AI check of the exported text is complete. "
                    : "Only a basic pattern check of the exported text was performed. "}
                  Inspect the result before sharing. Rebuilt documents may
                  differ from their source. Reinstall dependencies and test
                  exported code.
                </p>
                <button
                  className="primary download"
                  disabled={!!busy}
                  onClick={() =>
                    action("Downloading reviewed files.", async () => {
                      if (job.outputKey) {
                        location.href = `/api/jobs/${job.id}/download`;
                        return;
                      }
                      const parts: BlobPart[] = [];
                      let total = 1;
                      for (let part = 0; part < total; part++) {
                        const res = await fetch(
                          `/api/jobs/${job.id}/download?part=${part}`,
                        );
                        if (!res.ok)
                          throw new Error(
                            "Download failed. Retry the download.",
                          );
                        total = Number(res.headers.get("X-Total-Parts"));
                        parts.push(await res.arrayBuffer());
                      }
                      const url = URL.createObjectURL(
                        new Blob(parts, { type: "application/zip" }),
                      );
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = "kenobi-reviewed-output.zip";
                      link.click();
                      setTimeout(() => URL.revokeObjectURL(url), 10000);
                    })
                  }
                >
                  Download reviewed files (.zip)
                </button>
                {job.report?.residualDetails?.length ? (
                  <details>
                    <summary>
                      Inspect residual findings (
                      {job.report.residualDetails.length})
                    </summary>
                    {job.report.residualDetails.map((f) => (
                      <article key={f.id}>
                        <p>
                          <strong>{f.path}</strong> · Line {f.line}
                        </p>
                        <pre>{f.original}</pre>
                        <p>
                          <strong>Why this matters:</strong>{" "}
                          {findingCopy(f).risk}
                        </p>
                        <p>
                          <strong>Suggested change:</strong>{" "}
                          {findingCopy(f).action}
                        </p>
                      </article>
                    ))}
                  </details>
                ) : (
                  <p>
                    No remaining risks were detected by this{" "}
                    {job.report?.contextualCheck
                      ? "contextual AI and pattern"
                      : "basic pattern"}{" "}
                    check. This is not a guarantee. Inspect images, metadata and
                    the final result before sharing.
                  </p>
                )}
              </div>
            )}
            <details className="coverage" open={job.status !== "complete"}>
              <summary>
                Coverage & limitations · {job.warnings.length} notes
              </summary>
              <ul>
                {job.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
            {editable && (
              <section className="coverage" aria-label="Bulk review decisions">
                <button
                  disabled={!!busy || reviewed === job.findings.length}
                  onClick={() => {
                    setDecisions((d) => acceptRemaining(job.findings, d));
                    setAck(false);
                  }}
                >
                  Accept all changes
                </button>
                <p>
                  Accepts undecided suggestions across all files. Your own
                  replacements and “Keep original” decisions stay as they are.
                  Known incorrect spacing findings are skipped. Nothing is
                  applied until you approve and build the export.
                </p>
                <span role="status">
                  {reviewed} of {job.findings.length} findings decided
                </span>
              </section>
            )}
            {job.assessment && (
              <details className="coverage">
                <summary>
                  Client context identified · {job.assessment.context.length}{" "}
                  clues
                </summary>
                <p>
                  {job.assessment.provider} · {job.assessment.model} ·{" "}
                  {job.assessment.reviewedChunks} text sections assessed. These
                  are evidence-based hypotheses for you to verify.
                </p>
                {job.assessment.context.map((item, i) => (
                  <p key={i}>
                    <strong>{item.original}</strong> — {item.meaning}{" "}
                    <small>({item.path})</small>
                  </p>
                ))}
              </details>
            )}
            {Boolean(job.excludedCount) && (
              <p>
                {job.excludedCount} files were excluded before assessment.{" "}
                <a href={`/api/jobs/${job.id}/exclusions`}>
                  Download private exclusion list
                </a>
                . These files are not in the exported copy.
              </p>
            )}
            <div className="review-grid">
              <aside className="file-list">
                <h2>Source files</h2>
                {job.files.map((f) => (
                  <button
                    key={f.path}
                    className={selected === f.path ? "selected" : ""}
                    onClick={() => {
                      setSelected(f.path);
                      setSourcePage(0);
                    }}
                  >
                    <span>{f.path}</span>
                    <small>
                      {f.kind === "binary"
                        ? retainedFiles.includes(f.path)
                          ? "Retained after manual review"
                          : "Not assessed / excluded"
                        : `${job.findings.filter((x) => x.path === f.path).length} findings`}
                    </small>
                  </button>
                ))}
              </aside>
              <section className="findings">
                <h2>{selected}</h2>
                {selectedFile?.kind === "binary" && (
                  <div className="coverage">
                    <p>
                      This file has not been assessed by AI. It is excluded
                      unless you have separately checked its content, metadata
                      and licence.
                    </p>
                    <label>
                      <input
                        type="checkbox"
                        disabled={!editable || !!busy}
                        checked={retainedFiles.includes(selected)}
                        onChange={(e) => {
                          setRetainedFiles((files) =>
                            e.target.checked
                              ? [...files, selected]
                              : files.filter((f) => f !== selected),
                          );
                          setAck(false);
                        }}
                      />{" "}
                      I have manually reviewed this file and want to include it
                      unchanged.
                    </label>
                  </div>
                )}

                <details className="source">
                  <summary>Inspect extracted source text</summary>
                  {sourceError && (
                    <p role="alert">{sourceError} Refresh to retry.</p>
                  )}
                  {source && source.totalPages > 1 && (
                    <div>
                      <p>
                        Page {source.page + 1} of {source.totalPages} ·
                        characters {(source.start + 1).toLocaleString()}–
                        {source.end.toLocaleString()} of{" "}
                        {source.totalChars.toLocaleString()}. The full source is
                        assessed; these pages only control what is displayed.
                      </p>
                      <div className="decision-row">
                        <button
                          type="button"
                          disabled={sourcePage === 0}
                          onClick={() => setSourcePage(0)}
                        >
                          First page
                        </button>
                        <button
                          type="button"
                          disabled={sourcePage === 0}
                          onClick={() => setSourcePage((p) => p - 1)}
                        >
                          Previous page
                        </button>
                        <button
                          type="button"
                          disabled={sourcePage >= source.totalPages - 1}
                          onClick={() => setSourcePage((p) => p + 1)}
                        >
                          Next page
                        </button>
                        <button
                          type="button"
                          disabled={sourcePage >= source.totalPages - 1}
                          onClick={() => setSourcePage(source.totalPages - 1)}
                        >
                          Last page
                        </button>
                      </div>
                    </div>
                  )}
                  <pre>
                    {!source
                      ? "Loading source text…"
                      : source.text ||
                        "No reviewable text is available for this file."}
                  </pre>
                </details>
                {!visible.length && (
                  <p className="empty">
                    No findings for this file. This does not confirm it is free
                    of sensitive information. Inspect the source and add any
                    missed text below.
                  </p>
                )}
                {visible.map((f) => {
                  const decision = decisions[f.id];
                  const copy = findingCopy(f);
                  const custom =
                    decision?.decision === "accept" &&
                    decision.replacement !== f.replacement;
                  return (
                    <article className="finding" key={f.id}>
                      <div className="finding-heading">
                        <strong>{copy.title}</strong>
                        <span>
                          Line {f.line} ·{" "}
                          {f.source === "ai"
                            ? "AI suggestion"
                            : f.source === "rule"
                              ? "Pattern match"
                              : "Reviewer"}
                        </span>
                      </div>
                      <p>
                        <strong>Why this matters:</strong> {copy.risk}
                        {f.confidence && (
                          <span>
                            {" "}
                            AI confidence: {f.confidence} (not a guarantee).
                          </span>
                        )}
                      </p>
                      <p>
                        <strong>Suggested change:</strong> {copy.action}
                      </p>
                      <div className="comparison">
                        <div>
                          <label>Text found in your file</label>
                          <pre>{f.original}</pre>
                        </div>
                        <div>
                          <label>
                            {decision?.decision === "reject"
                              ? "Text that will stay"
                              : custom
                                ? "Your replacement"
                                : "Suggested replacement"}
                          </label>
                          <pre>
                            {decision?.decision === "reject"
                              ? f.original
                              : (decision?.replacement ?? f.replacement) ||
                                "(This text will be removed; nothing will replace it.)"}
                          </pre>
                        </div>
                      </div>
                      {customEditing[f.id] && editable && (
                        <div>
                          <label htmlFor={`replacement-${f.id}`}>
                            Write your own replacement
                          </label>
                          <p className="hint">
                            Enter the exact words to use, not an instruction.
                            Leave blank to remove this text. Your edit will only
                            be selected when you choose “Use my replacement”.
                          </p>
                          <textarea
                            id={`replacement-${f.id}`}
                            value={
                              customText[f.id] ??
                              decision?.replacement ??
                              f.replacement
                            }
                            disabled={!!busy}
                            rows={3}
                            onChange={(e) =>
                              setCustomText((t) => ({
                                ...t,
                                [f.id]: e.target.value,
                              }))
                            }
                          />
                          <button
                            disabled={!!busy}
                            onClick={() => {
                              setDecisions((d) => ({
                                ...d,
                                [f.id]: {
                                  id: f.id,
                                  decision: "accept",
                                  replacement:
                                    customText[f.id] ??
                                    decision?.replacement ??
                                    f.replacement,
                                },
                              }));
                              setCustomEditing((t) => ({
                                ...t,
                                [f.id]: false,
                              }));
                              setAck(false);
                            }}
                          >
                            Use my replacement
                          </button>
                          <button
                            disabled={!!busy}
                            onClick={() =>
                              setCustomEditing((t) => ({ ...t, [f.id]: false }))
                            }
                          >
                            Cancel edit
                          </button>
                        </div>
                      )}

                      <div className="decision-row">
                        <button
                          disabled={!editable || !!busy}
                          aria-pressed={decision?.decision === "accept"}
                          onClick={() =>
                            setDecisions((d) => ({
                              ...d,
                              [f.id]: {
                                id: f.id,
                                decision: "accept",
                                replacement: f.replacement,
                              },
                            }))
                          }
                        >
                          Accept change
                        </button>
                        <button
                          disabled={!editable || !!busy}
                          onClick={() => {
                            setCustomText((t) => ({
                              ...t,
                              [f.id]: decision?.replacement ?? f.replacement,
                            }));
                            setCustomEditing((t) => ({ ...t, [f.id]: true }));
                          }}
                        >
                          Use my own replacement
                        </button>
                        <button
                          disabled={!editable || !!busy}
                          aria-pressed={decision?.decision === "reject"}
                          onClick={() =>
                            setDecisions((d) => ({
                              ...d,
                              [f.id]: {
                                id: f.id,
                                decision: "reject",
                                replacement:
                                  d[f.id]?.replacement ?? f.replacement,
                              },
                            }))
                          }
                        >
                          Keep original
                        </button>
                        <span>
                          {decision?.decision === "accept"
                            ? custom
                              ? "Your replacement selected"
                              : "Suggested change selected"
                            : decision?.decision === "reject"
                              ? "Risk retained"
                              : "Needs a decision"}
                        </span>
                      </div>
                    </article>
                  );
                })}
                {editable && selectedFile?.kind !== "binary" && (
                  <details className="manual">
                    <summary>Add a missed finding</summary>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const data = new FormData(e.currentTarget);
                        action("Adding your finding.", async () => {
                          await post(
                            `/api/jobs/${job.id}`,
                            {
                              path: selected,
                              original: data.get("original"),
                              replacement: data.get("replacement"),
                            },
                            "PATCH",
                          );
                          await load(job.id);
                        });
                      }}
                    >
                      <label htmlFor="manual-original">
                        Exact source text (all matching occurrences)
                      </label>
                      <textarea id="manual-original" name="original" required />
                      <label htmlFor="manual-replacement">Replacement</label>
                      <textarea id="manual-replacement" name="replacement" />
                      <button disabled={!!busy}>Add finding</button>
                    </form>
                  </details>
                )}
              </section>
            </div>
            <section className="approval">
              <div>
                <h2>
                  {job.status === "review"
                    ? "Approve your change set"
                    : "Approved change set"}
                </h2>
                <p>
                  {reviewed} / {job.findings.length} findings reviewed{" "}
                  {editable && ` · ${draftState}`}
                </p>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={brand}
                  disabled={!editable || !!busy}
                  onChange={(e) => setBrand(e.target.checked)}
                />
                <span>Apply Accenture branding</span>
              </label>
              <p className="hint">
                HTML gets an Accenture header and purple typography. PDFs and
                PowerPoint use a new text template. Code exports include opt-in
                CSS and logo assets; review AI-proposed component changes
                individually. Original logos in images cannot be assessed;
                binary files are excluded unless you explicitly retain them
                after manual review. Code filenames are preserved and may need
                manual renaming.
              </p>
              {editable ? (
                <>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                    />
                    <span>
                      I have reviewed the changes, retained risks, branding
                      behaviour and coverage limitations, including document
                      reconstruction.
                    </span>
                  </label>
                  <button
                    className="primary"
                    disabled={
                      !!busy ||
                      !ack ||
                      reviewed !== job.findings.length ||
                      draftState !== "Draft saved" ||
                      Object.values(customEditing).some(Boolean)
                    }
                    onClick={() =>
                      action("Recording your approval.", async () => {
                        await post(`/api/jobs/${job.id}/approve`, {
                          sourceHash: job.sourceHash,
                          decisions: Object.values(decisions),
                          brand,
                          retainedFiles,
                          acknowledged: true,
                        });
                        await load(job.id);
                      })
                    }
                  >
                    Approve change set
                  </button>
                  <p className="hint">
                    Finish or cancel any open replacement edits before
                    approving. Approval locks this plan. Execution is a separate
                    action.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Approved by <strong>{job.approval?.reviewer}</strong> ·{" "}
                    {new Date(job.approval!.at).toLocaleString()}
                  </p>
                  {job.status === "approved" ? (
                    <button
                      className="primary"
                      disabled={!!busy}
                      onClick={() =>
                        action(
                          "Applying approved changes and checking the exported text.",
                          async () => {
                            await post(`/api/jobs/${job.id}/execute`);
                            await load(job.id);
                          },
                        )
                      }
                    >
                      Apply approved changes & build export
                    </button>
                  ) : (
                    <p>
                      Download and residual findings are shown above the review.
                    </p>
                  )}
                </>
              )}
            </section>
            <details className="delete">
              <summary>Delete this review and its files</summary>
              <p>
                This permanently removes the source snapshot, findings, approval
                and output from this server.
              </p>
              <button
                disabled={!!busy}
                onClick={() =>
                  action("Deleting this review.", async () => {
                    await post(`/api/jobs/${job.id}`, undefined, "DELETE");
                    location.href = "/";
                  })
                }
              >
                Delete review permanently
              </button>
            </details>
          </>
        )}
      </main>
      <footer>
        Kenobi · Human-reviewed asset cleansing<span>Built from Rockit</span>
      </footer>
    </div>
  );
}
