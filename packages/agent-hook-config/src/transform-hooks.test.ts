import { describe, expect, it } from "vitest";
import { transformHooks, type SourceHookEntry } from "./index.js";

const runId = "bridge-run";

function commandEntry(
  event: string,
  handler: SourceHookEntry["handler"] = { type: "command", command: "echo hook" },
  matcher?: string
): SourceHookEntry {
  return { event, matcher, handler };
}

describe("transformHooks", () => {
  it("transforms a supported command hook and preserves matcher", () => {
    const result = transformHooks(
      [commandEntry("PreToolUse", { type: "command", command: "lint" }, "Bash|Write")],
      "claude-code",
      "codex",
      { runId }
    );

    expect(result).toEqual({
      entries: [
        {
          event: "PreToolUse",
          matcher: "Bash|Write",
          handler: {
            type: "command",
            command: "lint",
            statusMessage: "[generated:poe-code:bridge-run] "
          },
          generatedId: "generated-bridge-run-0"
        }
      ],
      drops: []
    });
    expect(result.entries[0]?.handler.statusMessage).toMatch(/^\[generated:poe-code:bridge-run\] /);
  });

  it("drops an unsupported event and names it in the detail", () => {
    const source = commandEntry("SessionEnd");

    const result = transformHooks([source], "claude-code", "codex", { runId });

    expect(result.entries).toEqual([]);
    expect(result.drops).toEqual([
      {
        reason: "unsupported-event",
        detail: expect.stringContaining("SessionEnd"),
        source
      }
    ]);
  });

  it.each(["http", "mcp_tool", "prompt", "agent"])(
    "drops unsupported %s handlers and names the type in the detail",
    (type) => {
      const source = commandEntry("PreToolUse", { type });

      const result = transformHooks([source], "claude-code", "codex", { runId });

      expect(result.entries).toEqual([]);
      expect(result.drops).toEqual([
        {
          reason: "unsupported-handler-type",
          detail: expect.stringContaining(type),
          source
        }
      ]);
    }
  );

  it("rewrites project directory placeholders in commands and args", () => {
    const result = transformHooks(
      [
        commandEntry("Stop", {
          type: "command",
          command: "${CLAUDE_PROJECT_DIR}/foo ${CLAUDE_PROJECT_DIR}/foo",
          args: ["${CLAUDE_PROJECT_DIR}/foo", "--dir=${CLAUDE_PROJECT_DIR}/foo"]
        })
      ],
      "claude-code",
      "codex",
      { runId }
    );

    expect(result.entries[0]?.handler).toMatchObject({
      command: "$(git rev-parse --show-toplevel)/foo $(git rev-parse --show-toplevel)/foo",
      args: ["$(git rev-parse --show-toplevel)/foo", "--dir=$(git rev-parse --show-toplevel)/foo"]
    });
  });

  it("rewrites plugin root placeholders", () => {
    const result = transformHooks(
      [commandEntry("Stop", { type: "command", command: "${CLAUDE_PLUGIN_ROOT}/run" })],
      "claude-code",
      "codex",
      { runId }
    );

    expect(result.entries[0]?.handler.command).toBe("$PLUGIN_ROOT/run");
  });

  it("always emits the generated marker and preserves the original status tail", () => {
    const result = transformHooks(
      [
        commandEntry("Stop", { type: "command", command: "first" }),
        commandEntry("Stop", {
          type: "command",
          command: "second",
          statusMessage: " running exactly  "
        })
      ],
      "claude-code",
      "codex",
      { runId }
    );

    expect(result.entries.map((entry) => entry.handler.statusMessage)).toEqual([
      "[generated:poe-code:bridge-run] ",
      "[generated:poe-code:bridge-run]  running exactly  "
    ]);
  });

  it("does not leak claude-only command fields into generated handlers", () => {
    const result = transformHooks(
      [
        commandEntry("Stop", {
          type: "command",
          command: "notify",
          timeout: 50,
          args: ["now"],
          if: "always",
          once: true,
          shell: "bash"
        })
      ],
      "claude-code",
      "codex",
      { runId }
    );

    expect(result.entries[0]?.handler).toEqual({
      type: "command",
      command: "notify",
      args: ["now"],
      timeout: 50,
      statusMessage: "[generated:poe-code:bridge-run] "
    });
  });

  it("keeps survivor and drop order while assigning unique surviving ids", () => {
    const unsupportedEvent = commandEntry("SessionEnd", { type: "command", command: "end" });
    const first = commandEntry("SessionStart", { type: "command", command: "start" });
    const unsupportedHandler = commandEntry("Stop", { type: "prompt", prompt: "stop" });
    const second = commandEntry("Stop", { type: "command", command: "stop" });

    const result = transformHooks(
      [unsupportedEvent, first, unsupportedHandler, second],
      "claude-code",
      "codex",
      { runId }
    );

    expect(result.entries.map((entry) => entry.handler.command)).toEqual(["start", "stop"]);
    expect(result.entries.map((entry) => entry.generatedId)).toEqual([
      "generated-bridge-run-0",
      "generated-bridge-run-1"
    ]);
    expect(new Set(result.entries.map((entry) => entry.generatedId)).size).toBe(2);
    expect(result.drops.map((drop) => drop.source)).toEqual([unsupportedEvent, unsupportedHandler]);
  });

  it("is deterministic without mutating source entries", () => {
    const source = [
      commandEntry("Stop", {
        type: "command",
        command: "${CLAUDE_PROJECT_DIR}/check",
        args: ["${CLAUDE_PLUGIN_ROOT}/task"],
        statusMessage: "checking"
      })
    ];
    const originalSource = structuredClone(source);

    const firstResult = transformHooks(source, "claude-code", "codex", { runId });
    const secondResult = transformHooks(source, "claude-code", "codex", { runId });

    expect(secondResult).toEqual(firstResult);
    expect(source).toEqual(originalSource);
  });

  it("returns empty collections for empty input", () => {
    expect(transformHooks([], "claude-code", "codex", { runId })).toEqual({
      entries: [],
      drops: []
    });
  });

  it("drops command handlers missing an executable command", () => {
    const result = transformHooks(
      [
        commandEntry("Stop", { type: "command" }),
        commandEntry("Stop", { type: "command", command: "   " })
      ],
      "claude-code",
      "codex",
      { runId }
    );

    expect(result.entries).toEqual([]);
    expect(result.drops).toHaveLength(2);
    expect(result.drops.map((drop) => drop.detail)).toEqual([
      "Command hook is missing an executable command",
      "Command hook is missing an executable command"
    ]);
  });
});
