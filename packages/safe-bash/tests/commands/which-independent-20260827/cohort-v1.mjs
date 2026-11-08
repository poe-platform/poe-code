import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";

const own = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(path.join(own, "cases-v1.json"), "utf8"));
assert.ok(process.env.WHICH_CANDIDATE_ROOT, "Explicit isolated built candidate root required; no live fallback");
const candidate = realpathSync(process.env.WHICH_CANDIDATE_ROOT);
assert.notEqual(candidate, realpathSync(path.resolve(own, "../../..")), "Use an isolated candidate extraction");
const load = relative => import(pathToFileURL(path.join(candidate, "dist", relative)).href);
const { createWhichCommand, createWhichCommands, whichCommands } = await load("commands/which/index.js");
const { MemoryFileSystem } = await load("fs/memory/index.js");
const { ReadOnlyFileSystem } = await load("fs/readonly/index.js");
const { Shell } = await load("shell/shell.js");
const { CommandRegistry, FsError, ACCESS_MODES } = await load("contracts/index.js");
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const capture = async operation => {
  try { return { kind: "return", value: await operation() }; }
  catch (reason) { return { kind: "throw", reason }; }
};
const rejected = (outcome, reason) => {
  assert.equal(outcome.kind, "throw");
  assert.ok(Object.is(outcome.reason, reason), "exact rejection identity including -0/NaN/falsy");
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const forbid = name => { throw new Error(`Forbidden which operation: ${name}`); };
async function memory() {
  const filesystem = new MemoryFileSystem();
  for (const directory of fixtures.fixture.directories) await filesystem.mkdir(directory, { recursive: true });
  for (const [filename, mode] of fixtures.fixture.files) {
    await filesystem.writeFile(filename, encoder.encode(`fixture:${filename}`));
    await filesystem.chmod(filename, mode);
  }
  for (const [filename, target] of fixtures.fixture.symlinks) await filesystem.symlink(target, filename);
  return filesystem;
}
async function prepare(recipe = {}, hooks = {}) {
  const backing = hooks.backing ?? await memory();
  const controller = hooks.controller ?? new AbortController();
  const calls = [];
  const writes = { stdout: [], stderr: [] };
  let inFlight = 0;
  const filesystem = new Proxy(backing, { get(target, property) {
    if (property === "capabilities") return hooks.capabilities ?? target.capabilities;
    if (property !== "stat" && property !== "access") return () => forbid(String(property));
    if (property === "access" && hooks.missingAccess) return undefined;
    return async (filename, modeOrOptions, accessOptions) => {
      assert.equal(inFlight++, 0, "provider calls must be sequential");
      calls.push([property, filename]);
      try {
        const options = property === "stat" ? modeOrOptions : accessOptions;
        assert.equal(options.signal, controller.signal);
        if (property === "access") assert.equal(modeOrOptions, ACCESS_MODES.X_OK);
        if (recipe.fault?.[0] === property && recipe.fault[1] === filename) {
          throw new FsError(recipe.fault[2], { path: "/host-secret", message: "HOST_SECRET" });
        }
        if (hooks[property]) return await hooks[property](filename, options, target);
        const actual = recipe.replacementStat ? decoder.decode(encoder.encode(filename)) : filename;
        return property === "stat" ? await target.stat(actual, options) : await target.access(actual, modeOrOptions, options);
      } finally { inFlight--; }
    };
  } });
  const env = {};
  const selectedPath = Object.hasOwn(recipe, "PATH") ? recipe.PATH : fixtures.fixture.PATH;
  if (selectedPath !== null) env.PATH = selectedPath;
  const args = Object.freeze([...(recipe.args ?? ["tool"])]);
  const context = { command: "which", args, cwd: recipe.cwd ?? fixtures.fixture.cwd, env: Object.freeze(env),
    fs: filesystem, signal: controller.signal };
  for (const name of ["stdin", "stdinIsDefault", "invoke", "registerCleanup"]) {
    Object.defineProperty(context, name, { get() { return forbid(name); } });
  }
  for (const channel of ["stdout", "stderr"]) context[channel] = {
    write(bytes) {
      assert.ok(bytes instanceof Uint8Array);
      writes[channel].push(Buffer.from(bytes));
      return hooks[channel]?.(bytes);
    },
    get ownedOutput() { return forbid(`${channel}.ownedOutput`); },
    close() { return forbid(`${channel}.close`); }
  };
  const execute = () => createWhichCommand({ limits: recipe.limits }).execute(context);
  return { backing, context, calls, writes, controller, execute, text: channel => Buffer.concat(writes[channel]).toString("utf8") };
}
async function check(recipe, hooks) {
  const probe = await prepare(recipe, hooks);
  const result = await probe.execute();
  const stderr = recipe.usage ? fixtures.usage : recipe.illegal !== undefined
    ? `which: illegal option -- ${recipe.illegal}\n${fixtures.usage}` : recipe.stderr ?? "";
  assert.equal(result.exitCode, recipe.usage || recipe.illegal !== undefined ? 1 : recipe.exitCode);
  assert.equal(probe.text("stdout"), recipe.stdout ?? "");
  assert.equal(probe.text("stderr"), stderr);
  if (recipe.calls) assert.deepEqual(probe.calls, recipe.calls);
  if (recipe.callCount !== undefined) assert.equal(probe.calls.length, recipe.callCount);
  if (recipe.usage || recipe.illegal !== undefined) assert.deepEqual(probe.calls, []);
  assert.ok(probe.writes.stderr.length <= 1);
  assert.ok(Buffer.byteLength(stderr) <= (recipe.limits?.maxPathBytes ?? fixtures.defaults.maxPathBytes) + 256);
  return probe;
}
for (const family of fixtures.cases.filter(row => row.variants)) test(`${family.id} ${family.name}`, { timeout: 10000 }, async () => {
  for (const recipe of family.variants) await check(recipe);
});

test("B12 exact typed provider failure classes at stat and access", { timeout: 10000 }, async () => {
  for (const method of ["stat", "access"]) {
    for (const code of fixtures.missCodes) await check({ fault: [method, "/a/tool", code], stdout: "/b/tool\n", exitCode: 0 });
    for (const [code, description] of Object.entries(fixtures.fatalCodes)) {
      await check({ args: ["-a", "tool"], fault: [method, "/b/tool", code], stdout: "/a/tool\n", stderr: `which: /b/tool: ${description}\n`, exitCode: 1 });
    }
    for (const reason of [{ code: "ENOENT" }, new Error("HOST_SECRET"), undefined, null, false, 0, "", NaN]) {
      await check({ stderr: "which: /a/tool: filesystem operation failed\n", exitCode: 1 }, { [method]: async () => { throw reason; } });
    }
  }
  await check({ fault: ["access", "/b/tool", "EIO"], stdout: "/a/tool\n", exitCode: 0, callCount: 2 });
});

test("B16 no content effects or borrowed resource acquisition", async () => {
  const probe = await prepare({ args: ["-a", "tool"] });
  const beforeBytes = await probe.backing.readFile("/a/tool");
  const beforeEntries = await probe.backing.readdir("/a");
  const args = probe.context.args;
  const env = probe.context.env;
  assert.equal((await probe.execute()).exitCode, 0);
  assert.equal(probe.context.args, args);
  assert.equal(probe.context.env, env);
  assert.equal(probe.context.cwd, "/work");
  assert.deepEqual(await probe.backing.readFile("/a/tool"), beforeBytes);
  assert.deepEqual(await probe.backing.readdir("/a"), beforeEntries);
});

test("B17 actual readonly and explicit provider permission profiles", async () => {
  await check({ stdout: "/a/tool\n", exitCode: 0 }, { backing: new ReadOnlyFileSystem(await memory()) });
  for (const capabilities of [{}, { permissions: false }]) {
    await check({ stdout: "/a/tool\n", exitCode: 0 }, { capabilities });
    await check({ stdout: "/a/tool\n", exitCode: 0 }, { capabilities,
      stat: async (filename, options, target) => ({ ...await target.stat(filename, options), mode: 0 }), access: async () => {} });
  }
  await check({ PATH: "/a", exitCode: 1, callCount: 1 }, {
    stat: async (filename, options, target) => ({ ...await target.stat(filename, options), type: "symlink" }),
    access: () => forbid("nonregular access") });
  await check({ PATH: "/a", exitCode: 1 }, { access: async () => { throw new FsError("EACCES"); } });
  await check({ args: ["-s", "tool"], exitCode: 1, stderr: "which: /a/tool: operation not supported\n" }, {
    access: async () => { throw new FsError("ENOTSUP"); } });
  await check({ exitCode: 1, stderr: "which: /a/tool: filesystem operation failed\n" }, { missingAccess: true });
});

test("B18 actual Shell module-only integration", { timeout: 10000 }, async () => {
  const { agentCommands } = await load("plugins/index.js");
  const filesystem = await memory();
  const caller = new AbortController();
  const shell = new Shell({ fs: filesystem, cwd: "/work", env: { PATH: "/a:/b" } });
  shell.use(agentCommands());
  assert.equal(shell.commands.has("which"), false, "No root/default which integration in this profile");
  shell.use(whichCommands());
  shell.commands.register({ name: "registered-only", execute: () => ({ exitCode: 0 }) });
  shell.commands.register({ name: "driver", async execute(context) {
    const result = await context.invoke("which", ["./tool"], { cwd: "/work", env: { PATH: "/unused" } });
    assert.equal(result.exitCode, 0);
    return { exitCode: 0 };
  } });
  try {
    let result = await shell.exec("PATH=/b which tool > /result; which tool; driver", { signal: caller.signal });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "/a/tool\n./tool\n");
    assert.equal(result.stderr, "");
    assert.equal(decoder.decode(await filesystem.readFile("/result")), "/b/tool\n");
    result = await shell.exec("which -a tool | head -n 1; printf 'AFTER\\n'", { signal: caller.signal });
    assert.equal(result.stdout, "/a/tool\nAFTER\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(caller.signal.aborted, false);
    result = await shell.exec("function-only() { true; }; which true registered-only function-only tool");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "/a/tool\n");
    assert.equal(result.stderr, "");
    await filesystem.writeFile("/a/registered-only", encoder.encode("file"));
    await filesystem.chmod("/a/registered-only", 0o755);
    assert.equal((await shell.exec("which registered-only")).stdout, "/a/registered-only\n");
  } finally { await shell.dispose(); }
});

