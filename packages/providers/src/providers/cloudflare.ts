import type { AuthProvider } from "../types.js";

export const cloudflareProvider: AuthProvider = {
  id: "cloudflare",
  label: "Cloudflare AI Gateway",
  summary: "Route coding agents through Cloudflare AI Gateway.",
  baseUrlEnvVar: "CF_AIG_BASE_URL",
  requiresBaseUrl: true,
  auth: {
    kind: "api-key",
    envVar: "CF_AIG_TOKEN",
    storageKey: "provider:cloudflare",
    prompt: { title: "Cloudflare AI Gateway token" }
  },
  apiShapes: [
    {
      id: "openai-chat-completions",
      baseUrlPath: "compat"
    },
    {
      id: "openai-responses",
      baseUrlPath: "openai"
    },
    {
      id: "anthropic-messages",
      baseUrlPath: "anthropic"
    },
    {
      id: "google-generations",
      baseUrlPath: "google-ai-studio"
    }
  ]
};
