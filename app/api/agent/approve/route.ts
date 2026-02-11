import { z } from "zod";
import { approveOrRejectRun } from "@/lib/agent/workflow";

export const runtime = "nodejs";

const ApprovalSchema = z.object({
  runId: z.string().min(1),
  approved: z.boolean(),
  feedback: z.string().optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const payload = await request.json();
    const input = ApprovalSchema.parse(payload);
    const run = await approveOrRejectRun(input);
    return Response.json(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}
