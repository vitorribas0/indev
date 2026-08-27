import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import {
  codexAppServerArgs,
  ensureRuntimeFolders,
  getRuntimeConfig,
  iaraServerEntrypoint,
  workspaceRoot,
} from "../scripts/indev-runtime.mjs";

ensureRuntimeFolders();
const runtimeOptions = {
  INDEV_LLM_PROVIDER: "iara",
  INDEV_IARA_MOCK: "1",
  INDEV_IARA_PROXY_TOKEN: "indev-iara-smoke-token",
  INDEV_APP_SERVER_PORT: "4621",
  INDEV_BRIDGE_PORT: "4622",
  INDEV_WEB_PORT: "3021",
  IARA_MODEL: "gpt-4.1-mini",
  IARA_MODELS: "gpt-4.1-mini",
};

const children = [];
let socket;
let responsesServer;
let runtime;
let diagnostics = "";

function start(command, args) {
  const child = spawn(command, args, { cwd: workspaceRoot, env: runtime.env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  child.stdout.on("data", (chunk) => { diagnostics += String(chunk); });
  child.stderr.on("data", (chunk) => { diagnostics += String(chunk); });
  child.on("error", (error) => { diagnostics += `\n${command}: ${error.message}`; });
  return child;
}

function pythonCommand() {
  const candidates = [process.env.INDEV_TEST_PYTHON, "python", "python3"].filter(Boolean);
  for (const command of [...new Set(candidates)]) {
    const probe = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 5_000 });
    if (probe.status === 0) return command;
    diagnostics += `\nFalha ao testar ${command}: ${probe.error?.message || probe.stderr || `código ${probe.status}`}`;
  }
  throw new Error(`Python 3 não foi encontrado.${diagnostics}`);
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

function responsePayload(model) {
  const responseId = `resp_indev_${randomUUID().replaceAll("-", "")}`;
  return {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1_000),
    status: "completed",
    model,
    output: [{
      id: `msg_${randomUUID().replaceAll("-", "")}`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: "Iara conectada ao InDev com sucesso.", annotations: [] }],
    }],
    usage: { input_tokens: 1, output_tokens: 8, total_tokens: 9 },
  };
}

function responseEvents(response) {
  const output = response.output[0];
  const part = output.content[0];
  const base = { ...response, status: "in_progress", output: [] };
  return [
    { type: "response.created", response: base, sequence_number: 0 },
    { type: "response.in_progress", response: base, sequence_number: 1 },
    { type: "response.output_item.added", output_index: 0, item: { ...output, status: "in_progress", content: [] }, sequence_number: 2 },
    { type: "response.content_part.added", item_id: output.id, output_index: 0, content_index: 0, part: { ...part, text: "" }, sequence_number: 3 },
    { type: "response.output_text.delta", item_id: output.id, output_index: 0, content_index: 0, delta: part.text, logprobs: [], sequence_number: 4 },
    { type: "response.output_text.done", item_id: output.id, output_index: 0, content_index: 0, text: part.text, logprobs: [], sequence_number: 5 },
    { type: "response.content_part.done", item_id: output.id, output_index: 0, content_index: 0, part, sequence_number: 6 },
    { type: "response.output_item.done", output_index: 0, item: output, sequence_number: 7 },
    { type: "response.completed", response, sequence_number: 8 },
  ];
}

function startResponsesServer(token) {
  return createServer(async (request, response) => {
    const sendJson = (status, payload) => {
      const body = JSON.stringify(payload);
      response.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
      response.end(body);
    };
    if (request.headers.authorization !== `Bearer ${token}`) {
      sendJson(401, { error: { type: "authentication_error", message: "Token local inválido." } });
      return;
    }
    if (request.method === "GET" && request.url === "/v1/models") {
      sendJson(200, { object: "list", data: [{ id: "gpt-4.1-mini", object: "model", owned_by: "iara" }] });
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/responses") {
      sendJson(404, { error: { type: "not_found", message: "Rota não encontrada." } });
      return;
    }
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const result = responsePayload(payload.model || "gpt-4.1-mini");
      if (!payload.stream) {
        sendJson(200, result);
        return;
      }
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "close" });
      for (const event of responseEvents(result)) response.write(`data: ${JSON.stringify(event)}\n\n`);
      response.end("data: [DONE]\n\n");
    } catch (error) {
      sendJson(400, { error: { type: "invalid_request_error", message: error.message } });
    }
  });
}

try {
  const selfTestRuntime = getRuntimeConfig(runtimeOptions);
  const python = pythonCommand();
  const selfTest = spawnSync(python, [iaraServerEntrypoint, "--self-test"], {
    cwd: workspaceRoot,
    env: selfTestRuntime.env,
    encoding: "utf8",
    timeout: 20_000,
  });
  diagnostics += `${selfTest.stdout || ""}${selfTest.stderr || ""}`;
  assert.equal(selfTest.status, 0, `Autoteste Python falhou com ${selfTest.signal || selfTest.status}.\n${diagnostics}`);

  responsesServer = startResponsesServer(runtimeOptions.INDEV_IARA_PROXY_TOKEN);
  await new Promise((resolveListen, reject) => {
    responsesServer.once("error", reject);
    responsesServer.listen(0, "127.0.0.1", resolveListen);
  });
  const address = responsesServer.address();
  assert(address && typeof address === "object");
  runtime = getRuntimeConfig({ ...runtimeOptions, INDEV_IARA_PROXY_PORT: String(address.port) });

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
  console.log("OK: adaptador Iara + Codex App Server + Responses streaming");
} finally {
  socket?.terminate();
  for (const child of children) child.kill("SIGTERM");
  if (responsesServer) {
    const closed = new Promise((resolveClose) => responsesServer.close(resolveClose));
    responsesServer.closeAllConnections();
    await closed;
  }
}
