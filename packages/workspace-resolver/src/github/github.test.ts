import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { isUserError } from "@poe-code/user-error";
import { buildCachePath, buildCloneUrl, cloneOrUpdate } from "./clone.js";
import { createWritableCheckout } from "./isolation.js";
import type { ResolverFileSystem, WorkspaceResolverOptions } from "../types.js";

function createFs(): ResolverFileSystem {
  return createFsFromVolume(new Volume()).promises as unknown as ResolverFileSystem;
}

function createOptions(overrides: Partial<WorkspaceResolverOptions> = {}): WorkspaceResolverOptions {
  return {
    baseDir: "/workspace",
    homeDir: "/home/test",
    mode: overrides.mode ?? "read",
    fs: overrides.fs ?? createFs(),
    exec: overrides.exec ?? (async () => ({ stdout: "", stderr: "", exitCode: 0 }))
  };
}

describe("github clone helpers", () => {
  const locator = { scheme: "github" as const, owner: "poe-platform", repo: "poe-code" };

  it("builds cache paths inside the shared workspace cache", () => {
    expect(buildCachePath("/home/test", locator)).toBe(
      "/home/test/.poe-code/workspaces/github/c-poe-platform-poe-code"
    );
  });

  it("does not alias distinct owner and repository boundaries", () => {
    expect(buildCachePath("/home/test", { scheme: "github", owner: "a-b", repo: "c" })).not.toBe(
      buildCachePath("/home/test", { scheme: "github", owner: "a", repo: "b-c" })
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

    expect(cwd).toBe("/home/test/.poe-code/workspaces/github/c-poe-platform-poe-code");
    expect(calls).toEqual([
      {
        command: "git",
        args: [
          "clone",
          "--depth",
          "1",
          "https://github.com/poe-platform/poe-code.git",
          "/home/test/.poe-code/workspaces/github/c-poe-platform-poe-code"
        ],
        cwd: undefined
      }
    ]);
  });

  it("does not perform a post-clone filesystem write", async () => {
    let mkdirCalls = 0;
    const fs: ResolverFileSystem = {
      stat: async () => {
        throw new Error("missing");
      },
      lstat: async () => ({ isSymbolicLink: () => false }),
      mkdir: async () => {
        mkdirCalls += 1;
        if (mkdirCalls > 1) {
          throw new Error("unexpected cache mkdir");
        }
      }
    };

    await expect(cloneOrUpdate(locator, createOptions({ fs }))).resolves.toContain("poe-platform-poe-code");
    expect(mkdirCalls).toBe(1);
  });

  it("updates a clean cached checkout and checks out the requested ref as a revision", async () => {
    const fs = createFs();
    await fs.mkdir("/home/test/.poe-code/workspaces/github/c-poe-platform-poe-code", {
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
        cwd: "/home/test/.poe-code/workspaces/github/c-poe-platform-poe-code"
      },
      {
        command: "git",
        args: ["pull", "--ff-only"],
        cwd: "/home/test/.poe-code/workspaces/github/c-poe-platform-poe-code"
      },
      {
        command: "git",
        args: ["fetch", "origin", "--", "beta"],
        cwd: "/home/test/.poe-code/workspaces/github/c-poe-platform-poe-code"
      },
      {
        command: "git",
        args: ["checkout", "FETCH_HEAD", "--"],
        cwd: "/home/test/.poe-code/workspaces/github/c-poe-platform-poe-code"
      }
    ]);
  });

  describe("failed clones of a missing cache", () => {
    async function cloneWithStderr(stderr: string, target = locator): Promise<unknown> {
      const fs = createFs();
      return await cloneOrUpdate(
        target,
        createOptions({
          fs,
          exec: async () => ({ stdout: "", stderr, exitCode: 128 })
        })
      ).catch((error: unknown) => error);
    }

    it("maps a missing repository to guidance naming the locator, without raw git stderr", async () => {
      const error = await cloneWithStderr(
        "Cloning into '/home/test/...'\nERROR: Repository not found.\nfatal: Could not read from remote repository.",
        { scheme: "github", owner: "not", repo: "a-repo" }
      );

      expect(isUserError(error)).toBe(true);
      expect((error as Error).message).toMatch(
        /^Cannot clone github:\/\/not\/a-repo: the repository does not exist or your account cannot see it\./
      );
      expect((error as Error).message).not.toContain("Cloning into");
    });

    it("maps an authentication failure to guidance naming the locator", async () => {
      const error = await cloneWithStderr(
        "fatal: Authentication failed for 'https://github.com/poe-platform/poe-code.git/'"
      );

      expect(isUserError(error)).toBe(true);
      expect((error as Error).message).toMatch(/^Cannot clone github:\/\/poe-platform\/poe-code:/);
      expect((error as Error).message).toContain("gh auth login");
    });

    it("maps an unreachable network to guidance naming the locator", async () => {
      const error = await cloneWithStderr(
        "fatal: unable to access 'https://github.com/poe-platform/poe-code.git/': Could not resolve host: github.com"
      );

      expect(isUserError(error)).toBe(true);
      expect((error as Error).message).toMatch(/^Cannot clone github:\/\/poe-platform\/poe-code:/);
      expect((error as Error).message).toContain("GitHub is unreachable");
    });

    it("leaves an unrecognised clone failure as a system error", async () => {
      const error = await cloneWithStderr("error: index-pack died of signal 9");

      expect(isUserError(error)).toBe(false);
      expect((error as Error).message).toContain("index-pack died of signal 9");
    });
  });

  it("rejects a cached path that is not a git repository", async () => {
    const fs = createFs();
    await fs.mkdir("/home/test/.poe-code/workspaces/github/c-poe-platform-poe-code", {
      recursive: true
    });

    await expect(
      cloneOrUpdate(locator, createOptions({
        fs,
        exec: async () => ({ stdout: "", stderr: "fatal: not a git repository", exitCode: 128 })
      }))
    ).rejects.toThrow("fatal: not a git repository");
  });

  it("rejects a symbolic-link cached repository path", async () => {
    const fs: ResolverFileSystem = {
      mkdir: vi.fn(async () => undefined),
      stat: vi.fn(async () => ({ isDirectory: () => true })),
      lstat: vi.fn(async () => ({ isSymbolicLink: () => true }))
    };
    const exec = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    await expect(cloneOrUpdate(locator, createOptions({ fs, exec }))).rejects.toThrow(
      "must not be a symbolic link"
    );
    expect(exec).not.toHaveBeenCalled();
  });

  it("rejects symlinked workspace cache ancestors before cloning", async () => {
    const volume = new Volume();
    volume.mkdirSync("/home/test/.poe-code/workspaces", { recursive: true });
    volume.mkdirSync("/outside", { recursive: true });
    volume.symlinkSync("/outside", "/home/test/.poe-code/workspaces/github");
    const fs = createFsFromVolume(volume).promises as unknown as ResolverFileSystem;
    const exec = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    await expect(cloneOrUpdate(locator, createOptions({ fs, exec }))).rejects.toThrow(
      "must not be a symbolic link"
    );
    expect(exec).not.toHaveBeenCalled();
  });

  it("rejects a failed update of a clean cached checkout", async () => {
    const fs = createFs();
    await fs.mkdir("/home/test/.poe-code/workspaces/github/c-poe-platform-poe-code", {
      recursive: true
    });

    await expect(
      cloneOrUpdate(locator, createOptions({
        fs,
        exec: async (_command, args) => args[0] === "pull"
          ? { stdout: "", stderr: "pull failed", exitCode: 1 }
          : { stdout: "", stderr: "", exitCode: 0 }
      }))
    ).rejects.toThrow("pull failed");
  });

  it("treats a dash-prefixed ref as a checkout operand", async () => {
    const fs = createFs();
    await fs.mkdir("/home/test/.poe-code/workspaces/github/c-poe-platform-poe-code", {
      recursive: true
    });
    const exec = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    await cloneOrUpdate({ ...locator, ref: "--detach" }, createOptions({ fs, exec }));

    expect(exec).toHaveBeenCalledWith(
      "git",
      ["fetch", "origin", "--", "--detach"],
      { cwd: "/home/test/.poe-code/workspaces/github/c-poe-platform-poe-code" }
    );
    expect(exec).toHaveBeenCalledWith(
      "git",
      ["checkout", "FETCH_HEAD", "--"],
      { cwd: "/home/test/.poe-code/workspaces/github/c-poe-platform-poe-code" }
    );
  });
});