const limitError = key => `which: ${key} limit exceeded\n`;
test("L01 argument PATH components NUL and admission priority", { timeout: 10000 }, async () => {
  const vectors = [
    { args: ["tool"], limits: { maxArguments: 1, maxArgumentBytes: 4 }, stdout: "/a/tool\n", exitCode: 0 },
    { args: ["-s", "tool"], limits: { maxArguments: 1 }, key: "maxArguments" },
    { args: ["", ""], limits: { maxArguments: 1 }, key: "maxArguments" },
    { args: ["tool"], limits: { maxArgumentBytes: 3 }, key: "maxArgumentBytes" },
    { args: ["é"], limits: { maxArgumentBytes: 2 }, stdout: "/a/é\n", exitCode: 0 },
    { args: ["é"], limits: { maxArgumentBytes: 1 }, key: "maxArgumentBytes" },
    { args: ["/a/tool"], PATH: "é", limits: { maxPathEnvBytes: 2 }, stdout: "/a/tool\n", exitCode: 0 },
    { args: ["/a/tool"], PATH: "é", limits: { maxPathEnvBytes: 1 }, key: "maxPathEnvBytes" },
    { args: ["tool"], PATH: ":", limits: { maxPathComponents: 2 }, stdout: "./tool\n", exitCode: 0 },
    { args: ["tool"], PATH: ":", limits: { maxPathComponents: 1 }, key: "maxPathComponents" },
    { args: ["\u0000", "tool"], limits: { maxArguments: 1, maxArgumentBytes: 1 }, key: "maxArguments" },
    { args: ["\u0000x"], limits: { maxArgumentBytes: 1 }, key: "maxArgumentBytes" },
    { args: ["\u0000"], stderr: "which: invalid argument: NUL byte\n", exitCode: 1, calls: [] },
    { args: ["/a/tool"], PATH: "\u0000", stderr: "which: invalid argument: NUL byte\n", exitCode: 1, calls: [] },
    { cwd: "/work\u0000", stderr: "which: invalid argument: NUL byte\n", exitCode: 1, calls: [] },
    { cwd: "relative", stderr: "which: cwd must be an absolute virtual path\n", exitCode: 1, calls: [] }
  ];
  for (const vector of vectors) await check(vector.key ? { ...vector, stderr: limitError(vector.key), exitCode: 1, calls: [] } : vector);
  await check({ args: Array(4097).fill(""), stderr: limitError("maxArguments"), exitCode: 1, calls: [] });
  await check({ args: ["x".repeat(65537)], stderr: limitError("maxArgumentBytes"), exitCode: 1, calls: [] });
  await check({ PATH: "x".repeat(65537), stderr: limitError("maxPathEnvBytes"), exitCode: 1, calls: [] });
  await check({ PATH: ":".repeat(4096), stderr: limitError("maxPathComponents"), exitCode: 1, calls: [] });
});

