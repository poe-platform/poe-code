import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn()
}));

vi.mock("node:fs/promises", () => {
  // Distinct paths are distinct files: the containment check reads an identity
  // only to tell one path from another, so a per-path inode is enough.
  const inodes = new Map<string, number>();
  const identify = (path: string): number => {
    const known = inodes.get(path);

    if (known !== undefined) {
      return known;
    }

    inodes.set(path, inodes.size + 1);
    return inodes.size;
  };

  return {
    mkdir: vi.fn(async () => undefined),
    realpath: vi.fn(async (path: string) => path),
    // Canonicalization only reads a link when realpath refuses the path, which this
    // realpath never does, so every path here is the non-link EINVAL answers for.
    readlink: vi.fn(async () => {
      const error: NodeJS.ErrnoException = new Error("EINVAL: invalid argument, readlink");
      error.code = "EINVAL";
      throw error;
    }),
    rm: vi.fn(async () => undefined),
    stat: vi.fn(async (path: string) => ({ dev: 1, ino: identify(path) }))
  };
});

import { execFile } from "node:child_process";
import { mkdir, realpath, rm } from "node:fs/promises";

import { run } from "../run.js";
import { makeAgentModule } from "./agent.js";
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

function createGitFailure(
  message: string,
  stdout = "",
  stderr = ""
): Error & { stdout: string; stderr: string } {
  return Object.assign(new Error(message), { stdout, stderr });
}

