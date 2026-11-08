import assert from "node:assert/strict";
import { readFileSync, realpathSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import * as root from "virtual-bash";
import * as subpath from "virtual-bash/commands/which";

const own = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(path.join(own, "cases.json"), "utf8"));
assert.ok(["installed", "moved"].includes(process.env.PUBLIC_WHICH_LAYOUT), "Explicit installed or moved layout required");
assert.ok(process.env.PUBLIC_WHICH_PACKAGE_ROOT, "Authenticated installed package root required");
const packageRoot = realpathSync(process.env.PUBLIC_WHICH_PACKAGE_ROOT);
const metadata = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const capture = async operation => {
  try { return { kind: "return", value: await operation() }; }
  catch (reason) { return { kind: "throw", reason }; }
};
const rejected = (outcome, reason) => { assert.equal(outcome.kind, "throw"); assert.ok(Object.is(outcome.reason, reason)); };
const gate = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const waitEntered = (entered, running, label) => Promise.race([
  entered.promise,
  running.then(() => { throw new Error(`Settled before ${label}`); })
]);
async function memory() {
  const filesystem = new root.MemoryFileSystem();
  for (const directory of ["/a", "/b", "/work"]) await filesystem.mkdir(directory);
  for (const filename of ["/a/tool", "/b/tool"]) await filesystem.writeFile(filename, encoder.encode(`not executed:${filename}`), { mode: 0o755 });
  return filesystem;
}
async function invocation(definition, options = {}) {
  const stdout = [];
  const stderr = [];
  const context = {
    command: definition.name, args: options.args ?? ["tool"], cwd: options.cwd ?? "/work",
    env: options.env ?? { PATH: "/a:/b" }, fs: options.fs ?? await memory(), signal: options.signal ?? new AbortController().signal,
    stdin: root.toByteSource(new Uint8Array()),
    stdout: { async write(bytes) { assert.ok(bytes instanceof Uint8Array); stdout.push(Buffer.from(bytes)); await options.stdout?.(bytes); } },
    stderr: { async write(bytes) { assert.ok(bytes instanceof Uint8Array); stderr.push(Buffer.from(bytes)); await options.stderr?.(bytes); } }
  };
  options.adjust?.(context);
  const outcome = await capture(() => definition.execute(context));
  return { outcome, context, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), writes: { stdout, stderr } };
}
function host(commands = new root.CommandRegistry()) {
  return { commands, use() { throw new Error("Unexpected middleware installation"); }, registerFileSystem() { throw new Error("Unexpected filesystem registration"); } };
}
function returned(result, exitCode, stdout, stderr = "") {
  if (result.outcome.kind === "throw") throw result.outcome.reason;
  assert.equal(result.outcome.value.exitCode, exitCode);
  assert.equal(result.stdout, stdout);
  assert.equal(result.stderr, stderr);
}
async function shellFixture(options) {
  const fs = await memory();
  const shell = new root.Shell({ fs, cwd: "/work", env: { PATH: "/a:/b" } });
  shell.use(root.agentCommands(options));
  return { fs, shell };
}

test("R01 actual installed root/subpath identity and artifact boundary", () => {
  for (const name of cases.factories) {
    assert.equal(typeof root[name], "function", name);
    assert.equal(root[name], subpath[name], name);
  }
  for (const specifier of ["virtual-bash", "virtual-bash/commands/which"]) {
    const filename = realpathSync(fileURLToPath(import.meta.resolve(specifier)));
    assert.ok(filename.startsWith(packageRoot + path.sep));
    assert.ok(filename.endsWith(".js"));
    assert.equal(filename.includes(`${path.sep}src${path.sep}`), false);
  }
  assert.equal(metadata.name, "virtual-bash");
  assert.deepEqual(metadata.dependencies ?? {}, {});
  assert.equal(existsSync(path.join(packageRoot, "src")), false);
  assert.ok(metadata.exports["./commands/which"].types);
  assert.ok(metadata.exports["./commands/which"].import);
});

