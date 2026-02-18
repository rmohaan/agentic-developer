"use client";

import { FormEvent, useMemo, useState } from "react";

type AgentRunRecord = {
  runId: string;
  status: string;
  createdAt: string;
  branchName?: string;
  error?: string;
  finalSummary?: string;
  mergeRequestUrl?: string;
  repo?: {
    techStack: string[];
    testingGuidance: string[];
  };
  proposal?: {
    requirements: string[];
    assumptions: string[];
    implementationPlan: string[];
    testsAndGrounding: string[];
    proposedEdits: Array<{ path: string; summary: string }>;
    commitTitle: string;
    prTitle: string;
  };
  diffPreview?: string;
  testReport?: {
    executed: boolean;
    success: boolean;
    command?: string;
    failureCause?: string;
    overallLineCoveragePercent: number | null;
    notes: string[];
    stdoutSnippet?: string;
    stderrSnippet?: string;
    fileCoverage: Array<{
      path: string;
      coveredLines: number;
      totalLines: number;
      lineCoveragePercent: number | null;
    }>;
  };
  compilationErrorAnalysis?: {
    detected: boolean;
    summary: string;
    rootCause: string;
    potentialSolutions: string[];
    followUpChecks: string[];
  };
};

type DiffRow = {
  kind: "context" | "added" | "removed";
  leftNumber?: number;
  rightNumber?: number;
  leftText: string;
  rightText: string;
};

type DiffFile = {
  path: string;
  rows: DiffRow[];
};

