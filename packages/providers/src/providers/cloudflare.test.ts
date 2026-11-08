import { describe, expect, it } from "vitest";
import { cloudflareProvider } from "./cloudflare.js";

describe("cloudflareProvider", () => {
  it("declares the standard Cloudflare gateway api shapes", () => {
    expect(cloudflareProvider).toMatchObject({
      id: "cloudflare",
      label: "Cloudflare AI Gateway",
      summary: "Route coding agents through Cloudflare AI Gateway.",
      baseUrlEnvVar: "CF_AIG_BASE_URL",
      modelInput: { kind: "freeform" },
      auth: {
        kind: "api-key",
        envVar: "CF_AIG_TOKEN",
        storageKey: "provider:cloudflare",
        prompt: { title: "Cloudflare AI Gateway token" }
      },
      requiresBaseUrl: true,
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
    });
    expect(cloudflareProvider).not.toHaveProperty("baseUrl");
  });
});
