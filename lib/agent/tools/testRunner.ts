import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { DraftEdit, RepoSnapshot, TestExecutionReport } from "../types";
import { readFileIfExists, writeFile } from "./repo";

const execAsync = promisify(exec);

export async function runTestsAndCollectCoverage(params: {
  repoPath: string;
  repo: RepoSnapshot;
  edits: DraftEdit[];
}): Promise<TestExecutionReport> {
  const strategy = await resolveTestStrategy(params.repoPath, params.repo);
  if (!strategy) {
    return {
      executed: false,
      success: false,
      overallLineCoveragePercent: null,
      fileCoverage: [],
      notes: [
        "No supported coverage strategy detected.",
        "Currently implemented: JavaScript/TypeScript Node.js repositories with lcov output.",
      ],
    };
  }

  const originalContents = new Map<string, string | null>();
  for (const edit of params.edits) {
    originalContents.set(edit.path, await readFileIfExists(params.repoPath, edit.path));
  }

  try {
    for (const edit of params.edits) {
      await writeFile(params.repoPath, edit.path, edit.content);
    }

    const result = await execAsync(strategy.command, {
      cwd: params.repoPath,
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const coverageByFile = await parseLcovFile(path.join(params.repoPath, strategy.lcovRelativePath), params.repoPath);
    const changedCoverage = params.edits
      .map((edit) => toCoverageEntry(edit.path, coverageByFile.get(normalizePath(edit.path))))
      .filter((item) => item !== null);

    return {
      executed: true,
      success: true,
      command: strategy.command,
      overallLineCoveragePercent: computeOverallCoverage(changedCoverage),
      fileCoverage: changedCoverage,
      notes: ["Tests executed successfully with coverage."],
      stdoutSnippet: truncate(result.stdout ?? "", 4000),
      stderrSnippet: truncate(result.stderr ?? "", 2000),
    };
  } catch (error) {
    const coverageByFile = await parseLcovFile(path.join(params.repoPath, strategy.lcovRelativePath), params.repoPath);
    const changedCoverage = params.edits
      .map((edit) => toCoverageEntry(edit.path, coverageByFile.get(normalizePath(edit.path))))
      .filter((item) => item !== null);

    const stdout = error instanceof Error && "stdout" in error ? String((error as { stdout?: string }).stdout ?? "") : "";
    const stderr = error instanceof Error && "stderr" in error ? String((error as { stderr?: string }).stderr ?? "") : "";

    return {
      executed: true,
      success: false,
      command: strategy.command,
      overallLineCoveragePercent: computeOverallCoverage(changedCoverage),
      fileCoverage: changedCoverage,
      notes: ["Tests failed. Review stderr/stdout before approval."],
      stdoutSnippet: truncate(stdout, 4000),
      stderrSnippet: truncate(stderr, 4000),
    };
  } finally {
    for (const [filePath, content] of originalContents.entries()) {
      if (content === null) {
        await fs.rm(path.join(params.repoPath, filePath), { force: true });
      } else {
        await writeFile(params.repoPath, filePath, content);
      }
    }
  }
}

type TestStrategy = {
  command: string;
  lcovRelativePath: string;
};

async function resolveTestStrategy(repoPath: string, repo: RepoSnapshot): Promise<TestStrategy | null> {
  const hasNode = Boolean(repo.languageSummary.TypeScript || repo.languageSummary.JavaScript);
  if (!hasNode) {
    return null;
  }

  const packageJsonPath = path.join(repoPath, "package.json");
  let scripts: Record<string, string> = {};
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    scripts = (JSON.parse(raw).scripts ?? {}) as Record<string, string>;
  } catch {
    scripts = {};
  }

  const manager = await detectPackageManager(repoPath);

  if (scripts["test:coverage"]) {
    return { command: `${manager} run test:coverage`, lcovRelativePath: "coverage/lcov.info" };
  }
  if (scripts.coverage) {
    return { command: `${manager} run coverage`, lcovRelativePath: "coverage/lcov.info" };
  }
  if (scripts.test) {
    return { command: `${manager} run test -- --coverage`, lcovRelativePath: "coverage/lcov.info" };
  }

  return null;
}

async function detectPackageManager(repoPath: string): Promise<string> {
  const hasPnpm = await exists(path.join(repoPath, "pnpm-lock.yaml"));
  if (hasPnpm) {
    return "pnpm";
  }
  const hasYarn = await exists(path.join(repoPath, "yarn.lock"));
  if (hasYarn) {
    return "yarn";
  }
  return "npm";
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

type CoverageAggregate = {
  coveredLines: number;
  totalLines: number;
};

async function parseLcovFile(filePath: string, repoPath: string): Promise<Map<string, CoverageAggregate>> {
  const map = new Map<string, CoverageAggregate>();
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return map;
  }

  const lines = raw.split("\n");
  let currentFile: string | null = null;
  let covered = 0;
  let total = 0;

  function flush(): void {
    if (!currentFile) {
      return;
    }
    const normalized = normalizeLcovPath(currentFile, repoPath);
    map.set(normalized, { coveredLines: covered, totalLines: total });
  }

  for (const line of lines) {
    if (line.startsWith("SF:")) {
      flush();
      currentFile = line.slice(3).trim();
      covered = 0;
      total = 0;
      continue;
    }

    if (line.startsWith("DA:")) {
      const parts = line.slice(3).split(",");
      const hits = Number.parseInt(parts[1] ?? "0", 10);
      total += 1;
      if (hits > 0) {
        covered += 1;
      }
      continue;
    }

    if (line === "end_of_record") {
      flush();
      currentFile = null;
      covered = 0;
      total = 0;
    }
  }

  flush();
  return map;
}

function normalizeLcovPath(filePath: string, repoPath: string): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(repoPath, filePath);
  return normalizePath(path.relative(repoPath, absolute));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function toCoverageEntry(pathValue: string, agg?: CoverageAggregate): TestExecutionReport["fileCoverage"][number] {
  if (!agg) {
    return {
      path: normalizePath(pathValue),
      coveredLines: 0,
      totalLines: 0,
      lineCoveragePercent: null,
    };
  }

  return {
    path: normalizePath(pathValue),
    coveredLines: agg.coveredLines,
    totalLines: agg.totalLines,
    lineCoveragePercent: agg.totalLines === 0 ? null : Number(((agg.coveredLines / agg.totalLines) * 100).toFixed(2)),
  };
}

function computeOverallCoverage(entries: TestExecutionReport["fileCoverage"]): number | null {
  const totalLines = entries.reduce((sum, item) => sum + item.totalLines, 0);
  if (totalLines === 0) {
    return null;
  }

  const coveredLines = entries.reduce((sum, item) => sum + item.coveredLines, 0);
  return Number(((coveredLines / totalLines) * 100).toFixed(2));
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}\n...<truncated>`;
}
