import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("o visual usa o Codex App Server e mantém a Responses API como reserva", async () => {
  const [page, client] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("lib/codex-app-client.ts", root), "utf8"),
  ]);

  assert.match(client, /ws:\/\/127\.0\.0\.1:4502/);
  assert.match(client, /"initialize"/);
  assert.match(page, /"thread\/start"/);
  assert.match(page, /"turn\/start"/);
  assert.match(page, /item\/agentMessage\/delta/);
  assert.match(page, /requestApproval/);
  assert.match(page, /startResponsesFallback/);
});

test("arquivos, skills, sandbox, terminal e comandos estão ligados ao protocolo", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  for (const capability of [
    "fs/writeFile",
    "fs/readDirectory",
    "skills/list",
    "thread/compact/start",
    "turn/interrupt",
    "item/commandExecution/outputDelta",
    "workspace-write",
    "read-only",
  ]) assert.match(page, new RegExp(capability.replace("/", "\\/")));
});

test("o comando padrão inicia o site e o App Server incluído no projeto", async () => {
  const [packageJson, launcher, runtime] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("scripts/indev-dev.mjs", root), "utf8"),
    readFile(new URL("scripts/indev-runtime.mjs", root), "utf8"),
  ]);

  assert.match(packageJson, /"dev": "node scripts\/indev-dev\.mjs"/);
  assert.match(packageJson, /"@openai\/codex": "0\.150\.0"/);
  assert.match(launcher, /codexEntrypoint/);
  assert.match(launcher, /app-server/);
  assert.match(launcher, /codex-bridge/);
  assert.match(launcher, /vinextEntrypoint/);
  assert.match(runtime, /node_modules.*@openai.*codex/s);
  assert.match(runtime, /CODEX_HOME/);
  assert.doesNotMatch(launcher, /spawn\("codex"/);
});
