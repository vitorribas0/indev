export type ToolEvent = {
  id: string;
  kind: "read" | "command" | "file_change" | "approval";
  title: string;
  detail: string;
  status: "queued" | "running" | "completed" | "failed" | "awaiting_approval";
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type Thread = {
  id: string;
  title: string;
  messages: Message[];
  events: ToolEvent[];
  createdAt: string;
  updatedAt: string;
};

const threads = new Map<string, Thread>();

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function createThread(title = "Nova tarefa") {
  const now = new Date().toISOString();
  const thread: Thread = { id: id("thread"), title, messages: [], events: [], createdAt: now, updatedAt: now };
  threads.set(thread.id, thread);
  return thread;
}

export function listThreads() {
  return [...threads.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getThread(threadId: string) {
  return threads.get(threadId);
}

export function appendUserMessage(thread: Thread, content: string) {
  thread.messages.push({ id: id("message"), role: "user", content, createdAt: new Date().toISOString() });
  thread.updatedAt = new Date().toISOString();
}

export function createPlannedResponse(thread: Thread) {
  const event: ToolEvent = {
    id: id("event"),
    kind: "read",
    title: "Analisando o projeto",
    detail: "Preparando o contexto e selecionando os arquivos relevantes.",
    status: "completed",
  };
  thread.events.unshift(event);
  thread.messages.push({
    id: id("message"),
    role: "assistant",
    content: "Recebi a tarefa. O backend registrou a conversa e preparou uma execução planejada. Para executar mudanças reais, o próximo passo é conectar um provedor de IA e um executor isolado com aprovação.",
    createdAt: new Date().toISOString(),
  });
  thread.updatedAt = new Date().toISOString();
  return event;
}
