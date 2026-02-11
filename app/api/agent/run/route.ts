import { z } from "zod";
import { startAgentRun } from "@/lib/agent/workflow";

export const runtime = "nodejs";

const RunSchema = z.object({
  taskId: z.string().min(1),
  tracker: z.enum(["jira", "gitlab"]),
  repoPath: z.string().min(1),
  targetBranch: z.string().min(1).default("develop"),
  dryRun: z.boolean().default(true),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const payload = await request.json();
    const input = RunSchema.parse(payload);
    const run = await startAgentRun(input);
    return Response.json(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}