describe("createWritableCheckout", () => {
  const locator = { scheme: "github" as const, owner: "poe-platform", repo: "poe-code" };
  it("creates and removes an isolated git worktree", async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const options = createOptions({
      mode: "edit",
      exec: async (command, args, execOptions) => {
        calls.push({ command, args, cwd: execOptions?.cwd });
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    const result = await createWritableCheckout(
      { scheme: "github", owner: "poe-platform", repo: "poe-code", ref: "main" },
      "/home/test/.poe-code/workspaces/github/c-poe-platform-poe-code",
      options
    );

    expect(result.cwd).toContain("/home/test/.poe-code/workspaces/checkouts/poe-platform-poe-code");

    await result.cleanup();

    expect(calls).toEqual([
      {
        command: "git",
        args: ["worktree", "add", "--detach", result.cwd, "main"],
        cwd: "/home/test/.poe-code/workspaces/github/c-poe-platform-poe-code"
      },
      {
        command: "git",
        args: ["worktree", "remove", "--force", result.cwd],
        cwd: "/home/test/.poe-code/workspaces/github/c-poe-platform-poe-code"
      }
    ]);
  });

  it("creates distinct editable checkout paths within the same millisecond", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(42);
    const exec = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const options = createOptions({ mode: "edit", exec });

    try {
      const [first, second] = await Promise.all([
        createWritableCheckout(locator, "/cache", options),
        createWritableCheckout(locator, "/cache", options)
      ]);

      expect(first.cwd).not.toBe(second.cwd);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("rejects cleanup when worktree removal fails without a filesystem fallback", async () => {
    const options = createOptions({
      mode: "edit",
      fs: {
        mkdir: vi.fn(async () => undefined),
        stat: vi.fn(async () => ({ isDirectory: () => true })),
        lstat: vi.fn(async () => ({ isSymbolicLink: () => false }))
      },
      exec: async (_command, args) => args[1] === "remove"
        ? { stdout: "", stderr: "still in use", exitCode: 1 }
        : { stdout: "", stderr: "", exitCode: 0 }
    });
    const checkout = await createWritableCheckout(locator, "/cache", options);

    await expect(checkout.cleanup()).rejects.toThrow("still in use");
  });

  it("cleans up a worktree when post-add filesystem setup fails", async () => {
    let mkdirCount = 0;
    const exec = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const fs: ResolverFileSystem = {
      mkdir: vi.fn(async () => {
        mkdirCount += 1;
        if (mkdirCount === 2) {
          throw new Error("local mkdir failed");
        }
      }),
      stat: vi.fn(async () => ({ isDirectory: () => true })),
      lstat: vi.fn(async () => ({ isSymbolicLink: () => false })),
      rm: vi.fn(async () => undefined)
    };

    await expect(createWritableCheckout(locator, "/cache", createOptions({ fs, exec }))).rejects.toThrow(
      "local mkdir failed"
    );
    expect(exec.mock.calls.map(([, args]) => args.slice(0, 2))).toEqual([
      ["worktree", "add"],
      ["worktree", "remove"]
    ]);
  });

  it("cleans up a worktree directory when git worktree add fails after creating it", async () => {
    const fs = createFs();
    const calls: string[][] = [];
    let checkoutPath = "";
    const options = createOptions({
      fs,
      mode: "edit",
      exec: async (_command, args) => {
        calls.push(args);
        if (args[0] === "worktree" && args[1] === "add") {
          checkoutPath = args[3];
          await fs.mkdir(checkoutPath, { recursive: true });
          return { stdout: "", stderr: "fatal: invalid reference: feature", exitCode: 128 };
        }
        if (args[0] === "worktree" && args[1] === "remove") {
          await fs.rm?.(args[3], { recursive: true, force: true });
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    await expect(createWritableCheckout(
      { ...locator, ref: "feature" },
      "/cache",
      options
    )).rejects.toThrow("fatal: invalid reference: feature");

    expect(calls).toContainEqual(["worktree", "remove", "--force", checkoutPath]);
    await expect(fs.stat(checkoutPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symbolic-link checkout parent", async () => {
    const fs: ResolverFileSystem = {
      mkdir: vi.fn(async () => undefined),
      stat: vi.fn(async () => ({ isDirectory: () => true })),
      lstat: vi.fn(async () => ({ isSymbolicLink: () => true }))
    };
    const exec = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    await expect(createWritableCheckout(locator, "/cache", createOptions({ fs, exec }))).rejects.toThrow(
      "must not be a symbolic link"
    );
    expect(exec).not.toHaveBeenCalled();
  });

  it("rejects symlinked workspace checkout ancestors before adding worktrees", async () => {
    const volume = new Volume();
    volume.mkdirSync("/home/test/.poe-code/workspaces", { recursive: true });
    volume.mkdirSync("/outside", { recursive: true });
    volume.symlinkSync("/outside", "/home/test/.poe-code/workspaces/checkouts");
    const fs = createFsFromVolume(volume).promises as unknown as ResolverFileSystem;
    const exec = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    await expect(createWritableCheckout(locator, "/cache", createOptions({ fs, exec }))).rejects.toThrow(
      "must not be a symbolic link"
    );
    expect(exec).not.toHaveBeenCalled();
  });
});
