import { defineProvider } from "../types.js";

export const anthropicProvider = defineProvider({
  id: "anthropic",
  label: "Anthropic",
  summary: "Route AI coding agents through Anthropic's API.",
  baseUrl: "https://api.anthropic.com",
  auth: {
    kind: "api-key",
    envVar: "ANTHROPIC_API_KEY",
    storageKey: "provider:anthropic",
    prompt: { title: "Anthropic API key" }
  },
  env: {
    ANTHROPIC_API_KEY: { kind: "providerCredential" }
  },
  apiShapes: [
    {
      id: "anthropic-messages"
    }
  ]
});
