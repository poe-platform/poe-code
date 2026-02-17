import { describe, it, expect } from "vitest";
import { claudeCodeSpawnConfig } from "./configs/claude-code.js";
import { codexSpawnConfig } from "./configs/codex.js";
import { openCodeSpawnConfig } from "./configs/opencode.js";
import { kimiSpawnConfig } from "./configs/kimi.js";
import { buildSpawnArgs } from "./spawn.js";

describe("buildSpawnArgs", () => {
  it("throws error if agent ID cannot be resolved", () => {
    expect(() => buildSpawnArgs("unknown", { prompt: "test" })).toThrow(/Unknown agent/);
  });

  it("throws error if agent has no spawn config", () => {
    expect(() => buildSpawnArgs("claude-desktop", { prompt: "test" })).toThrow(
      /has no spawn config/
    );
  });

  it("builds args with promptFlag + prompt + defaultArgs + modes.yolo by default", () => {
    const result = buildSpawnArgs("claude-code", { prompt: "test" });

    expect(result.binaryName).toBe("claude");
    expect(result.args).toEqual([
      claudeCodeSpawnConfig.promptFlag,
      "test",
      ...claudeCodeSpawnConfig.defaultArgs,
      ...claudeCodeSpawnConfig.modes.yolo
    ]);
  });

  it("includes model flag when model is provided", () => {
    const result = buildSpawnArgs("codex", { prompt: "hello", model: "o3" });

    expect(result.binaryName).toBe("codex");
    expect(result.args).toEqual([
      codexSpawnConfig.promptFlag,
      "hello",
      codexSpawnConfig.modelFlag,
      "o3",
      ...codexSpawnConfig.defaultArgs,
      ...codexSpawnConfig.modes.yolo
    ]);
  });

  it("strips provider namespace and converts dots to hyphens for claude-code model", () => {
    const result = buildSpawnArgs("claude-code", {
      prompt: "test",
      model: "anthropic/claude-opus-4.6"
    });

    expect(result.args).toContain("claude-opus-4-6");
    expect(result.args).not.toContain("anthropic/claude-opus-4.6");
    expect(result.args).not.toContain("claude-opus-4.6");
  });

  it("converts dots to hyphens for all claude-code models", () => {
    const result = buildSpawnArgs("claude-code", {
      prompt: "test",
      model: "anthropic/claude-4.6"
    });

    expect(result.args).toContain("claude-4-6");
    expect(result.args).not.toContain("claude-4.6");
  });

  it("appends mode-specific args for edit mode", () => {
    const result = buildSpawnArgs("claude-code", { prompt: "test", mode: "edit" });

    expect(result.args).toEqual([
      claudeCodeSpawnConfig.promptFlag,
      "test",
      ...claudeCodeSpawnConfig.defaultArgs,
      ...claudeCodeSpawnConfig.modes.edit
    ]);
  });

  it("appends mode-specific args for read mode", () => {
    const result = buildSpawnArgs("claude-code", { prompt: "test", mode: "read" });

    expect(result.args).toEqual([
      claudeCodeSpawnConfig.promptFlag,
      "test",
      ...claudeCodeSpawnConfig.defaultArgs,
      ...claudeCodeSpawnConfig.modes.read
    ]);
  });

  it("appends extra args after mode args", () => {
    const result = buildSpawnArgs("claude-code", {
      prompt: "test",
      args: ["--extra", "arg"]
    });

    expect(result.args).toEqual([
      claudeCodeSpawnConfig.promptFlag,
      "test",
      ...claudeCodeSpawnConfig.defaultArgs,
      ...claudeCodeSpawnConfig.modes.yolo,
      "--extra",
      "arg"
    ]);
  });

  it("builds correct args for opencode", () => {
    const result = buildSpawnArgs("opencode", { prompt: "hello" });

    expect(result.binaryName).toBe("opencode");
    expect(result.args).toEqual([
      openCodeSpawnConfig.promptFlag,
      "hello",
      ...openCodeSpawnConfig.defaultArgs,
      ...openCodeSpawnConfig.modes.yolo
    ]);
  });

  it("applies modelTransform for opencode claude-opus-4.6 → poe/anthropic/claude-opus-4.6", () => {
    const result = buildSpawnArgs("opencode", {
      prompt: "hello",
      model: "anthropic/claude-opus-4.6"
    });

    expect(result.args).toContain("poe/anthropic/claude-opus-4.6");
  });

  it("preserves provider namespace for opencode models", () => {
    const result = buildSpawnArgs("opencode", {
      prompt: "hello",
      model: "anthropic/claude-4.6"
    });

    expect(result.args).toContain("poe/anthropic/claude-4.6");
  });

  it("preserves openai namespace for opencode models", () => {
    const result = buildSpawnArgs("opencode", {
      prompt: "hello",
      model: "openai/gpt-5.2"
    });

    expect(result.args).toContain("poe/openai/gpt-5.2");
  });

  it("adds poe/ prefix to bare opencode models", () => {
    const result = buildSpawnArgs("opencode", {
      prompt: "hello",
      model: "gpt-5.2"
    });

    expect(result.args).toContain("poe/gpt-5.2");
  });

  it("does not double poe/ prefix for opencode models", () => {
    const result = buildSpawnArgs("opencode", {
      prompt: "hello",
      model: "poe/gpt-5.2"
    });

    expect(result.args).toContain("poe/gpt-5.2");
    expect(result.args).not.toContain("poe/poe/gpt-5.2");
  });

  it("builds correct args for kimi", () => {
    const result = buildSpawnArgs("kimi", { prompt: "hello" });

    expect(result.binaryName).toBe("kimi");
    expect(result.args).toEqual([
      kimiSpawnConfig.promptFlag,
      "hello",
      ...kimiSpawnConfig.defaultArgs,
      ...kimiSpawnConfig.modes.yolo
    ]);
  });

  it("builds stdin args for claude-code when useStdin is true", () => {
    const result = buildSpawnArgs("claude-code", { prompt: "test", useStdin: true });

    expect(result.args).toEqual([
      claudeCodeSpawnConfig.promptFlag,
      ...claudeCodeSpawnConfig.stdinMode!.extraArgs,
      ...claudeCodeSpawnConfig.defaultArgs,
      ...claudeCodeSpawnConfig.modes.yolo
    ]);
    expect(result.args).not.toContain("test");
  });

  it("builds stdin args with model for claude-code", () => {
    const result = buildSpawnArgs("claude-code", {
      prompt: "test",
      useStdin: true,
      model: "anthropic/claude-opus-4.6"
    });

    expect(result.args).toContain("--model");
    expect(result.args).toContain("claude-opus-4-6");
    expect(result.args).not.toContain("test");
  });

  it("builds stdin args for codex when useStdin is true", () => {
    const result = buildSpawnArgs("codex", { prompt: "test", useStdin: true });

    expect(result.args).toEqual([
      codexSpawnConfig.promptFlag,
      ...codexSpawnConfig.stdinMode!.extraArgs,
      ...codexSpawnConfig.defaultArgs,
      ...codexSpawnConfig.modes.yolo
    ]);
    expect(result.args).not.toContain("test");
  });

  it("ignores useStdin for agents without stdinMode", () => {
    const result = buildSpawnArgs("opencode", { prompt: "hello", useStdin: true });

    expect(result.args).toEqual([
      openCodeSpawnConfig.promptFlag,
      "hello",
      ...openCodeSpawnConfig.defaultArgs,
      ...openCodeSpawnConfig.modes.yolo
    ]);
  });

});