test("L02 one probe includes stat and access; suffix and silent accounting", async () => {
  await check({ limits: { maxProbes: 1 }, stdout: "/a/tool\n", exitCode: 0, callCount: 2 });
  await check({ args: ["-a", "tool"], limits: { maxProbes: 1 }, stdout: "/a/tool\n", stderr: limitError("maxProbes"), exitCode: 1, callCount: 2 });
  await check({ args: ["-as", "tool"], limits: { maxProbes: 1 }, stderr: limitError("maxProbes"), exitCode: 1, callCount: 2 });
  await check({ PATH: "/absent:/a", limits: { maxProbes: 1 }, stderr: limitError("maxProbes"), exitCode: 1, callCount: 1 });
  await check({ args: ["/a/tool/", "/a/tool"], limits: { maxProbes: 1 }, stderr: limitError("maxProbes"), exitCode: 1, calls: [] });
  await check({ args: ["", "tool"], limits: { maxProbes: 1 }, stdout: "/a/tool\n", exitCode: 1, callCount: 2 });
  await check({ args: ["tool", "/verylong/candidate"], limits: { maxProbes: 1, maxPathBytes: 7 }, stdout: "/a/tool\n", stderr: limitError("maxProbes"), exitCode: 1, callCount: 2 });
});

test("L03 separate literal path bounds and UTF-8", async () => {
  await check({ limits: { maxPathBytes: 7 }, stdout: "/a/tool\n", exitCode: 0 });
  await check({ limits: { maxPathBytes: 6 }, stderr: limitError("maxPathBytes"), exitCode: 1, calls: [] });
  await check({ cwd: "/longer-than-limit", limits: { maxPathBytes: 7 }, stderr: limitError("maxPathBytes"), exitCode: 1, calls: [] });
  await check({ PATH: ".", limits: { maxPathBytes: 12 }, stdout: "./tool\n", exitCode: 0 });
  await check({ PATH: ".", limits: { maxPathBytes: 11 }, stderr: limitError("maxPathBytes"), exitCode: 1, calls: [] });
  await check({ PATH: "/a/../a", limits: { maxPathBytes: 7 }, stderr: limitError("maxPathBytes"), exitCode: 1, calls: [] });
  await check({ args: ["é"], limits: { maxPathBytes: 5 }, stdout: "/a/é\n", exitCode: 0 });
  await check({ args: ["é"], cwd: "/", limits: { maxPathBytes: 4 }, stderr: limitError("maxPathBytes"), exitCode: 1, calls: [] });
});

