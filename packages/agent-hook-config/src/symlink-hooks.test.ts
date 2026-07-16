import * as fs from "node:fs";
import path from "node:path";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { isUserError } from "@poe-code/user-error";

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
const { userAuthoredHookFileCode } = await import("./symlink-hooks.js");

const cwd = "/repo/project";
const homeDir = "/home/tester";
const sourcePath = path.join(cwd, ".source/settings.json");
const targetPath = path.join(cwd, ".target/settings.json");

function generatedSettings(statusMessage = "[generated:poe-code:bridge-run] running"): string {
  return JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: "command", command: "notify", statusMessage }] }] }
  });
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

describe("symlinkHooks", () => {
  beforeEach(() => {
    vol.reset();
    vi.restoreAllMocks();
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

  it("links a same-agent project target to its user hook source", () => {
    const userPath = path.join(homeDir, ".source/settings.json");
    vol.mkdirSync(path.dirname(userPath), { recursive: true });
    vol.writeFileSync(userPath, "{}", "utf8");

    expect(symlinkHooks("source", "source", cwd, homeDir, "project")).toMatchObject({
      symlinkPath: sourcePath,
      targetPath: userPath
    });
    expect(readlinkSync(sourcePath)).toBe(userPath);
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

  it("replaces an entirely generated regular file larger than the first kilobyte", () => {
    const hooks = Array.from({ length: 30 }, (_, index) => ({
      type: "command",
      command: `notify-${index}`,
      statusMessage: `[generated:poe-code:old-run] generated hook ${index} ${"x".repeat(40)}`
    }));
    const contents = JSON.stringify({ hooks: { Stop: [{ hooks }] } }, null, 2);
    expect(Buffer.byteLength(contents)).toBeGreaterThan(1024);
    vol.fromJSON({ [targetPath]: contents }, "/");

    expect(symlinkHooks("source", "target", cwd, homeDir, "project").replaced).toBe(
      "generated-file"
    );
    expect(lstatSync(targetPath).isSymbolicLink()).toBe(true);
  });

  it("restores a generated regular file when replacement symlink creation fails", () => {
    const contents = generatedSettings();
    vol.fromJSON({ [targetPath]: contents }, "/");
    vi.spyOn(fs, "symlinkSync").mockImplementation(() => {
      throw new Error("symlink creation denied");
    });

    expect(() => symlinkHooks("source", "target", cwd, homeDir, "project")).toThrow(
      "symlink creation denied"
    );
    expect(readFileSync(targetPath, "utf8")).toBe(contents);
  });

  it("restores a generated regular file when parent preparation fails", () => {
    const contents = generatedSettings();
    vol.fromJSON({ [targetPath]: contents }, "/");
    const mkdirSync = fs.mkdirSync.bind(fs);
    vi.spyOn(fs, "mkdirSync").mockImplementation((directoryPath, options) => {
      if (String(directoryPath) === path.dirname(targetPath)) {
        throw new Error("parent preparation denied");
      }

      return mkdirSync(directoryPath, options);
    });

    expect(() => symlinkHooks("source", "target", cwd, homeDir, "project")).toThrow(
      "parent preparation denied"
    );
    expect(readFileSync(targetPath, "utf8")).toBe(contents);
  });

  it("does not overwrite a hook path recreated before generated file restore", () => {
    const contents = generatedSettings();
    vol.fromJSON({ [targetPath]: contents }, "/");
    vi.spyOn(fs, "symlinkSync").mockImplementation(() => {
      vol.writeFileSync(targetPath, "new occupant", "utf8");
      const error = new Error("hook path recreated") as NodeJS.ErrnoException;
      error.code = "EEXIST";
      throw error;
    });

    let failure: unknown;
    try {
      symlinkHooks("source", "target", cwd, homeDir, "project");
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors[0]).toMatchObject({
      code: "EEXIST",
      message: "hook path recreated"
    });
    expect((failure as AggregateError).errors[1]).toMatchObject({ code: "EEXIST" });
    expect(readFileSync(targetPath, "utf8")).toBe("new occupant");
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

  it("refuses a user-authored hook file as a user error with recovery guidance", () => {
    const contents = generatedSettings("user-authored");
    vol.fromJSON({ [targetPath]: contents }, "/");

    let failure: unknown;
    try {
      symlinkHooks("source", "target", cwd, homeDir, "project");
    } catch (error) {
      failure = error;
    }

    expect(isUserError(failure)).toBe(true);
    expect(failure).toMatchObject({ code: userAuthoredHookFileCode });
    expect((failure as Error).message).toContain(targetPath);
    expect((failure as Error).message).toMatch(/--hooks-strategy/);
  });

  it("does not ignore user-authored targets with inherited missing-file codes", async () => {
    const contents = generatedSettings("user-authored");
    vol.fromJSON({ [targetPath]: contents }, "/");

    await withObjectPrototypeProperties({ code: "ENOENT" }, () => {
      expect(() => symlinkHooks("source", "target", cwd, homeDir, "project")).toThrow(
        /refuse.*user-authored/i
      );
    });
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
                statusMessage: "[generated:poe-code:bridge-run] running"
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

  it("rejects a symlinked target parent directory", () => {
    vol.mkdirSync(cwd, { recursive: true });
    vol.mkdirSync("/outside", { recursive: true });
    fs.symlinkSync("/outside", path.dirname(targetPath));

    expect(() => symlinkHooks("source", "target", cwd, homeDir, "project")).toThrow(
      /symbolic link/
    );
    expect(vol.existsSync("/outside/settings.json")).toBe(false);
  });

  it("rechecks target parents after creating missing directories", () => {
    vol.mkdirSync(cwd, { recursive: true });
    vol.mkdirSync("/outside", { recursive: true });
    const mkdirSync = fs.mkdirSync.bind(fs);
    vi.spyOn(fs, "mkdirSync").mockImplementation((directoryPath, options) => {
      if (String(directoryPath) === path.dirname(targetPath)) {
        fs.symlinkSync("/outside", directoryPath);
        return undefined;
      }

      return mkdirSync(directoryPath, options);
    });

    expect(() => symlinkHooks("source", "target", cwd, homeDir, "project")).toThrow(
      /symbolic link/
    );
    expect(vol.existsSync("/outside/settings.json")).toBe(false);
  });

  it("throws when the source has no project hook path", () => {
    expect(() => symlinkHooks("project-less", "target", cwd, homeDir, "project")).toThrow(
      /project-less.*project/i
    );
  });
});
