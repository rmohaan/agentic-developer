import { promises as fs } from "node:fs";
import path from "node:path";

const MEMORY_DIR = ".agent-memory";
const MEMORY_FILE = "feedback-history.json";

type FeedbackRecord = {
  timestamp: string;
  runId: string;
  taskId: string;
  feedback: string;
  accepted: boolean;
};

export async function appendFeedback(repoPath: string, record: FeedbackRecord): Promise<void> {
  const dir = path.join(repoPath, MEMORY_DIR);
  const file = path.join(dir, MEMORY_FILE);

  await fs.mkdir(dir, { recursive: true });

  const existing = await readFeedback(repoPath);
  existing.push(record);
  await fs.writeFile(file, JSON.stringify(existing.slice(-200), null, 2), "utf8");
}

export async function readFeedback(repoPath: string): Promise<FeedbackRecord[]> {
  const file = path.join(repoPath, MEMORY_DIR, MEMORY_FILE);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FeedbackRecord[]) : [];
  } catch {
    return [];
  }
}

export async function summarizeFeedbackBias(repoPath: string): Promise<string> {
  const history = await readFeedback(repoPath);
  if (history.length === 0) {
    return "No previous feedback history.";
  }

  const recent = history.slice(-30);
  const rejected = recent.filter((item) => !item.accepted).length;
  const accepted = recent.length - rejected;
  const topSignals = recent
    .map((item) => item.feedback)
    .join("\n")
    .slice(0, 3000);

  return [
    `Recent accepted: ${accepted}`,
    `Recent rejected: ${rejected}`,
    "Feedback excerpts:",
    topSignals,
  ].join("\n");
}
