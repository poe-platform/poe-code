import { execFileSync, spawn, spawnSync, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastGlob from "fast-glob";
import { describe, expect, it, vi } from "vitest";
import * as workspaceRunner from "./build-workspaces.mjs";
import { buildWorkspaces, createWorkspaceBuildPlan, matchesWorkspaceRange, readManifest } from "./build-workspaces.mjs";

type Manifest = Record<string, unknown>;
type Fixture = { root: string; write: (name: string, manifest: Manifest) => void; remove: () => void };
const runnerFilename = fileURLToPath(new URL("./build-workspaces.mjs", import.meta.url));
const primaryValues = [undefined, null, false, 0, -0, "", NaN, new Error("primary")];

describe("maintained literal workspace test selectors", () => {
  const root = path.dirname(path.dirname(runnerFilename));

  function captureArguments(
    workspace: string,
    event: "test" | "test:unit",
    enumeration: "unavailable" | "empty" | "nonempty"
  ) {
    const directory = path.join(root, "packages", workspace);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    const result = spawnSync(
      "/bin/sh",
      [
        "-c",
        [
          'sort() { /usr/bin/sort "$@"; }',
          'tr() { /usr/bin/tr "$@"; }',
          'vitest() { printf "%s\\000" "$@"; }',
          enumeration === "empty"
            ? "rg() { return 0; }"
            : enumeration === "nonempty"
              ? `rg() { printf '%s\\n' 'packages/${workspace}/src/current.test.ts' 'packages/${workspace}/src/future/nested.test.ts'; }`
              : "",
          manifest.scripts[event]
        ].join("\n")
      ],
      { cwd: directory, env: { ...process.env, PATH: "" }, encoding: "utf8", timeout: 5000 }
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    return { arguments: result.stdout.split("\0").slice(0, -1), stderr: result.stderr };
  }

  for (const workspace of ["superintendent", "terminal-pilot"]) {
    for (const event of ["test", "test:unit"] as const) {
      for (const enumeration of ["unavailable", "empty", "nonempty"] as const) {
        it(`${workspace} ${event} keeps its directory filter when rg is ${enumeration}`, () => {
          expect(captureArguments(workspace, event, enumeration)).toEqual({
            arguments: ["run", `packages/${workspace}/src/`],
            stderr: ""
          });
        });
      }
    }

    it(`${workspace} retains current and future nested src paths without enumerating filenames in argv`, () => {
      const { arguments: capturedArguments } = captureArguments(workspace, "test:unit", "empty");
      const selector = capturedArguments[1];
      expect(selector).toBe(`packages/${workspace}/src/`);
      const current = fastGlob.sync(`packages/${workspace}/src/**/*.test.ts`, { cwd: root });
      expect(current.length).toBeGreaterThan(0);
      for (const filename of [
        ...current,
        `packages/${workspace}/src/future/deep/new.test.ts`,
        `packages/${workspace}/src/future/deep/new.spec.ts`
      ]) {
        expect(filename.startsWith(selector!)).toBe(true);
        expect(capturedArguments).not.toContain(filename);
      }
      expect(`packages/${workspace}/src-sibling/other.test.ts`.startsWith(selector!)).toBe(false);
      expect("packages/terminal-pilot/scripts/build-assets.test.ts".startsWith(selector!)).toBe(
        false
      );
    });
  }
});

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

function unitFixture() {
  const owned = fixture({
    alpha: { name: "alpha", scripts: { "test:unit": "node unit.cjs" } },
    bash: { name: "virtual-bash", scripts: { build: "node build.cjs", "test:unit": "node unit.cjs" }, dependencies: { middle: "*" } },
    middle: { name: "middle", dependencies: { beta: "*" } },
    beta: { name: "beta", scripts: { build: "node build.cjs" } },
    unused: { name: "unused" }
  });
  writeJson(path.join(owned.root, "package.json"), { name: "owned-root", private: true, workspaces: ["packages/*"], scripts: { "test:unit": "node root-unit.cjs" } });
  writeJson(path.join(owned.root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"] }, "virtual-bash#test:unit": { dependsOn: ["build"], outputs: [], cache: false } } });
  return owned;
}

describe("finite unit task planning", () => {
  it("rejects obsolete native-tool environment configuration", () => {
    const owned = unitFixture();
    try {
      writeJson(path.join(owned.root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"] }, "virtual-bash#test:unit": { passThroughEnv: ["SAFE_BASH_TEST_RG"] } } });
      expect(() => workspaceRunner.createWorkspaceTestPlan(owned.root)).toThrow("Unsupported unit task configuration");
    } finally { owned.remove(); }
  });
  it("retains root and every declared unit task plus buildless prerequisite closure", () => {
    const owned = unitFixture();
    try {
      const plan = workspaceRunner.createWorkspaceTestPlan(owned.root);
      expect(plan.testStages.map(task => task.id)).toEqual(["//#test:unit", "alpha#test:unit", "virtual-bash#test:unit"]);
      expect(plan.buildStages.map((task: { name: string }) => task.name)).toEqual(["beta", "virtual-bash"]);
      expect(plan.noTest.map((task: { name: string }) => task.name)).toEqual(["beta", "middle", "unused"]);
      owned.write("python", { name: "python", scripts: { "test:unit": "python3 -m unittest discover -s tests -t ." } });
      expect(workspaceRunner.createWorkspaceTestPlan(owned.root).testStages.map(task => task.name)).toContain("python");
    } finally { owned.remove(); }
  });

  it("excludes only the named Bash unit task and retains another task's required Bash build", () => {
    const owned = unitFixture();
    try {
      owned.write("alpha", { name: "alpha", scripts: { "test:unit": "node unit.cjs" }, dependencies: { "virtual-bash": "*" } });
      writeJson(path.join(owned.root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"] }, "alpha#test:unit": { dependsOn: ["^build"] }, "virtual-bash#test:unit": { dependsOn: ["build"] } } });
      const plan = workspaceRunner.createWorkspaceTestPlan(owned.root, { excludeWorkspace: "virtual-bash" });
      expect(plan.testStages.map(task => task.name)).toEqual(["owned-root", "alpha"]);
      expect(plan.buildStages.map((task: { name: string }) => task.name)).toEqual(["beta", "virtual-bash"]);
    } finally { owned.remove(); }
  });

  for (const kind of ["empty-unit", "invalid-pre", "unknown-override", "unknown-edge", "root-build", "environment", "rg-leak", "unknown-exclusion", "invalid-concurrency"]) {
    it('rejects unit ' + kind + ' before any build or test spawn', async () => {
      const owned = unitFixture(), mock = mockExecution();
      const options: Record<string, unknown> = {};
      try {
        if (kind === "empty-unit") owned.write("alpha", { name: "alpha", scripts: { "test:unit": "" } });
        if (kind === "invalid-pre") owned.write("alpha", { name: "alpha", scripts: { "test:unit": "node unit.cjs", "pretest:unit": 1 } });
        if (kind === "unknown-override") writeJson(path.join(owned.root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"] }, "missing#test:unit": {} } });
        if (kind === "unknown-edge") writeJson(path.join(owned.root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"] }, "alpha#test:unit": { dependsOn: ["lint"] } } });
        if (kind === "root-build") writeJson(path.join(owned.root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"] }, "//#test:unit": { dependsOn: ["build"] } } });
        if (kind === "environment") writeJson(path.join(owned.root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"] }, "alpha#test:unit": { env: ["ANYTHING"] } } });
        if (kind === "rg-leak") writeJson(path.join(owned.root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"] }, "alpha#test:unit": { passThroughEnv: ["SAFE_BASH_TEST_RG"] } } });
        if (kind === "unknown-exclusion") options.excludeWorkspace = "alpha";
        if (kind === "invalid-concurrency") options.concurrency = 0;
        await expect(workspaceRunner.testWorkspaces(owned.root, { ...mock, spawn: mock.spawn, ...options })).rejects.toBeDefined();
        expect(mock.start).not.toHaveBeenCalled();
      } finally { owned.remove(); }
    });
  }

  it("uses only the selected build closure without root suffix or unrelated builds", async () => {
    const owned = unitFixture(), mock = mockExecution();
    try {
      owned.write("unrelated", { name: "unrelated", scripts: { build: "node build.cjs" } });
      await workspaceRunner.buildWorkspaces(owned.root, { ...mock, workspace: "virtual-bash" });
      expect(mock.start.mock.calls.map(call => call[1][5])).toEqual(["--workspace=packages/beta", "--workspace=packages/bash"]);
      expect(mock.start.mock.calls.every(call => call[1][4] === "build")).toBe(true);
    } finally { owned.remove(); }
  });

  for (const args of [["--workspace=*"], ["--test-unit", "--concurrency=0"], ["--test-unit", "--exclude-workspace=alpha"], ["--test-unit", "--concurrency=1", "--concurrency=4"], ["--workspace=virtual-bash", "extra"]]) {
    it('rejects invalid finite runner arguments ' + JSON.stringify(args), () => {
      expect(() => workspaceRunner.parseWorkspaceArguments(args)).toThrow();
    });
  }

  it("preserves child argument forwarding and reserves finite mode options", () => {
    expect(workspaceRunner.parseWorkspaceArguments([])).toEqual({ mode: "build" });
    expect(workspaceRunner.parseWorkspaceArguments(["--test-unit", "--concurrency=4", "--exclude-workspace=virtual-bash", "--", "--reporter=tap", "name with spaces"]))
      .toEqual({ mode: "test-unit", concurrency: 4, excludeWorkspace: "virtual-bash", testArguments: ["--reporter=tap", "name with spaces"] });
    const forwarded = workspaceRunner.parseWorkspaceArguments(["--test-unit", "--reporter=json"]);
    if (!("testArguments" in forwarded)) throw new Error("Expected unit argument result");
    expect(forwarded.testArguments).toEqual(["--reporter=json"]);
  });
});

describe("finite unit execution and ownership", () => {
  it("builds before tests, retains npm lifecycles, exact arguments and feature-only profiles", async () => {
    const owned = unitFixture(), mock = mockExecution();
    const environment = { ...mock.environment, TERM: "xterm-256color", SAFEJS_LOCAL_ROOT: "/owned/safe-js", S3_HTTP_EXPORTS_REVISION: "owned-revision", FULL_GATE_ROOT: "/owned/full-gate" };
    try {
      const result = await workspaceRunner.testWorkspaces(owned.root, { ...mock, environment, testArguments: ["--reporter=tap", "a b"] });
      expect(result).toMatchObject({ builds: 2, tests: 3, concurrency: 1, cache: "UNCACHED" });
      expect(mock.start.mock.calls.map(call => call[1][4])).toEqual(["build", "build", "test:unit", "test:unit", "test:unit"]);
      expect(mock.start.mock.calls[2][1]).toContain("--workspaces=false");
      for (const call of mock.start.mock.calls) {
        expect(call[2].env?.TERM).toBe("xterm-256color");
        expect(call[2].env?.CUSTOM).toBe("preserved");
        expect(call[1]).toContain("--if-present=false");
        if (call[1][4] === "test:unit") expect(call[1].slice(-3)).toEqual(["--", "--reporter=tap", "a b"]);
        else expect(call[1]).not.toContain("--reporter=tap");
        const feature = call[1][4] === "test:unit" && call[1].includes("--workspace=packages/bash");
        for (const name of ["SAFEJS_LOCAL_ROOT", "S3_HTTP_EXPORTS_REVISION", "FULL_GATE_ROOT"]) expect(call[2].env?.[name]).toBe(feature ? environment[name as keyof typeof environment] : undefined);
      }
      expect(mock.host.listenerCount("SIGTERM")).toBe(0);
    } finally { owned.remove(); }
  });

  for (const concurrency of [1, 4]) it('limits unit concurrency to ' + concurrency, async () => {
    const owned = unitFixture(), host = mockHost();
    let active = 0, maximum = 0, launched = 0;
    try {
      for (const name of ["charlie", "delta", "echo"]) owned.write(name, { name, scripts: { "test:unit": "node unit.cjs" } });
      const start = () => {
        const child = Object.assign(new EventEmitter(), { pid: 10000 + launched++ });
        active++; maximum = Math.max(maximum, active);
        setImmediate(() => { active--; child.emit("close", 0, null); });
        return child as unknown as ReturnType<typeof spawn>;
      };
      await workspaceRunner.testWorkspaces(owned.root, { host, spawn: start as typeof spawn, environment: { npm_execpath: "/owned/npm-cli.js" }, concurrency });
      expect(maximum).toBe(concurrency);
      expect(active).toBe(0);
    } finally { owned.remove(); }
  });

  for (const [index, primary] of primaryValues.entries()) it('joins every occupied unit slot after falsey primary ' + index, async () => {
    const owned = unitFixture(), host = mockHost();
    const children: Array<EventEmitter & { pid: number }> = [];
    let settled = false;
    try {
      writeJson(path.join(owned.root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"] } } });
      for (const name of ["charlie", "delta", "echo", "foxtrot"]) owned.write(name, { name, scripts: { "test:unit": "node unit.cjs" } });
      const start = () => { const child = Object.assign(new EventEmitter(), { pid: 11000 + children.length }); children.push(child); return child as unknown as ReturnType<typeof spawn>; };
      const running = workspaceRunner.testWorkspaces(owned.root, { host, spawn: start as typeof spawn, environment: { npm_execpath: "/owned/npm-cli.js" }, concurrency: 4 });
      const observed = running.then(() => ({ failed: false, error: undefined }), error => ({ failed: true, error })).finally(() => { settled = true; });
      await vi.waitFor(() => expect(children).toHaveLength(4));
      children[1].emit("error", primary);
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(children).toHaveLength(4);
      for (const child of children) expect(host.kill).toHaveBeenCalledWith(-child.pid, "SIGTERM");
      children[0].emit("close", null, "SIGTERM"); children[1].emit("close", -2, null); children[2].emit("close", null, "SIGTERM");
      await Promise.resolve(); expect(settled).toBe(false);
      children[3].emit("close", null, "SIGTERM");
      const result = await observed;
      expect(result.failed).toBe(true); expect(Object.is(result.error, primary)).toBe(true);
      expect(children).toHaveLength(4);
      expect(host.listenerCount("SIGTERM")).toBe(0);
    } finally { owned.remove(); }
  });

  it("escalates STOP for all four slots and joins before settlement", async () => {
    const owned = unitFixture(), host = mockHost(), children: Array<EventEmitter & { pid: number }> = [];
    try {
      writeJson(path.join(owned.root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"] } } });
      owned.write("charlie", { name: "charlie", scripts: { "test:unit": "node unit.cjs" } });
      host.kill = vi.fn((pid: number, signal?: number | string) => { if (signal === 0) throw Object.assign(new Error("absent"), { code: "ESRCH" }); if (signal === "SIGKILL") children.find(child => child.pid === -pid)!.emit("close", null, signal); return true; }) as typeof host.kill;
      vi.useFakeTimers();
      const start = () => { const child = Object.assign(new EventEmitter(), { pid: 12000 + children.length }); children.push(child); return child as unknown as ReturnType<typeof spawn>; };
      const running = workspaceRunner.testWorkspaces(owned.root, { host, spawn: start as typeof spawn, environment: { npm_execpath: "/owned/npm-cli.js" }, concurrency: 4 });
      const observed = running.catch(error => error);
      await vi.advanceTimersByTimeAsync(0);
      expect(children).toHaveLength(4); host.emit("SIGTERM");
      await vi.advanceTimersByTimeAsync(2000);
      expect((await observed).message).toContain("interrupted");
      for (const child of children) expect(host.kill).toHaveBeenCalledWith(-child.pid, "SIGKILL");
      expect(vi.getTimerCount()).toBe(0); expect(host.listenerCount("SIGTERM")).toBe(0);
    } finally { vi.useRealTimers(); owned.remove(); }
  });
});

describe("finite unit owned npm lifecycle", () => {
  for (const failedEvent of ["none", "prebuild", "postbuild", "pretest:unit", "posttest:unit"]) it(failedEvent, async () => {
    const step = "node ../../step.cjs", owned = fixture({
      bash: { name: "virtual-bash", scripts: { prebuild: step, build: step, postbuild: step, "pretest:unit": step, "test:unit": step, "posttest:unit": step } }
    });
    try {
      fs.mkdirSync(path.join(owned.root, "scripts")); fs.copyFileSync(runnerFilename, path.join(owned.root, "scripts/build-workspaces.mjs"));
      writeJson(path.join(owned.root, "package.json"), { name: "owned-root", private: true, workspaces: ["packages/*"], scripts: { pretest: "node step.cjs", test: "node scripts/build-workspaces.mjs --test-unit", posttest: "node step.cjs", "pretest:unit": "node step.cjs", "test:unit": "node step.cjs", "posttest:unit": "node step.cjs" } });
      writeJson(path.join(owned.root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"] }, "virtual-bash#test:unit": { dependsOn: ["build"] } } });
      fs.writeFileSync(path.join(owned.root, "step.cjs"), 'const fs=require("node:fs");const event=process.env.npm_lifecycle_event;fs.appendFileSync(process.env.BUILD_EVENTS,JSON.stringify({name:process.env.npm_package_name,event})+"\\n");if(process.env.npm_package_name==="virtual-bash"&&event===' + JSON.stringify(failedEvent) + ')process.exit(7);');
      const result = await ownedNpm(owned.root, "test");
      expect(fs.existsSync(path.join(owned.root, "events.jsonl")), result.output).toBe(true);
      const events = fs.readFileSync(path.join(owned.root, "events.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
      const all = ["owned-root:pretest", "virtual-bash:prebuild", "virtual-bash:build", "virtual-bash:postbuild", "owned-root:pretest:unit", "owned-root:test:unit", "owned-root:posttest:unit", "virtual-bash:pretest:unit", "virtual-bash:test:unit", "virtual-bash:posttest:unit", "owned-root:posttest"];
      expect(result.signal).toBeNull();
      expect(result.code, result.output).toBe(failedEvent === "none" ? 0 : 7);
      const stop = failedEvent === "none" ? all.length : all.indexOf("virtual-bash:" + failedEvent) + 1;
      expect(events.map(event => event.name + ":" + event.event)).toEqual(all.slice(0, stop));
    } finally { owned.remove(); }
  }, 25000);
});

describe("finite unit late failure and cleanup ordering", () => {
  for (const [index, primary] of primaryValues.entries()) it('retains the original primary through late STOP ' + index, async () => {
    const owned = unitFixture(), host = mockHost(), children: Array<EventEmitter & { pid: number }> = [];
    try {
      writeJson(path.join(owned.root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"] } } });
      const start = () => { const child = Object.assign(new EventEmitter(), { pid: 13000 + children.length }); children.push(child); return child as unknown as ReturnType<typeof spawn>; };
      const running = workspaceRunner.testWorkspaces(owned.root, { host, spawn: start as typeof spawn, environment: { npm_execpath: "/owned/npm-cli.js" }, concurrency: 4 });
      const observed = running.then(() => ({ failed: false, error: undefined }), error => ({ failed: true, error }));
      await vi.waitFor(() => expect(children).toHaveLength(3));
      children[1].emit("error", primary); host.emit("SIGTERM");
      for (const child of children) child.emit("close", null, "SIGTERM");
      const result = await observed;
      expect(result.failed).toBe(true); expect(Object.is(result.error, primary)).toBe(true);
    } finally { owned.remove(); }
  });

  it("keeps primary then per-slot cleanup errors and still attempts all groups", async () => {
    const owned = unitFixture(), host = mockHost(), children: Array<EventEmitter & { pid: number }> = [];
    const primary = false, cleanup = [undefined, null, new Error("third group")];
    try {
      writeJson(path.join(owned.root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"] } } });
      const start = () => { const child = Object.assign(new EventEmitter(), { pid: 14000 + children.length }); children.push(child); return child as unknown as ReturnType<typeof spawn>; };
      host.kill = vi.fn((pid: number, signal?: string | number) => { if (signal === 0) throw Object.assign(new Error("absent"), { code: "ESRCH" }); if (signal === "SIGTERM") throw cleanup[-pid - 14000]; return true; }) as typeof host.kill;
      const running = workspaceRunner.testWorkspaces(owned.root, { host, spawn: start as typeof spawn, environment: { npm_execpath: "/owned/npm-cli.js" }, concurrency: 4 });
      const observed = running.catch(error => error);
      await vi.waitFor(() => expect(children).toHaveLength(3));
      children[1].emit("error", primary);
      for (const child of children) child.emit("close", null, "SIGTERM");
      const caught = await observed;
      expect(caught).toBeInstanceOf(AggregateError);
      expect(caught.errors).toEqual([primary, cleanup[0], cleanup[1], cleanup[2]]);
      for (const child of children) expect(host.kill).toHaveBeenCalledWith(-child.pid, "SIGTERM");
    } finally { owned.remove(); }
  });

  it("stops queued units when a later slot fails while an earlier slot remains open", async () => {
    const owned = unitFixture(), host = mockHost(), children: Array<EventEmitter & { pid: number }> = [];
    try {
      writeJson(path.join(owned.root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"] } } });
      for (const name of ["charlie", "delta", "echo"]) owned.write(name, { name, scripts: { "test:unit": "node unit.cjs" } });
      const start = () => { const child = Object.assign(new EventEmitter(), { pid: 15000 + children.length }); children.push(child); return child as unknown as ReturnType<typeof spawn>; };
      const running = workspaceRunner.testWorkspaces(owned.root, { host, spawn: start as typeof spawn, environment: { npm_execpath: "/owned/npm-cli.js" }, concurrency: 4 });
      const observed = running.catch(error => error);
      await vi.waitFor(() => expect(children).toHaveLength(4));
      children[3].emit("close", 9, null); children[1].emit("close", 0, null); children[2].emit("close", 0, null);
      await Promise.resolve(); expect(children).toHaveLength(4);
      children[0].emit("close", null, "SIGTERM");
      expect((await observed).exitCode).toBe(9); expect(children).toHaveLength(4);
    } finally { owned.remove(); }
  });
});

describe("finite unit real four-group cleanup", () => {
  for (const trigger of ["primary", "STOP"]) it(trigger, async () => {
    const owned = unitFixture(), host = mockHost(), children: ReturnType<typeof spawn>[] = [];
    const ready: Promise<void>[] = [], closed: Promise<void>[] = [], closeCounts: number[] = [];
    host.kill = process.kill.bind(process);
    try {
      writeJson(path.join(owned.root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"] } } });
      for (const name of ["charlie", "delta", "echo"]) owned.write(name, { name, scripts: { "test:unit": "node unit.cjs" } });
      const start = () => {
        const child = spawn(process.execPath, ["-e", 'process.send("ready");setInterval(()=>{},1000);'], { cwd: owned.root, env: { PATH: path.dirname(process.execPath) + ":/usr/bin:/bin", HOME: owned.root }, detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
        const index = children.length; children.push(child); closeCounts.push(0);
        ready.push(new Promise(resolve => child.once("message", () => resolve())));
        closed.push(new Promise(resolve => child.once("close", () => { closeCounts[index]++; resolve(); })));
        return child;
      };
      const running = workspaceRunner.testWorkspaces(owned.root, { host, spawn: start as typeof spawn, environment: { npm_execpath: "/owned/npm-cli.js" }, concurrency: 4 });
      const observed = running.then(() => ({ failed: false, error: undefined }), error => ({ failed: true, error }));
      await vi.waitFor(() => expect(children).toHaveLength(4)); await Promise.all(ready);
      if (trigger === "primary") children[1].emit("error", false); else host.emit("SIGTERM");
      const result = await observed;
      expect(result.failed).toBe(true);
      if (trigger === "primary") expect(Object.is(result.error, false)).toBe(true);
      else expect(String(result.error)).toContain("interrupted");
      expect(closeCounts).toEqual([1, 1, 1, 1]); expect(children).toHaveLength(4);
      for (const child of children) expect(() => process.kill(-child.pid!, 0)).toThrow();
      expect(host.listenerCount("SIGTERM")).toBe(0);
    } finally {
      const signal = (value: NodeJS.Signals) => { for (const child of children) { try { process.kill(-child.pid!, value); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } } };
      signal("SIGTERM"); const escalation = setTimeout(() => signal("SIGKILL"), 2000);
      await Promise.all(closed); clearTimeout(escalation); owned.remove();
    }
  }, 15000);
});

describe("finite unit input and environment boundaries", () => {
  it("clears Git's repository-local hook environment without changing the parent or private configuration", async () => {
    const owned = unitFixture(), mock = mockExecution();
    try {
      const names = execFileSync("git", ["rev-parse", "--local-env-vars"], {
        cwd: owned.root, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
        encoding: "utf8", timeout: 5000, maxBuffer: 65536
      }).trim().split("\n");
      const retained = { GIT_CONFIG_GLOBAL: "/owned/private.gitconfig", GIT_CONFIG_SYSTEM: "/owned/system.gitconfig", GIT_CONFIG_NOSYSTEM: "1", GIT_SSH_COMMAND: "owned-ssh", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", HOME: owned.root };
      const environment = Object.freeze({ ...mock.environment, ...retained, ...Object.fromEntries(names.map(name => [name, `owned-hook-${name}`])) });
      await workspaceRunner.testWorkspaces(owned.root, { ...mock, environment });
      expect(mock.start).toHaveBeenCalledTimes(5);
      for (const call of mock.start.mock.calls) {
        for (const name of names) expect(call[2].env).not.toHaveProperty(name);
        expect(call[2].env).toMatchObject(retained);
      }
      for (const name of names) expect(environment[name as keyof typeof environment]).toBe(`owned-hook-${name}`);
    } finally { owned.remove(); }
  });

  it("leaves the ordinary build caller's Git environment unchanged", async () => {
    const owned = fixture(), mock = mockExecution();
    const environment = Object.freeze({ ...mock.environment, GIT_DIR: "/owned/parent.git", GIT_CONFIG_GLOBAL: "/owned/private.gitconfig" });
    try {
      await buildWorkspaces(owned.root, { ...mock, environment });
      for (const call of mock.start.mock.calls) expect(call[2].env).toMatchObject(environment);
    } finally { owned.remove(); }
  });

  it("fails before any unit-mode child when Git cannot supply its local environment contract", async () => {
    const owned = unitFixture(), mock = mockExecution();
    try {
      await expect(workspaceRunner.testWorkspaces(owned.root, { ...mock, environment: { ...mock.environment, PATH: owned.root } })).rejects.toMatchObject({ code: "ENOENT" });
      expect(mock.start).not.toHaveBeenCalled();
    } finally { owned.remove(); }
  });

  it("keeps foreign fixture configuration and branch creation out of an owned detached hook repository", async () => {
    const owned = unitFixture(), mock = mockExecution();
    try {
      const decoy = path.join(owned.root, "decoy"), foreign = path.join(owned.root, "foreign");
      fs.mkdirSync(decoy); fs.mkdirSync(foreign);
      const environment = { PATH: process.env.PATH, HOME: owned.root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
      const git = (cwd: string, args: string[], env: NodeJS.ProcessEnv = environment) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd, env, encoding: "utf8", timeout: 5000, maxBuffer: 1048576, stdio: ["ignore", "pipe", "pipe"] });
      git(decoy, ["init", "--initial-branch=main"]);
      git(decoy, ["config", "user.name", "Owned Decoy"]);
      git(decoy, ["config", "user.email", "decoy@example.invalid"]);
      git(decoy, ["commit", "--allow-empty", "-m", "owned"]);
      git(decoy, ["checkout", "--detach"]);
      const config = fs.readFileSync(path.join(decoy, ".git/config"));
      const head = fs.readFileSync(path.join(decoy, ".git/HEAD"));
      const parent = Object.freeze({ ...mock.environment, ...environment, GIT_DIR: path.join(decoy, ".git"), GIT_WORK_TREE: decoy, GIT_INDEX_FILE: path.join(decoy, ".git/index") });
      await workspaceRunner.testWorkspaces(owned.root, { ...mock, environment: parent });
      const childEnvironment = mock.start.mock.calls.find(call => call[1][4] === "test:unit")![2].env;
      git(foreign, ["init"], childEnvironment);
      git(foreign, ["config", "user.name", "Owned Fixture"], childEnvironment);
      git(foreign, ["branch", "-M", "main"], childEnvironment);
      expect(git(foreign, ["config", "--local", "user.name"], childEnvironment).trim()).toBe("Owned Fixture");
      expect(git(foreign, ["symbolic-ref", "HEAD"], childEnvironment).trim()).toBe("refs/heads/main");
      expect(fs.readFileSync(path.join(decoy, ".git/config"))).toEqual(config);
      expect(fs.readFileSync(path.join(decoy, ".git/HEAD"))).toEqual(head);
      expect(parent.GIT_DIR).toBe(path.join(decoy, ".git"));
    } finally { owned.remove(); }
  });

  it("does not open source payloads while planning the metadata-only graph", () => {
    const owned = unitFixture(), opened: string[] = [];
    try {
      fs.mkdirSync(path.join(owned.root, "packages/bash/src/commands/xan"), { recursive: true });
      fs.writeFileSync(path.join(owned.root, "packages/bash/src/commands/xan/index.ts"), "OWNED SYNTHETIC PAYLOAD MUST NOT OPEN");
      const fileSystem = { ...fs, openSync: (...args: Parameters<typeof fs.openSync>) => { opened.push(String(args[0])); return fs.openSync(...args); } };
      workspaceRunner.createWorkspaceTestPlan(owned.root, { fileSystem });
      expect(opened.every(filename => ["package.json", "turbo.json"].includes(path.basename(filename)))).toBe(true);
      expect(opened.some(filename => filename.endsWith("package.json"))).toBe(true);
    } finally { owned.remove(); }
  });

  it("does not give the root unit task a feature profile through a matching root name", async () => {
    const owned = unitFixture(), mock = mockExecution();
    try {
      writeJson(path.join(owned.root, "package.json"), { name: "virtual-bash", private: true, workspaces: ["packages/*"], scripts: { "test:unit": "node owned.cjs" } });
      await workspaceRunner.testWorkspaces(owned.root, { ...mock, environment: { ...mock.environment, SAFEJS_LOCAL_ROOT: "/owned/safe-js" } });
      const rootCall = mock.start.mock.calls.find(call => call[1].includes("--workspaces=false"))!;
      expect(rootCall[2].env?.SAFEJS_LOCAL_ROOT).toBeUndefined();
      const featureCall = mock.start.mock.calls.find(call => call[1][4] === "test:unit" && call[1].includes("--workspace=packages/bash"))!;
      expect(featureCall[2].env?.SAFEJS_LOCAL_ROOT).toBe("/owned/safe-js");
    } finally { owned.remove(); }
  });
});
