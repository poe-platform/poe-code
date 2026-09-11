import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { CommandRegistry, FsError, type FsOptions } from "../../src/contracts/index.js";
import { createWhichCommand } from "../../src/commands/which/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { resolveLimits } from "../../src/shell/runtime.js";
import { cloudflareWorkerLimits } from "../../src/shell/worker-limits.js";
import { PathLookup } from "../../src/shell/path-lookup.js";
import { InvocationScope } from "../../src/shell/cleanup.js";

function fixture(context: TestContext, path = "/first:/second") {
  const fs = new MemoryFileSystem();
  const commands = new CommandRegistry();
  const shell = new Shell({ fs, commands, env: { PATH: path } });
  context.after(() => shell.dispose());
  return { fs, commands, shell };
}

const script = new TextEncoder().encode(":");
const limitIs = (name: string) => (error: unknown): boolean => error instanceof ShellLimitError && error.limit === name;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("PATH lookup consults at most 64 of 9000 nonexistent directories", async context => {
  const fs = new MemoryFileSystem();
  const stat = context.mock.method(fs, "stat");
  const shell = new Shell({ fs, commands: new CommandRegistry(), env: {
    PATH: Array.from({ length: 9000 }, (_, index) => `/missing${index}`).join(":"),
  } });
  context.after(() => shell.dispose());
  try {
    await assert.rejects(shell.exec("missing"), error => error instanceof ShellLimitError && error.limit === "maxPathComponents");
  } finally {
    assert.equal(stat.mock.callCount(), 64);
  }
});

test("PATH lookup caches negative candidates within one exec", async context => {
  const fs = new MemoryFileSystem();
  const stat = context.mock.method(fs, "stat");
  const shell = new Shell({ fs, commands: new CommandRegistry(), env: { PATH: "/absent:/also-absent" } });
  context.after(() => shell.dispose());
  assert.equal((await shell.exec("command -v missing; command -v missing")).exitCode, 1);
  assert.equal(stat.mock.callCount(), 2);
});

test("PATH lookup caches positive metadata but rechecks executable access", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/bin");
  await fs.writeFile("/bin/tool", new TextEncoder().encode(":"), { mode: 0o755 });
  const stat = context.mock.method(fs, "stat");
  const access = context.mock.method(fs, "access");
  const shell = new Shell({ fs, commands: new CommandRegistry(), env: { PATH: "/bin" } });
  context.after(() => shell.dispose());
  assert.equal((await shell.exec("command -v tool; command -v tool")).stdout, "/bin/tool\n/bin/tool\n");
  assert.equal(stat.mock.callCount(), 1);
  assert.equal(access.mock.callCount(), 2);
});

test("PATH component defaults, overrides and expansion admission stay independent", async context => {
  assert.equal(resolveLimits().maxPathComponents, 64);
  assert.equal(cloudflareWorkerLimits.maxPathComponents, 64);
  assert.equal(resolveLimits().maxFileSystemOperations, 100_000);
  for (const maximum of [-1, 0.5, NaN, Infinity]) assert.throws(() => resolveLimits({ maxPathComponents: maximum }), RangeError);
  const { fs, shell } = fixture(context, "/first:/second:/third");
  const stat = context.mock.method(fs, "stat");
  await assert.rejects(shell.exec("missing", { limits: { maxExpansionFields: 2 } }), limitIs("maxExpansionFields"));
  assert.equal(stat.mock.callCount(), 0);
  await assert.rejects(shell.exec("missing", { limits: { maxPathComponents: 0 } }), limitIs("maxPathComponents"));
  assert.equal(stat.mock.callCount(), 0);
  await assert.rejects(shell.exec("missing", { limits: { maxPathComponents: 2 } }), limitIs("maxPathComponents"));
  assert.equal(stat.mock.callCount(), 2);
});

test("PATH cap counts consulted components, not unused trailing directories", async context => {
  const { fs, shell } = fixture(context, Array.from({ length: 9000 }, (_, index) => `/dir${index}`).join(":"));
  await fs.mkdir("/dir0");
  await fs.writeFile("/dir0/tool", script, { mode: 0o755 });
  const stat = context.mock.method(fs, "stat");
  assert.equal((await shell.exec("command -v tool")).stdout, "/dir0/tool\n");
  assert.equal(stat.mock.callCount(), 1);
  await assert.rejects(shell.exec("type -ap tool"), limitIs("maxPathComponents"));
  assert.equal(stat.mock.callCount(), 65);
  assert.equal((await shell.exec("command -v /dir0/tool", { limits: { maxPathComponents: 0 } })).exitCode, 0);
});

