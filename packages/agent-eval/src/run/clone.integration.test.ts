import { fs, vol } from "memfs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { simpleGit } from "simple-git";

const mocks = vi.hoisted(() => ({ clone: vi.fn(), raw: vi.fn(), revparse: vi.fn() }));
vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("simple-git", () => ({ simpleGit: vi.fn(() => mocks) }));
const { cloneTarget } = await import("./clone.js");

beforeEach(() => {
  vol.reset();
  vi.mocked(simpleGit).mockClear();
  mocks.clone.mockReset().mockImplementation(async (_repo: string, destination: string) => {
    await fs.promises.mkdir(destination, { recursive: true });
  });
  mocks.raw.mockReset().mockImplementation(async (args: string[]) => {
    if (args[0] === "worktree" && args[1] === "add") {
      await fs.promises.mkdir(args[3]!, { recursive: true });
    }
  });
  mocks.revparse.mockReset().mockResolvedValue("initial-sha\n");
});

const input = { repo: "fixture", ref: "main", dest: "/runs/first", cacheDir: "/cache" };

describe("cloneTarget filesystem and Git integration", () => {
  it("clones a ref and returns the resolved HEAD sha", async () => {
    await expect(cloneTarget({ repo: input.repo, ref: input.ref, dest: input.dest })).resolves.toEqual({ resolvedSha: "initial-sha" });
    expect(mocks.clone).toHaveBeenCalledWith("fixture", input.dest, ["--depth", "1", "--branch", "main"]);
    expect(mocks.revparse).toHaveBeenCalledWith(["HEAD"]);
    expect(vi.mocked(simpleGit)).toHaveBeenLastCalledWith(input.dest, { abort: undefined });
    await expect(fs.promises.access(input.dest)).resolves.toBeUndefined();
  });

  it("reuses a cached bare repo for a new worktree destination", async () => {
    await cloneTarget(input);
    const cached = path.join(input.cacheDir, (await fs.promises.readdir(input.cacheDir))[0]!);
    expect(mocks.clone).toHaveBeenCalledWith("fixture", cached, ["--bare"]);
    mocks.raw.mockClear();
    await expect(cloneTarget({ ...input, dest: "/runs/second" })).resolves.toEqual({ resolvedSha: "initial-sha" });
    expect(mocks.clone).toHaveBeenCalledTimes(1);
    expect(await fs.promises.readdir(input.cacheDir)).toHaveLength(1);
    expect(mocks.raw.mock.calls).toEqual([
      [["fetch", "origin", "--prune", "+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*"]],
      [["worktree", "prune"]],
      [["worktree", "add", "--detach", "/runs/second", "main"]],
    ]);
    expect(vi.mocked(simpleGit).mock.calls.slice(-3).map(call => call[0])).toEqual([cached, cached, "/runs/second"]);
  });

  it("reuses a cached bare repo after its worktree destination is deleted", async () => {
    await cloneTarget(input);
    await fs.promises.rm(input.dest, { recursive: true });
    mocks.raw.mockClear();
    await expect(cloneTarget(input)).resolves.toEqual({ resolvedSha: "initial-sha" });
    expect(mocks.clone).toHaveBeenCalledTimes(1);
    expect(await fs.promises.readdir(input.cacheDir)).toHaveLength(1);
    expect(mocks.raw.mock.calls.slice(-2)).toEqual([
      [["worktree", "prune"]], [["worktree", "add", "--detach", input.dest, "main"]],
    ]);
    await expect(fs.promises.access(input.dest)).resolves.toBeUndefined();
  });

  it("fetches cached bare repos before resolving later worktrees", async () => {
    await cloneTarget(input);
    mocks.revparse.mockResolvedValue("updated-sha\n");
    mocks.raw.mockClear();
    await expect(cloneTarget({ ...input, dest: "/runs/updated" })).resolves.toEqual({ resolvedSha: "updated-sha" });
    expect(mocks.raw.mock.calls[0]).toEqual([["fetch", "origin", "--prune", "+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*"]]);
    expect(mocks.raw.mock.invocationCallOrder.at(-1)!).toBeLessThan(mocks.revparse.mock.invocationCallOrder.at(-1)!);
    expect(mocks.clone).toHaveBeenCalledTimes(1);
  });

  it("cleans up the destination when an in-flight clone is aborted", async () => {
    const controller = new AbortController();
    const failure = new Error("clone aborted");
    mocks.clone.mockImplementationOnce(async (_repo: string, destination: string) => {
      await fs.promises.mkdir(destination, { recursive: true });
      controller.abort(failure);
      throw failure;
    });
    await expect(cloneTarget({ repo: input.repo, ref: input.ref, dest: input.dest, signal: controller.signal })).rejects.toBe(failure);
    expect(vi.mocked(simpleGit)).toHaveBeenCalledWith(process.cwd(), { abort: controller.signal });
    await expect(fs.promises.access(input.dest)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