export default function Home() {
  const [taskId, setTaskId] = useState("");
  const [tracker, setTracker] = useState<"jira" | "gitlab">("jira");
  const [repoPath, setRepoPath] = useState(".");
  const [targetBranch, setTargetBranch] = useState("develop");
  const [dryRun, setDryRun] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [run, setRun] = useState<AgentRunRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canApprove = useMemo(() => run?.status === "awaiting_approval", [run?.status]);
  const parsedDiff = useMemo(() => parseUnifiedDiff(run?.diffPreview ?? ""), [run?.diffPreview]);

  async function onStart(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          tracker,
          repoPath,
          targetBranch,
          dryRun,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to start run");
      }
      setRun(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function onDecision(approved: boolean) {
    if (!run) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/agent/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: run.runId,
          approved,
          feedback,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to submit decision");
      }

      setRun(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <p className="kicker">Developer Agent</p>
        <h1>Ticket-to-PR workflow with HITL approvals</h1>
        <p>
          LangGraph orchestration + Gemini reasoning + Jira/GitLab integration. Run in dry mode first, inspect
          proposal and stack-aware tests, then approve for code application and PR creation.
        </p>
      </section>

      <section className="panel">
        <form onSubmit={onStart} className="form-grid">
          <label>
            Task ID
            <input value={taskId} onChange={(event) => setTaskId(event.target.value)} placeholder="PROJ-123 or 42" required />
          </label>

          <label>
            Tracker
            <select value={tracker} onChange={(event) => setTracker(event.target.value as "jira" | "gitlab")}>
              <option value="jira">Jira</option>
              <option value="gitlab">GitLab</option>
            </select>
          </label>

          <label>
            Repo Path
            <input value={repoPath} onChange={(event) => setRepoPath(event.target.value)} placeholder="." required />
          </label>

          <label>
            Target Branch
            <input value={targetBranch} onChange={(event) => setTargetBranch(event.target.value)} placeholder="develop" required />
          </label>

          <label className="toggle">
            <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
            Dry run (do not commit/push/create MR)
          </label>

          <button type="submit" disabled={loading}>
            {loading ? "Running..." : "Start Run"}
          </button>
        </form>
      </section>

      {error ? <section className="alert">{error}</section> : null}

      {run ? (
        <section className="panel output">
          <div className="row">
            <strong>Run ID:</strong> <code>{run.runId}</code>
          </div>
          <div className="row">
            <strong>Status:</strong> {run.status}
          </div>
          <div className="row">
            <strong>Branch:</strong> {run.branchName ?? "n/a"}
          </div>
          {run.mergeRequestUrl ? (
            <div className="row">
              <strong>Merge Request:</strong> <a href={run.mergeRequestUrl}>{run.mergeRequestUrl}</a>
            </div>
          ) : null}

          {run.repo ? (
            <>
              <h3>Detected Tech Stack</h3>
              <ul>{run.repo.techStack.map((item) => <li key={item}>{item}</li>)}</ul>
              <h3>Testing Guidance</h3>
              <ul>{run.repo.testingGuidance.map((item) => <li key={item}>{item}</li>)}</ul>
            </>
          ) : null}

          {run.proposal ? (
            <>
              <h3>Requirements</h3>
              <ul>{run.proposal.requirements.map((item) => <li key={item}>{item}</li>)}</ul>

              <h3>Implementation Plan</h3>
              <ul>{run.proposal.implementationPlan.map((item) => <li key={item}>{item}</li>)}</ul>

              <h3>Tests And Grounding</h3>
              <ul>{run.proposal.testsAndGrounding.map((item) => <li key={item}>{item}</li>)}</ul>

              <h3>Proposed Edits</h3>
              <ul>
                {run.proposal.proposedEdits.map((item) => (
                  <li key={item.path}>
                    <code>{item.path}</code> - {item.summary}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {run.testReport ? (
            <>
              <h3>Test And Coverage Gate</h3>
              <div className={`coverage-summary ${run.testReport.success ? "ok" : "bad"}`}>
                <div>
                  <strong>Status:</strong>{" "}
                  {run.testReport.executed
                    ? run.testReport.success
                      ? "Passed"
                      : "Failed"
                    : "Not Executed"}
                </div>
                <div>
                  <strong>Overall Coverage (Changed Files):</strong>{" "}
                  {run.testReport.overallLineCoveragePercent === null
                    ? "n/a"
                    : `${run.testReport.overallLineCoveragePercent}%`}
                </div>
                {run.testReport.command ? (
                  <div>
                    <strong>Command:</strong> <code>{run.testReport.command}</code>
                  </div>
                ) : null}
                {!run.testReport.success && run.testReport.failureCause ? (
                  <div>
                    <strong>Failure Cause:</strong> {run.testReport.failureCause}
                  </div>
                ) : null}
              </div>

              {run.testReport.notes.length > 0 ? (
                <ul>{run.testReport.notes.map((item) => <li key={item}>{item}</li>)}</ul>
              ) : null}

              <div className="coverage-table-wrap">
                <table className="coverage-table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Covered Lines</th>
                      <th>Total Lines</th>
                      <th>Coverage %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.testReport.fileCoverage.map((entry) => (
                      <tr key={entry.path}>
                        <td><code>{entry.path}</code></td>
                        <td>{entry.coveredLines}</td>
                        <td>{entry.totalLines}</td>
                        <td>{entry.lineCoveragePercent === null ? "n/a" : `${entry.lineCoveragePercent}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {run.testReport.stderrSnippet ? (
                <>
                  <h3>Test stderr</h3>
                  <pre>{run.testReport.stderrSnippet}</pre>
                </>
              ) : null}

              {run.compilationErrorAnalysis?.detected ? (
                <>
                  <h3>Compilation Error Deep Dive</h3>
                  <div className="error-analysis">
                    <p><strong>Summary:</strong> {run.compilationErrorAnalysis.summary}</p>
                    <p><strong>Root Cause:</strong> {run.compilationErrorAnalysis.rootCause}</p>

                    <p><strong>Potential Solutions:</strong></p>
                    <ul>
                      {run.compilationErrorAnalysis.potentialSolutions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>

                    <p><strong>Follow-up Checks:</strong></p>
                    <ul>
                      {run.compilationErrorAnalysis.followUpChecks.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : null}
            </>
          ) : null}

          {parsedDiff.length > 0 ? (
            <>
              <h3>Diff Preview (Side by Side)</h3>
              <div className="diff-list">
                {parsedDiff.map((file) => (
                  <section className="diff-file" key={file.path}>
                    <div className="diff-file-header">
                      <code>{file.path}</code>
                    </div>
                    <div className="diff-grid">
                      {file.rows.map((row, index) => (
                        <div className={`diff-row diff-${row.kind}`} key={`${file.path}-${index}`}>
                          <div className="diff-line-no">{row.leftNumber ?? ""}</div>
                          <pre className="diff-code diff-left">{row.leftText}</pre>
                          <div className="diff-line-no">{row.rightNumber ?? ""}</div>
                          <pre className="diff-code diff-right">{row.rightText}</pre>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </>
          ) : run.diffPreview ? (
            <>
              <h3>Diff Preview</h3>
              <pre>{run.diffPreview}</pre>
            </>
          ) : null}

          {run.finalSummary ? (
            <>
              <h3>Final Summary</h3>
              <p>{run.finalSummary}</p>
            </>
          ) : null}

          {canApprove ? (
            <div className="decision">
              <label>
                Reviewer Feedback
                <textarea
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  placeholder="Ask for corrections or approve with notes."
                />
              </label>
              <div className="actions">
                <button type="button" disabled={loading} onClick={() => onDecision(false)}>
                  Reject
                </button>
                <button type="button" disabled={loading} onClick={() => onDecision(true)}>
                  Approve & Apply
                </button>
              </div>
            </div>
          ) : null}

          {run.error ? <p className="error-text">{run.error}</p> : null}
        </section>
      ) : null}
    </main>
  );
}

function parseUnifiedDiff(diffText: string): DiffFile[] {
  if (!diffText.trim()) {
    return [];
  }

  const lines = diffText.split("\n");
  const files: DiffFile[] = [];

  let currentFile: DiffFile | null = null;
  let leftLine = 0;
  let rightLine = 0;

  for (const line of lines) {
    if (line.startsWith("Index: ")) {
      const path = line.slice("Index: ".length).trim();
      currentFile = { path, rows: [] };
      files.push(currentFile);
      continue;
    }

    if (line.startsWith("@@ ")) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match) {
        leftLine = Number.parseInt(match[1], 10);
        rightLine = Number.parseInt(match[2], 10);
      }
      continue;
    }

    if (!currentFile) {
      continue;
    }

    if (
      line.startsWith("===") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.length === 0
    ) {
      continue;
    }

    const marker = line[0];
    const text = line.slice(1);

    if (marker === "-") {
      currentFile.rows.push({
        kind: "removed",
        leftNumber: leftLine,
        rightNumber: undefined,
        leftText: text,
        rightText: "",
      });
      leftLine += 1;
      continue;
    }

    if (marker === "+") {
      currentFile.rows.push({
        kind: "added",
        leftNumber: undefined,
        rightNumber: rightLine,
        leftText: "",
        rightText: text,
      });
      rightLine += 1;
      continue;
    }

    if (marker === " ") {
      currentFile.rows.push({
        kind: "context",
        leftNumber: leftLine,
        rightNumber: rightLine,
        leftText: text,
        rightText: text,
      });
      leftLine += 1;
      rightLine += 1;
    }
  }

  return files.filter((file) => file.rows.length > 0);
}
