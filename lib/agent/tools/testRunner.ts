import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { DraftEdit, RepoSnapshot, TestExecutionReport } from "../types";
import { readFileIfExists, writeFile } from "./repo";

const execAsync = promisify(exec);

type CoverageAggregate = {
  coveredLines: number;
  totalLines: number;
};

type TestStrategy = {
  command: string;
  reportRelativePath: string;
  parser: "lcov" | "go-coverprofile" | "cobertura-xml" | "jacoco-xml";
  notes?: string[];
};

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
        "Supported strategies: JS/TS (lcov), Python pytest-cov XML, Go coverprofile, Java JaCoCo XML.",
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
      timeout: 15 * 60 * 1000,
      maxBuffer: 15 * 1024 * 1024,
    });

    const coverageByFile = await parseCoverageReport(strategy, params.repoPath);
    const changedCoverage = mapCoverageToChangedFiles(params.edits, coverageByFile);

    return {
      executed: true,
      success: true,
      command: strategy.command,
      overallLineCoveragePercent: computeOverallCoverage(changedCoverage),
      fileCoverage: changedCoverage,
      notes: [...(strategy.notes ?? []), "Tests executed successfully with coverage."],
      stdoutSnippet: truncate(result.stdout ?? "", 4000),
      stderrSnippet: truncate(result.stderr ?? "", 2000),
    };
  } catch (error) {
    const coverageByFile = await parseCoverageReport(strategy, params.repoPath);
    const changedCoverage = mapCoverageToChangedFiles(params.edits, coverageByFile);

    const stdout = error instanceof Error && "stdout" in error ? String((error as { stdout?: string }).stdout ?? "") : "";
    const stderr = error instanceof Error && "stderr" in error ? String((error as { stderr?: string }).stderr ?? "") : "";

    return {
      executed: true,
      success: false,
      command: strategy.command,
      overallLineCoveragePercent: computeOverallCoverage(changedCoverage),
      fileCoverage: changedCoverage,
      notes: [...(strategy.notes ?? []), "Tests failed. Review stderr/stdout before approval."],
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

async function resolveTestStrategy(repoPath: string, repo: RepoSnapshot): Promise<TestStrategy | null> {
  const nodeStrategy = await resolveNodeStrategy(repoPath, repo);
  if (nodeStrategy) {
    return nodeStrategy;
  }

  const pythonStrategy = await resolvePythonStrategy(repoPath, repo);
  if (pythonStrategy) {
    return pythonStrategy;
  }

  const goStrategy = await resolveGoStrategy(repoPath, repo);
  if (goStrategy) {
    return goStrategy;
  }

  const javaStrategy = await resolveJavaStrategy(repoPath, repo);
  if (javaStrategy) {
    return javaStrategy;
  }

  return null;
}

async function resolveNodeStrategy(repoPath: string, repo: RepoSnapshot): Promise<TestStrategy | null> {
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
    return { command: `${manager} run test:coverage`, reportRelativePath: "coverage/lcov.info", parser: "lcov" };
  }
  if (scripts.coverage) {
    return { command: `${manager} run coverage`, reportRelativePath: "coverage/lcov.info", parser: "lcov" };
  }
  if (scripts.test) {
    return { command: `${manager} run test -- --coverage`, reportRelativePath: "coverage/lcov.info", parser: "lcov" };
  }

  return null;
}

async function resolvePythonStrategy(repoPath: string, repo: RepoSnapshot): Promise<TestStrategy | null> {
  const hasPython = Boolean(repo.languageSummary.Python);
  const looksLikePythonRepo =
    hasPython ||
    (await exists(path.join(repoPath, "pyproject.toml"))) ||
    (await exists(path.join(repoPath, "requirements.txt")));

  if (!looksLikePythonRepo) {
    return null;
  }

  return {
    command: "pytest --cov=. --cov-report=xml:coverage.xml",
    reportRelativePath: "coverage.xml",
    parser: "cobertura-xml",
    notes: ["Python coverage expects pytest + pytest-cov to be installed."],
  };
}

async function resolveGoStrategy(repoPath: string, repo: RepoSnapshot): Promise<TestStrategy | null> {
  const hasGo = Boolean(repo.languageSummary.Go) || (await exists(path.join(repoPath, "go.mod")));
  if (!hasGo) {
    return null;
  }

  return {
    command: "go test ./... -covermode=count -coverprofile=coverage.out",
    reportRelativePath: "coverage.out",
    parser: "go-coverprofile",
  };
}

async function resolveJavaStrategy(repoPath: string, repo: RepoSnapshot): Promise<TestStrategy | null> {
  const hasJava = Boolean(repo.languageSummary.Java || repo.languageSummary.Kotlin);
  const hasMaven = (await exists(path.join(repoPath, "pom.xml"))) || (await exists(path.join(repoPath, "mvnw")));
  if (hasJava && hasMaven) {
    const maven = process.platform === "win32"
      ? ((await exists(path.join(repoPath, "mvnw.cmd"))) ? "mvnw.cmd" : "mvn")
      : ((await exists(path.join(repoPath, "mvnw"))) ? "./mvnw" : "mvn");

    return {
      command: `${maven} test jacoco:report`,
      reportRelativePath: "target/site/jacoco/jacoco.xml",
      parser: "jacoco-xml",
      notes: ["Java coverage expects JaCoCo plugin/report to be available in the build."],
    };
  }

  const hasGradle =
    (await exists(path.join(repoPath, "build.gradle"))) ||
    (await exists(path.join(repoPath, "build.gradle.kts"))) ||
    (await exists(path.join(repoPath, "gradlew"))) ||
    (await exists(path.join(repoPath, "gradlew.bat")));

  if (hasJava && hasGradle) {
    const gradle = process.platform === "win32"
      ? ((await exists(path.join(repoPath, "gradlew.bat"))) ? "gradlew.bat" : "gradle")
      : ((await exists(path.join(repoPath, "gradlew"))) ? "./gradlew" : "gradle");

    return {
      command: `${gradle} test jacocoTestReport`,
      reportRelativePath: "build/reports/jacoco/test/jacocoTestReport.xml",
      parser: "jacoco-xml",
      notes: ["Java coverage expects JaCoCo plugin/report task in Gradle build."],
    };
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

async function parseCoverageReport(strategy: TestStrategy, repoPath: string): Promise<Map<string, CoverageAggregate>> {
  const reportPath = path.join(repoPath, strategy.reportRelativePath);
  if (strategy.parser === "lcov") {
    return parseLcovFile(reportPath, repoPath);
  }
  if (strategy.parser === "go-coverprofile") {
    return parseGoCoverProfile(reportPath, repoPath);
  }
  if (strategy.parser === "cobertura-xml") {
    return parseCoberturaXml(reportPath, repoPath);
  }
  return parseJaCoCoXml(reportPath, repoPath);
}

function mapCoverageToChangedFiles(edits: DraftEdit[], coverageByFile: Map<string, CoverageAggregate>) {
  return edits.map((edit) => toCoverageEntry(edit.path, coverageByFile.get(normalizePath(edit.path))));
}

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

async function parseGoCoverProfile(filePath: string, repoPath: string): Promise<Map<string, CoverageAggregate>> {
  const map = new Map<string, CoverageAggregate>();
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return map;
  }

  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line || line.startsWith("mode:")) {
      continue;
    }

    const match = /^(.*):(\d+)\.(\d+),(\d+)\.(\d+)\s+(\d+)\s+(\d+)$/.exec(line.trim());
    if (!match) {
      continue;
    }

    const fileRef = normalizeGoPath(match[1], repoPath);
    const numStmt = Number.parseInt(match[6], 10);
    const count = Number.parseInt(match[7], 10);

    const existing = map.get(fileRef) ?? { coveredLines: 0, totalLines: 0 };
    existing.totalLines += numStmt;
    if (count > 0) {
      existing.coveredLines += numStmt;
    }
    map.set(fileRef, existing);
  }

  return map;
}

