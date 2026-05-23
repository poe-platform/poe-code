import { describe, expect, it } from "vitest";
import { getEventMappings, getHandlerTypeRules, getPlaceholderRewrites } from "./index.js";

describe("getEventMappings", () => {
  it("maps claude-code events to codex-supported hooks", () => {
    expect(getEventMappings("claude-code", "codex")).toEqual([
      { sourceEvent: "SessionStart", targetEvent: "SessionStart" },
      {
        sourceEvent: "SessionEnd",
        targetEvent: null,
        dropReason: "codex has no SessionEnd hook"
      },
      { sourceEvent: "UserPromptSubmit", targetEvent: "UserPromptSubmit" },
      { sourceEvent: "PreToolUse", targetEvent: "PreToolUse" },
      { sourceEvent: "PostToolUse", targetEvent: "PostToolUse" },
      { sourceEvent: "PermissionRequest", targetEvent: "PermissionRequest" },
      { sourceEvent: "Stop", targetEvent: "Stop" },
      {
        sourceEvent: "StopFailure",
        targetEvent: null,
        dropReason: "codex has no StopFailure hook"
      },
      {
        sourceEvent: "Notification",
        targetEvent: null,
        dropReason: "codex has no Notification hook"
      },
      {
        sourceEvent: "PreCompact",
        targetEvent: null,
        dropReason: "codex has no PreCompact hook"
      },
      {
        sourceEvent: "PostCompact",
        targetEvent: null,
        dropReason: "codex has no PostCompact hook"
      },
      {
        sourceEvent: "SubagentStart",
        targetEvent: null,
        dropReason: "codex has no SubagentStart hook"
      },
      {
        sourceEvent: "SubagentStop",
        targetEvent: null,
        dropReason: "codex has no SubagentStop hook"
      }
    ]);
  });

  it("throws when the source agent is unknown", () => {
    expect(() => getEventMappings("unknown-agent", "codex")).toThrow(
      'Unknown hook agent "unknown-agent"'
    );
  });

  it("throws when the target agent is unknown", () => {
    expect(() => getEventMappings("claude-code", "unknown-agent")).toThrow(
      'Unknown hook agent "unknown-agent"'
    );
  });

  it("maps every identity event without drops", () => {
    expect(getEventMappings("claude-code", "claude-code")).toEqual(
      [
        "SessionStart",
        "SessionEnd",
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "PermissionRequest",
        "Stop",
        "StopFailure",
        "Notification",
        "PreCompact",
        "PostCompact",
        "SubagentStart",
        "SubagentStop"
      ].map((sourceEvent) => ({ sourceEvent, targetEvent: sourceEvent }))
    );
  });

  it("maps every codex event when targeting the broader claude-code registry", () => {
    expect(getEventMappings("codex", "claude-code")).toEqual(
      [
        "SessionStart",
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "PermissionRequest",
        "Stop"
      ].map((sourceEvent) => ({ sourceEvent, targetEvent: sourceEvent }))
    );
  });
});

describe("getHandlerTypeRules", () => {
  it("only allows command handlers for codex", () => {
    expect(getHandlerTypeRules("codex")).toEqual([
      { sourceType: "command", allowed: true },
      {
        sourceType: "http",
        allowed: false,
        dropReason: 'codex only honors handlers of type "command"'
      },
      {
        sourceType: "mcp_tool",
        allowed: false,
        dropReason: 'codex only honors handlers of type "command"'
      },
      {
        sourceType: "prompt",
        allowed: false,
        dropReason: 'codex only honors handlers of type "command"'
      },
      {
        sourceType: "agent",
        allowed: false,
        dropReason: 'codex only honors handlers of type "command"'
      }
    ]);
  });

  it("allows all registered handler types for claude-code", () => {
    expect(getHandlerTypeRules("claude-code")).toEqual([
      { sourceType: "command", allowed: true },
      { sourceType: "http", allowed: true },
      { sourceType: "mcp_tool", allowed: true },
      { sourceType: "prompt", allowed: true },
      { sourceType: "agent", allowed: true }
    ]);
  });

  it("throws when the target agent is unknown", () => {
    expect(() => getHandlerTypeRules("unknown-agent")).toThrow(
      'Unknown hook agent "unknown-agent"'
    );
  });
});

describe("getPlaceholderRewrites", () => {
  it("rewrites shared claude-code placeholders to codex forms", () => {
    expect(getPlaceholderRewrites("claude-code", "codex")).toEqual([
      { from: "${CLAUDE_PROJECT_DIR}", to: "$(git rev-parse --show-toplevel)" },
      { from: "${CLAUDE_PLUGIN_ROOT}", to: "$PLUGIN_ROOT" },
      { from: "${CLAUDE_PLUGIN_DATA}", to: "$PLUGIN_DATA" }
    ]);
  });

  it("does not rewrite placeholders already in target form", () => {
    expect(getPlaceholderRewrites("claude-code", "claude-code")).toEqual([]);
  });

  it("rewrites shared codex placeholders back to claude-code forms", () => {
    expect(getPlaceholderRewrites("codex", "claude-code")).toEqual([
      { from: "$(git rev-parse --show-toplevel)", to: "${CLAUDE_PROJECT_DIR}" },
      { from: "$PLUGIN_ROOT", to: "${CLAUDE_PLUGIN_ROOT}" },
      { from: "$PLUGIN_DATA", to: "${CLAUDE_PLUGIN_DATA}" }
    ]);
  });

  it("throws when either placeholder agent is unknown", () => {
    expect(() => getPlaceholderRewrites("unknown-agent", "codex")).toThrow(
      'Unknown hook agent "unknown-agent"'
    );
    expect(() => getPlaceholderRewrites("claude-code", "unknown-agent")).toThrow(
      'Unknown hook agent "unknown-agent"'
    );
  });
});
