import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RepoSnapshot } from "../types";

const execFileAsync = promisify(execFile);

const languageByExtension: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".java": "Java",
  ".kt": "Kotlin",
  ".cs": "C#",
  ".rb": "Ruby",
  ".rs": "Rust",
  ".php": "PHP",
  ".swift": "Swift",
  ".scala": "Scala",
  ".c": "C",
  ".cpp": "C++",
  ".h": "C/C++",
};

export async function scanRepository(repoPath: string): Promise<RepoSnapshot> {
  const { stdout } = await execFileAsync("rg", ["--files"], { cwd: repoPath });
  const files = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const languageSummary: Record<string, number> = {};
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const language = languageByExtension[ext] ?? "Other";
    languageSummary[language] = (languageSummary[language] ?? 0) + 1;
  }

  const entries = await fs.readdir(repoPath);

  return {
    fileCount: files.length,
    topLevelEntries: entries.slice(0, 25),
    languageSummary,
    sampleFiles: files.slice(0, 80),
  };
}

export async function readFileIfExists(repoPath: string, relativePath: string): Promise<string | null> {
  const safePath = resolveInsideRepo(repoPath, relativePath);
  try {
    return await fs.readFile(safePath, "utf8");
  } catch {
    return null;
  }
}

export async function writeFile(repoPath: string, relativePath: string, content: string): Promise<void> {
  const safePath = resolveInsideRepo(repoPath, relativePath);
  await fs.mkdir(path.dirname(safePath), { recursive: true });
  await fs.writeFile(safePath, content, "utf8");
}

export function resolveInsideRepo(repoPath: string, relativePath: string): string {
  const resolved = path.resolve(repoPath, relativePath);
  const normalizedRoot = path.resolve(repoPath);

  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    throw new Error(`Invalid file path outside repo: ${relativePath}`);
  }

  return resolved;
}
