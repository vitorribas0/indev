"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CodexAppClient, CodexEnvelope } from "@/lib/codex-app-client";
import "./uploads.css";

type ChatMessage = { id: string; role: "user" | "assistant"; content: string; streaming?: boolean };
type WorkspaceFile = { id: string; name: string; size: number; type: string; path?: string; openaiId?: string };
type ActivityEvent = { id: string; kind: string; title: string; detail: string; status: string };
type PlanStep = { step: string; status: string };
type Skill = { name: string; description: string; path: string; enabled: boolean };
type Model = { id: string; model: string; displayName: string; isDefault?: boolean };
type ThreadSummary = { id: string; preview: string; name?: string | null; updatedAt?: number };
type Approval = { id: number; method: string; params: Record<string, unknown> };
type FileEntry = { fileName: string; isDirectory: boolean; isFile: boolean };
type ThreadStartResponse = { thread: { id: string; cwd: string; turns?: Array<{ items: Array<Record<string, unknown>> }> }; model: string; cwd: string };

const slashCommands = [
  ["/new", "Nova tarefa"],
  ["/interrupt", "Interromper execução"],
  ["/compact", "Compactar contexto"],
  ["/skills", "Ver habilidades"],
  ["/status", "Ver conexão"],
];

function itemLabel(item: Record<string, unknown>) {
  const type = String(item.type || "atividade");
  if (type === "commandExecution") return ["command", "Executando comando", String(item.command || "")];
  if (type === "fileChange") return ["file_change", "Alterando arquivos", `${(item.changes as unknown[] | undefined)?.length || 0} alteração(ões)`];
  if (type === "mcpToolCall") return ["tool", `Tool ${String(item.tool || "MCP")}`, String(item.server || "")];
  if (type === "dynamicToolCall") return ["tool", `Tool ${String(item.tool || "dinâmica")}`, String(item.namespace || "")];
  if (type === "collabAgentToolCall") return ["agent", "Agente colaborador", String(item.tool || "")];
  if (type === "reasoning") return ["reasoning", "Raciocinando", "Analisando a solicitação"];
  if (type === "plan") return ["plan", "Atualizando o plano", String(item.text || "")];
  if (type === "webSearch") return ["search", "Pesquisando na web", "Busca em andamento"];
  return [type, type, ""];
}

function messagesFromTurns(turns: ThreadStartResponse["thread"]["turns"] = []) {
  const output: ChatMessage[] = [];
  for (const turn of turns) {
    for (const item of turn.items || []) {
      if (item.type === "userMessage") {
        const content = (item.content as Array<{ type: string; text?: string }> | undefined)?.filter((part) => part.type === "text").map((part) => part.text).join("\n") || "";
        if (content) output.push({ id: String(item.id), role: "user", content });
      }
      if (item.type === "agentMessage" && item.text) output.push({ id: String(item.id), role: "assistant", content: String(item.text) });
    }
  }
  return output;
}

async function fileAsBase64(file: File) {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Falha ao ler arquivo."));
    reader.readAsDataURL(file);
  });
  return url.slice(url.indexOf(",") + 1);
}

