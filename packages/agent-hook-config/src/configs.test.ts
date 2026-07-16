import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatSupportedTransformPairs,
  getAgentConfig,
  isTransformSupported,
  resolveAgentSupport,
  resolveHookPath,
  supportedHookAgents,
  supportedTransformPairs,
  type AgentHookConfig
} from "./index.js";

describe("getAgentConfig", () => {
  it("exposes the agents with hook registry entries", () => {
    expect(supportedHookAgents).toEqual(["claude-code", "codex"]);
  });

  it("returns config for a known agent", () => {
    expect(getAgentConfig("codex")).toEqual({
      globalHookPath: "~/.codex/hooks.json",
      localHookPath: ".codex/hooks.json",
      format: "codex-hooks-json",
      transformWritable: true,
      supportedEvents: [
        "SessionStart",
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "PermissionRequest",
        "Stop"
      ],
      supportedHandlerTypes: ["command"],
      placeholders: {
        projectDir: "$(git rev-parse --show-toplevel)",
        pluginRoot: "$PLUGIN_ROOT",
        pluginData: "$PLUGIN_DATA"
      }
    });
  });

  it("does not expose mutable registry configuration", () => {
    const exposed = getAgentConfig("codex")!;
    exposed.localHookPath = ".redirected/hooks.json";

    expect(getAgentConfig("codex")?.localHookPath).toBe(".codex/hooks.json");
  });

  it("does not expose a mutable supported-agent list", () => {
    expect(Object.isFrozen(supportedHookAgents)).toBe(true);
  });
});

describe("resolveAgentSupport", () => {
  it("resolves aliases using resolveAgentId", () => {
    const result = resolveAgentSupport("claude");

    expect(result.status).toBe("supported");
    expect(result.id).toBe("claude-code");
    expect(result.config).toEqual(getAgentConfig("claude-code"));
  });

  it("resolves aliases without regard to input case", () => {
    expect(resolveAgentSupport("CLAUDE").id).toBe("claude-code");
  });

  it("returns unsupported for a known agent without hook config", () => {
    expect(resolveAgentSupport("gemini")).toEqual({
      status: "unsupported",
      input: "gemini",
      id: "gemini-cli"
    });
  });

  it("returns unknown for an unknown input", () => {
    expect(resolveAgentSupport("unknown-agent")).toEqual({
      status: "unknown",
      input: "unknown-agent"
    });
  });
});

describe("resolveHookPath", () => {
  it("returns undefined for local scope without a local path", () => {
    const config: AgentHookConfig = {
      globalHookPath: "~/.example/hooks.json",
      format: "codex-hooks-json",
      supportedEvents: [],
      supportedHandlerTypes: [],
      placeholders: { projectDir: "$PROJECT_DIR" }
    };

    expect(resolveHookPath(config, "local", "/repo")).toBeUndefined();
  });

  it("expands global home paths using an injected home directory", () => {
    const config = getAgentConfig("claude-code");

    expect(config).toBeDefined();
    expect(resolveHookPath(config!, "global", "/repo", "/home/tester")).toBe(
      path.resolve("/home/tester/.claude/settings.json")
    );
  });

  it("resolves local paths relative to cwd", () => {
    const config = getAgentConfig("codex");

    expect(config).toBeDefined();
    expect(resolveHookPath(config!, "local", "/repo/worktree")).toBe(
      path.resolve("/repo/worktree/.codex/hooks.json")
    );
  });
});

describe("supportedTransformPairs", () => {
  it("derives the readable-source to writable-target matrix from the registry", () => {
    expect(supportedTransformPairs()).toEqual([{ source: "claude-code", target: "codex" }]);
  });

  it("formats the matrix for help text and user errors", () => {
    expect(formatSupportedTransformPairs()).toBe("claude-code -> codex");
  });

  it("reports whether a source and target pair can be transformed", () => {
    expect(isTransformSupported("claude-code", "codex")).toBe(true);
    expect(isTransformSupported("codex", "claude-code")).toBe(false);
    expect(isTransformSupported("claude-code", "claude-code")).toBe(false);
    expect(isTransformSupported("claude-code", "not-an-agent")).toBe(false);
  });
});
