import type { AuthProvider } from "../types.js";

export const anthropicProvider: AuthProvider = {
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
  apiShapes: [
    {
      id: "anthropic-messages",
      defaultBaseUrl: "https://api.anthropic.com"
    }
  ]
};
