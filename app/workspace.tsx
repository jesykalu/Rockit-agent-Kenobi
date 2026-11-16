"use client";
import { useEffect, useState, useRef } from "react";
import type { Job, Decision } from "@/lib/types";
type ViewJob = Omit<Job, "files"> & {
  files: Omit<Job["files"][number], "content">[];
};
export default function Workspace() {
  const [job, setJob] = useState<ViewJob | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const [decisions, setDecisions] = useState<Record<string, Decision>>({}),
    [brand, setBrand] = useState(true),
    [ack, setAck] = useState(false);
  const [selected, setSelected] = useState(""),
    [mode, setMode] = useState("local");
  const [draftState, setDraftState] = useState("Saved");
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const draftVersion = useRef(0);
  async function load(id: string) {
    const res = await fetch(`/api/jobs/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setJob(data);
    setSelected((s) => s || data.files[0]?.path || "");
    const saved = data.approval || data.draft;
    if (saved) {
      setDecisions(
        Object.fromEntries(saved.decisions.map((d: Decision) => [d.id, d])),
      );
      setBrand(saved.brand);
    }
  }
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("review");
    if (id) load(id).catch((e) => setError(e.message));
  }, []);
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
            { type: "draft", brand, decisions: Object.values(decisions) },
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
  }, [decisions, brand, job?.id, job?.status]);
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
          {["Add an asset", "Review changes", "Approve & export"].map(
            (s, i) => (
              <span
                key={s}
                aria-current={
                  (!job && i === 0) ||
                  (job?.status === "review" && i === 1) ||
                  (job && job.status !== "review" && i === 2)
                    ? "step"
                    : undefined
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
            <div className="intake-grid">
              <form
                className="intake"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  action("Assessing your asset.", async () => {
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
                  HTML, code, text-based PDF, PPTX or ZIP. Up to 4 MB per upload
                  / 1,500 files. GitHub imports: up to 25 MB. Legacy .ppt files
                  need conversion to .pptx.
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
                  Client names, projects and sensitive terms
                </label>
                <textarea
                  id="terms"
                  name="terms"
                  rows={3}
                  placeholder="Separate names with commas or new lines"
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
                  <option value="ai">AI review — Azure Foundry</option>
                </select>
                <p className="hint">
                  {mode === "ai"
                    ? "Extracted text is sent to your configured Azure Foundry deployment for contextual review. The host must configure this connection."
                    : "Stays on this server. Finds supplied names, email addresses, common financial terms and credential patterns. It will miss contextual risks."}
                </p>
                <button className="primary" disabled={!!busy}>
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
                    ? "AI-assisted assessment"
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
                  {job.report?.residualFindings} residual pattern matches.
                </p>
                <p>
                  Inspect the result before sharing. Rebuilt documents may
                  differ from their source. Reinstall dependencies and test
                  exported code.
                </p>
                <button
                  className="primary download"
                  disabled={!!busy}
                  onClick={() =>
                    action("Downloading reviewed files.", async () => {
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
                        <p>{f.reason}</p>
                      </article>
                    ))}
                  </details>
                ) : (
                  <p>
                    No residual local pattern matches. Contextual and image
                    risks still require human review.
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
            <div className="review-grid">
              <aside className="file-list">
                <h2>Source files</h2>
                {job.files.map((f) => (
                  <button
                    key={f.path}
                    className={selected === f.path ? "selected" : ""}
                    onClick={() => setSelected(f.path)}
                  >
                    <span>{f.path}</span>
                    <small>
                      {f.kind === "binary"
                        ? "Excluded"
                        : `${job.findings.filter((x) => x.path === f.path).length} findings`}
                    </small>
                  </button>
                ))}
              </aside>
              <section className="findings">
                <h2>{selected}</h2>
                <details className="source">
                  <summary>Inspect extracted source text</summary>
                  <pre>
                    {selectedFile?.text ||
                      "No reviewable text. This file will be excluded."}
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
                  return (
                    <article className="finding" key={f.id}>
                      <div className="finding-heading">
                        <strong>{f.category}</strong>
                        <span>
                          Line {f.line} ·{" "}
                          {f.source === "ai"
                            ? "AI suggestion"
                            : f.source === "rule"
                              ? "Pattern match"
                              : "Reviewer"}
                        </span>
                      </div>
                      <p>{f.reason}</p>
                      <div className="comparison">
                        <div>
                          <label>Original</label>
                          <pre>{f.original}</pre>
                        </div>
                        <div>
                          <label htmlFor={`replacement-${f.id}`}>
                            Replacement
                          </label>
                          <textarea
                            id={`replacement-${f.id}`}
                            disabled={!editable || !!busy}
                            value={decision?.replacement ?? f.replacement}
                            rows={3}
                            onChange={(e) =>
                              setDecisions((d) => ({
                                ...d,
                                [f.id]: {
                                  id: f.id,
                                  decision: "accept",
                                  replacement: e.target.value,
                                },
                              }))
                            }
                          />
                        </div>
                      </div>
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
                                replacement:
                                  d[f.id]?.replacement ?? f.replacement,
                              },
                            }))
                          }
                        >
                          Accept change
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
                            ? "Will change"
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
                binary files are excluded. Code filenames are preserved and may
                need manual renaming.
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
                      draftState !== "Draft saved"
                    }
                    onClick={() =>
                      action("Recording your approval.", async () => {
                        await post(`/api/jobs/${job.id}/approve`, {
                          sourceHash: job.sourceHash,
                          decisions: Object.values(decisions),
                          brand,
                          acknowledged: true,
                        });
                        await load(job.id);
                      })
                    }
                  >
                    Approve change set
                  </button>
                  <p className="hint">
                    Approval locks this plan. Execution is a separate action.
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
                          "Applying approved changes and building your export.",
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
