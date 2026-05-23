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

function toolStart(input: {
  title: string;
  kind: string;
  rawInput?: unknown;
  input?: unknown;
}): TraceToolEvent {
  return {
    type: "tool",
    sequence: 0,
    phase: "start",
    id: "tool-1",
    name: input.title,
    operation: operation(input.kind),
    paths: [],
    ...(input.rawInput === undefined && input.input === undefined
      ? {}
      : { rawArguments: input.rawInput ?? input.input })
  };
}

function operation(kind: string): TraceToolEvent["operation"] {
  if (kind === "read") return "read";
  if (kind === "search" || kind === "glob") return "search";
  if (kind === "exec") return "exec";
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

  it("flags terminal-only tool calls without duplicating completed lifecycles", () => {
    const filter = new CheatFilter({ cloneDir: "/work/clone" });

    filter.onEvent(
      toolCall({
        id: "terminal-only",
        title: "Read secret",
        path: "/private/secret.txt",
        phase: "complete"
      })
    );
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
          path: "/private/secret.txt",
          toolCall: "Read secret",
          reason: "outside-clone"
        },
        {
          path: "/private/second.txt",
          toolCall: "Read second",
          reason: "outside-clone"
        }
      ]
    });
  });

  it("resolves relative paths against the clone", () => {
    const cloneDir = "/work/clone";
    const filter = new CheatFilter({ cloneDir });

    filter.onEvent(
      toolCall({ title: "Glob parent", kind: "glob", rawInput: { pattern: "../outside" } })
    );
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

    filter.onEvent(
      toolStart({
        title: "secret",
        kind: "search",
        input: { path: "/private", pattern: "secret" }
      })
    );

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
