import { spawn, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { buildWorkspaces, createWorkspaceBuildPlan, matchesWorkspaceRange, readManifest } from "./build-workspaces.mjs";

type Manifest = Record<string, unknown>;
type Fixture = { root: string; write: (name: string, manifest: Manifest) => void; remove: () => void };
const runnerFilename = fileURLToPath(new URL("./build-workspaces.mjs", import.meta.url));
const primaryValues = [undefined, null, false, 0, -0, "", NaN, new Error("primary")];

function writeJson(filename: string, value: unknown): void {
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(manifests: Record<string, Manifest> = {
  alpha: { name: "alpha", version: "1.0.0", scripts: { build: "node owned.cjs" }, dependencies: { beta: "*" } },
  beta: { name: "beta", version: "1.0.0", scripts: { build: "node owned.cjs" } }
}): Fixture {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), "workspace-build-owned-")));
  fs.mkdirSync(path.join(root, "packages"));
  writeJson(path.join(root, "package.json"), { name: "owned-root", private: true, workspaces: ["packages/*"] });
  writeJson(path.join(root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"], outputs: ["dist/**"] } } });
  const write = (name: string, manifest: Manifest) => {
    const directory = path.join(root, "packages", name);
    fs.mkdirSync(directory, { recursive: true });
    writeJson(path.join(directory, "package.json"), manifest);
  };
  for (const [name, manifest] of Object.entries(manifests)) write(name, manifest);
  return { root, write, remove: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function mockHost() {
  return Object.assign(new EventEmitter(), {
    platform: process.platform,
    execPath: process.execPath,
    kill: vi.fn((_pid: number, signal: NodeJS.Signals | number) => {
      if (signal === 0) throw Object.assign(new Error("absent"), { code: "ESRCH" });
      return true;
    })
  }) as unknown as NodeJS.Process;
}

function mockExecution(code = 0) {
  const host = mockHost();
  const children: Array<EventEmitter & { pid: number }> = [];
  const start = vi.fn((_command: string, _args: readonly string[], _options: SpawnOptions) => {
    const child = Object.assign(new EventEmitter(), { pid: 9000 + children.length });
    children.push(child);
    queueMicrotask(() => child.emit("close", code, null));
    return child as unknown as ReturnType<typeof spawn>;
  });
  return { host, children, start, spawn: start as unknown as typeof spawn, environment: { npm_execpath: "/owned/npm/bin/npm-cli.js", CUSTOM: "preserved" } };
}

describe("workspace graph admission", () => {
  it("plans dependency-first and includes newly declared packages dynamically", () => {
    const owned = fixture();
    try {
      expect(createWorkspaceBuildPlan(owned.root).stages.map(workspace => workspace.name)).toEqual(["beta", "alpha"]);
      owned.write("gamma", { name: "gamma", scripts: { build: "node owned.cjs" }, optionalDependencies: { alpha: "*" }, devDependencies: { beta: "*" } });
      const plan = createWorkspaceBuildPlan(owned.root);
      expect(plan.stages.map(workspace => workspace.name)).toEqual(["beta", "alpha", "gamma"]);
      expect(plan.edges).toEqual([{ from: "alpha", to: "beta" }, { from: "gamma", to: "beta" }, { from: "gamma", to: "alpha" }]);
      expect(plan.layers).toHaveLength(3);
    } finally { owned.remove(); }
  });

  it("retains build dependencies through a buildless workspace without claiming a pass", () => {
    const owned = fixture({
      alpha: { name: "alpha", scripts: { build: "node owned.cjs" }, dependencies: { middle: "*" } },
      middle: { name: "middle", dependencies: { beta: "*" } },
      beta: { name: "beta", scripts: { build: "node owned.cjs" } }
    });
    try {
      const plan = createWorkspaceBuildPlan(owned.root);
      expect(plan.stages.map(workspace => workspace.name)).toEqual(["beta", "alpha"]);
      expect(plan.layers).toEqual([["beta"], ["middle"], ["alpha"]]);
      expect(plan.noBuild).toEqual([{ name: "middle", path: "packages/middle", status: "NO_DECLARED_BUILD_NOT_A_PASS" }]);
    } finally { owned.remove(); }
  });

  it("records manifestless directories without descending into their children", () => {
    const owned = fixture();
    try {
      fs.mkdirSync(path.join(owned.root, "packages/legacy/deep"), { recursive: true });
      fs.writeFileSync(path.join(owned.root, "packages/legacy/deep/package.json"), "INVALID NOT READ");
      expect(createWorkspaceBuildPlan(owned.root).manifestless).toEqual(["packages/legacy"]);
    } finally { owned.remove(); }
  });

  it("does not derive task edges from nested package-lock installations", () => {
    const owned = fixture();
    try {
      writeJson(path.join(owned.root, "package-lock.json"), { packages: { "packages/alpha/node_modules/beta": { version: "9.0.0", resolved: "https://invalid.invalid/beta.tgz" } } });
      expect(createWorkspaceBuildPlan(owned.root).edges).toEqual([{ from: "alpha", to: "beta" }]);
    } finally { owned.remove(); }
  });

  for (const kind of ["cycle", "duplicate", "invalid-json", "missing-name", "empty-build", "local-config", "bad-layout", "bad-override", "unknown-override", "global-env", "local-env", "peer", "invalid-peers", "range", "conflict", "jsonc"]) {
    it(`refuses ${kind} before every spawn`, async () => {
      const owned = fixture(), mock = mockExecution();
      try {
        if (kind === "cycle") owned.write("beta", { name: "beta", scripts: { build: "node owned.cjs" }, dependencies: { alpha: "*" } });
        if (kind === "duplicate") owned.write("beta", { name: "alpha" });
        if (kind === "invalid-json") fs.writeFileSync(path.join(owned.root, "packages/beta/package.json"), "{");
        if (kind === "missing-name") owned.write("beta", {});
        if (kind === "empty-build") owned.write("beta", { name: "beta", scripts: { build: "" } });
        if (kind === "local-config") writeJson(path.join(owned.root, "packages/beta/turbo.json"), {});
        if (kind === "bad-layout") writeJson(path.join(owned.root, "package.json"), { workspaces: ["packages/**"] });
        if (kind === "bad-override") writeJson(path.join(owned.root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"] }, "beta#build": { dependsOn: [] } } });
        if (kind === "unknown-override") writeJson(path.join(owned.root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"] }, "missing#build": { dependsOn: ["^build"] } } });
        if (kind === "global-env") writeJson(path.join(owned.root, "turbo.json"), { globalEnv: ["TOKEN"], tasks: { build: { dependsOn: ["^build"] } } });
        if (kind === "local-env") writeJson(path.join(owned.root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"], env: ["TOKEN"] } } });
        if (kind === "peer") owned.write("alpha", { name: "alpha", peerDependencies: { beta: "*" } });
        if (kind === "invalid-peers") owned.write("alpha", { name: "alpha", peerDependencies: [] });
        if (kind === "range") owned.write("alpha", { name: "alpha", dependencies: { beta: "workspace:*" } });
        if (kind === "conflict") owned.write("alpha", { name: "alpha", dependencies: { beta: "*" }, devDependencies: { beta: "^1.0.0" } });
        if (kind === "jsonc") fs.writeFileSync(path.join(owned.root, "turbo.jsonc"), "{}");
        await expect(buildWorkspaces(owned.root, { host: mock.host, spawn: mock.spawn, environment: mock.environment })).rejects.toBeDefined();
        expect(mock.start).not.toHaveBeenCalled();
      } finally { owned.remove(); }
    });
  }

  for (const kind of ["workspace-symlink", "manifest-symlink", "manifest-directory", "manifest-case", "manifest-hardlink", "backslash"]) {
    it(`refuses ${kind} without payload access through that boundary`, () => {
      const owned = fixture();
      try {
        const location = path.join(owned.root, "packages/beta/package.json");
        if (kind === "workspace-symlink") fs.symlinkSync(path.join(owned.root, "packages/beta"), path.join(owned.root, "packages/alias"));
        if (kind === "manifest-symlink") { fs.unlinkSync(location); fs.symlinkSync(path.join(owned.root, "package.json"), location); }
        if (kind === "manifest-directory") { fs.unlinkSync(location); fs.mkdirSync(location); }
        if (kind === "manifest-case") fs.renameSync(location, path.join(owned.root, "packages/beta/Package.json"));
        if (kind === "manifest-hardlink") fs.linkSync(location, path.join(owned.root, "extra-link"));
        if (kind === "backslash") fs.mkdirSync(path.join(owned.root, "packages/bad\\name"));
        expect(() => createWorkspaceBuildPlan(owned.root)).toThrow();
      } finally { owned.remove(); }
    });
  }

  it("does not swallow an unreadable manifest as a missing workspace", () => {
    const owned = fixture(), primary = Object.assign(new Error("denied"), { code: "EACCES" });
    try {
      const fileSystem = { ...fs, openSync: () => { throw primary; } };
      expect(() => createWorkspaceBuildPlan(owned.root, fileSystem)).toThrow(primary);
    } finally { owned.remove(); }
  });

  it("accepts a supported nonmatching local version as an external dependency", () => {
    const owned = fixture();
    try {
      owned.write("alpha", { name: "alpha", scripts: { build: "node owned.cjs" }, dependencies: { beta: "^2.0.0" } });
      expect(createWorkspaceBuildPlan(owned.root).edges).toEqual([]);
    } finally { owned.remove(); }
  });
});

describe("finite workspace range matching", () => {
  for (const [range, version, expected] of [
    ["*", undefined, true], ["*", "0.0.0-dev", true],
    ["^1.2.3", "1.2.3", true], ["^1.2.3", "1.9.0", true], ["^1.2.3", "1.2.2", false], ["^1.2.3", "2.0.0", false],
    ["^0.2.3", "0.2.4", true], ["^0.2.3", "0.3.0", false], ["^0.0.3", "0.0.3", true], ["^0.0.3", "0.0.4", false]
  ] as const) it(`${range} versus ${String(version)}`, () => expect(matchesWorkspaceRange(range, version)).toBe(expected));
  for (const range of ["~1.0.0", "1.0.0", "^1", "^01.0.0", "^1.0.0-beta", "workspace:*", "file:../beta", "^9007199254740992.0.0"]) {
    it(`refuses unsupported ${range}`, () => expect(() => matchesWorkspaceRange(range, "1.0.0")).toThrow());
  }
});

describe("native npm execution and cleanup", () => {
  it("accepts explicit false lifecycle settings without changing their environment", async () => {
    const owned = fixture(), mock = mockExecution();
    const environment = { ...mock.environment, npm_config_ignore_scripts: "false", NPM_CONFIG_IF_PRESENT: "false", npm_config_include_workspace_root: "false" };
    try {
      await expect(buildWorkspaces(owned.root, { host: mock.host, spawn: mock.spawn, environment })).resolves.toMatchObject({ builds: 2 });
      expect(mock.start.mock.calls[0][2].env).toEqual(environment);
    } finally { owned.remove(); }
  });

  it("binds actual npm argv and environment and awaits each close serially", async () => {
    const owned = fixture(), mock = mockExecution();
    try {
      const result = await buildWorkspaces(owned.root, { host: mock.host, spawn: mock.spawn, environment: mock.environment });
      expect(result.builds).toBe(2);
      expect(mock.start.mock.calls).toEqual([
        [process.execPath, [mock.environment.npm_execpath, "--prefix", owned.root, "run", "build", "--workspace=packages/beta", "--include-workspace-root=false", "--if-present=false"], { cwd: owned.root, env: mock.environment, stdio: "inherit", detached: true }],
        [process.execPath, [mock.environment.npm_execpath, "--prefix", owned.root, "run", "build", "--workspace=packages/alpha", "--include-workspace-root=false", "--if-present=false"], { cwd: owned.root, env: mock.environment, stdio: "inherit", detached: true }]
      ]);
      expect(mock.host.listenerCount("SIGINT")).toBe(0);
      expect(mock.host.listenerCount("SIGTERM")).toBe(0);
    } finally { owned.remove(); }
  });

  it("stops at the first nonzero close and preserves its exit code", async () => {
    const owned = fixture(), mock = mockExecution(7);
    try {
      await expect(buildWorkspaces(owned.root, { host: mock.host, spawn: mock.spawn, environment: mock.environment })).rejects.toMatchObject({ exitCode: 7 });
      expect(mock.start).toHaveBeenCalledTimes(1);
    } finally { owned.remove(); }
  });

  for (const environment of [
    {}, { npm_execpath: "npm" },
    { npm_execpath: "/owned/npm-cli.js", npm_config_ignore_scripts: "true" },
    { npm_execpath: "/owned/npm-cli.js", NPM_CONFIG_IGNORE_SCRIPTS: "true" },
    { npm_execpath: "/owned/npm-cli.js", npm_config_include_workspace_root: "true" },
    { npm_execpath: "/owned/npm-cli.js", npm_config_if_present: "true" }
  ]) {
    it(`rejects unsupported execution environment ${JSON.stringify(environment)}`, async () => {
      const owned = fixture(), mock = mockExecution();
      try {
        await expect(buildWorkspaces(owned.root, { host: mock.host, spawn: mock.spawn, environment })).rejects.toBeDefined();
        expect(mock.start).not.toHaveBeenCalled();
      } finally { owned.remove(); }
    });
  }

  for (const [index, primary] of primaryValues.entries()) {
    it(`preserves falsey spawn primary and ordered signal cleanup ${index}`, async () => {
      const owned = fixture(), host = mockHost(), cleanup = new Error("cleanup"), removed: string[] = [];
      const originalOff = host.off.bind(host);
      host.off = ((event: string, handler: (...args: unknown[]) => void) => {
        removed.push(event); originalOff(event, handler);
        if (event === "SIGINT") throw cleanup;
        return host;
      }) as typeof host.off;
      try {
        const promise = buildWorkspaces(owned.root, { host, spawn: () => { throw primary; }, environment: { npm_execpath: "/owned/npm-cli.js" } });
        await expect(promise).rejects.toMatchObject({ errors: [primary, cleanup] });
        expect(removed).toEqual(["SIGTERM", "SIGINT"]);
      } finally { owned.remove(); }
    });

    it(`preserves falsey child error until actual close ${index}`, async () => {
      const owned = fixture(), host = mockHost();
      const child = Object.assign(new EventEmitter(), { pid: 9999 });
      let settled = false;
      try {
        const running = buildWorkspaces(owned.root, { host, spawn: (() => child) as unknown as typeof spawn, environment: { npm_execpath: "/owned/npm-cli.js" } });
        const observed = running.then(() => ({ failed: false, error: undefined }), error => ({ failed: true, error })).finally(() => { settled = true; });
        child.emit("error", primary);
        await Promise.resolve();
        expect(settled).toBe(false);
        child.emit("close", -2, null);
        const result = await observed;
        expect(result.failed).toBe(true);
        expect(Object.is(result.error, primary)).toBe(true);
      } finally { owned.remove(); }
    });
  }

  it("removes partially registered signals before any child can start", async () => {
    const owned = fixture(), mock = mockExecution(), primary = new Error("registration");
    const originalOn = mock.host.on.bind(mock.host);
    mock.host.on = ((event: string, handler: (...args: unknown[]) => void) => {
      originalOn(event, handler);
      if (event === "SIGTERM") throw primary;
      return mock.host;
    }) as typeof mock.host.on;
    try {
      await expect(buildWorkspaces(owned.root, { host: mock.host, spawn: mock.spawn, environment: mock.environment })).rejects.toBe(primary);
      expect(mock.start).not.toHaveBeenCalled();
      expect(mock.host.listenerCount("SIGINT")).toBe(0);
      expect(mock.host.listenerCount("SIGTERM")).toBe(0);
    } finally { owned.remove(); }
  });

  it("forwards termination to the active group and still awaits close", async () => {
    const owned = fixture(), host = mockHost(), child = Object.assign(new EventEmitter(), { pid: 9999 });
    let settled = false;
    try {
      const running = buildWorkspaces(owned.root, { host, spawn: (() => child) as unknown as typeof spawn, environment: { npm_execpath: "/owned/npm-cli.js" } });
      const observed = running.catch(error => error).finally(() => { settled = true; });
      host.emit("SIGTERM");
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(host.kill).toHaveBeenCalledWith(-9999, "SIGTERM");
      child.emit("close", null, "SIGTERM");
      expect((await observed).message).toContain("interrupted");
      expect(host.listenerCount("SIGTERM")).toBe(0);
    } finally { owned.remove(); }
  });

  for (const [index, primary] of primaryValues.entries()) it(`keeps child primary ahead of group cleanup failure ${index}`, async () => {
    const owned = fixture(), host = mockHost(), cleanup = new Error("group cleanup");
    const child = Object.assign(new EventEmitter(), { pid: 9999 });
    host.kill = vi.fn(() => { throw cleanup; });
    try {
      const running = buildWorkspaces(owned.root, { host, spawn: (() => child) as unknown as typeof spawn, environment: { npm_execpath: "/owned/npm-cli.js" } });
      child.emit("error", primary);
      child.emit("close", -2, null);
      const caught = await running.catch(error => error);
      expect(caught).toBeInstanceOf(AggregateError);
      expect(Object.is(caught.errors[0], primary)).toBe(true);
      expect(caught.errors[1]).toBe(cleanup);
      expect(host.listenerCount("SIGTERM")).toBe(0);
    } finally { owned.remove(); }
  });

  it("treats cleanup-only failure after success as failure and stops further tasks", async () => {
    const owned = fixture(), mock = mockExecution(), cleanup = new Error("group inspection");
    mock.host.kill = vi.fn(() => { throw cleanup; });
    try {
      await expect(buildWorkspaces(owned.root, { host: mock.host, spawn: mock.spawn, environment: mock.environment })).rejects.toBe(cleanup);
      expect(mock.start).toHaveBeenCalledTimes(1);
    } finally { owned.remove(); }
  });

  it("waits for residual group termination before starting the next workspace", async () => {
    const owned = fixture(), mock = mockExecution();
    let alive = true;
    mock.host.kill = vi.fn((_pid: number, signal?: string | number) => {
      if (signal === "SIGTERM") alive = false;
      if (signal === 0 && !alive) throw Object.assign(new Error("absent"), { code: "ESRCH" });
      return true as const;
    });
    try {
      await expect(buildWorkspaces(owned.root, { host: mock.host, spawn: mock.spawn, environment: mock.environment })).resolves.toMatchObject({ builds: 2 });
      expect(mock.host.kill).toHaveBeenCalledWith(-9000, "SIGTERM");
      expect(alive).toBe(false);
    } finally { owned.remove(); }
  });
});

describe("post-spawn setup cleanup", () => {
  for (const [label, primary] of [["error", new Error("setup")], ["undefined", undefined]] as const) {
    it(`orders setup ${label}, termination, emitted error and group cleanup without duplicate observers`, async () => {
      const owned = fixture(), host = mockHost(), child = Object.assign(new EventEmitter(), { pid: 9999 });
      const termination = new Error("termination"), emitted = new Error("emitted"), cleanup = new Error("group cleanup");
      const originalOnce = child.once;
      child.once = function (event, handler) {
        const result = originalOnce.call(this, event, handler);
        if (event === "error") throw primary;
        return result;
      };
      host.kill = vi.fn((_pid: number, signal?: string | number) => { throw signal === "SIGTERM" ? termination : cleanup; });
      let settled = false;
      try {
        const running = buildWorkspaces(owned.root, { host, spawn: (() => child) as unknown as typeof spawn, environment: { npm_execpath: "/owned/npm-cli.js" } });
        const observed = running.catch(error => error).finally(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);
        child.emit("error", emitted);
        child.emit("close", null, "SIGTERM");
        const caught = await observed;
        expect(caught).toBeInstanceOf(AggregateError);
        expect(caught.errors).toHaveLength(4);
        for (const [index, reason] of [primary, termination, emitted, cleanup].entries()) expect(Object.is(caught.errors[index], reason)).toBe(true);
        expect(child.listenerCount("close")).toBe(0);
        expect(child.listenerCount("error")).toBe(0);
        expect(host.listenerCount("SIGTERM")).toBe(0);
      } finally { owned.remove(); }
    });
  }

  it("escalates a setup failure and awaits close before removing supervisory handlers", async () => {
    const owned = fixture(), host = mockHost(), child = Object.assign(new EventEmitter(), { pid: 9999 });
    const originalOnce = child.once, primary = new Error("setup");
    child.once = function (event, handler) {
      if (event === "error") throw primary;
      return originalOnce.call(this, event, handler);
    };
    host.kill = vi.fn((_pid: number, signal?: string | number) => {
      if (signal === 0) throw Object.assign(new Error("absent"), { code: "ESRCH" });
      if (signal === "SIGKILL") child.emit("close", null, signal);
      return true as const;
    });
    vi.useFakeTimers();
    let settled = false;
    try {
      const running = buildWorkspaces(owned.root, { host, spawn: (() => child) as unknown as typeof spawn, environment: { npm_execpath: "/owned/npm-cli.js" } });
      const observed = running.catch(error => error).finally(() => { settled = true; });
      expect(host.kill).toHaveBeenCalledWith(-9999, "SIGTERM");
      await vi.advanceTimersByTimeAsync(1999);
      expect(settled).toBe(false);
      expect(host.listenerCount("SIGTERM")).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await observed).toBe(primary);
      expect(host.kill).toHaveBeenCalledWith(-9999, "SIGKILL");
      expect(host.listenerCount("SIGTERM")).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); owned.remove(); }
  });

  for (const event of ["error", "close"] as const) {
    for (const timing of ["before", "after"] as const) {
      for (const [label, primary] of [["error", new Error("listener installation")], ["undefined", undefined]] as const) {
        it(`joins an actual owned child after ${event} observer ${timing} installation throws ${label}`, async () => {
          const owned = fixture(), host = mockHost();
          host.kill = process.kill.bind(process);
          let runningChild: ReturnType<typeof spawn> | undefined;
          let closed: Promise<void> | undefined;
          let closeSeen = false, exitSeen = false, spawns = 0;
          const start = () => {
            spawns++;
            const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
              cwd: owned.root, env: { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: owned.root, LANG: "C", LC_ALL: "C" }, detached: true, stdio: "ignore"
            });
            runningChild = child;
            child.on("error", () => undefined);
            child.once("exit", () => { exitSeen = true; });
            closed = new Promise(resolve => child.once("close", () => { closeSeen = true; resolve(); }));
            const originalOnce = child.once;
            child.once = function (...[name, handler]: Parameters<typeof originalOnce>) {
              if (name === event && timing === "before") throw primary;
              const result = originalOnce.call(this, name, handler);
              if (name === event) throw primary;
              return result;
            };
            return child;
          };
          const groupExists = () => {
            try { process.kill(-runningChild!.pid!, 0); return true; } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
              throw error;
            }
          };
          try {
            let failed = false, caught: unknown;
            try {
              await buildWorkspaces(owned.root, { host, spawn: start as typeof spawn, environment: { npm_execpath: "/owned/npm-cli.js" } });
            } catch (error) { failed = true; caught = error; }
            expect(failed).toBe(true);
            expect(Object.is(caught, primary)).toBe(true);
            expect(spawns).toBe(1);
            expect(closeSeen).toBe(true);
            expect(exitSeen).toBe(true);
            expect(groupExists()).toBe(false);
            expect(host.listenerCount("SIGINT")).toBe(0);
            expect(host.listenerCount("SIGTERM")).toBe(0);
          } finally {
            if (runningChild?.pid) {
              const signal = (value: NodeJS.Signals) => {
                try { process.kill(-runningChild!.pid!, value); } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
                }
              };
              signal("SIGTERM");
              const timer = setTimeout(() => signal("SIGKILL"), 1000);
              await closed;
              clearTimeout(timer);
              expect(groupExists()).toBe(false);
            }
            owned.remove();
          }
        }, 10000);
      }
    }
  }
});

describe("manifest descriptor cleanup", () => {
  for (const [index, cleanup] of primaryValues.entries()) it(`preserves close-only failure ${index}`, () => {
    const owned = fixture();
    let closes = 0, failed = false, caught: unknown;
    try {
      const fileSystem = { ...fs, closeSync: (descriptor: number) => { closes++; fs.closeSync(descriptor); throw cleanup; } };
      try { readManifest(owned.root, "package.json", fileSystem); } catch (error) { failed = true; caught = error; }
      expect(failed).toBe(true);
      expect(Object.is(caught, cleanup)).toBe(true);
      expect(closes).toBe(1);
    } finally { owned.remove(); }
  });

  for (const field of ["dev", "ino", "mode", "size", "nlink", "mtimeMs", "ctimeMs"]) it(`rejects descriptor ${field} drift before reading bytes`, () => {
    const owned = fixture();
    const reads = vi.fn(fs.readSync);
    let closes = 0;
    try {
      const fileSystem = {
        ...fs,
        readSync: reads,
        fstatSync: (descriptor: number) => { const metadata = fs.fstatSync(descriptor); return { ...metadata, [field]: metadata[field as keyof typeof metadata] as number + 1 }; },
        closeSync: (descriptor: number) => { closes++; fs.closeSync(descriptor); }
      };
      expect(() => readManifest(owned.root, "package.json", fileSystem as unknown as typeof fs)).toThrow(`Manifest identity: ${field}`);
      expect(reads).not.toHaveBeenCalled();
      expect(closes).toBe(1);
    } finally { owned.remove(); }
  });

  for (const [index, primary] of primaryValues.entries()) it(`keeps primary then close identity ${index}`, () => {
    const owned = fixture(), cleanup = new Error("close"), closed: number[] = [];
    try {
      const fileSystem = {
        ...fs,
        readSync: () => { throw primary; },
        closeSync: (descriptor: number) => { closed.push(descriptor); fs.closeSync(descriptor); throw cleanup; }
      };
      let failed = false, caught: unknown;
      try { readManifest(owned.root, "package.json", fileSystem); } catch (error) { failed = true; caught = error; }
      expect(failed).toBe(true);
      expect(caught).toBeInstanceOf(AggregateError);
      expect(Object.is((caught as AggregateError).errors[0], primary)).toBe(true);
      expect((caught as AggregateError).errors[1]).toBe(cleanup);
      expect(closed).toHaveLength(1);
    } finally { owned.remove(); }
  });
});

async function ownedNpm(root: string, event: string) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("Owned lifecycle controls require the invoking npm CLI path");
  for (const name of ["home", "tmp", "cache"]) fs.mkdirSync(path.join(root, name));
  for (const name of ["user.npmrc", "global.npmrc"]) fs.writeFileSync(path.join(root, name), "");
  const environment = {
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: path.join(root, "home"), TMPDIR: path.join(root, "tmp"),
    LANG: "C", LC_ALL: "C", TZ: "UTC", CUSTOM_TEST_VALUE: "preserved", BUILD_EVENTS: path.join(root, "events.jsonl"),
    npm_config_userconfig: path.join(root, "user.npmrc"), npm_config_globalconfig: path.join(root, "global.npmrc"),
    npm_config_cache: path.join(root, "cache"), npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false"
  };
  const child = spawn(process.execPath, [npmCli, "--prefix", root, "run", event], { cwd: root, env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const chunks: Buffer[] = [];
  let bytes = 0, stopped = false;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  const failures: unknown[] = [];
  const signal = (value: NodeJS.Signals) => {
    try { process.kill(-child.pid!, value); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") failures.push(error); }
  };
  const stop = () => { stopped = true; signal("SIGTERM"); forceTimer ??= setTimeout(() => signal("SIGKILL"), 1000); };
  const timer = setTimeout(stop, 20000);
  child.on("error", error => failures.push(error));
  for (const stream of [child.stdout!, child.stderr!]) stream.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024 * 1024) stop(); else chunks.push(chunk); });
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
  clearTimeout(timer);
  clearTimeout(forceTimer);
  if (failures.length > 1) throw new AggregateError(failures, "Owned npm execution and cleanup failed");
  if (failures.length) throw failures[0];
  expect(stopped, Buffer.concat(chunks).toString()).toBe(false);
  return { ...result, output: Buffer.concat(chunks).toString() };
}

describe("owned real npm lifecycle route", () => {
  for (const mode of ["build", "prepack", "postbuild-failure", "suppress-lifecycle", "include-root"]) it(mode, async () => {
    const step = "node ../../step.cjs";
    const owned = fixture({
      alpha: { name: "alpha", version: "1.0.0", scripts: { prebuild: step, build: step, postbuild: step }, dependencies: { beta: "*" } },
      beta: { name: "beta", version: "1.0.0", scripts: { prebuild: step, build: step, postbuild: mode === "postbuild-failure" ? `${step} fail` : step } },
      python: { name: "python" }
    });
    try {
      fs.mkdirSync(path.join(owned.root, "scripts"));
      fs.copyFileSync(runnerFilename, path.join(owned.root, "scripts/build-workspaces.mjs"));
      writeJson(path.join(owned.root, "package.json"), { name: "owned-root", private: true, workspaces: ["packages/*"], scripts: { build: "node scripts/build-workspaces.mjs && node step.cjs suffix", prepack: "npm run build" } });
      fs.writeFileSync(path.join(owned.root, "step.cjs"), 'const fs=require("node:fs");fs.appendFileSync(process.env.BUILD_EVENTS,JSON.stringify({name:process.env.npm_package_name,event:process.env.npm_lifecycle_event,custom:process.env.CUSTOM_TEST_VALUE,suffix:process.argv.includes("suffix")})+"\\n");if(process.argv.includes("fail"))process.exit(7);');
      if (mode === "suppress-lifecycle") fs.writeFileSync(path.join(owned.root, ".npmrc"), "ignore-scripts=true\n");
      if (mode === "include-root") fs.writeFileSync(path.join(owned.root, ".npmrc"), "include-workspace-root=true\n");
      const result = await ownedNpm(owned.root, mode === "prepack" ? "prepack" : "build");
      if (mode === "suppress-lifecycle") {
        expect(result.code, result.output).not.toBe(0);
        expect(result.output).toContain("Unsupported lifecycle or workspace option");
        expect(fs.existsSync(path.join(owned.root, "events.jsonl"))).toBe(false);
        return;
      }
      const events = fs.readFileSync(path.join(owned.root, "events.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
      expect(result.signal, result.output).toBeNull();
      expect(events.every(event => event.custom === "preserved")).toBe(true);
      if (mode === "postbuild-failure") {
        expect(result.code, result.output).not.toBe(0);
        expect(events.map(event => `${event.name}:${event.event}`)).toEqual(["beta:prebuild", "beta:build", "beta:postbuild"]);
      } else {
        expect(result.code, result.output).toBe(0);
        expect(events.map(event => `${event.name}:${event.event}`)).toEqual(["beta:prebuild", "beta:build", "beta:postbuild", "alpha:prebuild", "alpha:build", "alpha:postbuild", "owned-root:build"]);
        expect(events.at(-1).suffix).toBe(true);
        expect(result.output).toContain("NO_DECLARED_BUILD_NOT_A_PASS");
      }
    } finally { owned.remove(); }
  }, 25000);
});
