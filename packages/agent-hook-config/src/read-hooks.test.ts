import * as fs from "node:fs";
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

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
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

  it("rejects a symlinked project settings file", () => {
    writeSettings("/outside/settings.json", { hooks: {} });
    vol.mkdirSync(path.dirname(projectPath), { recursive: true });
    fs.symlinkSync("/outside/settings.json", projectPath);

    expect(() => readClaudeHooks(cwd, homeDir, { scope: "project" })).toThrow(/symbolic link/);
  });

  it("does not ignore symlinked settings files with inherited missing-file codes", async () => {
    writeSettings("/outside/settings.json", { hooks: {} });
    vol.mkdirSync(path.dirname(projectPath), { recursive: true });
    fs.symlinkSync("/outside/settings.json", projectPath);

    await withObjectPrototypeProperties({ code: "ENOENT" }, () => {
      expect(() => readClaudeHooks(cwd, homeDir, { scope: "project" })).toThrow(/symbolic link/);
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

  it("rejects a symlinked user settings file", () => {
    writeSettings("/outside/settings.json", { hooks: {} });
    vol.mkdirSync(path.dirname(userPath), { recursive: true });
    fs.symlinkSync("/outside/settings.json", userPath);

    expect(() => readClaudeHooks(cwd, homeDir, { scope: "user" })).toThrow(/symbolic link/);
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

  it("rejects null event groups as malformed configuration", () => {
    vol.fromJSON({ [projectPath]: JSON.stringify({ hooks: { Stop: null } }) }, "/");

    expect(() => readClaudeHooks(cwd, homeDir, { scope: "project" })).toThrow(
      `Malformed hooks in ${projectPath}`
    );
  });

  it("rejects null handlers as malformed configuration", () => {
    writeSettings(projectPath, {
      hooks: { Stop: [{ hooks: [null] }] }
    });

    expect(() => readClaudeHooks(cwd, homeDir, { scope: "project" })).toThrow(
      `Malformed hooks in ${projectPath}`
    );
  });
});
