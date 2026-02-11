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
          proposal and diff, then approve for code application and PR creation.
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

          {run.proposal ? (
            <>
              <h3>Requirements</h3>
              <ul>{run.proposal.requirements.map((item) => <li key={item}>{item}</li>)}</ul>

              <h3>Implementation Plan</h3>
              <ul>{run.proposal.implementationPlan.map((item) => <li key={item}>{item}</li>)}</ul>

              <h3>Proposed Edits</h3>
              <ul>{run.proposal.proposedEdits.map((item) => <li key={item.path}><code>{item.path}</code> - {item.summary}</li>)}</ul>
            </>
          ) : null}

          {run.diffPreview ? (
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
