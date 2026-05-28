import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
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

  it("does not perform a post-clone filesystem write", async () => {
    let mkdirCalls = 0;
    const fs: ResolverFileSystem = {
      stat: async () => {
        throw new Error("missing");
      },
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
        args: ["checkout", "--", "beta"],
        cwd: "/home/test/.poe-code/workspaces/github/poe-platform-poe-code"
      }
    ]);
  });

  it("rejects a cached path that is not a git repository", async () => {
    const fs = createFs();
    await fs.mkdir("/home/test/.poe-code/workspaces/github/poe-platform-poe-code", {
      recursive: true
    });

    await expect(
      cloneOrUpdate(locator, createOptions({
        fs,
        exec: async () => ({ stdout: "", stderr: "fatal: not a git repository", exitCode: 128 })
      }))
    ).rejects.toThrow("fatal: not a git repository");
  });

  it("rejects a failed update of a clean cached checkout", async () => {
    const fs = createFs();
    await fs.mkdir("/home/test/.poe-code/workspaces/github/poe-platform-poe-code", {
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
    await fs.mkdir("/home/test/.poe-code/workspaces/github/poe-platform-poe-code", {
      recursive: true
    });
    const exec = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    await cloneOrUpdate({ ...locator, ref: "--detach" }, createOptions({ fs, exec }));

    expect(exec).toHaveBeenCalledWith(
      "git",
      ["checkout", "--", "--detach"],
      { cwd: "/home/test/.poe-code/workspaces/github/poe-platform-poe-code" }
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
        stat: vi.fn(async () => ({ isDirectory: () => true }))
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
});