export default function Home() {
  const clientRef = useRef<CodexAppClient | null>(null);
  const activeThreadRef = useRef("");
  const pendingTitleRef = useRef("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [engine, setEngine] = useState<"connecting" | "codex" | "responses" | "offline">("connecting");
  const [threadId, setThreadId] = useState("");
  const [cwd, setCwd] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [terminal, setTerminal] = useState("");
  const [diff, setDiff] = useState("");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("Conectando ao Codex");
  const [error, setError] = useState("");
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<"activity" | "files" | "terminal">("activity");
  const [menu, setMenu] = useState<"slash" | "files" | "skills" | "settings" | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<Skill[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<FileEntry[]>([]);
  const [contextFiles, setContextFiles] = useState<WorkspaceFile[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");
  const [sandbox, setSandbox] = useState<"read-only" | "workspace-write">("workspace-write");
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [account, setAccount] = useState("Conta local");

  useEffect(() => { activeThreadRef.current = threadId; }, [threadId]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  useEffect(() => {
    const client = new CodexAppClient();
    clientRef.current = client;
    const unsubscribe = client.onMessage(handleCodexMessage);
    let disposed = false;

    (async () => {
      try {
        await client.connect();
        if (disposed) return;
        setEngine("codex");
        const [accountResult, modelResult, skillResult] = await Promise.all([
          client.request<{ account: { type: string; planType?: string; email?: string } | null }>("account/read", {}),
          client.request<{ data: Model[] }>("model/list", { limit: 20 }),
          client.request<{ data: Array<{ skills: Skill[] }> }>("skills/list", {}),
        ]);
        if (disposed) return;
        setModels(modelResult.data || []);
        setModel(modelResult.data?.find((entry) => entry.isDefault)?.model || modelResult.data?.[0]?.model || "");
        setSkills((skillResult.data || []).flatMap((entry) => entry.skills || []).filter((skill) => skill.enabled));
        const currentAccount = accountResult.account;
        setAccount(currentAccount?.type === "chatgpt" ? `ChatGPT ${currentAccount.planType || ""}`.trim() : currentAccount?.type || "Conta local");
        await createCodexThread(client);
        await refreshThreads(client);
      } catch {
        if (disposed) return;
        await startResponsesFallback();
      }
    })();

    return () => {
      disposed = true;
      unsubscribe();
      client.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCodexMessage(message: CodexEnvelope) {
    const method = message.method || "";
    const params = message.params || {};
    const eventThreadId = String(params.threadId || "");
    if (eventThreadId && activeThreadRef.current && eventThreadId !== activeThreadRef.current) return;

    if (message.id !== undefined && method.includes("requestApproval")) {
      setApprovals((current) => [...current, { id: message.id as number, method, params }]);
      setStatus("Aguardando sua aprovação");
      return;
    }
    if (method === "indev/disconnected") {
      setEngine("offline"); setStatus("App Server desconectado"); setBusy(false);
      return;
    }
    if (method === "item/agentMessage/delta") {
      const itemId = String(params.itemId);
      const deltaText = String(params.delta || "");
      setMessages((current) => {
        const found = current.find((entry) => entry.id === itemId);
        return found
          ? current.map((entry) => entry.id === itemId ? { ...entry, content: entry.content + deltaText, streaming: true } : entry)
          : [...current, { id: itemId, role: "assistant", content: deltaText, streaming: true }];
      });
      setStatus("Respondendo");
      return;
    }
    if (method === "item/started") {
      const item = (params.item || {}) as Record<string, unknown>;
      if (item.type === "agentMessage") {
        setMessages((current) => current.some((entry) => entry.id === String(item.id)) ? current : [...current, { id: String(item.id), role: "assistant", content: "", streaming: true }]);
        return;
      }
      if (item.type === "userMessage") return;
      const [kind, title, detail] = itemLabel(item);
      setEvents((current) => [{ id: String(item.id || crypto.randomUUID()), kind, title, detail, status: "running" }, ...current]);
      return;
    }
    if (method === "item/completed") {
      const item = (params.item || {}) as Record<string, unknown>;
      if (item.type === "agentMessage") {
        setMessages((current) => current.map((entry) => entry.id === String(item.id) ? { ...entry, content: String(item.text || entry.content), streaming: false } : entry));
      } else {
        setEvents((current) => current.map((entry) => entry.id === String(item.id) ? { ...entry, status: String(item.status || "completed"), detail: item.type === "commandExecution" ? String(item.aggregatedOutput || entry.detail) : entry.detail } : entry));
        if (item.type === "commandExecution" && item.aggregatedOutput) {
          const commandOutput = String(item.aggregatedOutput);
          setTerminal((current) => current.endsWith(commandOutput) ? current : `${current}${current ? "\n" : ""}${commandOutput}`);
        }
      }
      return;
    }
    if (method === "item/commandExecution/outputDelta") {
      setTerminal((current) => current + String(params.delta || "")); setActiveTab("terminal");
      return;
    }
    if (method === "turn/plan/updated") { setPlan((params.plan as PlanStep[]) || []); return; }
    if (method === "turn/diff/updated") { setDiff(String(params.diff || "")); return; }
    if (method === "turn/completed") {
      const turn = (params.turn || {}) as { status?: string; error?: { message?: string } };
      setBusy(false);
      setStatus(turn.status === "completed" ? "Pronto" : "Execução encerrada");
      if (turn.error?.message) setError(turn.error.message);
      const pendingTitle = pendingTitleRef.current;
      pendingTitleRef.current = "";
      if (pendingTitle && clientRef.current?.connected) {
        void clientRef.current.request("thread/name/set", { threadId: activeThreadRef.current, name: pendingTitle }).then(() => refreshThreads()).catch(() => refreshThreads());
      } else void refreshThreads(clientRef.current);
      return;
    }
    if (method === "error" || method === "warning" || method === "guardianWarning") {
      const detail = String(params.message || params.error || "O Codex informou um erro.");
      setError(detail); setBusy(false); setStatus("Aguardando");
    }
  }

  async function createCodexThread(client = clientRef.current) {
    if (!client?.connected) return;
    setStatus("Criando tarefa"); setError(""); setMessages([]); setEvents([]); setFiles([]); setContextFiles([]); setSelectedSkills([]); setTerminal(""); setDiff(""); setPlan([]);
    const response = await client.request<ThreadStartResponse>("thread/start", {
      model: model || undefined,
      approvalPolicy: "on-request",
      sandbox,
      threadSource: "indev",
      developerInstructions: "Você é o InDev, um agente de desenvolvimento local. Responda em português quando o usuário falar português. Use tools com segurança, mantenha o usuário informado e nunca alegue uma execução que não ocorreu.",
    });
    activeThreadRef.current = response.thread.id;
    setThreadId(response.thread.id); setCwd(response.cwd || response.thread.cwd); setModel(response.model); setStatus("Pronto");
  }

  async function startResponsesFallback() {
    setEngine("responses"); setStatus("Conectando pela API OpenAI");
    try {
      const response = await fetch("/api/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Nova tarefa InDev" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao iniciar tarefa.");
      activeThreadRef.current = data.thread.id; setThreadId(data.thread.id); setStatus("Pronto");
    } catch (caught) {
      setEngine("offline"); setStatus("Offline"); setError(caught instanceof Error ? caught.message : "Não foi possível iniciar a tarefa.");
    }
  }

  async function refreshThreads(client = clientRef.current) {
    if (!client?.connected) return;
    try {
      const result = await client.request<{ data: ThreadSummary[] }>("thread/list", { limit: 12, sourceKinds: ["appServer"], sortKey: "updated_at", sortDirection: "desc", useStateDbOnly: true });
      setThreads((result.data || []).filter((thread) => thread.preview || thread.id === activeThreadRef.current));
    } catch { /* histórico não bloqueia o chat */ }
  }

  async function resumeThread(id: string) {
    const client = clientRef.current;
    if (!client?.connected || id === threadId || busy) return;
    setStatus("Abrindo tarefa"); setError("");
    try {
      const response = await client.request<ThreadStartResponse>("thread/resume", { threadId: id, approvalPolicy: "on-request", sandbox });
      activeThreadRef.current = response.thread.id; setThreadId(response.thread.id); setCwd(response.cwd || response.thread.cwd); setModel(response.model);
      setMessages(messagesFromTurns(response.thread.turns)); setEvents([]); setPlan([]); setTerminal(""); setDiff(""); setStatus("Pronto");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível abrir a tarefa."); setStatus("Aguardando"); }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (!content || !threadId || busy) return;
    if (content.startsWith("/") && await runSlashCommand(content)) return;
    setInput(""); setError(""); setStatus("Codex está pensando"); setBusy(true); setMenu(null);
    const localId = `local-${Date.now()}`;
    setMessages((current) => [...current, { id: localId, role: "user", content }]);

    if (engine === "codex" && clientRef.current?.connected) {
      try {
        if (messages.length === 0) pendingTitleRef.current = content.slice(0, 58);
        const attachments = [...files, ...contextFiles];
        const inputs: Array<Record<string, unknown>> = [{ type: "text", text: content, text_elements: [] }];
        selectedSkills.forEach((skill) => inputs.push({ type: "skill", name: skill.name, path: skill.path }));
        attachments.forEach((file) => {
          if (!file.path) return;
          inputs.push(file.type.startsWith("image/") ? { type: "localImage", path: file.path } : { type: "mention", name: file.name, path: file.path });
        });
        await clientRef.current.request("turn/start", { threadId, input: inputs, model: model || undefined, approvalPolicy: "on-request" });
        setFiles([]); setContextFiles([]); setSelectedSkills([]);
      } catch (caught) {
        pendingTitleRef.current = "";
        setError(caught instanceof Error ? caught.message : "Falha ao iniciar o turno."); setBusy(false); setStatus("Aguardando");
      }
      return;
    }

    try {
      const response = await fetch(`/api/threads/${threadId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Ocorreu um erro.");
      setMessages(data.thread.messages); setStatus("Pronto");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Ocorreu um erro."); setStatus("Aguardando"); }
    finally { setBusy(false); }
  }

  async function runSlashCommand(command: string) {
    const client = clientRef.current;
    if (command === "/new") { setInput(""); setMenu(null); if (engine === "codex") await createCodexThread(); else await startResponsesFallback(); return true; }
    if (command === "/interrupt") { setInput(""); setMenu(null); if (client?.connected && threadId) await client.request("turn/interrupt", { threadId }); return true; }
    if (command === "/compact") { setInput(""); setMenu(null); if (client?.connected) { setBusy(true); setStatus("Compactando contexto"); await client.request("thread/compact/start", { threadId }); } return true; }
    if (command === "/skills") { setInput(""); setMenu("skills"); return true; }
    if (command === "/status") { setInput(""); setError(engine === "codex" ? `Codex App Server conectado em ${cwd}.` : `Motor atual: ${engine}.`); return true; }
    return false;
  }

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected || !threadId) return;
    if (selected.size > 12 * 1024 * 1024) { setError("O limite por arquivo nesta versão é 12 MB."); return; }
    setUploading(true); setError(""); setStatus("Armazenando arquivo");
    try {
      if (engine === "codex" && clientRef.current?.connected && cwd) {
        const safeName = selected.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const uploadDir = `${cwd}/.indev/uploads`;
        const path = `${uploadDir}/${Date.now()}-${safeName}`;
        await clientRef.current.request("fs/createDirectory", { path: uploadDir, recursive: true });
        await clientRef.current.request("fs/writeFile", { path, dataBase64: await fileAsBase64(selected) }, 60_000);
        setFiles((current) => [...current, { id: crypto.randomUUID(), name: selected.name, size: selected.size, type: selected.type || "application/octet-stream", path }]);
      } else {
        const form = new FormData(); form.append("file", selected);
        const response = await fetch(`/api/threads/${threadId}/files`, { method: "POST", body: form });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível anexar o arquivo.");
        setFiles(data.files.map((file: { id: string; name: string; size: number; type: string; openaiFileId: string }) => ({ ...file, openaiId: file.openaiFileId })));
      }
      setStatus("Pronto");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível anexar o arquivo."); setStatus("Aguardando"); }
    finally { setUploading(false); }
  }

  async function openFileMenu() {
    setMenu("files");
    if (!clientRef.current?.connected || !cwd) return;
    try {
      const result = await clientRef.current.request<{ entries: FileEntry[] }>("fs/readDirectory", { path: cwd });
      setWorkspaceFiles((result.entries || []).filter((entry) => !entry.fileName.startsWith(".")).slice(0, 30));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível listar os arquivos."); }
  }

  function addContextFile(entry: FileEntry) {
    const path = `${cwd}/${entry.fileName}`;
    setContextFiles((current) => current.some((file) => file.path === path) ? current : [...current, { id: crypto.randomUUID(), name: entry.fileName, size: 0, type: entry.isDirectory ? "inode/directory" : "text/plain", path }]);
    setMenu(null);
  }

  function addSkill(skill: Skill) {
    setSelectedSkills((current) => current.some((entry) => entry.path === skill.path) ? current : [...current, skill]); setMenu(null);
  }

  function answerApproval(approval: Approval, decision: "accept" | "decline") {
    clientRef.current?.respond(approval.id, { decision });
    setApprovals((current) => current.filter((entry) => entry.id !== approval.id));
    setStatus(decision === "accept" ? "Aprovado — executando" : "Ação recusada");
  }

  const allAttachments = useMemo(() => [...files, ...contextFiles], [files, contextFiles]);
  const title = messages.find((message) => message.role === "user")?.content.slice(0, 48) || "Nova tarefa InDev";

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="logo"><span>i</span> InDev <em>BETA</em></div>
      <button className="new" onClick={() => engine === "codex" ? createCodexThread() : startResponsesFallback()}>＋ Nova tarefa</button>
      <small>TAREFAS</small>
      <div className="thread-list">
        <button className="task active">{title}</button>
        {threads.filter((thread) => thread.id !== threadId).slice(0, 8).map((thread) => <button className="task" key={thread.id} onClick={() => resumeThread(thread.id)}>{thread.name || thread.preview || "Tarefa sem título"}</button>)}
      </div>
      <div className="side-bottom">
        <button onClick={() => setMenu(menu === "slash" ? null : "slash")}>⌘ Comandos</button>
        <button onClick={() => setMenu(menu === "settings" ? null : "settings")}>⚙ Configurações</button>
        <div className="user">V <span>Vitor<br/><small>{account}</small></span></div>
      </div>
    </aside>

    <section className="conversation">
      <header>
        <div><h1>{title}</h1><p><i className={engine}></i> {status} · {engine === "codex" ? "Codex App Server" : engine === "responses" ? "OpenAI API (reserva)" : "ambiente local"}</p></div>
        <div className="header-actions"><select aria-label="Modelo" value={model} onChange={(event) => setModel(event.target.value)} disabled={engine !== "codex"}>{models.length ? models.map((entry) => <option key={entry.id} value={entry.model}>{entry.displayName}</option>) : <option>gpt-5.4</option>}</select><button onClick={() => setMenu(menu === "settings" ? null : "settings")}>•••</button></div>
      </header>

      <div className="chat">
        {messages.length === 0 && <div className="welcome"><span>i</span><h2>O que vamos construir?</h2><p>{engine === "codex" ? "Tools, sandbox, terminal, arquivos, skills e memória estão conectados." : "Conectando ao motor local do InDev…"}</p></div>}
        {messages.map((message) => <article className={`message ${message.role}`} key={message.id}><b>{message.role === "user" ? "V" : "i"}</b><div>{message.content}{message.streaming && <span className="cursor">▋</span>}</div></article>)}
        {busy && !messages.some((message) => message.streaming) && <div className="thinking"><span></span><span></span><span></span> Codex está trabalhando…</div>}
        {approvals.map((approval) => <div className="approval-card" key={approval.id}><strong>Confirmação necessária</strong><p>{String(approval.params.reason || approval.params.command || (approval.method.includes("fileChange") ? "Alterar arquivos fora da área permitida" : "Executar uma ação protegida"))}</p><div><button onClick={() => answerApproval(approval, "decline")}>Recusar</button><button className="approve" onClick={() => answerApproval(approval, "accept")}>Aprovar uma vez</button></div></div>)}
        {error && <div className="error">{error}</div>}
        <div ref={chatEndRef}></div>
      </div>

      <form onSubmit={send}>
        {(allAttachments.length > 0 || selectedSkills.length > 0) && <div className="attachments">{allAttachments.map((file) => <button type="button" key={file.id} onClick={() => { setFiles((current) => current.filter((item) => item.id !== file.id)); setContextFiles((current) => current.filter((item) => item.id !== file.id)); }}>▤ {file.name} ×</button>)}{selectedSkills.map((skill) => <button type="button" key={skill.path} onClick={() => setSelectedSkills((current) => current.filter((item) => item.path !== skill.path))}>✦ {skill.name} ×</button>)}</div>}
        {menu && <div className="command-menu">
          {menu === "slash" && <><div className="menu-label">COMANDOS</div>{slashCommands.map(([command, description]) => <button type="button" key={command} onClick={() => { setInput(command); setMenu(null); }}>{command}<span>{description}</span></button>)}</>}
          {menu === "files" && <><div className="menu-label">ARQUIVOS DO PROJETO</div>{engine !== "codex" ? <p>Disponível quando o Codex App Server estiver conectado.</p> : workspaceFiles.length ? workspaceFiles.map((entry) => <button type="button" key={entry.fileName} onClick={() => addContextFile(entry)}>{entry.isDirectory ? "▸" : "▤"} {entry.fileName}</button>) : <p>Carregando arquivos…</p>}</>}
          {menu === "skills" && <><div className="menu-label">SKILLS</div>{skills.slice(0, 20).map((skill) => <button type="button" key={skill.path} onClick={() => addSkill(skill)}>✦ {skill.name}<span>{skill.description}</span></button>)}</>}
          {menu === "settings" && <><div className="menu-label">SEGURANÇA E EXECUÇÃO</div><button type="button" onClick={() => setSandbox("workspace-write")} className={sandbox === "workspace-write" ? "selected" : ""}>Workspace write<span>Pode editar somente o projeto</span></button><button type="button" onClick={() => setSandbox("read-only")} className={sandbox === "read-only" ? "selected" : ""}>Somente leitura<span>Não altera arquivos</span></button><p>A mudança vale para a próxima tarefa.</p></>}
        </div>}
        <input ref={fileInput} className="file-input" type="file" onChange={uploadFile} />
        <div className="composer">
          <button type="button" title="Enviar arquivo" onClick={() => fileInput.current?.click()} disabled={uploading}>＋</button>
          <button type="button" title="Adicionar arquivo do projeto" onClick={openFileMenu}>@</button>
          <button type="button" title="Comandos" onClick={() => setMenu(menu === "slash" ? null : "slash")}>/</button>
          <button type="button" title="Skills" onClick={() => setMenu(menu === "skills" ? null : "skills")}>✦</button>
          <input value={input} onChange={(event) => { setInput(event.target.value); if (event.target.value === "/") setMenu("slash"); }} placeholder="Peça ao InDev para construir, testar ou explicar…" />
          {busy ? <button type="button" className="stop" title="Interromper" onClick={() => runSlashCommand("/interrupt")}>■</button> : <button className="send" disabled={!threadId || uploading || engine === "connecting"}>↑</button>}
        </div>
        <p>{uploading ? "Armazenando arquivo no projeto…" : engine === "codex" ? `Sandbox: ${sandbox} · respostas em streaming · aprovações ativas` : "Modo reserva pela Responses API."}</p>
      </form>
    </section>

    <aside className="activity">
      <nav><button className={activeTab === "activity" ? "active" : ""} onClick={() => setActiveTab("activity")}>Atividade</button><button className={activeTab === "files" ? "active" : ""} onClick={() => setActiveTab("files")}>Arquivos</button><button className={activeTab === "terminal" ? "active" : ""} onClick={() => setActiveTab("terminal")}>Terminal</button></nav>
      <div className="activity-body">
        <label>● {status.toUpperCase()}</label>
        {activeTab === "activity" && <>
          <h2>Plano</h2>{plan.length ? plan.map((step, index) => <p key={`${step.step}-${index}`} className={step.status}>◌ {step.step}</p>) : <p className="muted">O plano aparecerá quando a tarefa exigir várias etapas.</p>}
          <h2>Execuções</h2>{events.length ? events.map((entry) => <div className="event-card" key={entry.id}><span className={entry.status}></span><div><b>{entry.title}</b><small>{entry.detail || entry.status}</small></div></div>) : <p className="muted">Tools e comandos aparecerão aqui em tempo real.</p>}
          {diff && <><h2>Últimas alterações</h2><pre className="diff-preview">{diff.slice(-2400)}</pre></>}
        </>}
        {activeTab === "files" && <><h2>Contexto desta mensagem</h2>{allAttachments.length ? allAttachments.map((file) => <div className="backend-card file-card" key={file.id}><b>{file.name}</b><span>{file.path || `${Math.max(1, Math.round(file.size / 1024))} KB`}</span></div>) : <p className="muted">Use + para subir um arquivo ou @ para selecionar algo do projeto.</p>}<h2>Área de trabalho</h2><div className="backend-card"><b>{cwd ? cwd.split("/").pop() : "InDev"}</b><span title={cwd}>{cwd || "Aguardando App Server"}</span></div></>}
        {activeTab === "terminal" && <><h2>Saída do terminal</h2><pre className="terminal-output">{terminal || "Nenhum comando executado nesta tarefa."}</pre></>}
        <h2>Motor</h2><div className="backend-card"><b>{engine === "codex" ? "Codex App Server" : engine === "responses" ? "Responses API" : "Conectando"}</b><span>{engine === "codex" ? `${model || "modelo padrão"} · ${sandbox}` : "Reserva segura"}</span></div>
      </div>
    </aside>
  </main>;
}
