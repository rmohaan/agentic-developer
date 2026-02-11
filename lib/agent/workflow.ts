import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { randomUUID } from "node:crypto";
import { createPatch } from "diff";
import { buildGroundingChecklist } from "./tools/grounding";
import { generateText, parseJsonObject } from "./clients/gemini";
import { createMergeRequest } from "./tools/gitlab";
import {
  buildBranchName,
  createOrCheckoutBranch,
  getDiff,
  pushBranch,
  stageCommitAndGetSha,
} from "./tools/git";
import { appendFeedback, summarizeFeedbackBias } from "./memory/feedback";
import { readFileIfExists, scanRepository, writeFile } from "./tools/repo";
import { fetchTask } from "./tools/tracker";
import { getRun, putRun, updateRun } from "./store";
import type {
  AgentRunInput,
  AgentRunRecord,
  DesignProposal,
  DraftEdit,
  FinalizeResult,
  TrackerTask,
} from "./types";

type WorkflowState = {
  runId: string;
  input: AgentRunInput;
  task?: TrackerTask;
  repo?: Awaited<ReturnType<typeof scanRepository>>;
  feedbackBias?: string;
  branchName?: string;
  proposal?: DesignProposal;
  stagedEdits?: DraftEdit[];
  diffPreview?: string;
};

const graphState = Annotation.Root({
  runId: Annotation<string>,
  input: Annotation<AgentRunInput>,
  task: Annotation<TrackerTask | undefined>,
  repo: Annotation<Awaited<ReturnType<typeof scanRepository>> | undefined>,
  feedbackBias: Annotation<string | undefined>,
  branchName: Annotation<string | undefined>,
  proposal: Annotation<DesignProposal | undefined>,
  stagedEdits: Annotation<DraftEdit[] | undefined>,
  diffPreview: Annotation<string | undefined>,
});

const graph = new StateGraph(graphState)
  .addNode("loadTask", async (state: WorkflowState) => {
    const task = await fetchTask(state.input.tracker, state.input.taskId);
    return { task };
  })
  .addNode("scanRepo", async (state: WorkflowState) => {
    const repo = await scanRepository(state.input.repoPath);
    return { repo };
  })
  .addNode("loadFeedback", async (state: WorkflowState) => {
    const feedbackBias = await summarizeFeedbackBias(state.input.repoPath);
    return { feedbackBias };
  })
  .addNode("prepareBranch", async (state: WorkflowState) => {
    const branchName = buildBranchName(state.input.taskId);
    await createOrCheckoutBranch(state.input.repoPath, branchName, state.input.targetBranch, state.input.dryRun);
    return { branchName };
  })
  .addNode("propose", async (state: WorkflowState) => {
    if (!state.task || !state.repo || !state.feedbackBias) {
      throw new Error("Missing context for proposal");
    }

    const grounding = buildGroundingChecklist(state.repo);
    const prompt = buildProposalPrompt({
      task: state.task,
      repo: state.repo,
      feedbackBias: state.feedbackBias,
      targetBranch: state.input.targetBranch,
      grounding,
    });

    const raw = await generateText(prompt);
    const proposal = parseJsonObject<DesignProposal>(raw);
    return { proposal };
  })
  .addNode("draftChanges", async (state: WorkflowState) => {
    if (!state.task || !state.repo || !state.proposal) {
      throw new Error("Missing context for drafting changes");
    }

    const draftPrompt = await hydrateDraftPrompt({
      repoPath: state.input.repoPath,
      task: state.task,
      repo: state.repo,
      proposal: state.proposal,
      feedback: "Initial implementation draft for human review.",
    });

    const raw = await generateText(draftPrompt);
    const editPayload = parseJsonObject<{
      edits: Array<{ path: string; content: string; rationale: string }>;
      summary: string;
      commitTitle?: string;
      prDescription?: string;
    }>(raw);

    const stagedEdits = editPayload.edits;
    const diffPreview = await buildPreviewDiff(state.input.repoPath, stagedEdits);
    return { stagedEdits, diffPreview };
  })
  .addEdge(START, "loadTask")
  .addEdge("loadTask", "scanRepo")
  .addEdge("scanRepo", "loadFeedback")
  .addEdge("loadFeedback", "prepareBranch")
  .addEdge("prepareBranch", "propose")
  .addEdge("propose", "draftChanges")
  .addEdge("draftChanges", END)
  .compile();

