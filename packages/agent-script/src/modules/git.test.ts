import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn()
}));

import { execFile } from "node:child_process";

import { makeGitModule, type GitSavepoint } from "./git.js";

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

type ExecFileCall = {
  file: string;
  args: string[];
  options: {
    cwd: string;
    encoding: BufferEncoding;
    maxBuffer: number;
  };
};

function createGitFailure(message: string, stdout = "", stderr = ""): Error & { stdout: string; stderr: string } {
  return Object.assign(new Error(message), { stdout, stderr });
}

function mockExecFileSequence(handlers: Array<(call: ExecFileCall) => { error?: Error | null; stdout?: string; stderr?: string }>) {
  const execFileMock = vi.mocked(execFile);

  execFileMock.mockImplementation(((file, args, options, callback) => {
    const handler = handlers.shift();

    if (!handler) {
      throw new Error(`Unexpected git call: ${String(file)} ${(args as string[]).join(" ")}`);
    }

    const result = handler({
      file: String(file),
      args: [...(args as string[])],
      options: {
        cwd: String((options as { cwd: string }).cwd),
        encoding: (options as { encoding: BufferEncoding }).encoding,
        maxBuffer: Number((options as { maxBuffer: number }).maxBuffer)
      }
    });

    (callback as ExecFileCallback)(result.error ?? null, result.stdout ?? "", result.stderr ?? "");
    return {} as never;
  }) as typeof execFile);

  return execFileMock;
}

