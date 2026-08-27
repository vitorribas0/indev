import { appendAssistantMessage, appendUserMessage, getThread } from "@/lib/agent-store";
import { serverLlmProvider } from "@/lib/server-llm-provider";

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  const thread = getThread(threadId);
  if (!thread) return Response.json({ error: "Tarefa não encontrada." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.content !== "string" || !body.content.trim()) {
    return Response.json({ error: "Uma mensagem é obrigatória." }, { status: 400 });
  }
  appendUserMessage(thread, body.content.trim());
  const provider = serverLlmProvider();
  if (!provider.configured) {
    return Response.json({
      error: `O provedor ${provider.label} ainda não foi configurado no arquivo .env.local.`,
      thread,
    }, { status: 503 });
  }
  try {
    const response = await provider.client.responses.create({
      model: provider.model,
      store: false,
      instructions: "Você é o InDev, um assistente de desenvolvimento. Seja objetivo, explique o plano antes de mudanças relevantes e não alegue executar ferramentas que não estão conectadas.",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: thread.messages.map((message) => `${message.role === "user" ? "Usuário" : "InDev"}: ${message.content}`).join("\n\n") },
          ...thread.files.map((file) => ({ type: "input_file" as const, file_id: file.openaiFileId })),
        ],
      }],
    });
    appendAssistantMessage(thread, response.output_text || "Não recebi texto de resposta do modelo.");
  } catch (error) {
    const message = error instanceof Error ? error.message : `Não foi possível comunicar com ${provider.label}.`;
    return Response.json({ error: message, thread }, { status: 502 });
  }
  return Response.json({ thread });
}