export async function startAgentRun(input: AgentRunInput): Promise<AgentRunRecord> {
  const runId = randomUUID();
  const baseRecord: AgentRunRecord = {
    runId,
    createdAt: new Date().toISOString(),
    input,
    status: "awaiting_approval",
    feedbackHistory: [],
  };
  putRun(baseRecord);

  try {
    const result = await graph.invoke({ runId, input });
    const record = updateRun(runId, {
      task: result.task,
      repo: result.repo,
      proposal: result.proposal,
      branchName: result.branchName,
      stagedEdits: result.stagedEdits,
      diffPreview: result.diffPreview,
    });
    return record;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return updateRun(runId, { status: "failed", error: message });
  }
}

export async function approveOrRejectRun(params: {
  runId: string;
  approved: boolean;
  feedback?: string;
}): Promise<AgentRunRecord> {
  const run = getRun(params.runId);
  if (!run) {
    throw new Error("Run not found");
  }

  if (!params.approved) {
    const feedback = params.feedback?.trim() || "Rejected without detailed feedback.";
    await appendFeedback(run.input.repoPath, {
      timestamp: new Date().toISOString(),
      runId: run.runId,
      taskId: run.input.taskId,
      feedback,
      accepted: false,
    });

    return updateRun(run.runId, {
      status: "rejected",
      feedbackHistory: [...run.feedbackHistory, feedback],
      finalSummary: "Run rejected by reviewer."
    });
  }

  updateRun(run.runId, { status: "applying" });

  const finalized = await finalizeApprovedRun(run, params.feedback);

  await appendFeedback(run.input.repoPath, {
    timestamp: new Date().toISOString(),
    runId: run.runId,
    taskId: run.input.taskId,
    feedback: params.feedback?.trim() || "Approved",
    accepted: true,
  });

  const updated = updateRun(run.runId, {
    status: "done",
    finalSummary: finalized.summary,
    mergeRequestUrl: finalized.mergeRequestUrl,
    feedbackHistory: params.feedback
      ? [...run.feedbackHistory, params.feedback]
      : run.feedbackHistory,
  });

  return updated;
}

async function finalizeApprovedRun(run: AgentRunRecord, feedback?: string): Promise<FinalizeResult> {
  if (!run.task || !run.repo || !run.proposal || !run.branchName) {
    throw new Error("Run is missing proposal context.");
  }

  const editPayload = await resolveFinalEdits(run, feedback);

  const changedFiles: string[] = [];
  for (const edit of editPayload.edits) {
    await writeFile(run.input.repoPath, edit.path, edit.content);
    changedFiles.push(edit.path);
  }

  const diffPreview = await getDiff(run.input.repoPath);
  updateRun(run.runId, { diffPreview });

  if (run.input.dryRun) {
    return {
      changedFiles,
      summary: `${editPayload.summary}\n\nDry-run mode is enabled. Review diff and manually commit/push/create MR.`,
    };
  }

  const commitSha = await stageCommitAndGetSha(run.input.repoPath, editPayload.commitTitle ?? run.proposal.commitTitle);
  await pushBranch(run.input.repoPath, run.branchName);

  const mergeRequestUrl = await createMergeRequest({
    sourceBranch: run.branchName,
    targetBranch: run.input.targetBranch,
    title: run.proposal.prTitle,
    description: editPayload.prDescription ?? `Automated changes for ${run.task.id}`,
  });

  return {
    changedFiles,
    commitSha,
    mergeRequestUrl,
    summary: `${editPayload.summary}${mergeRequestUrl ? `\nMerge request: ${mergeRequestUrl}` : ""}`,
  };
}

async function resolveFinalEdits(
  run: AgentRunRecord,
  feedback?: string,
): Promise<{
  edits: Array<{ path: string; content: string; rationale: string }>;
  summary: string;
  commitTitle?: string;
  prDescription?: string;
}> {
  if (run.stagedEdits && run.stagedEdits.length > 0 && (!feedback || feedback.trim().length === 0)) {
    return {
      edits: run.stagedEdits,
      summary: "Applied previously staged draft edits after approval.",
      commitTitle: run.proposal?.commitTitle,
      prDescription: "Automated edits approved by reviewer.",
    };
  }

  const prompt = await hydrateEditPromptWithCurrentFiles(run, feedback);
  const raw = await generateText(prompt);
  return parseJsonObject<{
    edits: Array<{ path: string; content: string; rationale: string }>;
    summary: string;
    commitTitle?: string;
    prDescription?: string;
  }>(raw);
}

