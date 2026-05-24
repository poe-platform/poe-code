import path from "node:path";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

vi.mock("./configs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./configs.js")>();
  const claudeConfig = actual.getAgentConfig("claude-code")!;
  const configs = {
    source: {
      ...claudeConfig,
      globalHookPath: "~/.source/settings.json",
      localHookPath: ".source/settings.json"
    },
    target: {
      ...claudeConfig,
      globalHookPath: "~/.target/settings.json",
      localHookPath: ".target/settings.json"
    },
    "project-less": {
      ...claudeConfig,
      globalHookPath: "~/.remote/settings.json",
      localHookPath: undefined
    }
  };

  return {
    ...actual,
    getAgentConfig(agentId: string) {
      return configs[agentId as keyof typeof configs] ?? actual.getAgentConfig(agentId);
    }
  };
});

const { symlinkHooks } = await import("./index.js");

const cwd = "/repo/project";
const homeDir = "/home/tester";
const sourcePath = path.join(cwd, ".source/settings.json");
const targetPath = path.join(cwd, ".target/settings.json");

function generatedSettings(statusMessage = "[generated:bridge-run] running"): string {
  return JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: "command", command: "notify", statusMessage }] }] }
  });
}

describe("symlinkHooks", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("throws with both format names when source and target formats differ", () => {
    expect(() => symlinkHooks("claude-code", "codex", cwd, homeDir, "project")).toThrow(
      /claude-settings-json.*codex-hooks-json/
    );
  });

  it("creates a same-format project symlink", () => {
    const result = symlinkHooks("source", "target", cwd, homeDir, "project");

    expect(result).toEqual({ symlinkPath: targetPath, targetPath: sourcePath, replaced: "none" });
    expect(lstatSync(targetPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(targetPath)).toBe(sourcePath);
  });

  it("is idempotent when the existing symlink points to the target", () => {
    symlinkHooks("source", "target", cwd, homeDir, "project");

    expect(symlinkHooks("source", "target", cwd, homeDir, "project").replaced).toBe("none");
    expect(readlinkSync(targetPath)).toBe(sourcePath);
  });

  it("replaces a stale symlink", () => {
    vol.mkdirSync(path.dirname(targetPath), { recursive: true });
    vol.symlinkSync("/stale/settings.json", targetPath);

    expect(symlinkHooks("source", "target", cwd, homeDir, "project").replaced).toBe(
      "stale-symlink"
    );
    expect(readlinkSync(targetPath)).toBe(sourcePath);
  });

  it("replaces an entirely generated regular file", () => {
    vol.fromJSON({ [targetPath]: generatedSettings() }, "/");

    expect(symlinkHooks("source", "target", cwd, homeDir, "project").replaced).toBe(
      "generated-file"
    );
    expect(lstatSync(targetPath).isSymbolicLink()).toBe(true);
  });

  it("refuses to replace a regular file containing a user-authored hook", () => {
    const contents = generatedSettings("user-authored");
    vol.fromJSON({ [targetPath]: contents }, "/");

    expect(() => symlinkHooks("source", "target", cwd, homeDir, "project")).toThrow(
      /refuse.*user-authored/i
    );
    expect(readFileSync(targetPath, "utf8")).toBe(contents);
    expect(lstatSync(targetPath).isSymbolicLink()).toBe(false);
  });

  it("refuses to replace generated hooks in a user-authored settings file", () => {
    const contents = JSON.stringify({
      permissions: { allow: ["Read"] },
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: "notify",
                statusMessage: "[generated:bridge-run] running"
              }
            ]
          }
        ]
      }
    });
    vol.fromJSON({ [targetPath]: contents }, "/");

    expect(() => symlinkHooks("source", "target", cwd, homeDir, "project")).toThrow(
      /refuse.*user-authored/i
    );
    expect(readFileSync(targetPath, "utf8")).toBe(contents);
    expect(lstatSync(targetPath).isSymbolicLink()).toBe(false);
  });

  it("creates missing parent directories", () => {
    symlinkHooks("source", "target", cwd, homeDir, "project");

    expect(lstatSync(path.dirname(targetPath)).isDirectory()).toBe(true);
  });

  it("throws when the source has no project hook path", () => {
    expect(() => symlinkHooks("project-less", "target", cwd, homeDir, "project")).toThrow(
      /project-less.*project/i
    );
  });
});
