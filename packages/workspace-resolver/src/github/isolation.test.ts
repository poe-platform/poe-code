import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createWritableCheckout } from "./isolation.js";
import type { ResolverFileSystem, WorkspaceResolverOptions } from "../types.js";

function createFs(): ResolverFileSystem {
  return createFsFromVolume(new Volume()).promises as unknown as ResolverFileSystem;
}

function createOptions(overrides: Partial<WorkspaceResolverOptions> = {}): WorkspaceResolverOptions {
  return {
    baseDir: "/workspace",
    homeDir: "/home/test",
    mode: "edit",
    fs: overrides.fs ?? createFs(),
    exec: overrides.exec ?? (async () => ({ stdout: "", stderr: "", exitCode: 0 }))
  };
}

describe("createWritableCheckout", () => {
  it("creates and removes an isolated git worktree", async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const options = createOptions({
      exec: async (command, args, execOptions) => {
        calls.push({ command, args, cwd: execOptions?.cwd });
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    const result = await createWritableCheckout(
      { scheme: "github", owner: "poe-platform", repo: "poe-code", ref: "main" },
      "/home/test/.poe-code/workspaces/github/poe-platform-poe-code",
      options
    );

    expect(result.cwd).toContain("/home/test/.poe-code/workspaces/checkouts/poe-platform-poe-code");

    await result.cleanup();

    expect(calls).toEqual([
      {
        command: "git",
        args: ["worktree", "add", "--detach", result.cwd, "main"],
        cwd: "/home/test/.poe-code/workspaces/github/poe-platform-poe-code"
      },
      {
        command: "git",
        args: ["worktree", "remove", "--force", result.cwd],
        cwd: "/home/test/.poe-code/workspaces/github/poe-platform-poe-code"
      }
    ]);
  });
});
