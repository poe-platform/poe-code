import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CheatFilter } from "./cheat.js";
import type { TraceToolEvent } from "./trace/types.js";

function toolCall(input: {
  id?: string;
  title?: string;
  kind?: string;
  path?: string;
  paths?: readonly string[];
  rawInput?: unknown;
  phase?: TraceToolEvent["phase"];
}): TraceToolEvent {
  return {
    type: "tool",
    sequence: 0,
    phase: input.phase ?? "start",
    id: input.id ?? "tool-1",
    name: input.title ?? input.path ?? "read",
    operation: operation(input.kind ?? "read"),
    paths: input.paths ?? (input.path === undefined ? [] : [input.path]),
    ...(input.rawInput === undefined ? {} : { rawArguments: input.rawInput })
  };
}

function operation(kind: string): TraceToolEvent["operation"] {
  if (kind === "read") return "read";
  if (kind === "search" || kind === "glob") return "search";
  if (kind === "exec") return "exec";
  if (kind === "edit") return "edit";
  if (kind === "write") return "write";
  if (kind === "mcp") return "mcp";
  return "other";
}

describe("CheatFilter", () => {
  it("passes paths inside the clone", () => {
    const filter = new CheatFilter({ cloneDir: "/work/clone" });

    filter.onEvent(toolCall({ path: "/work/clone/src/index.ts" }));
    filter.onEvent(toolCall({ path: "/work/clone", title: "clone root" }));

    expect(filter.report()).toEqual({
      cheated: false,
      violations: []
    });
  });

  it("passes edits and writes inside the clone", () => {
    const filter = new CheatFilter({ cloneDir: "/work/clone" });

    filter.onEvent(toolCall({ title: "Patch local", kind: "edit", path: "src/index.ts" }));
    filter.onEvent(toolCall({ title: "Write local", kind: "write", path: "src/new.ts" }));

    expect(filter.report()).toEqual({ cheated: false, violations: [] });
  });

  it("passes allowlisted paths", () => {
    const filter = new CheatFilter({
      cloneDir: "/work/clone",
      allowedPaths: ["/fixtures"]
    });

    filter.onEvent(toolCall({ path: "/fixtures/input.txt" }));

    expect(filter.report()).toEqual({
      cheated: false,
      violations: []
    });
  });

  it("passes default allowlisted paths", () => {
    const filter = new CheatFilter({ cloneDir: "/work/clone" });

    filter.onEvent(toolCall({ path: path.join(os.tmpdir(), "agent-eval.tmp") }));
    filter.onEvent(
      toolCall({ path: path.join(os.homedir(), ".cache", "agent-eval", "state.json") })
    );
    filter.onEvent(
      toolCall({ title: "env", kind: "exec", rawInput: { command: "/usr/bin/env node" } })
    );

    expect(filter.report()).toEqual({
      cheated: false,
      violations: []
    });
  });

  it("does not treat allowlisted sibling path prefixes as allowed", () => {
    const filter = new CheatFilter({
      cloneDir: "/work/clone",
      allowedPaths: ["/fixtures"]
    });

    filter.onEvent(toolCall({ title: "Read sibling fixture", path: "/fixtures-other/input.txt" }));

    expect(filter.report()).toEqual({
      cheated: true,
      violations: [
        {
          path: "/fixtures-other/input.txt",
          toolCall: "Read sibling fixture",
          reason: "outside-clone"
        }
      ]
    });
  });

  it("flags unrelated absolute paths", () => {
    const filter = new CheatFilter({ cloneDir: "/work/clone" });

    filter.onEvent(toolCall({ title: "Read secret", path: "/private/secret.txt" }));

    expect(filter.report()).toEqual({
      cheated: true,
      violations: [
        {
          path: "/private/secret.txt",
          toolCall: "Read secret",
          reason: "outside-clone"
        }
      ]
    });
  });

  it.each([
    ["edit", "Patch secret"],
    ["write", "Write secret"],
    ["mcp", "filesystem.write_file"]
  ])("flags outside-clone %s operations", (kind, title) => {
    const filter = new CheatFilter({ cloneDir: "/work/clone" });

    filter.onEvent(toolCall({ title, kind, path: "/private/secret.txt" }));

    expect(filter.report()).toEqual({
      cheated: true,
      violations: [
        {
          path: "/private/secret.txt",
          toolCall: title,
          reason: "outside-clone"
        }
      ]
    });
  });

  it("checks structured command target paths without treating executables as targets", () => {
    const filter = new CheatFilter({ cloneDir: "/work/clone" });

    filter.onEvent(toolCall({ title: "Run env", kind: "exec", paths: ["/private/result.txt"] }));

    expect(filter.report()).toEqual({
      cheated: true,
      violations: [
        {
          path: "/private/result.txt",
          toolCall: "Run env",
          reason: "outside-clone"
        }
      ]
    });
  });

  it("reports uninspectable shell commands without declaring a violation", () => {
    const filter = new CheatFilter({ cloneDir: "/work/clone" });

    filter.onEvent({
      ...toolCall({ title: "Shell redirect", kind: "exec" }),
      inspection: { status: "uninspectable", reason: "shell-command" }
    });

    expect(filter.report()).toEqual({
      cheated: false,
      violations: [],
      uninspectable: [
        {
          toolCall: "Shell redirect",
          operation: "exec",
          reason: "shell-command"
        }
      ]
    });
  });

  it("reports uninspectable MCP file calls without declaring a violation", () => {
    const filter = new CheatFilter({ cloneDir: "/work/clone" });

    filter.onEvent({
      ...toolCall({ title: "fs.write_file", kind: "mcp" }),
      inspection: { status: "uninspectable", reason: "missing-path" }
    });

    expect(filter.report()).toEqual({
      cheated: false,
      violations: [],
      uninspectable: [
        {
          toolCall: "fs.write_file",
          operation: "mcp",
          reason: "missing-path"
        }
      ]
    });
  });

  it("replaces provisional MCP uncertainty with confirmed completion targets", () => {
    const filter = new CheatFilter({ cloneDir: "/work/clone" });

    filter.onEvent({
      ...toolCall({ id: "mcp-1", title: "fs.write_file", kind: "mcp" }),
      inspection: { status: "uninspectable", reason: "missing-path" }
    });
    filter.onEvent(
      toolCall({
        id: "mcp-1",
        title: "fs.write_file",
        kind: "mcp",
        path: "/private/secret.txt",
        phase: "complete"
      })
    );

    expect(filter.report()).toEqual({
      cheated: true,
      violations: [
        { path: "/private/secret.txt", toolCall: "fs.write_file", reason: "outside-clone" }
      ]
    });
  });

  it("only resolves the completed MCP call when tool names match", () => {
    const filter = new CheatFilter({ cloneDir: "/work/clone" });

    for (const id of ["mcp-1", "mcp-2"]) {
      filter.onEvent({
        ...toolCall({ id, title: "fs.write_file", kind: "mcp" }),
        inspection: { status: "uninspectable", reason: "missing-path" }
      });
    }
    filter.onEvent(
      toolCall({
        id: "mcp-2",
        title: "fs.write_file",
        kind: "mcp",
        path: "src/local.txt",
        phase: "complete"
      })
    );

    expect(filter.report()).toEqual({
      cheated: false,
      violations: [],
      uninspectable: [{ toolCall: "fs.write_file", operation: "mcp", reason: "missing-path" }]
    });
  });

  it("flags every referenced path from one tool start", () => {
    const filter = new CheatFilter({ cloneDir: "/work/clone" });

    filter.onEvent(
      toolCall({
        title: "Search files",
        kind: "search",
        paths: ["src", "/private/secret.txt"]
      })
    );
    expect(filter.report()).toEqual({
      cheated: true,
      violations: [
        {
          path: "/private/secret.txt",
          toolCall: "Search files",
          reason: "outside-clone"
        }
      ]
    });
  });

  it("does not duplicate completed lifecycle violations", () => {
    const filter = new CheatFilter({ cloneDir: "/work/clone" });

    filter.onEvent(
      toolCall({ id: "lifecycle", title: "Read second", path: "/private/second.txt" })
    );
    filter.onEvent(
      toolCall({
        id: "lifecycle",
        title: "Read second",
        path: "/private/second.txt",
        phase: "complete"
      })
    );

    expect(filter.report()).toEqual({
      cheated: true,
      violations: [
        {
          path: "/private/second.txt",
          toolCall: "Read second",
          reason: "outside-clone"
        }
      ]
    });
  });

  it("checks edit targets first reported when a tool completes", () => {
    const filter = new CheatFilter({ cloneDir: "/work/clone" });

    filter.onEvent(toolCall({ id: "late-path", title: "Edit late", kind: "edit" }));
    filter.onEvent(
      toolCall({
        id: "late-path",
        title: "Edit late",
        kind: "edit",
        path: "/private/late.txt",
        phase: "complete"
      })
    );

    expect(filter.report()).toEqual({
      cheated: true,
      violations: [
        {
          path: "/private/late.txt",
          toolCall: "Edit late",
          reason: "outside-clone"
        }
      ]
    });
  });

  it("resolves relative paths against the clone", () => {
    const cloneDir = "/work/clone";
    const filter = new CheatFilter({ cloneDir });

    filter.onEvent(toolCall({ title: "Glob parent", kind: "glob", paths: ["../outside"] }));
    filter.onEvent(toolCall({ title: "Read local", path: "src/index.ts" }));

    expect(filter.report()).toEqual({
      cheated: true,
      violations: [
        {
          path: path.resolve(cloneDir, "../outside"),
          toolCall: "Glob parent",
          reason: "outside-clone"
        }
      ]
    });
  });

  it("does not treat sibling path prefixes as inside the clone", () => {
    const filter = new CheatFilter({ cloneDir: "/work/clone" });

    filter.onEvent(toolCall({ title: "Read sibling", path: "/work/clone-other/file.txt" }));

    expect(filter.report()).toEqual({
      cheated: true,
      violations: [
        {
          path: "/work/clone-other/file.txt",
          toolCall: "Read sibling",
          reason: "outside-clone"
        }
      ]
    });
  });

  it("reads adapter input paths before display titles", () => {
    const filter = new CheatFilter({ cloneDir: "/work/clone" });

    filter.onEvent(toolCall({ title: "secret", kind: "search", paths: ["/private"] }));

    expect(filter.report()).toEqual({
      cheated: true,
      violations: [
        {
          path: "/private",
          toolCall: "secret",
          reason: "outside-clone"
        }
      ]
    });
  });
});
