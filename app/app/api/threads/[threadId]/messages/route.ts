import { appendUserMessage, createPlannedResponse, getThread } from "@/lib/agent-store";

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  const thread = getThread(threadId);
  if (!thread) return Response.json({ error: "Tarefa não encontrada." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.content !== "string" || !body.content.trim()) {
    return Response.json({ error: "Uma mensagem é obrigatória." }, { status: 400 });
  }
  appendUserMessage(thread, body.content.trim());
  createPlannedResponse(thread);
  return Response.json({ thread });
}