describe("makeGitModule", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the current HEAD commit hash", async () => {
    const execFileMock = mockExecFileSequence([
      (call) => {
        expect(call).toMatchObject({
          file: "git",
          args: ["rev-parse", "HEAD"],
          options: { cwd: "/repo", encoding: "utf8" }
        });
        return { stdout: "abc123\n" };
      }
    ]);

    const git = makeGitModule("/repo");

    await expect(git.head()).resolves.toBe("abc123");
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("creates a clean savepoint from HEAD when there are no local changes", async () => {
    mockExecFileSequence([
      () => ({ stdout: "base-head\n" }),
      (call) => {
        expect(call.args).toEqual(["status", "--porcelain"]);
        return { stdout: "" };
      }
    ]);

    const git = makeGitModule("/repo");

    await expect(git.checkpoint()).resolves.toEqual({
      head: "base-head"
    } satisfies GitSavepoint);
  });

  it("captures dirty state in a temporary stash-backed savepoint and restores the worktree", async () => {
    vi.spyOn(Date, "now").mockReturnValue(123456789);
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);

    const ref = "refs/poe-code/checkpoints/21i3v9-4fzzzxjy";

    mockExecFileSequence([
      () => ({ stdout: "base-head\n" }),
      () => ({ stdout: " M tracked.ts\n?? new.ts\n" }),
      (call) => {
        expect(call.args).toEqual([
          "stash",
          "push",
          "--include-untracked",
          "--message",
          `poe-code checkpoint ${ref}`
        ]);
        return { stdout: "Saved working directory and index state\n" };
      },
      (call) => {
        expect(call.args).toEqual(["rev-parse", "stash@{0}"]);
        return { stdout: "stash-oid\n" };
      },
      (call) => {
        expect(call.args).toEqual(["update-ref", ref, "stash-oid"]);
        return { stdout: "" };
      },
      (call) => {
        expect(call.args).toEqual(["stash", "apply", "--index", ref]);
        return { stdout: "" };
      },
      (call) => {
        expect(call.args).toEqual(["stash", "drop", "stash@{0}"]);
        return { stdout: "Dropped stash@{0}\n" };
      }
    ]);

    const git = makeGitModule("/repo");

    await expect(git.checkpoint()).resolves.toEqual({
      head: "base-head",
      stashRef: ref
    } satisfies GitSavepoint);
  });

  it("stages every change, commits, and returns the new HEAD when files are omitted", async () => {
    mockExecFileSequence([
      (call) => {
        expect(call.args).toEqual(["add", "--all"]);
        return { stdout: "" };
      },
      (call) => {
        expect(call.args).toEqual(["commit", "--message", "save progress"]);
        return { stdout: "[main abc123] save progress\n" };
      },
      (call) => {
        expect(call.args).toEqual(["rev-parse", "HEAD"]);
        return { stdout: "new-head\n" };
      }
    ]);

    const git = makeGitModule("/repo");

    await expect(git.commit({ message: "save progress" })).resolves.toBe("new-head");
  });

  it("stages only the provided files before committing", async () => {
    mockExecFileSequence([
      (call) => {
        expect(call.args).toEqual(["add", "--", "src/a.ts", "docs/notes.md"]);
        return { stdout: "" };
      },
      (call) => {
        expect(call.args).toEqual([
          "commit",
          "--message",
          "partial commit",
          "--",
          "src/a.ts",
          "docs/notes.md"
        ]);
        return { stdout: "" };
      },
      () => ({ stdout: "new-head\n" })
    ]);

    const git = makeGitModule("/repo");

    await git.commit({
      message: "partial commit",
      files: ["src/a.ts", "docs/notes.md"]
    });
  });

  it("cleans up the temporary savepoint ref when checkpoint restoration fails", async () => {
    vi.spyOn(Date, "now").mockReturnValue(123456789);
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);

    const ref = "refs/poe-code/checkpoints/21i3v9-4fzzzxjy";

    mockExecFileSequence([
      () => ({ stdout: "base-head\n" }),
      () => ({ stdout: " M tracked.ts\n" }),
      () => ({ stdout: "Saved working directory and index state\n" }),
      () => ({ stdout: "stash-oid\n" }),
      () => ({ stdout: "" }),
      (call) => {
        expect(call.args).toEqual(["stash", "apply", "--index", ref]);
        return {
          error: createGitFailure("git failed", "", "conflict while applying checkpoint"),
          stderr: "conflict while applying checkpoint"
        };
      },
      (call) => {
        expect(call.args).toEqual(["update-ref", "--delete", ref]);
        return { stdout: "" };
      },
      (call) => {
        expect(call.args).toEqual(["stash", "drop", "stash@{0}"]);
        return { stdout: "Dropped stash@{0}\n" };
      }
    ]);

    const git = makeGitModule("/repo");

    await expect(git.checkpoint()).rejects.toThrow(
      `git stash apply --index ${ref} failed: conflict while applying checkpoint`
    );
  });

  it("reverts to the savepoint HEAD and reapplies the captured stash when present", async () => {
    const savepoint: GitSavepoint = {
      head: "base-head",
      stashRef: "refs/poe-code/checkpoints/checkpoint-123"
    };

    mockExecFileSequence([
      (call) => {
        expect(call.args).toEqual(["reset", "--hard", "base-head"]);
        return { stdout: "HEAD is now at base-head\n" };
      },
      (call) => {
        expect(call.args).toEqual(["clean", "--force", "-d"]);
        return { stdout: "" };
      },
      (call) => {
        expect(call.args).toEqual(["stash", "apply", "--index", savepoint.stashRef!]);
        return { stdout: "" };
      },
      (call) => {
        expect(call.args).toEqual(["update-ref", "--delete", savepoint.stashRef!]);
        return { stdout: "" };
      }
    ]);

    const git = makeGitModule("/repo");

    await expect(git.revert(savepoint)).resolves.toBeUndefined();
  });

  it("deletes the savepoint ref even when stash reapply fails during revert", async () => {
    const savepoint: GitSavepoint = {
      head: "base-head",
      stashRef: "refs/poe-code/checkpoints/checkpoint-123"
    };

    mockExecFileSequence([
      () => ({ stdout: "HEAD is now at base-head\n" }),
      () => ({ stdout: "" }),
      (call) => {
        expect(call.args).toEqual(["stash", "apply", "--index", savepoint.stashRef!]);
        return {
          error: createGitFailure("git failed", "", "stash apply failed"),
          stderr: "stash apply failed"
        };
      },
      (call) => {
        expect(call.args).toEqual(["update-ref", "--delete", savepoint.stashRef!]);
        return { stdout: "" };
      }
    ]);

    const git = makeGitModule("/repo");

    await expect(git.revert(savepoint)).rejects.toThrow(
      `git stash apply --index ${savepoint.stashRef} failed: stash apply failed`
    );
  });

  it("returns the current diff against HEAD", async () => {
    mockExecFileSequence([
      (call) => {
        expect(call.args).toEqual(["diff", "HEAD", "--"]);
        return { stdout: "diff --git a/file b/file\n" };
      }
    ]);

    const git = makeGitModule("/repo");

    await expect(git.diff()).resolves.toBe("diff --git a/file b/file\n");
  });

  it("surfaces git stderr when a command fails", async () => {
    mockExecFileSequence([
      () => ({ stdout: "" }),
      () => ({
        error: createGitFailure("git failed", "", "nothing to commit"),
        stderr: "nothing to commit"
      })
    ]);

    const git = makeGitModule("/repo");

    await expect(git.commit({ message: "save progress" })).rejects.toThrow(
      "git commit --message save progress failed: nothing to commit"
    );
  });
});