test("L04 stdout line admission, separate diagnostics and backpressure", async () => {
  await check({ limits: { maxOutputBytes: 8 }, stdout: "/a/tool\n", exitCode: 0 });
  await check({ limits: { maxOutputBytes: 7 }, stderr: limitError("maxOutputBytes"), exitCode: 1 });
  await check({ args: ["-a", "tool"], limits: { maxOutputBytes: 15 }, stdout: "/a/tool\n", stderr: limitError("maxOutputBytes"), exitCode: 1 });
  await check({ args: ["-as", "tool"], limits: { maxOutputBytes: 1 }, stdout: "", exitCode: 0, callCount: 4 });
  await check({ args: ["é"], limits: { maxOutputBytes: 6 }, stdout: "/a/é\n", exitCode: 0 });
  await check({ args: ["é"], limits: { maxOutputBytes: 5 }, stderr: limitError("maxOutputBytes"), exitCode: 1 });
  const hold = deferred();
  const entered = deferred();
  let retained;
  let settled = false;
  const probe = await prepare({ args: ["-a", "tool"] }, { stdout(bytes) {
    if (!retained) { retained = bytes; entered.resolve(); return hold.promise; }
  } });
  const running = probe.execute().finally(() => { settled = true; });
  await entered.promise;
  try {
    await nextTurn();
    assert.equal(settled, false);
    assert.equal(probe.writes.stdout.length, 1);
    assert.equal(probe.calls.length, 2);
    assert.equal(decoder.decode(retained), "/a/tool\n");
  } finally { hold.resolve(); }
  assert.equal((await running).exitCode, 0);
  assert.equal(decoder.decode(retained), "/a/tool\n");
});