function mockExecFileSequence(
  handlers: Array<
    (call: ExecFileCall) => { error?: Error | null; stdout?: string; stderr?: string }
  >
) {
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

describe("makeGitModule", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(realpath).mockImplementation(async (path) => String(path));
    vi.mocked(rm).mockResolvedValue(undefined);
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

  it("ignores inherited git option fields", async () => {
    const execFileMock = mockExecFileSequence([
      (call) => {
        expect(call.args).toEqual(["add", "--all"]);
        return { stdout: "" };
      },
      (call) => {
        expect(call.args).toEqual(["commit", "--message", "save progress"]);
        return { stdout: "" };
      },
      () => ({ stdout: "new-head\n" }),
      (call) => {
        expect(call.args).toEqual(["reset", "--hard", "base-head"]);
        return { stdout: "" };
      },
      (call) => {
        expect(call.args).toEqual(["clean", "--force", "-d"]);
        return { stdout: "" };
      },
      () => ({ stdout: "/repo\n" }),
      () => ({ error: createGitFailure("missing ref") }),
      (call) => {
        expect(call.args).toEqual([
          "worktree",
          "add",
          "-b",
          "feature/inherited",
          "/repo/.poe-code/worktrees/feature%2Finherited",
          "HEAD"
        ]);
        return { stdout: "" };
      }
    ]);
    const git = makeGitModule("/repo");

    await withObjectPrototypeProperties(
      {
        base: "origin/polluted",
        files: ["polluted.ts"],
        path: "/tmp/outside",
        stashRef: "refs/heads/main"
      },
      async () => {
        await expect(git.commit({ message: "save progress" })).resolves.toBe("new-head");
        await expect(git.revert({ head: "base-head" })).resolves.toBeUndefined();
        await expect(git.worktreeCreate("feature/inherited", {})).resolves.toEqual({
          branch: "feature/inherited",
          path: "/repo/.poe-code/worktrees/feature%2Finherited"
        });
      }
    );

    expect(execFileMock).toHaveBeenCalledTimes(8);
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
        expect(call.args).toEqual(["stash", "apply", "--index", "stash@{0}"]);
        return {
          error: createGitFailure("git failed", "", "conflict while restoring original stash"),
          stderr: "conflict while restoring original stash"
        };
      }
    ]);

    const git = makeGitModule("/repo");

    await expect(git.checkpoint()).rejects.toThrow(
      `git stash apply --index ${ref} failed: conflict while applying checkpoint`
    );
    expect(execFile).toHaveBeenCalledTimes(8);
  });

  it("restores dirty work before dropping its stash when savepoint ref creation fails", async () => {
    vi.spyOn(Date, "now").mockReturnValue(123456789);
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);

    const ref = "refs/poe-code/checkpoints/21i3v9-4fzzzxjy";

    mockExecFileSequence([
      () => ({ stdout: "base-head\n" }),
      () => ({ stdout: " M tracked.ts\n" }),
      () => ({ stdout: "Saved working directory and index state\n" }),
      () => ({ stdout: "stash-oid\n" }),
      () => ({
        error: createGitFailure("git failed", "", "cannot write ref"),
        stderr: "cannot write ref"
      }),
      (call) => {
        expect(call.args).toEqual(["update-ref", "--delete", ref]);
        return { stdout: "" };
      },
      (call) => {
        expect(call.args).toEqual(["stash", "apply", "--index", "stash@{0}"]);
        return { stdout: "" };
      },
      (call) => {
        expect(call.args).toEqual(["stash", "drop", "stash@{0}"]);
        return { stdout: "Dropped stash@{0}\n" };
      }
    ]);

    const git = makeGitModule("/repo");

    await expect(git.checkpoint()).rejects.toThrow(
      `git update-ref ${ref} stash-oid failed: cannot write ref`
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

  it("rejects a forged savepoint ref before deleting caller-selected refs", async () => {
    const git = makeGitModule("/repo");

    await expect(git.revert({ head: "base-head", stashRef: "refs/heads/main" })).rejects.toThrow(
      "Git savepoint stashRef must be a Poe checkpoint ref."
    );
    expect(execFile).not.toHaveBeenCalled();
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

  it("creates a worktree at the default path and lists it", async () => {
    const worktreePath = "/repo/.poe-code/worktrees/feature%2Fx";

    const execFileMock = mockExecFileSequence([
      (call) => {
        expect(call.args).toEqual(["rev-parse", "--show-toplevel"]);
        return { stdout: "/repo\n" };
      },
      (call) => {
        expect(call.args).toEqual(["show-ref", "--verify", "--quiet", "refs/heads/feature/x"]);
        return { error: createGitFailure("missing ref") };
      },
      (call) => {
        expect(call.args).toEqual(["worktree", "add", "-b", "feature/x", worktreePath, "HEAD"]);
        return { stdout: "Preparing worktree\n" };
      },
      (call) => {
        expect(call.args).toEqual(["worktree", "list", "--porcelain"]);
        return {
          stdout: [
            "worktree /repo",
            "HEAD base-head",
            "branch refs/heads/main",
            "",
            `worktree ${worktreePath}`,
            "HEAD feature-head",
            "branch refs/heads/feature/x",
            ""
          ].join("\n")
        };
      }
    ]);

    const git = makeGitModule("/repo");

    await expect(git.worktreeCreate("feature/x")).resolves.toEqual({
      path: worktreePath,
      branch: "feature/x"
    });
    await expect(git.worktreeList()).resolves.toEqual([
      { path: "/repo", branch: "main" },
      { path: worktreePath, branch: "feature/x" }
    ]);
    expect(mkdir).toHaveBeenCalledWith("/repo/.poe-code/worktrees", { recursive: true });
    expect(execFileMock).toHaveBeenCalledTimes(4);
  });

  it("uses HEAD as the default worktree base and accepts an explicit base ref", async () => {
    mockExecFileSequence([
      () => ({ stdout: "/repo\n" }),
      () => ({ error: createGitFailure("missing ref") }),
      (call) => {
        expect(call.args).toEqual([
          "worktree",
          "add",
          "-b",
          "feature/default",
          "/repo/.poe-code/worktrees/feature%2Fdefault",
          "HEAD"
        ]);
        return { stdout: "" };
      },
      () => ({ stdout: "/repo\n" }),
      () => ({ error: createGitFailure("missing ref") }),
      (call) => {
        expect(call.args).toEqual([
          "worktree",
          "add",
          "-b",
          "feature/base",
          "/repo/custom-worktrees/base",
          "origin/main"
        ]);
        return { stdout: "" };
      }
    ]);

    const git = makeGitModule("/repo");

    await expect(git.worktreeCreate("feature/default")).resolves.toEqual({
      path: "/repo/.poe-code/worktrees/feature%2Fdefault",
      branch: "feature/default"
    });
    await expect(
      git.worktreeCreate("feature/base", {
        base: "origin/main",
        path: "custom-worktrees/base"
      })
    ).resolves.toEqual({
      path: "/repo/custom-worktrees/base",
      branch: "feature/base"
    });
  });

  it("removes a worktree and treats a second removal as a no-op", async () => {
    const worktreePath = "/repo/.poe-code/worktrees/feature%2Fx";

    mockExecFileSequence([
      () => ({ stdout: "/repo\n" }),
      (call) => {
        expect(call.args).toEqual(["worktree", "list", "--porcelain"]);
        return {
          stdout: [
            "worktree /repo",
            "branch refs/heads/main",
            "",
            `worktree ${worktreePath}`,
            "branch refs/heads/feature/x",
            ""
          ].join("\n")
        };
      },
      (call) => {
        expect(call.args).toEqual(["worktree", "remove", "--force", worktreePath]);
        return { stdout: "" };
      },
      () => ({ stdout: "/repo\n" }),
      (call) => {
        expect(call.args).toEqual(["worktree", "list", "--porcelain"]);
        return {
          stdout: ["worktree /repo", "branch refs/heads/main", ""].join("\n")
        };
      }
    ]);

    const git = makeGitModule("/repo");

    await expect(git.worktreeRemove(worktreePath)).resolves.toBeUndefined();
    await expect(git.worktreeRemove(worktreePath)).resolves.toBeUndefined();
    expect(rm).toHaveBeenCalledTimes(1);
    expect(rm).toHaveBeenCalledWith(worktreePath, { recursive: true, force: true });
  });

  it("lists current worktrees across multiple creates and removes", async () => {
    const firstPath = "/repo/.poe-code/worktrees/feature%2Fone";
    const secondPath = "/repo/.poe-code/worktrees/feature%2Ftwo";

    mockExecFileSequence([
      () => ({ stdout: "/repo\n" }),
      () => ({ error: createGitFailure("missing ref") }),
      () => ({ stdout: "" }),
      () => ({ stdout: "/repo\n" }),
      () => ({ error: createGitFailure("missing ref") }),
      () => ({ stdout: "" }),
      () => ({
        stdout: [
          "worktree /repo",
          "branch refs/heads/main",
          "",
          `worktree ${firstPath}`,
          "branch refs/heads/feature/one",
          "",
          `worktree ${secondPath}`,
          "branch refs/heads/feature/two",
          ""
        ].join("\n")
      }),
      () => ({ stdout: "/repo\n" }),
      () => ({
        stdout: [
          "worktree /repo",
          "branch refs/heads/main",
          "",
          `worktree ${firstPath}`,
          "branch refs/heads/feature/one",
          "",
          `worktree ${secondPath}`,
          "branch refs/heads/feature/two",
          ""
        ].join("\n")
      }),
      () => ({ stdout: "" }),
      () => ({
        stdout: [
          "worktree /repo",
          "branch refs/heads/main",
          "",
          `worktree ${secondPath}`,
          "branch refs/heads/feature/two",
          ""
        ].join("\n")
      })
    ]);

    const git = makeGitModule("/repo");

    await git.worktreeCreate("feature/one");
    await git.worktreeCreate("feature/two");
    await expect(git.worktreeList()).resolves.toEqual([
      { path: "/repo", branch: "main" },
      { path: firstPath, branch: "feature/one" },
      { path: secondPath, branch: "feature/two" }
    ]);
    await git.worktreeRemove(firstPath);
    await expect(git.worktreeList()).resolves.toEqual([
      { path: "/repo", branch: "main" },
      { path: secondPath, branch: "feature/two" }
    ]);
  });

  it("throws a clear error when the worktree branch already exists", async () => {
    mockExecFileSequence([
      () => ({ stdout: "/repo\n" }),
      (call) => {
        expect(call.args).toEqual([
          "show-ref",
          "--verify",
          "--quiet",
          "refs/heads/feature/existing"
        ]);
        return { stdout: "" };
      }
    ]);

    const git = makeGitModule("/repo");

    await expect(git.worktreeCreate("feature/existing")).rejects.toThrow(
      "Git worktree branch 'feature/existing' already exists."
    );
    expect(mkdir).not.toHaveBeenCalled();
  });

  it("rejects worktree paths outside the repository", async () => {
    mockExecFileSequence([() => ({ stdout: "/repo\n" })]);

    const git = makeGitModule("/repo");

    await expect(git.worktreeCreate("feature/escape", { path: "/tmp/outside" })).rejects.toThrow(
      "Git worktree path must be inside the git repository."
    );
    expect(mkdir).not.toHaveBeenCalled();
  });

  // A worktree has to live under the repository, so the repository root is not a
  // legal worktree path even though it is trivially "inside" itself.
  it("rejects the repository root itself as a worktree path", async () => {
    mockExecFileSequence([() => ({ stdout: "/repo\n" })]);

    const git = makeGitModule("/repo");

    await expect(git.worktreeCreate("feature/root", { path: "/repo" })).rejects.toThrow(
      "Git worktree path must be inside the git repository."
    );
    expect(mkdir).not.toHaveBeenCalled();
  });

  it("accepts a worktree path through a symlinked repo path after canonical validation", async () => {
    vi.mocked(realpath).mockImplementation(async (path) => {
      if (
        String(path) === "/var/tmp/repo/worktrees" ||
        String(path) === "/var/tmp/repo/worktrees/feature"
      ) {
        const error = Object.assign(new Error("missing path"), { code: "ENOENT" });
        throw error;
      }

      if (String(path) === "/var/tmp/repo") {
        return "/private/var/tmp/repo";
      }

      return String(path);
    });

    mockExecFileSequence([
      () => ({ stdout: "/private/var/tmp/repo\n" }),
      () => ({ error: createGitFailure("missing ref") }),
      (call) => {
        expect(call.args).toEqual([
          "worktree",
          "add",
          "-b",
          "feature/symlink-root",
          "/private/var/tmp/repo/worktrees/feature",
          "HEAD"
        ]);
        return { stdout: "" };
      }
    ]);

    const git = makeGitModule("/var/tmp/repo");

    await expect(
      git.worktreeCreate("feature/symlink-root", {
        path: "/var/tmp/repo/worktrees/feature"
      })
    ).resolves.toEqual({
      path: "/private/var/tmp/repo/worktrees/feature",
      branch: "feature/symlink-root"
    });
  });

  it("does not treat inherited realpath error codes as missing worktree ancestors", async () => {
    vi.mocked(realpath).mockImplementation(async (path) => {
      if (String(path) === "/repo/worktrees/feature") {
        throw new Error("realpath denied");
      }

      return String(path);
    });
    mockExecFileSequence([() => ({ stdout: "/repo\n" })]);

    const git = makeGitModule("/repo");

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(
        git.worktreeCreate("feature/denied", {
          path: "/repo/worktrees/feature"
        })
      ).rejects.toThrow("realpath denied");
    });
    expect(mkdir).not.toHaveBeenCalled();
  });

  it("rejects worktree paths whose existing parent resolves outside the repository", async () => {
    vi.mocked(realpath).mockImplementation(async (path) => {
      if (String(path) === "/repo/linked-out/worktree") {
        const error = Object.assign(new Error("missing path"), { code: "ENOENT" });
        throw error;
      }

      if (String(path) === "/repo/linked-out") {
        return "/tmp/outside";
      }

      return String(path);
    });
    mockExecFileSequence([() => ({ stdout: "/repo\n" })]);

    const git = makeGitModule("/repo");

    await expect(
      git.worktreeCreate("feature/symlink-escape", {
        path: "/repo/linked-out/worktree"
      })
    ).rejects.toThrow("Git worktree path must be inside the git repository.");
    expect(mkdir).not.toHaveBeenCalled();
  });

  it("passes a created worktree path to spawn so edits stay outside the main checkout", async () => {
    const worktreePath = "/repo/.poe-code/worktrees/feature%2Fspawn";
    const edits = new Map<string, string>();
    const spawnAgent = vi.fn(async (input: { cwd?: string }) => {
      edits.set(input.cwd ?? "", "edited");
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        summary: "edited",
        durationMs: 1
      };
    });

    mockExecFileSequence([
      () => ({ stdout: "/repo\n" }),
      () => ({ error: createGitFailure("missing ref") }),
      () => ({ stdout: "" })
    ]);

    const result = await run(
      [
        'import { worktreeCreate } from "git";',
        'import { spawn } from "agent";',
        'const worktree = await worktreeCreate("feature/spawn");',
        'await spawn("codex", { prompt: "Edit files.", cwd: worktree.path });',
        "return worktree.path;"
      ].join("\n"),
      {
        modules: {
          agent: makeAgentModule(spawnAgent),
          git: makeGitModule("/repo")
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: worktreePath
    });
    expect(edits.get(worktreePath)).toBe("edited");
    expect(edits.has("/repo")).toBe(false);
    expect(spawnAgent).toHaveBeenCalledWith({
      agent: "codex",
      prompt: "Edit files.",
      cwd: worktreePath
    });
  });
});
