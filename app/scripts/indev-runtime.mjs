import { existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const workspaceRoot = resolve(appRoot, "..");
export const runtimeRoot = resolve(workspaceRoot, ".indev");
export const codexHome = resolve(runtimeRoot, "codex-home");
export const codexEntrypoint = resolve(appRoot, "node_modules", "@openai", "codex", "bin", "codex.js");
export const vinextEntrypoint = resolve(appRoot, "node_modules", "vinext", "dist", "cli.js");
export const iaraRoot = resolve(appRoot, "iara");
export const iaraServerEntrypoint = resolve(iaraRoot, "server.py");
export const iaraRequirements = resolve(iaraRoot, "requirements.txt");
export const iaraVenv = resolve(runtimeRoot, "iara-venv");
const generatedIaraProxyToken = randomBytes(32).toString("hex");

function port(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : fallback;
}

function csv(value, fallback = []) {
  const entries = String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  return entries.length ? [...new Set(entries)] : fallback;
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function iaraPythonExecutable(source) {
  if (source.INDEV_IARA_PYTHON) return resolve(String(source.INDEV_IARA_PYTHON));
  return process.platform === "win32"
    ? resolve(iaraVenv, "Scripts", "python.exe")
    : resolve(iaraVenv, "bin", "python");
}

export function loadLocalEnvironment() {
  for (const file of [resolve(appRoot, ".env.local"), resolve(appRoot, ".env")]) {
    if (existsSync(file)) loadEnvFile(file);
  }
}

export function ensureRuntimeFolders() {
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(resolve(runtimeRoot, "uploads"), { recursive: true });
}

export function assertLocalDependencies() {
  if (!existsSync(codexEntrypoint) || !existsSync(vinextEntrypoint)) {
    throw new Error("Dependências locais ausentes. Execute npm install dentro da pasta app.");
  }
}

export function codexAppServerArgs(runtime) {
  const args = [codexEntrypoint, "app-server", "--listen", runtime.appServerWs];
  if (runtime.llmProvider !== "iara") return args;
  const config = {
    model_provider: "iara",
    model: runtime.defaultModel,
    "model_providers.iara.name": "Iara",
    "model_providers.iara.base_url": `${runtime.iaraProxyBaseUrl}/v1`,
    "model_providers.iara.env_key": "INDEV_IARA_PROXY_TOKEN",
    "model_providers.iara.wire_api": "responses",
    "model_providers.iara.requires_openai_auth": false,
    "model_providers.iara.supports_websockets": false,
    "model_providers.iara.request_max_retries": 3,
    "model_providers.iara.stream_max_retries": 3,
    "model_providers.iara.stream_idle_timeout_ms": 300000,
  };
  for (const [key, value] of Object.entries(config)) {
    args.push("-c", `${key}=${typeof value === "string" ? tomlString(value) : String(value)}`);
  }
  return args;
}

export function getRuntimeConfig(overrides = {}) {
  const source = { ...process.env, ...overrides };
  const webPort = port(source.INDEV_WEB_PORT, 3001);
  const appServerPort = port(source.INDEV_APP_SERVER_PORT, 4501);
  const bridgePort = port(source.INDEV_BRIDGE_PORT, 4502);
  const iaraProxyPort = port(source.INDEV_IARA_PROXY_PORT, 4510);
  const inferredProvider = source.IARA_CLIENT_ID && source.IARA_CLIENT_SECRET ? "iara" : "openai";
  const llmProvider = String(source.INDEV_LLM_PROVIDER || inferredProvider).trim().toLowerCase();
  if (!new Set(["openai", "iara"]).has(llmProvider)) {
    throw new Error("INDEV_LLM_PROVIDER deve ser 'openai' ou 'iara'.");
  }
  const iaraEnvironment = String(source.IARA_ENVIRONMENT || "homol").trim().toLowerCase();
  const iaraProvider = String(source.IARA_PROVIDER || "azure_openai").trim().toLowerCase();
  const iaraModel = String(source.IARA_MODEL || "gpt-4.1-mini").trim();
  const iaraModels = csv(source.IARA_MODELS, [iaraModel, "gpt-4.1"]);
  if (!iaraModels.includes(iaraModel)) iaraModels.unshift(iaraModel);
  const openAIModel = String(source.OPENAI_MODEL || "gpt-5.6-luna").trim();
  const defaultModel = llmProvider === "iara" ? iaraModel : openAIModel;
  const iaraProxyToken = String(source.INDEV_IARA_PROXY_TOKEN || generatedIaraProxyToken);
  const iaraProxyBaseUrl = `http://127.0.0.1:${iaraProxyPort}`;
  const selectedCodexHome = source.INDEV_CODEX_HOME
    ? resolve(String(source.INDEV_CODEX_HOME))
    : codexHome;

  return {
    webPort,
    appServerPort,
    bridgePort,
    iaraProxyPort,
    llmProvider,
    providerLabel: llmProvider === "iara" ? "Iara" : "OpenAI",
    defaultModel,
    availableModels: llmProvider === "iara" ? iaraModels : [openAIModel],
    iaraEnvironment,
    iaraProvider,
    iaraPython: iaraPythonExecutable(source),
    iaraProxyBaseUrl,
    iaraProxyReady: `${iaraProxyBaseUrl}/healthz`,
    webOrigin: `http://127.0.0.1:${webPort}`,
    appServerWs: `ws://127.0.0.1:${appServerPort}`,
    appServerReady: `http://127.0.0.1:${appServerPort}/readyz`,
    bridgeWs: `ws://127.0.0.1:${bridgePort}`,
    bridgeReady: `http://127.0.0.1:${bridgePort}/readyz`,
    env: {
      ...source,
      CODEX_HOME: selectedCodexHome,
      INDEV_WEB_PORT: String(webPort),
      INDEV_APP_SERVER_PORT: String(appServerPort),
      INDEV_BRIDGE_PORT: String(bridgePort),
      INDEV_LLM_PROVIDER: llmProvider,
      INDEV_IARA_PROXY_PORT: String(iaraProxyPort),
      INDEV_IARA_PROXY_TOKEN: iaraProxyToken,
      INDEV_IARA_PROXY_BASE_URL: iaraProxyBaseUrl,
      IARA_ENVIRONMENT: iaraEnvironment,
      IARA_PROVIDER: iaraProvider,
      IARA_MODEL: iaraModel,
      IARA_MODELS: iaraModels.join(","),
      WRANGLER_LOG_PATH: resolve(appRoot, ".wrangler", "wrangler.log"),
    },
  };
}
