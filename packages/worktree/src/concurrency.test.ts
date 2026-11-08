import { createFsFromVolume, Volume } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
import * as api from "./index.js";
import { addWorktreeEntry, removeWorktreeEntry, writeRegistry } from "./registry.js";
import type { ExecFn, Worktree, WorktreeFileSystem } from "./types.js";

const REGISTRY = "/repo/.poe-code/worktrees.yaml";
const WORKTREES = "/repo/.poe-code/worktrees";

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function gate() {
  const entered = signal();
  const released = signal();
  return {
    entered: entered.promise,
    release: released.resolve,
    wait: async () => {
      entered.resolve();
      await released.promise;
    }
  };
}

function entry(name: string): Worktree {
  return {
    name, path: `${WORKTREES}/${name}`, branch: `poe-code/${name}`,
    baseBranch: "main", createdAt: "2026-08-26T00:00:00.000Z",
    source: "test", agent: "test", status: "active"
  };
}

function fixture(names: string[] = []) {
  const volume = Volume.fromJSON({
    [REGISTRY]: stringify({ worktrees: names.map(entry) })
  });
  const base = createFsFromVolume(volume).promises;
  const contended = signal();
  const checkouts = new Set(names);
  const exec = vi.fn<ExecFn>(async (command) => {
    for (const name of ["alpha", "beta"]) {
      if (command.startsWith(`git worktree remove '${WORKTREES}/${name}'`)) {
        checkouts.delete(name);
      }
      if (command.startsWith(`git worktree add -b 'poe-code/${name}'`)) {
        checkouts.add(name);
      }
    }
    return { stdout: command === "git rev-parse --is-inside-work-tree" ? "true\n" : "", stderr: "" };
  });
  function wrapper(): WorktreeFileSystem {
    return {
      ...base,
      mkdir: async (path, options) => {
        try {
          await base.mkdir(path, options);
        } catch (error) {
          if (path === `${REGISTRY}.lock` && (error as NodeJS.ErrnoException).code === "EEXIST") {
            contended.resolve();
          }
          throw error;
        }
      }
    } as WorktreeFileSystem;
  }
  const createOptions = (name: string, fs = wrapper(), run = exec) => ({
    cwd: "/repo", name, baseBranch: "main", source: "test", agent: "test",
    registryFile: REGISTRY, worktreeDir: WORKTREES, deps: { fs, exec: run }
  });
  const removeOptions = (name: string, fs = wrapper(), run = exec) => ({
    cwd: "/repo", name, registryFile: REGISTRY, deps: { fs, exec: run }
  });
  async function overlap<T>(held: ReturnType<typeof gate>, startSecond: () => Promise<T>) {
    await held.entered;
    const second = startSecond();
    try {
      await Promise.race([second.then(() => undefined, () => undefined), contended.promise]);
    } finally {
      held.release();
    }
    return second;
  }
  return { base, volume, wrapper, exec, checkouts, createOptions, removeOptions, overlap };
}