test("PATH lookup consumes the existing shared filesystem ledger, including cache-hit access", async context => {
  const { fs, commands, shell } = fixture(context);
  const stat = context.mock.method(fs, "stat");
  await assert.rejects(shell.exec("missing", { limits: { maxFileSystemOperations: 1 } }), limitIs("maxFileSystemOperations"));
  assert.equal(stat.mock.callCount(), 1);
  assert.equal((await shell.exec("command -v missing; command -v missing", { limits: { maxFileSystemOperations: 2 } })).exitCode, 1);
  assert.equal(stat.mock.callCount(), 3);
  commands.register({ name: "probe", async execute({ fs }) { await fs.stat("/"); return { exitCode: 0 }; } });
  await assert.rejects(shell.exec("command -v missing; probe", { limits: { maxFileSystemOperations: 2 } }), limitIs("maxFileSystemOperations"));
  await fs.mkdir("/first");
  await fs.writeFile("/first/tool", script, { mode: 0o755 });
  const access = context.mock.method(fs, "access");
  await assert.rejects(shell.exec("command -v tool; command -v tool", { limits: { maxFileSystemOperations: 2 } }), limitIs("maxFileSystemOperations"));
  assert.equal(access.mock.callCount(), 0);
  await assert.rejects(shell.exec("command -v tool; command -v tool", { limits: { maxFileSystemOperations: 3 } }), limitIs("maxFileSystemOperations"));
  assert.equal(access.mock.callCount(), 1);
});

test("PATH cache is reset for every exec and filesystem override", async context => {
  const { fs, shell } = fixture(context, "/");
  assert.equal((await shell.exec("command -v tool")).exitCode, 1);
  await fs.writeFile("/tool", script, { mode: 0o755 });
  assert.equal((await shell.exec("command -v tool")).exitCode, 0);
  assert.equal((await shell.exec("command -v tool", { fs: new MemoryFileSystem() })).exitCode, 1);
  await fs.rm("/tool");
  assert.equal((await shell.exec("command -v tool")).exitCode, 1);
});

for (const path of ["bin", "", ":bin"]) test(`PATH cache keys resolve cwd for ${JSON.stringify(path)}`, async context => {
  const { fs, shell } = fixture(context, path);
  await fs.mkdir("/left/bin", { recursive: true });
  await fs.mkdir("/right/bin", { recursive: true });
  await fs.writeFile(path === "bin" ? "/left/bin/tool" : "/left/tool", script, { mode: 0o755 });
  const result = await shell.exec("cd /left; command -v tool; cd /right; command -v tool; cd /left; command -v tool");
  const target = path === "bin" ? "bin/tool" : "./tool";
  assert.equal(result.stdout, `${target}\n${target}\n`);
  assert.equal(result.exitCode, 0);
});

for (const invocation of ["create", "result=$(create)", "(create)", "sh -c create"]) test(`PATH miss invalidates after opaque mutation in ${invocation}`, async context => {
  const { fs, commands, shell } = fixture(context, "/");
  commands.register({ name: "create", async execute() { await fs.writeFile("/tool", script, { mode: 0o755 }); return { exitCode: 0 }; } });
  const result = await shell.exec(`command -v tool; ${invocation}; command -v tool`);
  assert.equal(result.stdout, "/tool\n");
  assert.equal(result.exitCode, 0);
});

for (const mutation of ["remove", "directory", "chmod", "replace-link"]) test(`PATH positive cache invalidates on ${mutation}`, async context => {
  const { fs, commands, shell } = fixture(context);
  await fs.mkdir("/first");
  await fs.mkdir("/second");
  await fs.writeFile("/first/tool", script, { mode: 0o755 });
  await fs.writeFile("/second/tool", script, { mode: 0o755 });
  commands.register({ name: "mutate", async execute({ fs }) {
    if (mutation === "chmod") await fs.chmod!("/first/tool", 0o644);
    else {
      await fs.rm("/first/tool");
      if (mutation === "directory") await fs.mkdir("/first/tool");
      if (mutation === "replace-link") await fs.symlink!("/missing", "/first/tool");
    }
    return { exitCode: 0 };
  } });
  assert.equal((await shell.exec("command -v tool; mutate; command -v tool")).stdout, "/first/tool\n/second/tool\n");
});

