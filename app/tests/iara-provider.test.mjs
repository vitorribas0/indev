import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";

import { codexAppServerArgs, getRuntimeConfig, iaraServerEntrypoint } from "../scripts/indev-runtime.mjs";
import { resolveLlmProvider } from "../lib/llm-provider.mjs";

async function unusedPort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // A porta ainda pode estar abrindo; a próxima tentativa confirma.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Servidor não iniciou: ${url}`);
}

test("a configuração Iara gera um provider Responses local para o Codex", () => {
  const runtime = getRuntimeConfig({
    INDEV_LLM_PROVIDER: "iara",
    IARA_MODEL: "gpt-4.1-mini",
    IARA_MODELS: "gpt-4.1-mini,gpt-4.1",
    INDEV_IARA_PROXY_PORT: "4599",
    INDEV_IARA_PROXY_TOKEN: "token-de-teste",
  });
  assert.equal(runtime.llmProvider, "iara");
  assert.equal(runtime.defaultModel, "gpt-4.1-mini");
  assert.deepEqual(runtime.availableModels, ["gpt-4.1-mini", "gpt-4.1"]);
  const args = codexAppServerArgs(runtime).join(" ");
  assert.match(args, /model_provider="iara"/);
  assert.match(args, /wire_api="responses"/);
  assert.match(args, /requires_openai_auth=false/);
  assert.match(args, /127\.0\.0\.1:4599\/v1/);
});

test("tools diretas usam o mesmo provedor e modelo econômico", () => {
  const provider = resolveLlmProvider({
    INDEV_LLM_PROVIDER: "iara",
    INDEV_IARA_PROXY_BASE_URL: "http://127.0.0.1:4999",
    INDEV_IARA_PROXY_TOKEN: "local",
    IARA_MODEL: "gpt-4.1",
    IARA_MASSIVA_MODEL: "gpt-4.1-mini",
  });
  assert.deepEqual(provider, {
    id: "iara",
    label: "Iara",
    apiKey: "local",
    baseURL: "http://127.0.0.1:4999/v1",
    model: "gpt-4.1",
    massivaModel: "gpt-4.1-mini",
  });
});

test("o adaptador Iara protege localhost e entrega Responses com streaming", async (context) => {
  const port = await unusedPort();
  const token = "token-local-de-teste";
  const child = spawn("python3", [iaraServerEntrypoint], {
    env: {
      ...process.env,
      INDEV_IARA_PROXY_PORT: String(port),
      INDEV_IARA_PROXY_TOKEN: token,
      INDEV_IARA_MOCK: "1",
      IARA_MODEL: "gpt-4.1-mini",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += String(chunk); });
  context.after(() => child.kill("SIGTERM"));

  await waitFor(`http://127.0.0.1:${port}/healthz`);
  const unauthorized = await fetch(`http://127.0.0.1:${port}/v1/models`);
  assert.equal(unauthorized.status, 401);

  const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4.1-mini", input: "teste" }),
  });
  assert.equal(response.status, 200, errors);
  const body = await response.json();
  assert.equal(body.object, "response");
  assert.equal(body.status, "completed");
  assert.match(body.output[0].content[0].text, /Iara conectada/);

  const stream = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4.1-mini", input: "teste", stream: true }),
  });
  const events = await stream.text();
  assert.match(events, /response\.output_text\.delta/);
  assert.match(events, /response\.completed/);
  assert.match(events, /\[DONE\]/);
});
