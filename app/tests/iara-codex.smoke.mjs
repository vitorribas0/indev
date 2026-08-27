import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import {
  codexAppServerArgs,
  ensureRuntimeFolders,
  getRuntimeConfig,
  iaraServerEntrypoint,
  workspaceRoot,
} from "../scripts/indev-runtime.mjs";

ensureRuntimeFolders();
const runtime = getRuntimeConfig({
  INDEV_LLM_PROVIDER: "iara",
  INDEV_IARA_MOCK: "1",
  INDEV_IARA_PROXY_PORT: "4620",
  INDEV_APP_SERVER_PORT: "4621",
  INDEV_BRIDGE_PORT: "4622",
  INDEV_WEB_PORT: "3021",
  IARA_MODEL: "gpt-4.1-mini",
  IARA_MODELS: "gpt-4.1-mini",
});

const children = [];
let socket;
let diagnostics = "";

function start(command, args) {
  const child = spawn(command, args, { cwd: workspaceRoot, env: runtime.env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  child.stdout.on("data", (chunk) => { diagnostics += String(chunk); });
  child.stderr.on("data", (chunk) => { diagnostics += String(chunk); });
  return child;
}

async function waitFor(url, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
    } catch {
      // Processo ainda iniciando.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  assert.fail(`${label} não iniciou em ${timeoutMs / 1_000}s.\n${diagnostics}`);
}

try {
  start(process.platform === "win32" ? "python" : "python3", [iaraServerEntrypoint]);
  await waitFor(runtime.iaraProxyReady, "adaptador Iara");
  start(process.execPath, codexAppServerArgs(runtime));
  await waitFor(runtime.appServerReady, "Codex App Server com Iara");

  socket = new WebSocket(runtime.appServerWs);
  await new Promise((resolveOpen, reject) => {
    const timer = setTimeout(() => reject(new Error(`WebSocket não abriu.\n${diagnostics}`)), 5_000);
    socket.once("open", () => { clearTimeout(timer); resolveOpen(); });
    socket.once("error", reject);
  });

  let nextId = 1;
  const pending = new Map();
  let streamed = "";
  let completeTurn;
  const completedTurn = new Promise((resolveTurn) => { completeTurn = resolveTurn; });
  socket.on("message", (data) => {
    const message = JSON.parse(String(data));
    if (message.id !== undefined && !message.method) {
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.error) call.reject(new Error(message.error.message));
      else call.resolve(message.result);
    }
    if (message.method === "item/agentMessage/delta") streamed += message.params.delta;
    if (message.method === "turn/completed") completeTurn(message.params.turn);
  });
  const request = (method, params = {}) => new Promise((resolveRequest, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`Timeout em ${method}.\n${diagnostics}`)), 20_000);
    pending.set(id, { resolve: resolveRequest, reject, timer });
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });

  await request("initialize", {
    clientInfo: { name: "indev-iara-smoke", title: "InDev Iara Smoke", version: "0.3.1" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  socket.send(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }));
  const started = await request("thread/start", {
    ephemeral: true,
    model: "gpt-4.1-mini",
    approvalPolicy: "never",
    sandbox: "read-only",
    threadSource: "indev-iara-smoke",
  });
  await request("turn/start", {
    threadId: started.thread.id,
    input: [{ type: "text", text: "Responda apenas OK.", text_elements: [] }],
  });
  let responseTimer;
  const turn = await Promise.race([
    completedTurn,
    new Promise((_, reject) => {
      responseTimer = setTimeout(() => reject(new Error(`A Iara simulada não respondeu.\n${diagnostics}`)), 30_000);
    }),
  ]);
  clearTimeout(responseTimer);
  assert.equal(turn.status, "completed", diagnostics);
  assert.match(streamed, /Iara conectada ao InDev com sucesso/, diagnostics);
  console.log("OK: Codex App Server -> Responses local -> SDK Iara (simulado) com streaming");
} finally {
  socket?.close();
  for (const child of children) child.kill("SIGTERM");
}
