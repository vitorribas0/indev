import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  appRoot,
  assertLocalDependencies,
  codexEntrypoint,
  codexHome,
  ensureRuntimeFolders,
  getRuntimeConfig,
  iaraRequirements,
  iaraVenv,
  loadLocalEnvironment,
  workspaceRoot,
} from "./indev-runtime.mjs";

const nonInteractive = process.argv.includes("--non-interactive") || process.argv.includes("--check");
const checkOnly = process.argv.includes("--check");
const forceIara = process.argv.includes("--iara");

function runCodex(args, { capture = false, input } = {}) {
  const { env } = getRuntimeConfig();
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [codexEntrypoint, ...args], {
      cwd: workspaceRoot,
      env,
      stdio: capture ? ["pipe", "pipe", "pipe"] : [input ? "pipe" : "inherit", "inherit", "inherit"],
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    }
    child.on("error", reject);
    child.on("exit", (code) => resolveRun({ code: code ?? 1, stdout, stderr }));
    if (input) child.stdin.end(`${input}\n`);
  });
}

function run(command, args, { capture = false } = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd: appRoot,
      env: process.env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    }
    child.on("error", (error) => resolveRun({ code: 1, stdout, stderr: error.message }));
    child.on("exit", (code) => resolveRun({ code: code ?? 1, stdout, stderr }));
  });
}

async function findPython() {
  const candidates = process.platform === "win32"
    ? [["py", ["-3"]], ["python", []]]
    : [["python3", []], ["python", []]];
  for (const [command, prefix] of candidates) {
    const result = await run(command, [...prefix, "-c", "import sys; print('.'.join(map(str, sys.version_info[:3])))"], { capture: true });
    const [major = 0, minor = 0] = result.stdout.trim().split(".").map(Number);
    if (result.code === 0 && (major > 3 || (major === 3 && minor >= 9))) return { command, prefix };
  }
  return null;
}

async function prepareIara(runtime) {
  const mock = String(process.env.INDEV_IARA_MOCK || "").match(/^(1|true|yes)$/i);
  if (!mock && (!process.env.IARA_CLIENT_ID?.trim() || !process.env.IARA_CLIENT_SECRET?.trim())) {
    console.error("[indev] Preencha IARA_CLIENT_ID e IARA_CLIENT_SECRET em app/.env.local.");
    return false;
  }
  if (mock) {
    console.log("[indev] Adaptador Iara em modo simulado para testes locais.");
    return true;
  }

  if (!existsSync(runtime.iaraPython)) {
    if (checkOnly) {
      console.error("[indev] Ambiente Python da Iara ausente. Execute npm run setup:iara.");
      return false;
    }
    if (process.env.INDEV_IARA_PYTHON) {
      console.error(`[indev] O Python configurado não existe: ${runtime.iaraPython}`);
      return false;
    }
    const python = await findPython();
    if (!python) {
      console.error("[indev] Python 3.9 ou superior é necessário para o SDK da Iara.");
      return false;
    }
    console.log("[indev] Criando o ambiente Python privado da Iara em .indev…");
    const created = await run(python.command, [...python.prefix, "-m", "venv", iaraVenv]);
    if (created.code !== 0) return false;
  }

  let sdk = await run(runtime.iaraPython, ["-c", "from iaragenai import IaraGenAI"], { capture: true });
  if (sdk.code !== 0 && !checkOnly) {
    console.log("[indev] Instalando o SDK oficial da Iara no ambiente privado…");
    const installed = await run(runtime.iaraPython, ["-m", "pip", "install", "--disable-pip-version-check", "--requirement", iaraRequirements]);
    if (installed.code !== 0) return false;
    sdk = await run(runtime.iaraPython, ["-c", "from iaragenai import IaraGenAI"], { capture: true });
  }
  if (sdk.code !== 0) {
    console.error("[indev] SDK da Iara indisponível. Execute npm run setup:iara na rede corporativa.");
    return false;
  }
  console.log(`[indev] Iara pronta · ${runtime.iaraEnvironment} · ${runtime.iaraProvider} · ${runtime.defaultModel}.`);
  return true;
}

const nodeVersion = process.versions.node.split(".").map(Number);
if (nodeVersion[0] < 22 || (nodeVersion[0] === 22 && nodeVersion[1] < 13)) {
  console.error(`[indev] Node.js 22.13 ou superior é necessário. Versão atual: ${process.versions.node}`);
  process.exit(1);
}

loadLocalEnvironment();
if (forceIara) process.env.INDEV_LLM_PROVIDER = "iara";
if (process.env.IARA_CA_BUNDLE) {
  process.env.REQUESTS_CA_BUNDLE ||= process.env.IARA_CA_BUNDLE;
  process.env.SSL_CERT_FILE ||= process.env.IARA_CA_BUNDLE;
  process.env.PIP_CERT ||= process.env.IARA_CA_BUNDLE;
}
ensureRuntimeFolders();
assertLocalDependencies();
const runtime = getRuntimeConfig();

const version = await runCodex(["--version"], { capture: true });
if (version.code !== 0) {
  console.error("[indev] O Codex incluído no projeto não iniciou.");
  process.exit(version.code);
}
console.log(`[indev] ${version.stdout.trim()} carregado do próprio projeto.`);
console.log(`[indev] Dados privados locais: ${codexHome}`);

if (runtime.llmProvider === "iara") {
  process.exit(await prepareIara(runtime) ? 0 : 1);
}

let status = await runCodex(["login", "status"], { capture: true });
if (status.code === 0) {
  console.log("[indev] Autenticação pronta.");
  process.exit(0);
}

if (!checkOnly && process.env.OPENAI_API_KEY) {
  console.log("[indev] Configurando a chave de .env.local no armazenamento privado do projeto…");
  const login = await runCodex(["login", "--with-api-key"], { input: process.env.OPENAI_API_KEY });
  if (login.code !== 0) process.exit(login.code);
  status = await runCodex(["login", "status"], { capture: true });
  if (status.code === 0) {
    console.log("[indev] Autenticação por API pronta.");
    process.exit(0);
  }
}

if (!nonInteractive && process.stdin.isTTY) {
  console.log("[indev] Abrindo o login seguro da OpenAI para esta cópia do InDev…");
  const login = await runCodex(["login"]);
  if (login.code === 0) process.exit(0);
}

console.error(`[indev] Falta autenticar. Execute "npm run setup" em ${appRoot} ou crie app/.env.local a partir de .env.example.`);
process.exit(1);
