import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(appRoot, "..");
const children = [];

async function appServerIsReady() {
  try {
    const response = await fetch("http://127.0.0.1:4501/readyz", { signal: AbortSignal.timeout(700) });
    return response.ok;
  } catch {
    return false;
  }
}

async function bridgeIsReady() {
  try {
    const response = await fetch("http://127.0.0.1:4502/readyz", { signal: AbortSignal.timeout(700) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntil(check, label) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await check()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`${label} não iniciou.`);
}

function start(command, args, cwd, label) {
  const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env });
  children.push(child);
  child.on("error", (error) => console.error(`[${label}] ${error.message}`));
  return child;
}

if (!await appServerIsReady()) {
  start("codex", ["app-server", "--listen", "ws://127.0.0.1:4501"], workspaceRoot, "codex");
} else {
  console.log("[indev] Codex App Server já está ativo em ws://127.0.0.1:4501");
}
await waitUntil(appServerIsReady, "Codex App Server");

if (!await bridgeIsReady()) start("node", ["scripts/codex-bridge.mjs"], appRoot, "bridge");
else console.log("[indev] Ponte do navegador já está ativa em ws://127.0.0.1:4502");
await waitUntil(bridgeIsReady, "Ponte do navegador");

const web = start("npm", ["run", "dev:web"], appRoot, "web");

function shutdown(signal) {
  for (const child of children) if (!child.killed) child.kill(signal);
}

process.on("SIGINT", () => { shutdown("SIGINT"); process.exit(130); });
process.on("SIGTERM", () => { shutdown("SIGTERM"); process.exit(143); });
web.on("exit", (code) => { shutdown("SIGTERM"); process.exit(code ?? 0); });
