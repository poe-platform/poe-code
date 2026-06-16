import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { buildCachePath } from "./github/clone.js";
import { assertPathHasNoSymbolicLinks } from "./path-safety.js";
import { resolveWorkspace } from "./resolve.js";
import { parseLocator } from "./parse.js";
import type { ResolverFileSystem, WorkspaceResolverOptions } from "./types.js";

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

describe("parseLocator", () => {
  it("treats plain filesystem paths as local locators", () => {
    expect(parseLocator("./src")).toEqual({ scheme: "local", path: "./src" });
    expect(parseLocator("/tmp/project")).toEqual({ scheme: "local", path: "/tmp/project" });
  });

  it("parses github locators with owner and repo", () => {
    expect(parseLocator("github://poe-platform/poe-code")).toEqual({
      scheme: "github",
      owner: "poe-platform",
      repo: "poe-code"
    });
  });

  it("parses github locators with a ref and subdir", () => {
    expect(parseLocator("github://poe-platform/poe-code#beta:packages/process-runner")).toEqual({
      scheme: "github",
      owner: "poe-platform",
      repo: "poe-code",
      ref: "beta",
      subdir: "packages/process-runner"
    });
  });

  it("parses github locators with ref only (no subdir)", () => {
    expect(parseLocator("github://owner/repo#v1.0.0")).toEqual({
      scheme: "github",
      owner: "owner",
      repo: "repo",
      ref: "v1.0.0"
    });
  });

  it("parses github locators with subdir via path segments", () => {
    expect(parseLocator("github://owner/repo/packages/core")).toEqual({
      scheme: "github",
      owner: "owner",
      repo: "repo",
      subdir: "packages/core"
    });
  });

  it("rejects github subdirectories that traverse outside the repository", () => {
    expect(() => parseLocator("github://owner/repo/../../outside")).toThrow(
      "Invalid github workspace subdirectory"
    );
  });

  it("parses github locators with deeply nested subdir via path", () => {
    expect(parseLocator("github://owner/repo/a/b/c")).toEqual({
      scheme: "github",
      owner: "owner",
      repo: "repo",
      subdir: "a/b/c"
    });
  });

  it("parses github locators with subdir in fragment but no ref", () => {
    expect(parseLocator("github://owner/repo#:subdir")).toEqual({
      scheme: "github",
      owner: "owner",
      repo: "repo",
      subdir: "subdir"
    });
  });

  it("ignores trailing colon in fragment when subdir is empty", () => {
    expect(parseLocator("github://owner/repo#main:")).toEqual({
      scheme: "github",
      owner: "owner",
      repo: "repo",
      ref: "main"
    });
  });

  it("ignores empty fragment", () => {
    expect(parseLocator("github://owner/repo#")).toEqual({
      scheme: "github",
      owner: "owner",
      repo: "repo"
    });
  });

  it("rejects github locators with subdir in both path and fragment", () => {
    expect(() => parseLocator("github://owner/repo/path-sub#ref:frag-sub")).toThrow(
      'Invalid github workspace locator'
    );
  });

  it("rejects github locators with only owner", () => {
    expect(() => parseLocator("github://owner")).toThrow('Invalid github workspace locator');
  });

  it("rejects github locators with empty authority", () => {
    expect(() => parseLocator("github://")).toThrow('Invalid github workspace locator');
  });

  it("strips leading/trailing whitespace", () => {
    expect(parseLocator("  ./src  ")).toEqual({ scheme: "local", path: "./src" });
  });

  it("treats empty string as local", () => {
    expect(parseLocator("")).toEqual({ scheme: "local", path: "" });
  });

  it("treats Windows drive paths as local", () => {
    expect(parseLocator("C:\\Users\\me\\repo")).toEqual({
      scheme: "local",
      path: "C:\\Users\\me\\repo"
    });
  });

  it("parses ssh locators with port", () => {
    expect(parseLocator("ssh://deploy@10.0.0.1:2222/var/repos/app")).toEqual({
      scheme: "ssh",
      user: "deploy",
      host: "10.0.0.1",
      port: 2222,
      path: "/var/repos/app"
    });
  });

  it("parses ssh locators without user", () => {
    expect(parseLocator("ssh://example.com/repo")).toEqual({
      scheme: "ssh",
      host: "example.com",
      path: "/repo"
    });
  });

  it("parses docker locators with image tag", () => {
    expect(parseLocator("docker://myimage:latest/workspace/app")).toEqual({
      scheme: "docker",
      container: "myimage:latest",
      path: "/workspace/app"
    });
  });

  it("rejects docker locators without a path", () => {
    expect(() => parseLocator("docker://container-only")).toThrow(
      'Invalid docker workspace locator'
    );
  });

  it("parses reserved ssh and docker schemes for future support", () => {
    expect(parseLocator("ssh://git@example.com/worktree")).toEqual({
      scheme: "ssh",
      user: "git",
      host: "example.com",
      path: "/worktree"
    });

    expect(parseLocator("docker://dev-container/workspace")).toEqual({
      scheme: "docker",
      container: "dev-container",
      path: "/workspace"
    });
  });

  it("rejects unknown locator schemes", () => {
    expect(() => parseLocator("s3://bucket/repo")).toThrow('Unsupported workspace locator scheme "s3".');
  });
});