test("R02 public singular/plural factories execute actual discovery", async () => {
  for (const api of [root, subpath]) {
    const definitions = api.createWhichCommands();
    assert.deepEqual(definitions.map(definition => definition.name), ["which"]);
    for (const definition of [api.createWhichCommand(), definitions[0]]) returned(await invocation(definition), 0, "/a/tool\n");
  }
});

test("R03 exact77 definitions and aggregate plugin registration", async () => {
  const definitions = root.createAgentCommands();
  assert.equal(definitions.length, 77);
  assert.equal(new Set(definitions.map(command => command.name)).size, 77);
  assert.deepEqual(definitions.map(command => command.name).sort(), cases.expected77);
  const target = host();
  await root.agentCommands().setup(target);
  assert.deepEqual(target.commands.list().map(command => command.name).sort(), cases.expected77);
});

test("R04 getopts stays builtin and network/SafeJS stay optional", async () => {
  const { shell } = await shellFixture();
  try {
    for (const name of ["getopts", "curl", "safejs"]) assert.equal(shell.commands.has(name), false, name);
    const result = await shell.exec("type -t getopts");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "builtin\n");
    assert.equal(result.stderr, "");
    assert.equal(shell.commands.list().length, 77);
  } finally { await shell.dispose(); }
});

test("R05 public family plugins install only which", async () => {
  for (const api of [root, subpath]) {
    const target = host();
    const plugin = api.whichCommands();
    assert.equal(plugin.name, "which-commands");
    await plugin.setup(target);
    assert.deepEqual(target.commands.list().map(command => command.name), ["which"]);
    returned(await invocation(target.commands.get("which")), 0, "/a/tool\n");
  }
});

test("R06 aggregate which conflict preserves the entire registry", async () => {
  const commands = new root.CommandRegistry([{ name: "which", execute: () => ({ exitCode: 23 }) }, { name: "custom", execute: () => ({ exitCode: 29 }) }]);
  const before = commands.list();
  const result = await capture(() => root.agentCommands().setup(host(commands)));
  assert.equal(result.kind, "throw");
  assert.match(String(result.reason), /already registered/);
  assert.deepEqual(commands.list(), before);
  assert.equal(commands.has("printf"), false);
});

test("R07 top-level replace wins over untyped nested replace values", async () => {
  for (const topLevel of [false, true]) {
    const incumbent = () => ({ exitCode: 23 });
    const commands = new root.CommandRegistry([{ name: "which", execute: incumbent }, { name: "custom", execute: incumbent }]);
    const before = commands.list();
    const options = { replace: topLevel, which: { replace: !topLevel } };
    const result = await capture(() => root.agentCommands(options).setup(host(commands)));
    if (!topLevel) {
      assert.equal(result.kind, "throw");
      assert.deepEqual(commands.list(), before);
    } else {
      assert.equal(result.kind, "return");
      assert.equal(commands.list().length, 78);
      assert.equal(commands.get("custom"), before.find(command => command.name === "custom"));
      assert.notEqual(commands.get("which").execute, incumbent);
      returned(await invocation(commands.get("which")), 0, "/a/tool\n");
    }
  }
});

test("R08 aggregate limit forwarding through definitions and plugin", async () => {
  const options = { which: { limits: { maxProbes: 1 } } };
  const target = host();
  await root.agentCommands(options).setup(target);
  for (const definition of [root.createAgentCommands(options).find(command => command.name === "which"), target.commands.get("which")]) {
    returned(await invocation(definition, { args: ["-a", "tool"] }), 1, "/a/tool\n", "which: maxProbes limit exceeded\n");
  }
});

test("R09 invalid which options admit no partial aggregate registration", async () => {
  const target = host();
  const outcome = await capture(() => root.agentCommands({ which: { limits: { maxProbes: 0 } } }).setup(target));
  assert.equal(outcome.kind, "throw");
  assert.ok(outcome.reason instanceof RangeError);
  assert.equal(outcome.reason.message, "Invalid which limit: maxProbes");
  assert.equal(target.commands.list().length, 0);
  assert.throws(() => root.createAgentCommands({ which: { limits: { maxProbes: 0 } } }), RangeError);
});

