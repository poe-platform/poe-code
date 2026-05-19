import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CheatFilter } from "./cheat.js";
import type { SpawnEvent } from "../types.js";

function toolCall(input: {
  title?: string;
  kind?: string;
  path?: string;
  rawInput?: unknown;
}): SpawnEvent {
  return {
    sessionUpdate: "tool_call",
    toolCallId: "tool-1",
    title: input.title ?? input.path ?? "read",
    kind: input.kind ?? "read",
    ...(input.path === undefined ? {} : { locations: [{ path: input.path }] }),
    ...(input.rawInput === undefined ? {} : { rawInput: input.rawInput })
  } as SpawnEvent;
}

function toolStart(input: {
  title: string;
  kind: string;
  rawInput?: unknown;
  input?: unknown;
}): SpawnEvent {
  return {
    event: "tool_start",
    id: "tool-1",
    title: input.title,
    kind: input.kind,
    ...(input.rawInput === undefined ? {} : { rawInput: input.rawInput }),
    ...(input.input === undefined ? {} : { input: input.input })
  } as SpawnEvent;
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
    filter.onEvent(toolCall({ path: path.join(os.homedir(), ".cache", "agent-eval", "state.json") }));
    filter.onEvent(toolCall({ title: "env", kind: "exec", rawInput: { command: "/usr/bin/env node" } }));

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

  it("resolves relative paths against the clone", () => {
    const cloneDir = "/work/clone";
    const filter = new CheatFilter({ cloneDir });

    filter.onEvent(toolCall({ title: "Glob parent", kind: "glob", rawInput: { pattern: "../outside" } }));
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

    filter.onEvent(toolStart({
      title: "secret",
      kind: "search",
      input: { path: "/private", pattern: "secret" }
    }));

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
