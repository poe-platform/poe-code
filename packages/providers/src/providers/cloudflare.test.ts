import { describe, expect, it } from "vitest";
import { cloudflareProvider } from "./cloudflare.js";

describe("cloudflareProvider", () => {
  it("declares the Poe Cloudflare gateway api shapes", () => {
    expect(cloudflareProvider).toMatchObject({
      id: "cloudflare",
      label: "Cloudflare AI Gateway",
      summary: "Route through the Poe Cloudflare gateway with BYOK keys.",
      baseUrl: "https://poe-ai-gateway.poe-dev.workers.dev",
      auth: {
        kind: "api-key",
        envVar: "CLOUDFLARE_API_KEY",
        storageKey: "provider:cloudflare",
        prompt: { title: "Cloudflare API key" }
      },
      apiShapes: [
        {
          id: "openai-chat-completions",
          defaultBaseUrl: "https://poe-ai-gateway.poe-dev.workers.dev/openai/v1"
        },
        {
          id: "openai-responses",
          defaultBaseUrl: "https://poe-ai-gateway.poe-dev.workers.dev/openai/v1"
        },
        {
          id: "anthropic-messages",
          defaultBaseUrl: "https://poe-ai-gateway.poe-dev.workers.dev/anthropic"
        },
        {
          id: "google-generations",
          defaultBaseUrl: "https://poe-ai-gateway.poe-dev.workers.dev/google-ai-studio"
        }
      ]
    });
  });
});
