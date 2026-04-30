import { describe, expect, it } from "vitest";
import { CODEX_MODELS } from "./constants.js";

describe("CODEX_MODELS", () => {
  it("matches the supported Codex model list", () => {
    expect(CODEX_MODELS).toEqual([
      "openai/gpt-5.5",
      "openai/gpt-5.4",
      "openai/gpt-5.3-codex",
      "openai/gpt-5.2-codex",
      "openai/gpt-5.2",
      "openai/gpt-5.2-chat",
      "openai/gpt-5.2-pro",
      "openai/gpt-5.1",
      "openai/gpt-5.1-codex-mini",
      "anthropic/claude-opus-4.7"
    ]);
  });
});
