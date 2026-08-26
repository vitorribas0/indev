"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import "./uploads.css";

type ChatMessage = { id: string; role: "user" | "assistant"; content: string };
type AttachedFile = { id: string; name: string; size: number; type: string };

export default function Home() {
  const [threadId, setThreadId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("Preparando tarefa");
  const [error, setError] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Nova tarefa InDev" }) })
      .then((response) => response.json())
      .then(({ thread }) => { setThreadId(thread.id); setStatus("Pronto"); })
      .catch(() => setError("Não foi possível iniciar a tarefa."));
  }, []);

  async function send(event: FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (!content || !threadId) return;
    setInput(""); setError(""); setStatus("Pensando");
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: "user", content }]);
    const response = await fetch(`/api/threads/${threadId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error || "Ocorreu um erro."); setStatus("Aguardando"); return; }
    setMessages(data.thread.messages); setStatus("Pronto");
  }

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected || !threadId) return;
    setUploading(true); setError(""); setStatus("Enviando arquivo");
    const form = new FormData(); form.append("file", selected);
    const response = await fetch(`/api/threads/${threadId}/files`, { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) setError(data.error || "Não foi possível anexar o arquivo.");
    else setFiles(data.files);
    setUploading(false); setStatus("Pronto");
  }

  return <main className="app-shell">
    <aside className="sidebar"><div className="logo"><span>i</span> InDev</div><button className="new">＋ Nova tarefa</button><small>HOJE</small><button className="task active">Nova tarefa InDev</button><div className="side-bottom"><button>⌘ Comandos</button><button>⚙ Configurações</button><div className="user">V <span>Vitor<br/><small>Plano pessoal</small></span></div></div></aside>
    <section className="conversation"><header><div><h1>Nova tarefa InDev</h1><p><i></i> {status} · ambiente local</p></div><button>•••</button></header><div className="chat">{messages.length === 0 && <div className="welcome"><span>i</span><h2>O que vamos construir?</h2><p>O chat já está conectado ao backend do InDev.</p></div>}{messages.map((message) => <article className={`message ${message.role}`} key={message.id}><b>{message.role === "user" ? "V" : "i"}</b><div>{message.content}</div></article>)}{error && <div className="error">{error}</div>}</div><form onSubmit={send}>{files.length > 0 && <div className="attachments">{files.map((file) => <span key={file.id}>▤ {file.name}</span>)}</div>}<input ref={fileInput} className="file-input" type="file" onChange={uploadFile} /><div className="composer"><button type="button" title="Anexar arquivo" onClick={() => fileInput.current?.click()} disabled={uploading}>＋</button><button type="button" title="Adicionar contexto">@</button><button type="button" title="Comandos">/</button><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Descreva o que você quer construir..." /><button className="send" disabled={!threadId || uploading}>↑</button></div><p>{uploading ? "Enviando arquivo..." : "Use + para anexar, @ para contexto e / para comandos."}</p></form></section>
    <aside className="activity"><nav><b>Atividade</b><span>Arquivos</span><span>Terminal</span></nav><div className="activity-body"><label>● {status.toUpperCase()}</label><h2>Próximos passos</h2><p>◌ Entender a solicitação</p><p>◌ Planejar alterações</p><p>◌ Executar com aprovação</p><h2>Arquivos do chat</h2>{files.length === 0 ? <p className="muted">Nenhum arquivo anexado.</p> : files.map((file) => <div className="backend-card file-card" key={file.id}><b>{file.name}</b><span>{Math.max(1, Math.round(file.size / 1024))} KB</span></div>)}<h2>Backend</h2><div className="backend-card"><b>Responses API</b><span>{threadId ? "Conectado à tarefa" : "Iniciando"}</span></div><h2>Segurança</h2><p className="muted">Comandos continuam bloqueados até o sandbox ser conectado.</p></div></aside>
  </main>;
}