describe("registry lifecycle concurrency", () => {
  it("preserves overlapping creates across separately loaded APIs and fs wrappers", async () => {
    const setup = fixture();
    const held = gate();
    const firstExec = vi.fn<ExecFn>(async (command, options) => {
      if (command.startsWith("git worktree add")) await held.wait();
      return setup.exec(command, options);
    });
    vi.resetModules();
    const independentApi = await import("./index.js");
    const first = api.createWorktree(setup.createOptions("alpha", setup.wrapper(), firstExec));
    await setup.overlap(held, () => independentApi.createWorktree(setup.createOptions("beta")));
    await first;
    expect((await api.readRegistry(REGISTRY, setup.wrapper())).worktrees.map(({ name }) => name).sort())
      .toEqual(["alpha", "beta"]);
  });

  it.each(["alpha", "beta"])("preserves status and reconciliation updates on %s", async (updatedName) => {
    const setup = fixture(["alpha", "beta"]);
    const held = gate();
    const fs = setup.wrapper();
    const readFile = fs.readFile;
    fs.readFile = async (path, encoding) => {
      const content = await readFile(path, encoding);
      if (path === REGISTRY) await held.wait();
      return content;
    };
    const first = api.updateWorktreeStatus(REGISTRY, "alpha", "done", { fs });
    const reconciliation: Worktree["reconciliation"] = {
      committed: "present", uncommitted: "none", removed: false,
      cleanup: "not_needed", conflictFiles: [], threadId: "thread"
    };
    await setup.overlap(held, () => api.updateWorktreeEntry(REGISTRY, updatedName, (current) => ({
      ...current, reconciledAt: "2026-08-26T01:00:00.000Z", reconciliation
    }), { fs: setup.wrapper() }));
    await first;
    const { worktrees } = await api.readRegistry(REGISTRY, setup.wrapper());
    expect(worktrees.find(({ name }) => name === "alpha")?.status).toBe("done");
    expect(worktrees.find(({ name }) => name === updatedName)).toMatchObject({
      reconciledAt: "2026-08-26T01:00:00.000Z", reconciliation
    });
  });

  it.each(["add", "remove"])("serializes overlapping %s helpers", async (operation) => {
    const setup = fixture(operation === "remove" ? ["alpha", "beta"] : []);
    const held = gate();
    const fs = setup.wrapper();
    const readFile = fs.readFile;
    fs.readFile = async (path, encoding) => {
      const content = await readFile(path, encoding);
      if (path === REGISTRY) await held.wait();
      return content;
    };
    const mutate = (name: string, target: WorktreeFileSystem) => operation === "add"
      ? addWorktreeEntry(REGISTRY, entry(name), target)
      : removeWorktreeEntry(REGISTRY, name, target);
    const first = mutate("alpha", fs);
    await setup.overlap(held, () => mutate("beta", setup.wrapper()));
    await first;
    expect((await api.readRegistry(REGISTRY, setup.wrapper())).worktrees.map(({ name }) => name).sort())
      .toEqual(operation === "add" ? ["alpha", "beta"] : []);
  });

  it("does not restore an entry removed during another create", async () => {
    const setup = fixture(["beta"]);
    const held = gate();
    const firstExec = vi.fn<ExecFn>(async (command, options) => {
      if (command.startsWith("git worktree add")) await held.wait();
      return setup.exec(command, options);
    });
    const first = api.createWorktree(setup.createOptions("alpha", setup.wrapper(), firstExec));
    await setup.overlap(held, () => api.removeWorktree(setup.removeOptions("beta")));
    await first;
    expect((await api.readRegistry(REGISTRY, setup.wrapper())).worktrees.map(({ name }) => name))
      .toEqual(["alpha"]);
  });

  it("does not resurrect simultaneous removals", async () => {
    const setup = fixture(["alpha", "beta"]);
    const held = gate();
    const fs = setup.wrapper();
    const readFile = fs.readFile;
    let reads = 0;
    fs.readFile = async (path, encoding) => {
      const content = await readFile(path, encoding);
      if (path === REGISTRY && ++reads === 1) await held.wait();
      return content;
    };
    const first = api.removeWorktree(setup.removeOptions("alpha", fs));
    await setup.overlap(held, () => api.removeWorktree(setup.removeOptions("beta")));
    await first;
    expect((await api.readRegistry(REGISTRY, setup.wrapper())).worktrees).toEqual([]);
  });

  it.each(["git", "registry"])("keeps successful entries through create %s compensation", async (failure) => {
    const setup = fixture(["alpha"]);
    const held = gate();
    const fs = setup.wrapper();
    const rename = fs.rename;
    fs.rename = async (source, destination) => {
      const registry = parse(await fs.readFile(source, "utf8"));
      if (failure === "registry" && registry.worktrees.some((worktree: Worktree) => worktree.name === "alpha" && worktree.status === "active")) {
        throw new Error("registry failure");
      }
      await rename(source, destination);
    };
    const firstExec = vi.fn<ExecFn>(async (command, options) => {
      if (command.startsWith("git worktree add")) {
        await held.wait();
        if (failure === "git") throw new Error("git failure");
      }
      return setup.exec(command, options);
    });
    const first = api.createWorktree(setup.createOptions("alpha", fs, firstExec)).catch((error: unknown) => error);
    await setup.overlap(held, () => api.createWorktree(setup.createOptions("beta")));
    expect(await first).toEqual(new Error(`${failure} failure`));
    const { worktrees } = await api.readRegistry(REGISTRY, setup.wrapper());
    expect(worktrees.find(({ name }) => name === "alpha")?.status).toBe("failed");
    expect(worktrees.find(({ name }) => name === "beta")?.status).toBe("active");
  });

  it("keeps successful creates through remove compensation", async () => {
    const setup = fixture(["alpha"]);
    const held = gate();
    const firstExec = vi.fn<ExecFn>(async () => {
      await held.wait();
      throw new Error("remove failure");
    });
    const first = api.removeWorktree(setup.removeOptions("alpha", setup.wrapper(), firstExec)).catch((error: unknown) => error);
    await setup.overlap(held, () => api.createWorktree(setup.createOptions("beta")));
    expect(await first).toEqual(new Error("remove failure"));
    expect((await api.readRegistry(REGISTRY, setup.wrapper())).worktrees.map(({ name, status }) => ({ name, status })))
      .toEqual([{ name: "alpha", status: "active" }, { name: "beta", status: "active" }]);
  });

  it("finishes same-name rollback before the next creator owns the checkout", async () => {
    const setup = fixture();
    const held = gate();
    const fs = setup.wrapper();
    fs.rename = async () => { throw new Error("registry failure"); };
    const firstExec = vi.fn<ExecFn>(async (command, options) => {
      if (command.startsWith("git worktree add")) {
        await setup.exec(command, options);
        await held.wait();
        return { stdout: "", stderr: "" };
      }
      return setup.exec(command, options);
    });
    const first = api.createWorktree(setup.createOptions("alpha", fs, firstExec)).catch((error: unknown) => error);
    await setup.overlap(held, () => api.createWorktree({ ...setup.createOptions("alpha"), source: "second" }));
    expect(await first).toEqual(new Error("registry failure"));
    expect(setup.checkouts.has("alpha")).toBe(true);
    expect((await api.readRegistry(REGISTRY, setup.wrapper())).worktrees).toMatchObject([{ name: "alpha", source: "second" }]);
  });

  it("serializes same-name create/remove rather than reporting a missing in-flight create", async () => {
    const setup = fixture();
    const held = gate();
    const firstExec = vi.fn<ExecFn>(async (command, options) => {
      if (command.startsWith("git worktree add")) await held.wait();
      return setup.exec(command, options);
    });
    const first = api.createWorktree(setup.createOptions("alpha", setup.wrapper(), firstExec));
    const second = await setup.overlap(held, () => api.removeWorktree(setup.removeOptions("alpha"))
      .then(() => "removed", (error: unknown) => error));
    await first;
    expect(second).toBe("removed");
    expect((await api.readRegistry(REGISTRY, setup.wrapper())).worktrees).toEqual([]);
    expect(setup.checkouts.has("alpha")).toBe(false);
  });

  it("coordinates direct registry replacement with field mutators", async () => {
    const setup = fixture(["alpha"]);
    const held = gate();
    const fs = setup.wrapper();
    const rename = fs.rename;
    fs.rename = async (source, destination) => {
      await held.wait();
      await rename(source, destination);
    };
    const first = writeRegistry(REGISTRY, { worktrees: [entry("alpha"), entry("beta")] }, fs);
    await setup.overlap(held, () => api.updateWorktreeStatus(REGISTRY, "alpha", "done", { fs: setup.wrapper() }));
    await first;
    expect((await api.readRegistry(REGISTRY, setup.wrapper())).worktrees).toMatchObject([
      { name: "alpha", status: "done" }, { name: "beta", status: "active" }
    ]);
  });
});

