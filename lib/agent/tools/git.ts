import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runGit(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repoPath });
  return stdout.trim();
}

export async function ensureCleanWorktree(repoPath: string): Promise<void> {
  const status = await runGit(repoPath, ["status", "--porcelain"]);
  if (status.length > 0) {
    throw new Error("Working tree is not clean. Commit/stash existing changes before running the agent.");
  }
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  return runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

export function buildBranchName(taskId: string): string {
  const slug = taskId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 45);
  return `codex/${slug || "task"}`;
}

export async function createOrCheckoutBranch(
  repoPath: string,
  branchName: string,
  targetBranch: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    return;
  }

  await ensureCleanWorktree(repoPath);

  const existingBranch = await runGit(repoPath, ["branch", "--list", branchName]);
  if (existingBranch.trim().length > 0) {
    await runGit(repoPath, ["checkout", branchName]);
    return;
  }

  await runGit(repoPath, ["checkout", targetBranch]);
  await runGit(repoPath, ["checkout", "-b", branchName]);
}

export async function getDiff(repoPath: string): Promise<string> {
  return runGit(repoPath, ["diff", "--", "."]);
}

export async function stageCommitAndGetSha(repoPath: string, commitMessage: string): Promise<string> {
  await runGit(repoPath, ["add", "."]);
  await runGit(repoPath, ["commit", "-m", commitMessage]);
  return runGit(repoPath, ["rev-parse", "HEAD"]);
}

export async function pushBranch(repoPath: string, branchName: string): Promise<void> {
  await runGit(repoPath, ["push", "-u", "origin", branchName]);
}
