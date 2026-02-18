import { promises as fs } from "node:fs";
import path from "node:path";
import type { RepoSnapshot } from "./types";

const INSTRUCTIONS_DIR = path.resolve(process.cwd(), "instructions", "llm");

type InstructionSpec = {
  key: string;
  file: string;
  match: (repo: RepoSnapshot) => boolean;
};

const specs: InstructionSpec[] = [
  {
    key: "java",
    file: "java.md",
    match: (repo) => repo.techStack.some((item) => item.includes("Java")),
  },
  {
    key: "javascript",
    file: "javascript.md",
    match: (repo) => Boolean(repo.languageSummary.JavaScript),
  },
  {
    key: "typescript",
    file: "typescript.md",
    match: (repo) => Boolean(repo.languageSummary.TypeScript),
  },
  {
    key: "nodejs",
    file: "nodejs.md",
    match: (repo) => repo.techStack.includes("JavaScript/Node.js"),
  },
  {
    key: "nextjs",
    file: "nextjs.md",
    match: (repo) => repo.techStack.includes("Next.js"),
  },
  {
    key: "python",
    file: "python.md",
    match: (repo) => Boolean(repo.languageSummary.Python),
  },
];

export async function loadLlmInstructionBundle(repo: RepoSnapshot): Promise<string> {
  const files = ["common.md", ...specs.filter((spec) => spec.match(repo)).map((spec) => spec.file)];

  const chunks: string[] = [];
  for (const file of files) {
    const absolutePath = path.join(INSTRUCTIONS_DIR, file);
    try {
      const text = await fs.readFile(absolutePath, "utf8");
      chunks.push(text.trim());
    } catch {
      chunks.push(`# Missing Instruction File\n${file} could not be loaded.`);
    }
  }

  return chunks.join("\n\n");
}