describe("registry lock safety", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("holds a filesystem owner marker until the transaction finishes", async () => {
    const setup = fixture(["alpha"]);
    const held = gate();
    const fs = setup.wrapper();
    const readFile = fs.readFile;
    fs.readFile = async (path, encoding) => {
      if (path === REGISTRY) await held.wait();
      return readFile(path, encoding);
    };
    const operation = api.updateWorktreeStatus(REGISTRY, "alpha", "done", { fs });
    await held.entered;
    let owners: unknown;
    try {
      owners = await setup.base.readdir(`${REGISTRY}.lock`);
    } catch (error) {
      owners = error;
    } finally {
      held.release();
    }
    await operation;
    expect(owners).toHaveLength(1);
    await expect(setup.base.lstat(`${REGISTRY}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["empty", "abandoned", "live"])("never steals a contended %s lock", async (owner) => {
    const setup = fixture(["alpha"]);
    await setup.base.mkdir(`${REGISTRY}.lock`);
    if (owner !== "empty") await setup.base.mkdir(`${REGISTRY}.lock/${owner}`);
    const original = setup.volume.toJSON();
    let time = 0;
    vi.spyOn(Date, "now").mockImplementation(() => { time += 60_000; return time; });
    await expect(api.removeWorktree(setup.removeOptions("alpha"))).rejects.toThrow("lock");
    expect(setup.exec).not.toHaveBeenCalled();
    expect(setup.volume.toJSON()).toEqual(original);
  });

  it.each(["empty", "marked"])("does not remove a replaced owner's %s lock during release", async (replacement) => {
    const setup = fixture(["alpha"]);
    const fs = setup.wrapper();
    const rename = fs.rename;
    fs.rename = async (source, destination) => {
      await rename(source, destination);
      const owners = await setup.base.readdir(`${REGISTRY}.lock`);
      for (const owner of owners) await setup.base.rmdir(`${REGISTRY}.lock/${owner}`);
      await setup.base.rmdir(`${REGISTRY}.lock`);
      await setup.base.mkdir(`${REGISTRY}.lock`);
      if (replacement === "marked") await setup.base.mkdir(`${REGISTRY}.lock/replacement-owner`);
    };
    await expect(api.updateWorktreeStatus(REGISTRY, "alpha", "done", { fs })).rejects.toThrow();
    expect(await setup.base.readdir(`${REGISTRY}.lock`)).toEqual(replacement === "marked" ? ["replacement-owner"] : []);
  });

  it("does not remove unexpected files placed in the lock directory", async () => {
    const setup = fixture(["alpha"]);
    const fs = setup.wrapper();
    const rename = fs.rename;
    fs.rename = async (source, destination) => {
      await rename(source, destination);
      await setup.base.writeFile(`${REGISTRY}.lock/keep`, "user data");
    };
    await expect(api.updateWorktreeStatus(REGISTRY, "alpha", "done", { fs })).rejects.toThrow();
    expect(await setup.base.readFile(`${REGISTRY}.lock/keep`, "utf8")).toBe("user data");
  });

  it("releases a lock when creating its owner marker fails", async () => {
    const setup = fixture(["alpha"]);
    const fs = setup.wrapper();
    const mkdir = fs.mkdir;
    fs.mkdir = async (path, options) => {
      if (path.startsWith(`${REGISTRY}.lock/`)) throw new Error("owner marker failure");
      await mkdir(path, options);
    };
    await expect(api.updateWorktreeStatus(REGISTRY, "alpha", "done", { fs })).rejects.toThrow("owner marker failure");
    await expect(setup.base.lstat(`${REGISTRY}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
    await api.updateWorktreeStatus(REGISTRY, "alpha", "done", { fs: setup.wrapper() });
  });

  it("waits while the owner is still initializing an empty lock", async () => {
    const setup = fixture(["alpha", "beta"]);
    const held = gate();
    const fs = setup.wrapper();
    const mkdir = fs.mkdir;
    fs.mkdir = async (path, options) => {
      if (path.startsWith(`${REGISTRY}.lock/`)) await held.wait();
      await mkdir(path, options);
    };
    const first = api.updateWorktreeStatus(REGISTRY, "alpha", "done", { fs });
    await setup.overlap(held, () => api.updateWorktreeStatus(REGISTRY, "beta", "failed", { fs: setup.wrapper() }));
    await first;
    expect((await api.readRegistry(REGISTRY, setup.wrapper())).worktrees).toMatchObject([
      { name: "alpha", status: "done" }, { name: "beta", status: "failed" }
    ]);
    await expect(setup.base.lstat(`${REGISTRY}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("makes simultaneous abandoned-lock contenders fail without removing the owner", async () => {
    const setup = fixture(["alpha", "beta"]);
    await setup.base.mkdir(`${REGISTRY}.lock`);
    await setup.base.mkdir(`${REGISTRY}.lock/abandoned`);
    const original = setup.volume.toJSON();
    let time = 0;
    vi.spyOn(Date, "now").mockImplementation(() => { time += 60_000; return time; });
    vi.resetModules();
    const independentApi = await import("./index.js");
    const results = await Promise.allSettled([
      api.removeWorktree(setup.removeOptions("alpha")),
      independentApi.removeWorktree(setup.removeOptions("beta"))
    ]);
    expect(results).toMatchObject([{ status: "rejected" }, { status: "rejected" }]);
    expect(setup.exec).not.toHaveBeenCalled();
    expect(setup.volume.toJSON()).toEqual(original);
  });

  it("coordinates normalized path aliases without a shared wrapper", async () => {
    const setup = fixture(["alpha", "beta"]);
    const held = gate();
    const fs = setup.wrapper();
    const readFile = fs.readFile;
    fs.readFile = async (path, encoding) => {
      const content = await readFile(path, encoding);
      if (path === REGISTRY) await held.wait();
      return content;
    };
    const first = api.updateWorktreeStatus(REGISTRY, "alpha", "done", { fs });
    await setup.overlap(held, () => api.updateWorktreeStatus(
      "/repo/.poe-code/./worktrees.yaml", "beta", "failed", { fs: setup.wrapper() }
    ));
    await first;
    expect((await api.readRegistry(REGISTRY, setup.wrapper())).worktrees).toMatchObject([
      { name: "alpha", status: "done" }, { name: "beta", status: "failed" }
    ]);
  });

  it("preserves operation and cleanup errors and leaves an unreleasable lock closed", async () => {
    const setup = fixture(["alpha"]);
    const fs = setup.wrapper();
    const rmdir = fs.rmdir;
    fs.rmdir = async (path) => {
      if (path === `${REGISTRY}.lock`) throw new Error("release denied");
      await rmdir(path);
    };
    const result = await api.updateWorktreeEntry(REGISTRY, "alpha", () => {
      throw new Error("callback failure");
    }, { fs }).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(AggregateError);
    expect((result as AggregateError).errors).toEqual([new Error("callback failure"), new Error("release denied")]);
    expect(await setup.base.readdir(`${REGISTRY}.lock`)).toEqual([]);
    let time = 0;
    vi.spyOn(Date, "now").mockImplementation(() => { time += 60_000; return time; });
    await expect(api.removeWorktree(setup.removeOptions("alpha"))).rejects.toThrow("lock");
    expect(setup.exec).not.toHaveBeenCalled();
  });

  it("does not treat acquisition permission errors as contention", async () => {
    const setup = fixture(["alpha"]);
    const fs = setup.wrapper();
    const mkdir = fs.mkdir;
    fs.mkdir = async (path, options) => {
      if (path === `${REGISTRY}.lock`) throw Object.assign(new Error("lock denied"), { code: "EACCES" });
      await mkdir(path, options);
    };
    await expect(api.removeWorktree(setup.removeOptions("alpha", fs))).rejects.toThrow("lock denied");
    expect(setup.exec).not.toHaveBeenCalled();
    await expect(setup.base.lstat(`${REGISTRY}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["read", "callback", "write"])("releases ownership after a %s failure", async (failure) => {
    const setup = fixture(["alpha"]);
    const fs = setup.wrapper();
    if (failure === "read") fs.readFile = async () => { throw new Error("read failure"); };
    if (failure === "write") fs.rename = async () => { throw new Error("write failure"); };
    await expect(api.updateWorktreeEntry(REGISTRY, "alpha", (current) => {
      if (failure === "callback") throw new Error("callback failure");
      return { ...current, status: "done" };
    }, { fs })).rejects.toThrow(`${failure} failure`);
    await expect(setup.base.lstat(`${REGISTRY}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
    await api.updateWorktreeStatus(REGISTRY, "alpha", "done", { fs: setup.wrapper() });
    expect(await setup.base.readdir("/repo/.poe-code")).toEqual(["worktrees.yaml"]);
  });

  it.each(["lock", "registry", "parent"])("rejects a symlinked %s before Git or mutation", async (target) => {
    const setup = fixture(["alpha"]);
    await setup.base.mkdir("/outside");
    await setup.base.writeFile("/outside/keep", "user data");
    if (target === "lock") await setup.base.symlink("/outside", `${REGISTRY}.lock`);
    if (target === "registry") {
      await setup.base.unlink(REGISTRY);
      await setup.base.symlink("/outside/keep", REGISTRY);
    }
    if (target === "parent") {
      await setup.base.rename("/repo/.poe-code", "/repo/original");
      await setup.base.symlink("/outside", "/repo/.poe-code");
    }
    const original = setup.volume.toJSON();
    await expect(api.createWorktree(setup.createOptions("alpha"))).rejects.toThrow("symbolic link");
    expect(setup.exec).not.toHaveBeenCalled();
    expect(setup.volume.toJSON()).toEqual(original);
    expect(await setup.base.readFile("/outside/keep", "utf8")).toBe("user data");
  });
});