test("C01 preabort and cooperative provider cancellation preserve identity", { timeout: 10000 }, async () => {
  for (const reason of [{ stop: true }, null, false, 0, -0, "", NaN]) {
    const controller = new AbortController();
    controller.abort(reason);
    const pre = await prepare({}, { controller });
    rejected(await capture(pre.execute), reason);
    assert.deepEqual(pre.calls, []);
    assert.equal(pre.text("stdout") + pre.text("stderr"), "");
    for (const method of ["stat", "access"]) {
      const live = new AbortController();
      const probe = await prepare({}, { controller: live, [method]: async () => {
        live.abort(reason);
        throw new FsError("ENOENT");
      } });
      rejected(await capture(probe.execute), reason);
      assert.equal(probe.calls.length, method === "stat" ? 1 : 2);
      assert.equal(probe.text("stdout") + probe.text("stderr"), "");
    }
  }
  const undefinedController = { signal: { aborted: true, reason: undefined, throwIfAborted() { throw undefined; } } };
  const pre = await prepare({}, { controller: undefinedController });
  rejected(await capture(pre.execute), undefined);
  assert.deepEqual(pre.calls, []);
  const native = new AbortController();
  native.abort(undefined);
  assert.equal(native.signal.reason.name, "AbortError");
  const nativeProbe = await prepare({}, { controller: native });
  rejected(await capture(nativeProbe.execute), native.signal.reason);
  for (const method of ["stat", "access"]) {
    const controller = new AbortController();
    const entered = deferred();
    const reason = Object.freeze({ method });
    let listeners = 0;
    const probe = await prepare({}, { controller, [method]: async (filename, { signal }) => {
      await new Promise((resolve, reject) => {
        const onAbort = () => { signal.removeEventListener("abort", onAbort); listeners--; reject(signal.reason); };
        listeners++;
        signal.addEventListener("abort", onAbort, { once: true });
        entered.resolve();
      });
    } });
    const running = capture(probe.execute);
    await entered.promise;
    controller.abort(reason);
    rejected(await running, reason);
    assert.equal(listeners, 0);
    assert.equal(probe.text("stdout") + probe.text("stderr"), "");
  }
});

