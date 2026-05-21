import { allAgents } from "@poe-code/agent-defs";
import type { AuthProvider } from "../types.js";

export const POE_PROVIDER_ID = "poe" as const;

export const poeProvider: AuthProvider = {
  id: POE_PROVIDER_ID,
  label: "Poe",
  summary: "Route AI coding agents through Poe's API.",
  baseUrl: "https://api.poe.com",
  auth: {
    kind: "api-key",
    envVar: "POE_API_KEY",
    storageKey: "provider:poe",
    prompt: { title: "Poe API key" },
    preferredLogin: "oauth"
  },
  apiShapes: [
    {
      id: "openai-chat-completions",
      defaultBaseUrl: "https://api.poe.com/v1"
    },
    {
      id: "openai-responses",
      defaultBaseUrl: "https://api.poe.com/v1"
    },
    {
      id: "anthropic-messages",
      defaultBaseUrl: "https://api.poe.com/anthropic"
    }
  ],
  supportsAgents: allAgents.map((a) => a.id)
};