test("PATH invalidation restores earlier candidates and observes shell redirection writes", async context => {
  const { fs, commands, shell } = fixture(context);
  await fs.mkdir("/first");
  await fs.mkdir("/second");
  await fs.writeFile("/second/tool", script, { mode: 0o755 });
  commands.register({ name: "create", async execute({ fs }) { await fs.writeFile("/first/tool", script, { mode: 0o755 }); return { exitCode: 0 }; } });
  assert.equal((await shell.exec("command -v tool; create; command -v tool")).stdout, "/second/tool\n/first/tool\n");
  const result = await shell.exec("command -v fresh; : > /first/fresh; source fresh");
  assert.equal(result.exitCode, 0, result.stderr);
});

test("PATH caching resumes after shell output finalization", async context => {
  const { fs, shell } = fixture(context, "/");
  const stat = context.mock.method(fs, "stat");
  assert.equal((await shell.exec("command -v missing; : > /created; command -v missing; command -v missing")).exitCode, 1);
  assert.equal(stat.mock.calls.filter(call => call.arguments[0] === "/missing").length, 2);
});

test("PATH cache is disabled throughout middleware mutation", async context => {
  const { fs, shell } = fixture(context, "/");
  let calls = 0;
  shell.use(async (_context, next) => {
    if (++calls === 2) await fs.writeFile("/tool", script, { mode: 0o755 });
    return next();
  });
  assert.equal((await shell.exec("command -v tool; command -v tool")).stdout, "/tool\n");
});

test("PATH source search shares bounded metadata but always checks read access", async context => {
  const { fs, shell } = fixture(context);
  await fs.mkdir("/second");
  await fs.writeFile("/second/file", script);
  const stat = context.mock.method(fs, "stat");
  const access = context.mock.method(fs, "access");
  assert.equal((await shell.exec("source file; source file")).exitCode, 0);
  assert.equal(stat.mock.callCount(), 4);
  assert.equal(access.mock.callCount(), 4);
  await assert.rejects(shell.exec("source missing", { limits: { maxPathComponents: 1 } }), limitIs("maxPathComponents"));
  await assert.rejects(shell.exec("source missing", { limits: { maxFileSystemOperations: 1 } }), limitIs("maxFileSystemOperations"));
});

test("PATH source and executable permission probes are not interchangeable", async context => {
  const { fs, shell } = fixture(context, "/");
  await fs.writeFile("/file", script, { mode: 0o644 });
  assert.equal((await shell.exec("source file; command -v file")).exitCode, 1);
  await fs.chmod("/file", 0o111);
  const result = await shell.exec("command -v file; source file");
  assert.equal(result.stdout, "/file\n");
  assert.equal(result.exitCode, 1);
});

test("PATH access denial is never cached and cannot be bypassed by a positive hit", async context => {
  const { fs, shell } = fixture(context, "/");
  await fs.writeFile("/tool", script, { mode: 0o755 });
  let calls = 0;
  context.mock.method(fs, "access", async () => {
    if (++calls === 2) throw new FsError("EACCES", { path: "/tool" });
  });
  const result = await shell.exec("command -v tool; command -v tool; command -v tool");
  assert.equal(result.stdout, "/tool\n/tool\n");
  assert.equal(calls, 3);
});

test("PATH cancellation interrupts a pending probe and preserves errno-shaped reason", async context => {
  const { fs, shell } = fixture(context);
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { path: "/cancel" });
  const stat = context.mock.method(fs, "stat", async () => {
    controller.abort(reason);
    return new Promise<never>(() => {});
  });
  await assert.rejects(shell.exec("command -v missing", { signal: controller.signal }), error => error === reason);
  assert.equal(stat.mock.callCount(), 1);
});

