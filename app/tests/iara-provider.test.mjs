import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codexAppServerArgs, getRuntimeConfig, iaraRequirements, iaraServerEntrypoint } from "../scripts/indev-runtime.mjs";
import { resolveLlmProvider } from "../lib/llm-provider.mjs";

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

test("o adaptador Iara é restrito a localhost, autenticado e compatível com Responses", async () => {
  const [source, requirements] = await Promise.all([
    readFile(iaraServerEntrypoint, "utf8"),
    readFile(iaraRequirements, "utf8"),
  ]);
  assert.match(source, /HOST = "127\.0\.0\.1"/);
  assert.match(source, /hmac\.compare_digest/);
  assert.match(source, /IARA_ACCESS_TOKEN/);
  assert.match(source, /client_options\["access_token"\]/);
  assert.match(source, /"\/v1\/responses"/);
  assert.match(source, /"text\/event-stream"/);
  assert.match(source, /client\.responses\.stream/);
  assert.match(requirements, /--trusted-host artifactory\.prod\.aws\.cloud\.ihf/);
  assert.match(requirements, /python-remotes\/simple/);
  assert.match(requirements, /itau-kk7-python-release\/simple/);
  assert.doesNotMatch(requirements, /snapshot/i);
});
