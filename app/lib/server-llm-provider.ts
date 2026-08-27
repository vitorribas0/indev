import OpenAI from "openai";

export function serverLlmProvider() {
  const inferred = process.env.IARA_CLIENT_ID && process.env.IARA_CLIENT_SECRET ? "iara" : "openai";
  const id = (process.env.INDEV_LLM_PROVIDER || inferred).trim().toLowerCase();
  if (id === "iara") {
    const baseURL = `${(process.env.INDEV_IARA_PROXY_BASE_URL || "http://127.0.0.1:4510").replace(/\/$/, "")}/v1`;
    const apiKey = process.env.INDEV_IARA_PROXY_TOKEN || "";
    return {
      id,
      label: "Iara",
      model: process.env.IARA_MODEL || "gpt-4.1-mini",
      configured: Boolean(apiKey),
      client: new OpenAI({ apiKey: apiKey || "indev-not-configured", baseURL }),
    };
  }
  const apiKey = process.env.OPENAI_API_KEY || "";
  return {
    id: "openai",
    label: "OpenAI",
    model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
    configured: Boolean(apiKey),
    client: new OpenAI({ apiKey: apiKey || "indev-not-configured" }),
  };
}