test("PATH cache bounds entries and bytes without resetting the filesystem ledger", async context => {
  const { fs, shell } = fixture(context, "/");
  const stat = context.mock.method(fs, "stat");
  const source = `${Array.from({ length: 257 }, (_, index) => `command -v missing${index}`).join("; ")}; command -v missing0`;
  assert.equal((await shell.exec(source)).exitCode, 1);
  assert.equal(stat.mock.callCount(), 258);
  const lookup = new PathLookup();
  const signal = new AbortController().signal;
  const paths = Array.from({ length: 20 }, (_, index) => `${`/${"a".repeat(199)}`.repeat(20)}/${index}`);
  for (const path of paths) assert.equal(await lookup.isFile(fs, path, signal), false);
  await lookup.isFile(fs, paths[0]!, signal);
  assert.equal(stat.mock.callCount(), 279);
});

test("which retains its own component limit and shares the shell filesystem ledger", async context => {
  const { fs, commands, shell } = fixture(context);
  commands.register(createWhichCommand());
  const stat = context.mock.method(fs, "stat");
  await assert.rejects(shell.exec("which missing", { limits: { maxFileSystemOperations: 1 } }), limitIs("maxFileSystemOperations"));
  assert.equal(stat.mock.callCount(), 1);
  const result = await shell.exec("which missing", { env: { PATH: Array.from({ length: 9000 }, () => "/x").join(":") } });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxPathComponents/u);
  assert.equal(stat.mock.callCount(), 1);
});

test("PATH cache is suspended across concurrent opaque pipeline invocations", async context => {
  const { fs, commands, shell } = fixture(context, "/");
  const missed = deferred();
  const created = deferred();
  commands.register({ name: "observe", async execute(context) {
    assert.equal((await context.invoke!("command", ["-v", "tool"])).exitCode, 1);
    missed.resolve();
    await created.promise;
    return context.invoke!("command", ["-v", "tool"]);
  } });
  commands.register({ name: "create", async execute() {
    await missed.promise;
    await fs.writeFile("/tool", script, { mode: 0o755 });
    created.resolve();
    return { exitCode: 0 };
  } });
  const result = await shell.exec("create | observe");
  assert.equal(result.stdout, "/tool\n");
  assert.equal(result.exitCode, 0);
});

test("PATH cache does not publish an older probe across a mutation generation", async context => {
  const fs = new MemoryFileSystem();
  const lookup = new PathLookup();
  const signal = new AbortController().signal;
  const probed = deferred();
  const finish = deferred();
  const stat = fs.stat.bind(fs);
  let first = true;
  context.mock.method(fs, "stat", async (path: string, options?: FsOptions) => {
    if (!first) return stat(path, options);
    first = false;
    try { return await stat(path, options); }
    catch (error) { probed.resolve(); await finish.promise; throw error; }
  });
  const pending = lookup.isFile(fs, "/tool", signal);
  await probed.promise;
  const resume = lookup.suspend();
  await fs.writeFile("/tool", script);
  resume();
  finish.resolve();
  assert.equal(await pending, false);
  assert.equal(await lookup.isFile(fs, "/tool", signal), true);
});

test("PATH cache remains suspended until all opaque cleanup finishes", async () => {
  const fs = new MemoryFileSystem();
  const lookup = new PathLookup();
  const scope = new InvocationScope();
  const started = deferred();
  const finish = deferred();
  const signal = new AbortController().signal;
  lookup.suspendUntilClosed(scope);
  scope.register(async () => {
    started.resolve();
    await finish.promise;
    await fs.writeFile("/tool", script);
  });
  const closing = scope.close();
  await started.promise;
  assert.equal(await lookup.isFile(fs, "/tool", signal), false);
  finish.resolve();
  await closing;
  assert.equal(await lookup.isFile(fs, "/tool", signal), true);
});

for (const reason of [undefined, null, false, 0]) test(`PATH cleanup preserves ${String(reason)} failures without recursive close`, async context => {
  const fs = new MemoryFileSystem();
  const lookup = new PathLookup();
  const failures: unknown[] = [];
  const scope = new InvocationScope(undefined, failures);
  const close = context.mock.method(scope, "close");
  const stat = context.mock.method(fs, "stat");
  const signal = new AbortController().signal;
  lookup.suspendUntilClosed(scope);
  scope.register(() => { throw reason; });
  await scope.close();
  assert.deepEqual(failures, [reason]);
  assert.equal(close.mock.callCount(), 1);
  await lookup.isFile(fs, "/missing", signal);
  await lookup.isFile(fs, "/missing", signal);
  assert.equal(stat.mock.callCount(), 1);
});