test("C02 sync/async sink failure and abort retain exact precedence", { timeout: 10000 }, async () => {
  for (const channel of ["stdout", "stderr"]) for (const asynchronous of [false, true]) {
    for (const reason of [new FsError("EIO"), undefined, null, false, 0, -0, "", NaN]) {
      const probe = await prepare({ args: channel === "stderr" ? ["-z"] : ["-a", "tool"] }, {
        [channel]: () => { if (asynchronous) return Promise.reject(reason); throw reason; }
      });
      rejected(await capture(probe.execute), reason);
      assert.equal(probe.writes[channel].length, 1);
      assert.equal(probe.writes[channel === "stdout" ? "stderr" : "stdout"].length, 0);
      assert.equal(probe.calls.length, channel === "stdout" ? 2 : 0);
    }
  }
  const reason = Object.freeze({ caller: true });
  const controller = new AbortController();
  const probe = await prepare({}, { controller, stdout() { controller.abort(reason); throw new Error("sink"); } });
  rejected(await capture(probe.execute), reason);
  const entered = deferred();
  const held = deferred();
  const lateController = new AbortController();
  const late = await prepare({}, { controller: lateController, stdout() { entered.resolve(); return held.promise; } });
  const running = capture(late.execute);
  await entered.promise;
  lateController.abort(reason);
  rejected(await running, reason);
  held.reject(new Error("handled late sink rejection"));
  await nextTurn();
  assert.equal(late.writes.stdout.length, 1);
  assert.equal(late.writes.stderr.length, 0);
});

test("T02 runtime module factory and collision controls", async () => {
  const definitions = createWhichCommands();
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].name, "which");
  const commands = new CommandRegistry();
  const incumbent = () => ({ exitCode: 7 });
  commands.register({ name: "which", execute: incumbent });
  commands.register({ name: "untouched", execute: incumbent });
  const host = { commands, use() { forbid("plugin middleware"); }, registerFileSystem() { forbid("plugin filesystem"); } };
  const plugin = whichCommands();
  assert.equal(plugin.name, "which-commands");
  assert.equal((await capture(() => plugin.setup(host))).kind, "throw");
  assert.equal(commands.get("which").execute, incumbent);
  await whichCommands({ replace: true }).setup(host);
  assert.notEqual(commands.get("which").execute, incumbent);
  assert.equal(commands.get("untouched").execute, incumbent);
});

test("T03 runtime limits reject invalid/unknown settings before execution", () => {
  for (const factory of [createWhichCommand, createWhichCommands, whichCommands]) {
    for (const key of Object.keys(fixtures.defaults)) {
      for (const invalid of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
        assert.throws(() => factory({ limits: { [key]: invalid } }), { name: "RangeError", message: `Invalid which limit: ${key}` });
      }
    }
    assert.throws(() => factory({ limits: { surprise: 1 } }), { name: "RangeError", message: "Unknown which limit: surprise" });
    assert.throws(() => factory({ limits: { maxPathBytes: Number.MAX_SAFE_INTEGER - 255 } }), { name: "RangeError", message: "Invalid which limit: maxPathBytes" });
    assert.doesNotThrow(() => factory({ limits: { maxPathBytes: Number.MAX_SAFE_INTEGER - 256 } }));
    assert.doesNotThrow(() => factory({ limits: { maxOutputBytes: Number.MAX_SAFE_INTEGER } }));
  }
});
