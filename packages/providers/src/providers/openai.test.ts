import { describe, expect, it } from "vitest";
import { codexAgent, gooseAgent, openCodeAgent, poeAgentAgent } from "@poe-code/agent-defs";
import { resolveApiShape } from "../compatibility.js";
import { openaiProvider } from "./openai.js";

describe("openaiProvider", () => {
  it("declares the first-party OpenAI API provider defaults", () => {
    expect(openaiProvider).toMatchObject({
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
  });

  it("supports agents that use OpenAI Responses or Chat Completions", () => {
    expect(resolveApiShape(openaiProvider, codexAgent)).toBe("openai-responses");
    expect(resolveApiShape(openaiProvider, poeAgentAgent)).toBe("openai-responses");
    expect(resolveApiShape(openaiProvider, gooseAgent)).toBe("openai-chat-completions");
    expect(resolveApiShape(openaiProvider, openCodeAgent)).toBe("openai-chat-completions");
  });
});
