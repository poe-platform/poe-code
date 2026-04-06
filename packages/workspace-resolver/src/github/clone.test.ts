import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { buildCachePath, buildCloneUrl, cloneOrUpdate } from "./clone.js";
import type { ResolverFileSystem, WorkspaceResolverOptions } from "../types.js";

function createFs(): ResolverFileSystem {
  return createFsFromVolume(new Volume()).promises as unknown as ResolverFileSystem;
}

function createOptions(overrides: Partial<WorkspaceResolverOptions> = {}): WorkspaceResolverOptions {
  return {
    baseDir: "/workspace",
    homeDir: "/home/test",
    mode: "read",
    fs: overrides.fs ?? createFs(),
    exec: overrides.exec ?? (async () => ({ stdout: "", stderr: "", exitCode: 0 }))
  };
}

describe("github clone helpers", () => {
  const locator = { scheme: "github" as const, owner: "poe-platform", repo: "poe-code" };

  it("builds cache paths inside the shared workspace cache", () => {
    expect(buildCachePath("/home/test", locator)).toBe(
      "/home/test/.poe-code/workspaces/github/poe-platform-poe-code"
    );
  });

  it("builds https clone urls", () => {
    expect(buildCloneUrl(locator)).toBe("https://github.com/poe-platform/poe-code.git");
  });

  it("clones missing repositories", async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const options = createOptions({
      exec: async (command, args, execOptions) => {
        calls.push({ command, args, cwd: execOptions?.cwd });
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    const cwd = await cloneOrUpdate(locator, options);

    expect(cwd).toBe("/home/test/.poe-code/workspaces/github/poe-platform-poe-code");
    expect(calls).toEqual([
      {
        command: "git",
        args: [
          "clone",
          "--depth",
          "1",
          "https://github.com/poe-platform/poe-code.git",
          "/home/test/.poe-code/workspaces/github/poe-platform-poe-code"
        ],
        cwd: undefined
      }
    ]);
  });

  it("updates a clean cached checkout and checks out the requested ref", async () => {
    const fs = createFs();
    await fs.mkdir("/home/test/.poe-code/workspaces/github/poe-platform-poe-code", {
      recursive: true
    });
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const options = createOptions({
      fs,
      exec: async (command, args, execOptions) => {
        calls.push({ command, args, cwd: execOptions?.cwd });
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    await cloneOrUpdate({ ...locator, ref: "beta" }, options);

    expect(calls).toEqual([
      {
        command: "git",
        args: ["status", "--porcelain"],
        cwd: "/home/test/.poe-code/workspaces/github/poe-platform-poe-code"
      },
      {
        command: "git",
        args: ["pull", "--ff-only"],
        cwd: "/home/test/.poe-code/workspaces/github/poe-platform-poe-code"
      },
      {
        command: "git",
        args: ["fetch", "origin"],
        cwd: "/home/test/.poe-code/workspaces/github/poe-platform-poe-code"
      },
      {
        command: "git",
        args: ["checkout", "beta"],
        cwd: "/home/test/.poe-code/workspaces/github/poe-platform-poe-code"
      }
    ]);
  });
});
