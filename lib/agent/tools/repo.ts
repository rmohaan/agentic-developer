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
  const files = await listRepositoryFiles(repoPath);

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

async function listRepositoryFiles(repoPath: string): Promise<string[]> {
  const rgFiles = await tryListFilesWithRg(repoPath);
  if (rgFiles.length > 0) {
    return rgFiles;
  }

  const gitFiles = await tryListFilesWithGit(repoPath);
  if (gitFiles.length > 0) {
    return gitFiles;
  }

  return listFilesWithDirectoryWalk(repoPath);
}

async function tryListFilesWithRg(repoPath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("rg", ["--files"], { cwd: repoPath });
    return normalizeFileList(stdout);
  } catch {
    return [];
  }
}

async function tryListFilesWithGit(repoPath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files"], { cwd: repoPath });
    return normalizeFileList(stdout);
  } catch {
    return [];
  }
}

function normalizeFileList(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function listFilesWithDirectoryWalk(repoPath: string): Promise<string[]> {
  const ignoreDirectories = new Set([
    ".git",
    "node_modules",
    ".next",
    "dist",
    "build",
    "coverage",
  ]);

  const files: string[] = [];
  const queue = [repoPath];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = path.relative(repoPath, absolutePath);

      if (entry.isDirectory()) {
        if (!ignoreDirectories.has(entry.name)) {
          queue.push(absolutePath);
        }
        continue;
      }

      if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  return files;
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