async function parseCoberturaXml(filePath: string, repoPath: string): Promise<Map<string, CoverageAggregate>> {
  const map = new Map<string, CoverageAggregate>();
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return map;
  }

  const classRegex = /<class\b[^>]*filename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/g;
  let classMatch: RegExpExecArray | null;
  while ((classMatch = classRegex.exec(raw)) !== null) {
    const filename = normalizeCoberturaPath(classMatch[1], repoPath);
    const body = classMatch[2] ?? "";

    const lineRegex = /<line\b[^>]*hits="(\d+)"[^>]*\/?>(?:<\/line>)?/g;
    let lineMatch: RegExpExecArray | null;
    let total = 0;
    let covered = 0;

    while ((lineMatch = lineRegex.exec(body)) !== null) {
      total += 1;
      const hits = Number.parseInt(lineMatch[1], 10);
      if (hits > 0) {
        covered += 1;
      }
    }

    const existing = map.get(filename) ?? { coveredLines: 0, totalLines: 0 };
    existing.coveredLines += covered;
    existing.totalLines += total;
    map.set(filename, existing);
  }

  return map;
}

async function parseJaCoCoXml(filePath: string, repoPath: string): Promise<Map<string, CoverageAggregate>> {
  const map = new Map<string, CoverageAggregate>();
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return map;
  }

  const packageRegex = /<package\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/package>/g;
  let packageMatch: RegExpExecArray | null;

  while ((packageMatch = packageRegex.exec(raw)) !== null) {
    const packageName = packageMatch[1] ?? "";
    const packageBody = packageMatch[2] ?? "";

    const sourceRegex = /<sourcefile\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/sourcefile>/g;
    let sourceMatch: RegExpExecArray | null;

    while ((sourceMatch = sourceRegex.exec(packageBody)) !== null) {
      const sourceName = sourceMatch[1] ?? "";
      const sourceBody = sourceMatch[2] ?? "";

      const counterMatch = /<counter\b[^>]*type="LINE"[^>]*missed="(\d+)"[^>]*covered="(\d+)"[^>]*\/>/.exec(sourceBody);
      if (!counterMatch) {
        continue;
      }

      const missed = Number.parseInt(counterMatch[1], 10);
      const covered = Number.parseInt(counterMatch[2], 10);
      const total = missed + covered;

      const combined = packageName.length > 0 ? `${packageName}/${sourceName}` : sourceName;
      const normalized = normalizePath(combined);
      const relative = normalizePath(path.relative(repoPath, path.resolve(repoPath, normalized)));
      map.set(relative, { coveredLines: covered, totalLines: total });
    }
  }

  return map;
}

function normalizeLcovPath(filePath: string, repoPath: string): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(repoPath, filePath);
  return normalizePath(path.relative(repoPath, absolute));
}

function normalizeGoPath(filePath: string, repoPath: string): string {
  const cleaned = normalizePath(filePath);
  if (path.isAbsolute(cleaned)) {
    return normalizePath(path.relative(repoPath, cleaned));
  }
  return cleaned;
}

function normalizeCoberturaPath(filePath: string, repoPath: string): string {
  const normalized = normalizePath(filePath);
  if (path.isAbsolute(normalized)) {
    return normalizePath(path.relative(repoPath, normalized));
  }
  return normalized;
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
