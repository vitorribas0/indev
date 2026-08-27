export function resolveLlmProvider(env = process.env) {
  const inferred = env.IARA_CLIENT_ID && env.IARA_CLIENT_SECRET ? "iara" : "openai";
  const id = String(env.INDEV_LLM_PROVIDER || inferred).trim().toLowerCase();
  if (id === "iara") {
    const baseURL = `${String(env.INDEV_IARA_PROXY_BASE_URL || "http://127.0.0.1:4510").replace(/\/$/, "")}/v1`;
    return {
      id,
      label: "Iara",
      apiKey: env.INDEV_IARA_PROXY_TOKEN || "",
      baseURL,
      model: env.IARA_MODEL || "gpt-4.1-mini",
      massivaModel: env.IARA_MASSIVA_MODEL || env.IARA_MODEL || "gpt-4.1-mini",
    };
  }
  if (id !== "openai") throw new Error("INDEV_LLM_PROVIDER deve ser 'openai' ou 'iara'.");
  return {
    id,
    label: "OpenAI",
    apiKey: env.OPENAI_API_KEY || "",
    baseURL: undefined,
    model: env.OPENAI_MODEL || "gpt-5.6-luna",
    massivaModel: env.OPENAI_MASSIVA_MODEL || env.OPENAI_MODEL || "gpt-5.6-luna",
  };
}
