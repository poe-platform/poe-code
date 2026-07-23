import { defineProvider } from "../types.js";

export const POE_PROVIDER_ID = "poe" as const;

export const poeProvider = defineProvider({
  id: POE_PROVIDER_ID,
  label: "Poe",
  summary: "Route AI coding agents through Poe's API.",
  baseUrl: "https://api.poe.com",
  agentBaseUrl: "https://api.poe.com",
  baseUrlEnvVar: "POE_BASE_URL",
  baseUrlEnvPath: "v1",
  agentBaseUrlPath: "",
  auth: {
    kind: "api-key",
    envVar: "POE_API_KEY",
    storageKey: "provider:poe",
    prompt: { title: "Poe API key" },
    preferredLogin: "oauth"
  },
  env: {
    ANTHROPIC_API_KEY: { kind: "providerCredential" }
  },
  apiShapes: [
    {
      id: "openai-chat-completions",
      envBaseUrlPath: "v1"
    },
    {
      id: "openai-responses",
      envBaseUrlPath: "v1"
    },
    {
      id: "anthropic-messages",
      envBaseUrlPath: "anthropic"
    }
  ]
});
