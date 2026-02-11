import type { AgentRunRecord } from "./types";

const runStore = new Map<string, AgentRunRecord>();

export function putRun(record: AgentRunRecord): void {
  runStore.set(record.runId, record);
}

export function getRun(runId: string): AgentRunRecord | undefined {
  return runStore.get(runId);
}

export function updateRun(runId: string, update: Partial<AgentRunRecord>): AgentRunRecord {
  const existing = runStore.get(runId);
  if (!existing) {
    throw new Error(`Run not found: ${runId}`);
  }

  const merged = { ...existing, ...update };
  runStore.set(runId, merged);
  return merged;
}
