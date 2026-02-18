export type TrackerType = "jira" | "gitlab";

export type AgentRunInput = {
  taskId: string;
  tracker: TrackerType;
  repoPath: string;
  targetBranch: string;
  dryRun: boolean;
};

export type TrackerTask = {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria?: string[];
  labels?: string[];
  priority?: string;
  url?: string;
};

export type RepoSnapshot = {
  fileCount: number;
  topLevelEntries: string[];
  languageSummary: Record<string, number>;
  sampleFiles: string[];
  techStack: string[];
  testingGuidance: string[];
};

export type ProposedEdit = {
  path: string;
  summary: string;
};

export type DraftEdit = {
  path: string;
  content: string;
  rationale: string;
};

export type DesignProposal = {
  requirements: string[];
  assumptions: string[];
  implementationPlan: string[];
  testsAndGrounding: string[];
  proposedEdits: ProposedEdit[];
  branchNameSuggestion: string;
  commitTitle: string;
  prTitle: string;
};

export type FileCoverage = {
  path: string;
  coveredLines: number;
  totalLines: number;
  lineCoveragePercent: number | null;
};

export type TestExecutionReport = {
  executed: boolean;
  success: boolean;
  command?: string;
  failureCause?: string;
  overallLineCoveragePercent: number | null;
  fileCoverage: FileCoverage[];
  notes: string[];
  stdoutSnippet?: string;
  stderrSnippet?: string;
};

export type AgentRunRecord = {
  runId: string;
  createdAt: string;
  input: AgentRunInput;
  status: "awaiting_approval" | "applying" | "done" | "rejected" | "failed";
  task?: TrackerTask;
  repo?: RepoSnapshot;
  proposal?: DesignProposal;
  stagedEdits?: DraftEdit[];
  branchName?: string;
  diffPreview?: string;
  testReport?: TestExecutionReport;
  feedbackHistory: string[];
  finalSummary?: string;
  mergeRequestUrl?: string;
  error?: string;
};

export type ApprovalInput = {
  runId: string;
  approved: boolean;
  feedback?: string;
};

export type FinalizeResult = {
  changedFiles: string[];
  commitSha?: string;
  mergeRequestUrl?: string;
  summary: string;
};