function buildProposalPrompt(params: {
  task: TrackerTask;
  repo: Awaited<ReturnType<typeof scanRepository>>;
  feedbackBias: string;
  targetBranch: string;
  grounding: string[];
}): string {
  return [
    "You are a senior software engineer planning implementation from a tracker ticket.",
    "Return JSON only with this schema:",
    JSON.stringify(
      {
        requirements: ["string"],
        assumptions: ["string"],
        implementationPlan: ["string"],
        testsAndGrounding: ["string"],
        proposedEdits: [{ path: "string", summary: "string" }],
        branchNameSuggestion: "string",
        commitTitle: "string",
        prTitle: "string",
      },
      null,
      2,
    ),
    "Focus on robust implementation and grounding checks. Support polyglot repositories.",
    `Task id: ${params.task.id}`,
    `Task title: ${params.task.title}`,
    `Task description: ${params.task.description}`,
    `Task labels: ${(params.task.labels ?? []).join(", ")}`,
    `Target branch: ${params.targetBranch}`,
    "Repository summary:",
    JSON.stringify(params.repo, null, 2),
    "Human feedback memory:",
    params.feedbackBias,
    "Grounding baseline checks:",
    params.grounding.map((item, index) => `${index + 1}. ${item}`).join("\n"),
    "Respect requirement clarity first. Keep assumptions explicit.",
  ].join("\n\n");
}

function buildEditPrompt(params: {
  task: TrackerTask;
  repo: Awaited<ReturnType<typeof scanRepository>>;
  proposal: DesignProposal;
  feedback?: string;
}): string {
  return [
    "Create concrete file edits to implement the approved task.",
    "Return JSON only with schema:",
    JSON.stringify(
      {
        edits: [
          {
            path: "relative/path.ext",
            content: "full file content",
            rationale: "short reason",
          },
        ],
        summary: "string",
        commitTitle: "string",
        prDescription: "string",
      },
      null,
      2,
    ),
    "Rules:",
    "- Edit only files listed in proposal.proposedEdits unless absolutely necessary.",
    "- Provide complete file content for each edited file.",
    "- Keep security and backwards compatibility in mind.",
    `Task: ${params.task.id} - ${params.task.title}`,
    `Task details: ${params.task.description}`,
    `Proposal: ${JSON.stringify(params.proposal, null, 2)}`,
    `Reviewer feedback: ${params.feedback ?? "No additional feedback"}`,
    `Repository files sample: ${JSON.stringify(params.repo.sampleFiles.slice(0, 120), null, 2)}`,
    "For each proposed file, use the latest existing file content below:",
  ].join("\n\n");
}

export async function hydrateEditPromptWithCurrentFiles(run: AgentRunRecord, feedback?: string): Promise<string> {
  if (!run.proposal || !run.task || !run.repo) {
    throw new Error("Run is not ready for file hydration");
  }

  const basePrompt = buildEditPrompt({
    task: run.task,
    repo: run.repo,
    proposal: run.proposal,
    feedback,
  });

  const sections: string[] = [basePrompt];
  for (const item of run.proposal.proposedEdits.slice(0, 12)) {
    const current = await readFileIfExists(run.input.repoPath, item.path);
    sections.push([
      `FILE: ${item.path}`,
      "CURRENT_CONTENT_START",
      current ?? "",
      "CURRENT_CONTENT_END",
    ].join("\n"));
  }

  return sections.join("\n\n");
}

async function hydrateDraftPrompt(params: {
  repoPath: string;
  task: TrackerTask;
  repo: Awaited<ReturnType<typeof scanRepository>>;
  proposal: DesignProposal;
  feedback?: string;
}): Promise<string> {
  const basePrompt = buildEditPrompt({
    task: params.task,
    repo: params.repo,
    proposal: params.proposal,
    feedback: params.feedback,
  });

  const sections: string[] = [basePrompt];
  for (const item of params.proposal.proposedEdits.slice(0, 12)) {
    const current = await readFileIfExists(params.repoPath, item.path);
    sections.push([
      `FILE: ${item.path}`,
      "CURRENT_CONTENT_START",
      current ?? "",
      "CURRENT_CONTENT_END",
    ].join("\n"));
  }

  return sections.join("\n\n");
}

async function buildPreviewDiff(repoPath: string, edits: DraftEdit[]): Promise<string> {
  const chunks: string[] = [];

  for (const edit of edits.slice(0, 20)) {
    const before = (await readFileIfExists(repoPath, edit.path)) ?? "";
    const patch = createPatch(edit.path, before, edit.content, "before", "staged");
    chunks.push(patch);
  }

  return chunks.join("\n");
}
