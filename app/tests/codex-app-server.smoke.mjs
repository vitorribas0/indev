import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";

const url = "ws://127.0.0.1:4502";
let server;
let bridge;

async function ready() {
  try { return (await fetch("http://127.0.0.1:4501/readyz", { signal: AbortSignal.timeout(700) })).ok; }
  catch { return false; }
}

async function bridgeReady() {
  try { return (await fetch("http://127.0.0.1:4502/readyz", { signal: AbortSignal.timeout(700) })).ok; }
  catch { return false; }
}

if (!await ready()) {
  server = spawn("codex", ["app-server", "--listen", url], { cwd: new URL("../../", import.meta.url), stdio: "ignore" });
  for (let attempt = 0; attempt < 30 && !await ready(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 200));
}
assert.equal(await ready(), true, "Codex App Server não iniciou");
if (!await bridgeReady()) {
  bridge = spawn("node", ["scripts/codex-bridge.mjs"], { cwd: new URL("../", import.meta.url), stdio: "ignore" });
  for (let attempt = 0; attempt < 30 && !await bridgeReady(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 200));
}
assert.equal(await bridgeReady(), true, "ponte segura do navegador não iniciou");

const socket = new WebSocket(url, { origin: "http://localhost:3001" });
let nextId = 1;
const pending = new Map();
let streamed = "";
let finishTurn;
const turnFinished = new Promise((resolve) => { finishTurn = resolve; });

const request = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout: ${method}`)); }, 30_000);
  pending.set(id, { resolve, reject, timer });
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id !== undefined && !message.method) {
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id); clearTimeout(call.timer);
    if (message.error) call.reject(new Error(message.error.message)); else call.resolve(message.result);
    return;
  }
  if (message.method === "item/agentMessage/delta") streamed += message.params.delta;
  if (message.method === "turn/completed") finishTurn(message.params.turn);
  if (message.id !== undefined && message.method?.includes("requestApproval")) socket.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { decision: "decline" } }));
});

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timeout: websocket")), 4_000);
  socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
});

await request("initialize", { clientInfo: { name: "indev-e2e", title: "InDev E2E", version: "0.2.0" }, capabilities: { experimentalApi: true, requestAttestation: false } });
socket.send(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }));
const [account, models, skills] = await Promise.all([
  request("account/read"),
  request("model/list", { limit: 3 }),
  request("skills/list"),
]);
assert.ok(account.account, "conta Codex ausente");
assert.ok(models.data.length > 0, "nenhum modelo disponível");
assert.ok(skills.data.length > 0, "skills não carregadas");

const started = await request("thread/start", { ephemeral: true, model: "gpt-5.6-terra", approvalPolicy: "never", sandbox: "read-only", threadSource: "indev-e2e" });
const uploadedPath = `${started.cwd}/.indev/uploads/e2e-upload.txt`;
await request("fs/createDirectory", { path: `${started.cwd}/.indev/uploads`, recursive: true });
await request("fs/writeFile", { path: uploadedPath, dataBase64: Buffer.from("UPLOAD_INDEV_OK\n").toString("base64") });
const stored = await request("fs/readFile", { path: uploadedPath });
assert.equal(Buffer.from(stored.dataBase64, "base64").toString(), "UPLOAD_INDEV_OK\n");
await request("turn/start", { threadId: started.thread.id, input: [{ type: "text", text: `Leia exatamente o caminho absoluto ${uploadedPath}. Responda apenas o código contido nesse arquivo, sem nenhuma outra palavra.`, text_elements: [] }, { type: "mention", name: "e2e-upload.txt", path: uploadedPath }] });
const completed = await Promise.race([turnFinished, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout: resposta LLM")), 60_000))]);
assert.equal(completed.status, "completed");
assert.match(streamed, /UPLOAD_INDEV_OK/);
await request("fs/remove", { path: uploadedPath, force: true });
console.log(`OK: ${models.data[0].displayName}; ${skills.data[0].skills.length} skills; upload e streaming LLM confirmados`);

socket.close();
server?.kill("SIGTERM");
bridge?.kill("SIGTERM");
setTimeout(() => process.exit(0), 50);
