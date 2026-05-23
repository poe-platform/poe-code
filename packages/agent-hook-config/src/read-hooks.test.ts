import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { readClaudeHooks } = await import("./index.js");

const cwd = "/repo/project";
const homeDir = "/home/tester";
const projectPath = path.join(cwd, ".claude/settings.json");
const userPath = path.join(homeDir, ".claude/settings.json");

function writeSettings(filePath: string, settings: unknown): void {
  vol.fromJSON({ [filePath]: JSON.stringify(settings) }, "/");
}

describe("readClaudeHooks", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("returns no entries or paths when both settings files are absent", () => {
    expect(readClaudeHooks(cwd, homeDir)).toEqual({ entries: [], readPaths: [] });
  });

  it("reads only a project settings file in project scope", () => {
    writeSettings(projectPath, {
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "lint" }] }]
      }
    });

    expect(readClaudeHooks(cwd, homeDir, { scope: "project" })).toEqual({
      entries: [
        {
          event: "PreToolUse",
          matcher: "Bash",
          handler: { type: "command", command: "lint" }
        }
      ],
      readPaths: [projectPath]
    });
  });

  it("reads only a user settings file in user scope", () => {
    writeSettings(userPath, {
      hooks: {
        Stop: [{ matcher: "", hooks: [{ type: "command", command: "notify" }] }]
      }
    });

    expect(readClaudeHooks(cwd, homeDir, { scope: "user" })).toEqual({
      entries: [{ event: "Stop", matcher: "", handler: { type: "command", command: "notify" } }],
      readPaths: [userPath]
    });
  });

  it("reads user entries before project entries in merged scope", () => {
    writeSettings(userPath, {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "user-command" }] }] }
    });
    writeSettings(projectPath, {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "project-command" }] }] }
    });

    expect(readClaudeHooks(cwd, homeDir)).toEqual({
      entries: [
        {
          event: "Stop",
          matcher: undefined,
          handler: { type: "command", command: "user-command" }
        },
        {
          event: "Stop",
          matcher: undefined,
          handler: { type: "command", command: "project-command" }
        }
      ],
      readPaths: [userPath, projectPath]
    });
  });

  it("does not read an unselected settings scope", () => {
    vol.fromJSON({ [userPath]: "{" }, "/");
    writeSettings(projectPath, {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "project-command" }] }] }
    });

    expect(readClaudeHooks(cwd, homeDir, { scope: "project" })).toEqual({
      entries: [
        {
          event: "Stop",
          matcher: undefined,
          handler: { type: "command", command: "project-command" }
        }
      ],
      readPaths: [projectPath]
    });
  });

  it("tracks a settings file with no hooks key as read", () => {
    writeSettings(projectPath, { permissions: { allow: [] } });

    expect(readClaudeHooks(cwd, homeDir, { scope: "project" })).toEqual({
      entries: [],
      readPaths: [projectPath]
    });
  });

  it("preserves an omitted matcher as undefined", () => {
    writeSettings(projectPath, {
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "begin" }] }] }
    });

    expect(readClaudeHooks(cwd, homeDir, { scope: "project" }).entries).toEqual([
      { event: "SessionStart", matcher: undefined, handler: { type: "command", command: "begin" } }
    ]);
  });

  it("creates one entry for each handler under a matcher group", () => {
    writeSettings(projectPath, {
      hooks: {
        PreToolUse: [
          {
            matcher: "Write",
            hooks: [
              { type: "command", command: "first" },
              { type: "http", url: "https://hooks.test/second" }
            ]
          }
        ]
      }
    });

    expect(readClaudeHooks(cwd, homeDir, { scope: "project" }).entries).toEqual([
      { event: "PreToolUse", matcher: "Write", handler: { type: "command", command: "first" } },
      {
        event: "PreToolUse",
        matcher: "Write",
        handler: { type: "http", url: "https://hooks.test/second" }
      }
    ]);
  });

  it("passes nested handler fields through verbatim", () => {
    const handler = {
      type: "mcp_tool",
      args: ["--json", "payload"],
      headers: { Authorization: "Bearer token" },
      input: { nested: { enabled: true }, count: 2 }
    };
    writeSettings(projectPath, {
      hooks: { PostToolUse: [{ matcher: "tool", hooks: [handler] }] }
    });

    expect(readClaudeHooks(cwd, homeDir, { scope: "project" }).entries).toEqual([
      { event: "PostToolUse", matcher: "tool", handler }
    ]);
  });

  it("preserves unrecognized raw event, matcher, and handler values", () => {
    const handler = { type: "custom_handler", prompt: "raw prompt", once: true };
    writeSettings(projectPath, {
      hooks: { CustomEvent: [{ matcher: "not validated", hooks: [handler] }] }
    });

    expect(readClaudeHooks(cwd, homeDir, { scope: "project" }).entries).toEqual([
      { event: "CustomEvent", matcher: "not validated", handler }
    ]);
  });

  it("throws a malformed JSON error naming the settings path", () => {
    vol.fromJSON({ [projectPath]: "{" }, "/");

    expect(() => readClaudeHooks(cwd, homeDir, { scope: "project" })).toThrowError(
      `Malformed JSON in ${projectPath}`
    );
  });
});