describe("assertPathHasNoSymbolicLinks", () => {
  it("does not treat inherited lstat error codes as missing local path segments", async () => {
    const fs = {
      lstat: vi.fn(async () => {
        throw new Error("workspace lstat denied");
      })
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(assertPathHasNoSymbolicLinks(fs, "/workspace/app")).rejects.toThrow(
        "workspace lstat denied"
      );
    });
  });
});

describe("resolveWorkspace", () => {
  it("resolves relative local paths against baseDir", async () => {
    const fs = createFs();
    await fs.mkdir("/workspace/apps/api", { recursive: true });

    await expect(resolveWorkspace("./apps/api", createOptions({ fs }))).resolves.toEqual({
      cwd: "/workspace/apps/api",
      locator: { scheme: "local", path: "./apps/api" }
    });
  });

  it("rejects local paths that do not exist", async () => {
    const fs = createFs();

    await expect(resolveWorkspace("./missing-dir", createOptions({ fs }))).rejects.toThrow(
      'Workspace path "/workspace/missing-dir" does not exist.'
    );
  });

  it("rejects local paths that are not directories", async () => {
    const fs = createFs();
    await fs.mkdir("/workspace", { recursive: true });
    await (fs as ResolverFileSystem & { writeFile(path: string, content: string): Promise<void> })
      .writeFile("/workspace/file.txt", "not a directory");

    await expect(resolveWorkspace("./file.txt", createOptions({ fs }))).rejects.toThrow(
      'Workspace path "/workspace/file.txt" is not a directory.'
    );
  });

  it("resolves github locators to the shared cache in read mode", async () => {
    const fs = createFs();
    const cachePath = buildCachePath("/home/test", {
      scheme: "github",
      owner: "poe-platform",
      repo: "poe-code"
    });
    await fs.mkdir(`${cachePath}/packages/process-runner`, { recursive: true });

    const result = await resolveWorkspace(
      "github://poe-platform/poe-code/packages/process-runner",
      createOptions({ fs })
    );

    expect(result.cwd).toBe(`${cachePath}/packages/process-runner`);
    expect(result.cleanup).toBeUndefined();
    expect(result.locator).toEqual({
      scheme: "github",
      owner: "poe-platform",
      repo: "poe-code",
      subdir: "packages/process-runner"
    });
  });

  it("creates isolated writable checkouts for edit mode", async () => {
    const fs = createFs();
    const cachePath = buildCachePath("/home/test", {
      scheme: "github",
      owner: "poe-platform",
      repo: "poe-code"
    });
    await fs.mkdir(`${cachePath}/packages/process-runner`, { recursive: true });

    const result = await resolveWorkspace(
      "github://poe-platform/poe-code#main:packages/process-runner",
      createOptions({
        fs,
        mode: "edit",
        exec: async (command, args) => {
          if (command === "git" && args[0] === "worktree" && args[1] === "add") {
            const checkoutPath = args[3];
            await fs.mkdir(`${checkoutPath}/packages/process-runner`, { recursive: true });
          }
          return { stdout: "", stderr: "", exitCode: 0 };
        }
      })
    );

    expect(result.cwd).toContain("/home/test/.poe-code/workspaces/checkouts/poe-platform-poe-code");
    expect(result.cwd.endsWith("/packages/process-runner")).toBe(true);
    expect(result.cleanup).toBeTypeOf("function");
  });

  it("creates isolated writable checkouts for auto mode", async () => {
    const fs = createFs();
    const cachePath = buildCachePath("/home/test", {
      scheme: "github",
      owner: "poe-platform",
      repo: "poe-code"
    });
    await fs.mkdir(`${cachePath}/packages/process-runner`, { recursive: true });

    const result = await resolveWorkspace(
      "github://poe-platform/poe-code#main:packages/process-runner",
      createOptions({
        fs,
        mode: "auto",
        exec: async (command, args) => {
          if (command === "git" && args[0] === "worktree" && args[1] === "add") {
            const checkoutPath = args[3];
            await fs.mkdir(`${checkoutPath}/packages/process-runner`, { recursive: true });
          }
          return { stdout: "", stderr: "", exitCode: 0 };
        }
      })
    );

    expect(result.cwd).toContain("/home/test/.poe-code/workspaces/checkouts/poe-platform-poe-code");
    expect(result.cleanup).toBeTypeOf("function");
  });

  it("uses direct cached access for yolo mode", async () => {
    const fs = createFs();
    const cachePath = buildCachePath("/home/test", { scheme: "github", owner: "owner", repo: "repo" });
    await fs.mkdir(cachePath, { recursive: true });
    const calls: string[][] = [];

    const result = await resolveWorkspace(
      "github://owner/repo",
      createOptions({ mode: "yolo", fs, exec: async (_command, args) => {
        calls.push(args);
        return { stdout: " M change", stderr: "", exitCode: 0 };
      } })
    );

    expect(result.cwd).toBe(cachePath);
    expect(result.cleanup).toBeUndefined();
    expect(calls.some((args) => args[0] === "worktree")).toBe(false);
  });

  it("isolates a read checkout when a ref is requested", async () => {
    const fs = createFs();
    const cachePath = buildCachePath("/home/test", { scheme: "github", owner: "owner", repo: "repo" });
    await fs.mkdir(cachePath, { recursive: true });
    const calls: string[][] = [];

    const result = await resolveWorkspace(
      "github://owner/repo#feature",
      createOptions({ fs, exec: async (_command, args) => {
        calls.push(args);
        if (args[0] === "worktree" && args[1] === "add") {
          await fs.mkdir(args[3], { recursive: true });
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      } })
    );

    expect(result.cwd).not.toBe(cachePath);
    expect(result.cleanup).toBeTypeOf("function");
    expect(calls).toContainEqual(["fetch", "origin", "--", "feature"]);
    expect(calls).toContainEqual(["worktree", "add", "--detach", expect.any(String), "FETCH_HEAD"]);
    expect(calls).not.toContainEqual(["checkout", "--", "feature"]);
  });

  it("cleans up isolated writable checkouts when subdir validation fails", async () => {
    const fs = createFs();
    const cachePath = buildCachePath("/home/test", {
      scheme: "github",
      owner: "poe-platform",
      repo: "poe-code"
    });
    await fs.mkdir(cachePath, { recursive: true });

    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];

    await expect(
      resolveWorkspace(
        "github://poe-platform/poe-code#main:packages/missing",
        createOptions({
          fs,
          mode: "edit",
          exec: async (command, args, execOptions) => {
            calls.push({ command, args, cwd: execOptions?.cwd });
            if (command === "git" && args[0] === "worktree" && args[1] === "add") {
              await fs.mkdir(args[3], { recursive: true });
            }
            return { stdout: "", stderr: "", exitCode: 0 };
          }
        })
      )
    ).rejects.toThrow(
      'Workspace subdirectory "packages/missing" does not exist in github://poe-platform/poe-code.'
    );

    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "git",
          args: ["fetch", "origin", "--", "main"],
          cwd: cachePath
        }),
        expect.objectContaining({
          command: "git",
          args: ["worktree", "add", "--detach", expect.any(String), "FETCH_HEAD"],
          cwd: cachePath
        }),
        expect.objectContaining({
          command: "git",
          args: [
            "worktree",
            "remove",
            "--force",
            expect.stringContaining(
              "/home/test/.poe-code/workspaces/checkouts/poe-platform-poe-code"
            )
          ],
          cwd: cachePath
        })
      ])
    );
  });

  it("rejects unsupported reserved schemes at resolution time", async () => {
    await expect(resolveWorkspace("ssh://git@example.com/worktree", createOptions())).rejects.toThrow(
      'Unsupported workspace locator scheme "ssh".'
    );
    await expect(resolveWorkspace("docker://container/workspace", createOptions())).rejects.toThrow(
      'Unsupported workspace locator scheme "docker".'
    );
  });

  it("resolves absolute local paths directly without baseDir", async () => {
    const fs = createFs();
    await fs.mkdir("/tmp/absolute", { recursive: true });

    await expect(resolveWorkspace("/tmp/absolute", createOptions({ fs }))).resolves.toEqual({
      cwd: "/tmp/absolute",
      locator: { scheme: "local", path: "/tmp/absolute" }
    });
  });

  it("resolves dot as the baseDir itself", async () => {
    const fs = createFs();
    await fs.mkdir("/workspace", { recursive: true });

    await expect(resolveWorkspace(".", createOptions({ baseDir: "/workspace", fs }))).resolves.toEqual({
      cwd: "/workspace",
      locator: { scheme: "local", path: "." }
    });
  });

  it("rejects github locators with a non-existent subdir in read mode", async () => {
    const fs = createFs();
    const cachePath = buildCachePath("/home/test", {
      scheme: "github",
      owner: "owner",
      repo: "repo"
    });
    await fs.mkdir(cachePath, { recursive: true });

    await expect(
      resolveWorkspace("github://owner/repo#main:missing/dir", createOptions({ fs }))
    ).rejects.toThrow(
      'Workspace subdirectory "missing/dir" does not exist in github://owner/repo.'
    );
  });

  it("rejects a github subdirectory that is a regular file", async () => {
    const fs = createFs();
    const cachePath = buildCachePath("/home/test", { scheme: "github", owner: "owner", repo: "repo" });
    await fs.mkdir(cachePath, { recursive: true });
    const regularFileFs: ResolverFileSystem = {
      ...fs,
      stat: async (target) => target.endsWith("README.md")
        ? { isDirectory: () => false }
        : fs.stat(target)
    };

    await expect(
      resolveWorkspace("github://owner/repo/README.md", createOptions({ fs: regularFileFs }))
    ).rejects.toThrow('Workspace subdirectory "README.md" is not a directory');
  });

  it("rejects a github subdirectory that is a symlink", async () => {
    const fs = createFs();
    const cachePath = buildCachePath("/home/test", { scheme: "github", owner: "owner", repo: "repo" });
    await fs.mkdir(cachePath, { recursive: true });
    await fs.mkdir("/outside", { recursive: true });
    await (fs as ResolverFileSystem & { symlink(target: string, path: string): Promise<void> }).symlink(
      "/outside",
      `${cachePath}/safe-subdir`
    );

    await expect(
      resolveWorkspace("github://owner/repo/safe-subdir", createOptions({ fs }))
    ).rejects.toThrow('Workspace subdirectory "safe-subdir" must not be a symbolic link.');
  });

  it("does not treat inherited github subdir lstat codes as missing paths", async () => {
    const fs = createFs();
    const cachePath = buildCachePath("/home/test", { scheme: "github", owner: "owner", repo: "repo" });
    await fs.mkdir(`${cachePath}/safe-subdir`, { recursive: true });
    const wrappedFs: ResolverFileSystem = {
      ...fs,
      lstat: vi.fn(async (target) => {
        if (String(target) === `${cachePath}/safe-subdir`) {
          throw new Error("github subdir lstat denied");
        }

        return fs.lstat(target);
      })
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(
        resolveWorkspace("github://owner/repo/safe-subdir", createOptions({ fs: wrappedFs }))
      ).rejects.toThrow("github subdir lstat denied");
    });
  });

  it("resolves github locators without ref or subdir", async () => {
    const fs = createFs();
    const cachePath = buildCachePath("/home/test", {
      scheme: "github",
      owner: "owner",
      repo: "repo"
    });
    await fs.mkdir(cachePath, { recursive: true });

    const result = await resolveWorkspace("github://owner/repo", createOptions({ fs }));

    expect(result.cwd).toBe(cachePath);
    expect(result.cleanup).toBeUndefined();
    expect(result.locator).toEqual({
      scheme: "github",
      owner: "owner",
      repo: "repo"
    });
  });

  it("runs git clone for a fresh github locator", async () => {
    const fs = createFs();
    const calls: Array<{ command: string; args: string[] }> = [];

    const cachePath = buildCachePath("/home/test", {
      scheme: "github",
      owner: "poe-platform",
      repo: "poe-code"
    });

    const result = await resolveWorkspace(
      "github://poe-platform/poe-code",
      createOptions({
        fs,
        exec: async (command, args) => {
          calls.push({ command, args });
          if (args[0] === "clone") {
            await fs.mkdir(cachePath, { recursive: true });
          }
          return { stdout: "", stderr: "", exitCode: 0 };
        }
      })
    );

    expect(result.cwd).toBe(cachePath);
    expect(calls[0]).toEqual({
      command: "git",
      args: ["clone", "--depth", "1", "https://github.com/poe-platform/poe-code.git", cachePath]
    });
  });

  it("runs git pull for an existing clean cache", async () => {
    const fs = createFs();
    const cachePath = buildCachePath("/home/test", {
      scheme: "github",
      owner: "owner",
      repo: "repo"
    });
    await fs.mkdir(cachePath, { recursive: true });

    const calls: Array<{ command: string; args: string[] }> = [];

    await resolveWorkspace(
      "github://owner/repo",
      createOptions({
        fs,
        exec: async (command, args) => {
          calls.push({ command, args });
          return { stdout: "", stderr: "", exitCode: 0 };
        }
      })
    );

    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: "git", args: ["pull", "--ff-only"] })
      ])
    );
  });

  it("creates an isolated checkout for a read-mode ref", async () => {
    const fs = createFs();
    const cachePath = buildCachePath("/home/test", {
      scheme: "github",
      owner: "owner",
      repo: "repo"
    });
    await fs.mkdir(cachePath, { recursive: true });

    const calls: Array<{ command: string; args: string[] }> = [];

    await resolveWorkspace(
      "github://owner/repo#v2.0.0",
      createOptions({
        fs,
        exec: async (command, args) => {
          calls.push({ command, args });
          return { stdout: "", stderr: "", exitCode: 0 };
        }
      })
    );

    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "git",
          args: ["fetch", "origin", "--", "v2.0.0"]
        }),
        expect.objectContaining({
          command: "git",
          args: ["worktree", "add", "--detach", expect.any(String), "FETCH_HEAD"]
        })
      ])
    );
    expect(calls.some((call) => call.args[0] === "checkout")).toBe(false);
  });

  it("does not fetch or checkout when no ref is specified", async () => {
    const fs = createFs();
    const cachePath = buildCachePath("/home/test", {
      scheme: "github",
      owner: "owner",
      repo: "repo"
    });
    await fs.mkdir(cachePath, { recursive: true });

    const calls: Array<{ command: string; args: string[] }> = [];

    await resolveWorkspace(
      "github://owner/repo",
      createOptions({
        fs,
        exec: async (command, args) => {
          calls.push({ command, args });
          return { stdout: "", stderr: "", exitCode: 0 };
        }
      })
    );

    const fetchCalls = calls.filter(c => c.args[0] === "fetch");
    const checkoutCalls = calls.filter(c => c.args[0] === "checkout");
    expect(fetchCalls).toHaveLength(0);
    expect(checkoutCalls).toHaveLength(0);
  });

  it("skips pull when worktree is dirty", async () => {
    const fs = createFs();
    const cachePath = buildCachePath("/home/test", {
      scheme: "github",
      owner: "owner",
      repo: "repo"
    });
    await fs.mkdir(cachePath, { recursive: true });

    const calls: Array<{ command: string; args: string[] }> = [];

    await resolveWorkspace(
      "github://owner/repo",
      createOptions({
        fs,
        exec: async (command, args) => {
          calls.push({ command, args });
          if (args[0] === "status") {
            return { stdout: " M dirty-file.ts\n", stderr: "", exitCode: 0 };
          }
          return { stdout: "", stderr: "", exitCode: 0 };
        }
      })
    );

    const pullCalls = calls.filter(c => c.args[0] === "pull");
    expect(pullCalls).toHaveLength(0);
  });

  it("throws when git clone fails", async () => {
    const fs = createFs();

    await expect(
      resolveWorkspace(
        "github://owner/private-repo",
        createOptions({
          fs,
          exec: async () => ({
            stdout: "",
            stderr: "fatal: repository not found",
            exitCode: 128
          })
        })
      )
    ).rejects.toThrow("fatal: repository not found");
  });
});