test("R10 installed readonly provider delegates metadata X_OK without content effects", async () => {
  const backing = await memory();
  const readonly = new root.ReadOnlyFileSystem(backing);
  assert.equal(readonly.capabilities.permissions, false);
  const calls = [];
  const fs = new Proxy(readonly, { get(target, key) {
    if (key === "capabilities") return target.capabilities;
    if (key !== "stat" && key !== "access") return () => { throw new Error(`Forbidden metadata read effect: ${String(key)}`); };
    return (...args) => { calls.push([key, args[0], key === "access" ? args[1] : null]); return Reflect.apply(target[key], target, args); };
  } });
  const bytes = await backing.readFile("/a/tool");
  const entries = await backing.readdir("/a");
  returned(await invocation(root.createWhichCommand(), { fs }), 0, "/a/tool\n");
  assert.deepEqual(calls, [["stat", "/a/tool", null], ["access", "/a/tool", 1]]);
  assert.deepEqual(await backing.readFile("/a/tool"), bytes);
  assert.deepEqual(await backing.readdir("/a"), entries);
});

test("R11 public FsError instances preserve denied versus unsupported access", async () => {
  for (const code of ["EACCES", "ENOTSUP"]) {
    const backing = await memory();
    const calls = [];
    const fs = new Proxy(backing, { get(target, key) {
      if (key === "stat") return (...args) => { calls.push("stat"); return target.stat(...args); };
      if (key === "access") return async () => { calls.push("access"); throw new root.FsError(code); };
      return Reflect.get(target, key, target);
    } });
    returned(await invocation(subpath.createWhichCommand(), { fs, env: { PATH: "/a" } }), 1, "", code === "ENOTSUP" ? "which: /a/tool: operation not supported\n" : "");
    assert.deepEqual(calls, ["stat", "access"]);
  }
});

test("R12 definitions and plugin nested env fallback include which without invoke", async () => {
  for (const style of ["definitions", "plugin"]) {
    const commands = style === "definitions" ? new root.CommandRegistry(root.createAgentCommands()) : new root.CommandRegistry();
    if (style === "plugin") await root.agentCommands().setup(host(commands));
    returned(await invocation(commands.get("env"), { args: ["which", "tool"] }), 0, "/a/tool\n");
  }
});

test("R13 public which does not fall back to host or registry executables", async () => {
  const { shell } = await shellFixture();
  shell.commands.register({ name: "registered_only", execute() { throw new Error("Discovery executed registry command"); } });
  try {
    const result = await shell.exec("PATH=/missing which sh pwd registered_only");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
  let calls = 0;
  const backing = await memory();
  const fs = new Proxy(backing, { get(target, key) {
    if (key === "stat" || key === "access") return () => { calls++; throw new Error("Absent PATH must not probe"); };
    return Reflect.get(target, key, target);
  } });
  returned(await invocation(root.createWhichCommand(), { fs, args: ["/a/tool"], env: {} }), 1, "");
  assert.equal(calls, 0);
});

test("R14 aggregate Shell prefix redirect pipeline and literal invocation", { timeout: 5000 }, async () => {
  const { shell, fs } = await shellFixture();
  const caller = new AbortController();
  shell.commands.register({ name: "public_driver", async execute(context) {
    assert.equal(typeof context.invoke, "function");
    return context.invoke("which", ["./tool"], { cwd: "/a", env: { PATH: "/unused" } });
  } });
  try {
    let result = await shell.exec("PATH=/b which tool > /result; which tool; public_driver", { signal: caller.signal });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "/a/tool\n./tool\n");
    assert.equal(result.stderr, "");
    assert.equal(decoder.decode(await fs.readFile("/result")), "/b/tool\n");
    result = await shell.exec("which -a tool | head -n 1; printf 'after\\n'", { signal: caller.signal });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "/a/tool\nafter\n");
    assert.equal(result.stderr, "");
    assert.equal(caller.signal.aborted, false);
    assert.equal((await shell.exec("pwd")).stdout, "/work\n");
  } finally { await shell.dispose(); }
});

