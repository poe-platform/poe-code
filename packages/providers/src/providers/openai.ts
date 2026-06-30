import { defineProvider } from "../types.js";

export const openaiProvider = defineProvider({
  id: "openai",
  label: "OpenAI",
  summary: "Route AI coding agents through OpenAI's API.",
  baseUrl: "https://api.openai.com/v1",
  auth: {
    kind: "api-key",
    envVar: "OPENAI_API_KEY",
    storageKey: "provider:openai",
    prompt: { title: "OpenAI API key" }
  },
  apiShapes: [
    {
      id: "openai-responses"
    },
    {
      id: "openai-chat-completions"
    }
  ]
});
