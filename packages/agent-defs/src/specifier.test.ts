import { describe, expect, it } from "vitest";
import { parseAgentSpecifier, formatAgentSpecifier } from "./specifier.js";

describe("parseAgentSpecifier", () => {
  it("parses agent-only specifier", () => {
    expect(parseAgentSpecifier("claude-code")).toEqual({
      agent: "claude-code",
    });
  });

  it("parses agent with provider/model", () => {
    expect(parseAgentSpecifier("claude-code:anthropic/claude-opus-4.6")).toEqual({
      agent: "claude-code",
      model: "anthropic/claude-opus-4.6",
    });
  });

  it("parses codex with openai model", () => {
    expect(parseAgentSpecifier("codex:openai/gpt-5.4")).toEqual({
      agent: "codex",
      model: "openai/gpt-5.4",
    });
  });

  it("parses kimi with model", () => {
    expect(parseAgentSpecifier("kimi:novitaai/kimi-k2.5")).toEqual({
      agent: "kimi",
      model: "novitaai/kimi-k2.5",
    });
  });

  it("returns undefined model when colon is present but model is empty", () => {
    expect(parseAgentSpecifier("claude-code:")).toEqual({
      agent: "claude-code",
    });
  });

  it("trims whitespace from agent and model", () => {
    expect(parseAgentSpecifier("  claude-code : anthropic/claude-opus-4.6  ")).toEqual({
      agent: "claude-code",
      model: "anthropic/claude-opus-4.6",
    });
  });

  it("handles model without provider prefix", () => {
    expect(parseAgentSpecifier("claude-code:claude-opus-4.6")).toEqual({
      agent: "claude-code",
      model: "claude-opus-4.6",
    });
  });
});

describe("formatAgentSpecifier", () => {
  it("formats agent-only", () => {
    expect(formatAgentSpecifier({ agent: "claude-code" })).toBe("claude-code");
  });

  it("formats agent with model", () => {
    expect(
      formatAgentSpecifier({ agent: "claude-code", model: "anthropic/claude-opus-4.6" })
    ).toBe("claude-code:anthropic/claude-opus-4.6");
  });

  it("formats agent when model is undefined", () => {
    expect(formatAgentSpecifier({ agent: "codex", model: undefined })).toBe("codex");
  });
});