test("R15 public direct factory preabort and successful-stat cancellation", async () => {
  for (const reason of [Object.freeze({ caller: "public" }), 0]) {
    let calls = 0;
    const before = new AbortController();
    before.abort(reason);
    const fs = { async stat() { calls++; throw new Error("preabort stat"); }, async access() { calls++; } };
    const pre = await invocation(root.createWhichCommand(), { fs, signal: before.signal });
    rejected(pre.outcome, reason);
    assert.equal(calls, 0);
    const after = new AbortController();
    const backing = await memory();
    const provider = { async stat(filename, options) { const result = await backing.stat(filename, options); after.abort(reason); return result; }, async access() { calls++; } };
    const post = await invocation(subpath.createWhichCommand(), { fs: provider, signal: after.signal });
    rejected(post.outcome, reason);
    assert.equal(calls, 0);
    assert.equal(post.stdout + post.stderr, "");
  }
});

test("R16 public sink failures reject exactly without retry/extra diagnostic", async () => {
  for (const channel of ["stdout", "stderr"]) {
    const reason = Object.freeze({ sink: channel });
    let writes = 0;
    const result = await invocation(root.createWhichCommand(), { args: channel === "stderr" ? ["-z"] : ["-a", "tool"],
      [channel]: async () => { writes++; throw reason; } });
    rejected(result.outcome, reason);
    assert.equal(writes, 1);
    assert.equal(result.writes[channel === "stdout" ? "stderr" : "stdout"].length, 0);
  }
});

test("R17 public settlement awaits host-enrolled cooperative cleanup", { timeout: 5000 }, async () => {
  const { shell } = await shellFixture();
  const entered = gate();
  const release = gate();
  let cleanupCalls = 0;
  let settled = false;
  shell.use(async (context, next) => {
    if (context.command === "which") {
      assert.equal(typeof context.registerCleanup, "function");
      context.registerCleanup(() => { cleanupCalls++; entered.resolve(); return release.promise; });
    }
    return next();
  });
  const caller = new AbortController();
  const running = shell.exec("which tool", { signal: caller.signal }).finally(() => { settled = true; });
  try {
    try {
      await waitEntered(entered, running, "registered cleanup");
      await nextTurn();
      assert.equal(settled, false);
      assert.equal(cleanupCalls, 1);
      assert.equal(caller.signal.aborted, false);
    } finally { release.resolve(); }
    const result = await running;
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "/a/tool\n");
    assert.equal(result.stderr, "");
    assert.equal(cleanupCalls, 1);
  } finally {
    release.resolve();
    await running.then(() => {}, () => {});
    await shell.dispose();
  }
});

test("R18 public backpressure and no borrowed-input/output ownership acquisition", { timeout: 5000 }, async () => {
  const entered = gate();
  const release = gate();
  let retained;
  let writes = 0;
  let settled = false;
  const running = invocation(subpath.createWhichCommand(), { args: ["-a", "tool"],
    stdout(bytes) { writes++; if (writes === 1) { retained = bytes; entered.resolve(); return release.promise; } },
    adjust(context) {
      for (const name of ["stdin", "stdinIsDefault", "registerCleanup", "invoke"]) Object.defineProperty(context, name, { get() { throw new Error(`Unexpected ownership access: ${name}`); } });
      for (const name of ["stdout", "stderr"]) {
        Object.defineProperty(context[name], "ownedOutput", { get() { throw new Error("Unexpected owned output acquisition"); } });
        context[name].close = () => { throw new Error("Unexpected caller sink close"); };
      }
    }
  }).finally(() => { settled = true; });
  try {
    await waitEntered(entered, running, "first awaited write");
    await nextTurn();
    assert.equal(settled, false);
    assert.equal(writes, 1);
    assert.equal(decoder.decode(retained), "/a/tool\n");
  } finally { release.resolve(); }
  returned(await running, 0, "/a/tool\n/b/tool\n");
  assert.equal(decoder.decode(retained), "/a/tool\n");
});
