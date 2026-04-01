import { describe, expect, it, vi } from "vitest";
import { createDefaultGit } from "./git.js";
import type { ExecFn } from "../types.js";

function createExec(
  responses: Array<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>
) {
  const commands: Array<{ command: string; options?: { cwd?: string; timeout?: number } }> = [];

  const exec = vi.fn(async (command: string, options?: { cwd?: string; timeout?: number }) => {
    commands.push({ command, options });

    const response = responses.shift();

    if (!response) {
      throw new Error(`Unexpected exec call: ${command}`);
    }

    return response;
  });

  return {
    exec: exec as ExecFn,
    commands
  };
}

describe("createDefaultGit", () => {
  it("commitAll stages files excluding experiment docs, commits, and returns hash", async () => {
    const { exec, commands } = createExec([
      { stdout: "", stderr: "", exitCode: 0 },
      { stdout: "", stderr: "", exitCode: 1 },
      { stdout: "", stderr: "", exitCode: 0 },
      { stdout: "abc123\n", stderr: "", exitCode: 0 }
    ]);
    const git = createDefaultGit(exec);

    await expect(git.commitAll("save experiment", "/repo")).resolves.toBe("abc123");

    expect(commands).toEqual([
      { command: "git add -A -- . ':!.poe-code/experiments'", options: { cwd: "/repo" } },
      { command: "git diff --cached --quiet", options: { cwd: "/repo" } },
      { command: "git commit -m 'save experiment'", options: { cwd: "/repo" } },
      { command: "git rev-parse --short HEAD", options: { cwd: "/repo" } }
    ]);
  });

  it("commitAll with no changes returns current hash", async () => {
    const { exec, commands } = createExec([
      { stdout: "", stderr: "", exitCode: 0 },
      { stdout: "", stderr: "", exitCode: 0 },
      { stdout: "def456\n", stderr: "", exitCode: 0 }
    ]);
    const git = createDefaultGit(exec);

    await expect(git.commitAll("save experiment", "/repo")).resolves.toBe("def456");

    expect(commands).toEqual([
      { command: "git add -A -- . ':!.poe-code/experiments'", options: { cwd: "/repo" } },
      { command: "git diff --cached --quiet", options: { cwd: "/repo" } },
      { command: "git rev-parse --short HEAD", options: { cwd: "/repo" } }
    ]);
  });

  it("reset stashes experiment docs, resets, and restores them", async () => {
    const { exec, commands } = createExec([
      { stdout: "", stderr: "", exitCode: 0 },
      { stdout: "", stderr: "", exitCode: 0 },
      { stdout: "", stderr: "", exitCode: 0 }
    ]);
    const git = createDefaultGit(exec);

    await git.reset("abc123", "/repo");

    expect(commands).toEqual([
      {
        command: "git stash push -q --include-untracked -- .poe-code/experiments",
        options: { cwd: "/repo" }
      },
      { command: "git reset --hard 'abc123'", options: { cwd: "/repo" } },
      { command: "git stash pop -q", options: { cwd: "/repo" } }
    ]);
  });

  it("reset skips stash pop when there was nothing to stash", async () => {
    const { exec, commands } = createExec([
      { stdout: "", stderr: "No local changes to save", exitCode: 1 },
      { stdout: "", stderr: "", exitCode: 0 }
    ]);
    const git = createDefaultGit(exec);

    await git.reset("abc123", "/repo");

    expect(commands).toEqual([
      {
        command: "git stash push -q --include-untracked -- .poe-code/experiments",
        options: { cwd: "/repo" }
      },
      { command: "git reset --hard 'abc123'", options: { cwd: "/repo" } }
    ]);
  });

  it("currentHash returns short hash", async () => {
    const { exec, commands } = createExec([{ stdout: "fedcba\n", stderr: "", exitCode: 0 }]);
    const git = createDefaultGit(exec);

    await expect(git.currentHash("/repo")).resolves.toBe("fedcba");
    expect(commands).toEqual([
      { command: "git rev-parse --short HEAD", options: { cwd: "/repo" } }
    ]);
  });

  it("commit messages are shell-escaped", async () => {
    const { exec, commands } = createExec([
      { stdout: "", stderr: "", exitCode: 0 },
      { stdout: "", stderr: "", exitCode: 1 },
      { stdout: "", stderr: "", exitCode: 0 },
      { stdout: "abc123\n", stderr: "", exitCode: 0 }
    ]);
    const git = createDefaultGit(exec);

    await git.commitAll("it's ready", "/repo");

    expect(commands[2]).toEqual({
      command: "git commit -m 'it'\\''s ready'",
      options: { cwd: "/repo" }
    });
  });
});
