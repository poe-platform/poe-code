import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryFileSystem, Shell, safeJsCommands, makeSafeJsShellModule } from "virtual-bash";
import { cases } from "./cases.mjs";

const load = name => import(pathToFileURL(join(process.env.SURFACE_ROOT, "engine/src", name)).href);
const { run } = await load("run.ts");
const { Budget } = await load("interp/budget.ts");
const { makeFsModule } = await load("modules/fs.ts");
const { declareHostOperation } = await load("interp/host-bridge.ts");
const emit = value => console.log(JSON.stringify(value));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const limits = { maxSteps: 20000, timeoutMs: 1500, maxOutputBytes: 131072, dataSize: 1048576, maxCallDepth: 64, stringLength: 131072, arrayLength: 4096 };
const baselineResources = process.getActiveResourcesInfo().sort();

function errorRecord(error) {
  return { name: error?.name, message: error?.message, code: error?.code };
}

function hostSurface(modules, contexts) {
  const records = [];
  const seen = new Set();
  function visit(value, path, depth) {
    if (value === null || !["object", "function"].includes(typeof value) || seen.has(value)) return;
    assert.ok(depth < 8 && seen.size < 300, "Bounded facade graph");
    seen.add(value);
    assert.ok(!contexts.some(context => value === context || value === context.registerCleanup || value === context.invoke), `Host authority leaked at ${path}`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const properties = Reflect.ownKeys(descriptors).map(key => {
      const descriptor = descriptors[key];
      return { key: String(key), enumerable: descriptor.enumerable, configurable: descriptor.configurable,
        writable: descriptor.writable, type: "value" in descriptor ? typeof descriptor.value : "accessor" };
    });
    const prototypes = [];
    let prototype = Object.getPrototypeOf(value);
    for (let depth = 0; prototype !== null && depth < 4; depth++) {
      assert.equal(Object.hasOwn(prototype, "registerCleanup"), false, `${path} prototype cleanup`);
      prototypes.push(prototype === Object.prototype ? "Object.prototype" : prototype === Function.prototype ? "Function.prototype" : prototype === Array.prototype ? "Array.prototype" : "other");
      prototype = Object.getPrototypeOf(prototype);
    }
    assert.equal(prototype, null, "Bounded host prototype chain");
    records.push({ path, properties, prototypes });
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key];
      assert.ok("value" in descriptor, `Unexpected accessor ${path}.${String(key)}`);
      if (key === "registerCleanup") assert.equal(typeof descriptor.value, "string", "Only caller string data may use the cleanup name");
      visit(descriptor.value, `${path}.${String(key)}`, depth + 1);
    }
  }
  visit(modules, "modules", 0);
  return records;
}

function verifySurfaces(value) {
  assert.ok(Array.isArray(value) && value.length > 0);
  for (const [path, info] of value) {
    const data = path === "command.env";
    assert.equal(info.cleanup, data ? "string" : "undefined", path);
    assert.equal(info.ownCleanup, data, path);
    assert.equal(info.spreadCleanup, info.callable ? "unsupported-function-spread" : info.cleanup, path);
    assert.equal(info.assignedCleanup, info.cleanup, path);
    assert.deepEqual(info.spreadKeys, info.callable ? null : info.keys, path);
    assert.deepEqual(info.assignedKeys, info.keys, path);
    for (const field of ["context", "invoke", "prototype", "proto", "constructor"]) assert.equal(info[field], "undefined", `${path}.${field}`);
    if (!data) assert.ok(!info.keys.includes("registerCleanup"), path);
  }
}

async function execute(testCase) {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work");
  await memory.writeFile("/work/sentinel", new TextEncoder().encode("unchanged"));
  const effects = { writes: [], reads: [], stdinReads: 0, shellDispatches: 0, runnerCalls: 0, hostCleanups: 0 };
  const mutations = new Set(["writeFile", "writeStream", "mkdir", "rm", "rmdir", "rename", "copyFile", "link", "symlink", "chmod", "utimes", "truncate"]);
  const reads = new Set(["stat", "lstat", "readFile", "readStream", "readdir", "readlink", "realpath", "access"]);
  const fs = new Proxy(memory, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (typeof value !== "function") return value;
    return (...args) => {
      if (mutations.has(key)) effects.writes.push(String(key));
      if (reads.has(key)) effects.reads.push(String(key));
      return Reflect.apply(value, target, args);
    };
  } });
  const controller = new AbortController();
  const reason = new Error(`surface-cancel:${testCase.name}`);
  const contexts = [];
  const facadeSnapshots = [];
  const budgets = [];
  const callerEnv = Object.freeze({ registerCleanup: "caller-string-data", SURFACE: "unchanged" });
  const raw = [];
  const output = [];
  const errors = [];
  const shell = new Shell({ fs, cwd: "/work", env: callerEnv, limits: { maxOutputBytes: 131072, maxCommands: 4 } });
  shell.use(async (context, next) => {
    const registration = context.registerCleanup;
    assert.equal(typeof registration, "function");
    assert.equal(context.fs, fs);
    const descriptor = Object.getOwnPropertyDescriptor(context, "registerCleanup");
    let cleaned = false;
    registration(() => { if (!cleaned) { cleaned = true; effects.hostCleanups++; } });
    contexts.push(context);
    try { return await next(); }
    finally { assert.deepEqual(Object.getOwnPropertyDescriptor(context, "registerCleanup"), descriptor); }
  });
  const runtime = {
    async run(source, options) {
      effects.runnerCalls++;
      facadeSnapshots.push(hostSurface(options.modules, contexts));
      assert.ok(options.signal instanceof AbortSignal);
      try {
        const result = await run(source, options);
        raw.push({ ok: result.ok, ...(result.ok ? { value: result.returnValue } : { error: errorRecord(result.error) }) });
        return result;
      } catch (error) {
        raw.push({ thrown: errorRecord(error) });
        throw error;
      }
    },
    createBudget(options) { budgets.push({ ...options }); return new Budget(options); },
    makeFsModule,
    declareHostOperation,
  };
  shell.use(safeJsCommands({ runtime, limits: { ...limits, ...testCase.limits } }));
  const stdin = { async *[Symbol.asyncIterator]() { effects.stdinReads++; yield new TextEncoder().encode("must-not-read"); } };
  const stdout = { async write(bytes) { output.push(Buffer.from(bytes)); if (testCase.abortOnWrite) controller.abort(reason); } };
  const stderr = { async write(bytes) { errors.push(Buffer.from(bytes)); } };
  let observed;
  let caught;
  let followup;
  const negativeResults = [];
  try {
    if (testCase.preAbort) controller.abort(reason);
    if (testCase.route === "command") {
      try { observed = await shell.exec(`safejs -p -e ${quote(testCase.source)} -- registerCleanup`, { signal: controller.signal, stdin, stdout, stderr }); }
      catch (error) { caught = error; }
      if (testCase.followup) followup = await shell.exec(`safejs -p -e ${quote(testCase.followup)}`, { signal: controller.signal });
      for (const negative of testCase.negativeSources ?? []) {
        const result = await shell.exec(`safejs -p -e ${quote(negative.source)}`, { signal: controller.signal });
        negativeResults.push({ source: negative.source, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
      }
    } else {
      const bridge = makeSafeJsShellModule((source, options) => {
        effects.shellDispatches++;
        assert.equal(options.fs, fs);
        assert.equal(options.signal, controller.signal);
        return shell.exec(source, options);
      }, { fs, signal: controller.signal, replayPolicy: "read-side-effect", declareHostOperation });
      const budget = runtime.createBudget({ ...limits, deadline: Date.now() + limits.timeoutMs });
      try { observed = await runtime.run(testCase.source, { budget, filename: testCase.name, modules: { shell: bridge }, signal: controller.signal }); }
      catch (error) { caught = error; }
    }
    const stdoutText = Buffer.concat(output).toString();
    const stderrText = Buffer.concat(errors).toString();
    const value = testCase.route === "bridge" ? observed?.returnValue : observed?.exitCode === 0 ? JSON.parse(stdoutText) : undefined;
    emit({ type: "observation", name: testCase.name, route: testCase.route, stdout: stdoutText, stderr: stderrText,
      exitCode: observed?.exitCode, engine: raw, cancellation: caught ? { error: errorRecord(caught), exactCallerReason: caught === reason } : null,
      value, followup: followup && { stdout: followup.stdout, stderr: followup.stderr, exitCode: followup.exitCode },
      negativeResults,
      effects, budgets, facadeSnapshots,
      hostContexts: contexts.map(context => ({ keys: Object.keys(context).sort(), cleanupDescriptor: { type: typeof context.registerCleanup, enumerable: Object.getOwnPropertyDescriptor(context, "registerCleanup").enumerable } })),
    });
    if (testCase.assertion === "cancel") {
      assert.equal(caught, reason);
      assert.equal(effects.runnerCalls, testCase.preAbort ? 0 : 1);
      assert.equal(stdoutText, testCase.preAbort ? "" : "surface-probed");
    } else {
      if (testCase.assertion !== "bad-option") assert.equal(caught, undefined);
      if (["surfaces", "reflection", "undefined-list", "local-only"].includes(testCase.assertion)) {
        if (testCase.route === "command") { assert.equal(observed.exitCode, 0, stderrText); assert.equal(stderrText, ""); }
        else assert.equal(observed.ok, true, observed.error?.message);
      }
      switch (testCase.assertion) {
        case "surfaces": verifySurfaces(value); break;
        case "reflection":
          assert.ok(value.every(([, type]) => type === "undefined"));
          assert.equal(negativeResults.length, testCase.negativeSources.length);
          for (let index = 0; index < negativeResults.length; index++) {
            assert.equal(negativeResults[index].exitCode, 1);
            assert.equal(negativeResults[index].stdout, "");
            assert.equal(negativeResults[index].stderr, testCase.negativeSources[index].stderr);
          }
          break;
        case "undefined-list": {
          const expected = Array(17).fill("undefined");
          expected[9] = "function";
          expected[10] = "function";
          assert.deepEqual(value, expected);
          break;
        }
        case "missing-export": assert.equal(observed.exitCode, 1); assert.match(stderrText, /does not export 'registerCleanup'/); break;
        case "absent-call": assert.equal(observed.exitCode, 1); assert.equal(stderrText, "safejs: Attempted to call a non-function value.\n"); break;
        case "local-only":
          assert.deepEqual(value, ["guest-only", "string", "caller-string-data"]);
          assert.equal(followup.exitCode, 0, followup.stderr);
          assert.deepEqual(JSON.parse(followup.stdout), ["undefined", "caller-string-data"]);
          break;
        case "step-budget": assert.equal(observed.exitCode, 124); assert.match(stderrText, /budget|steps/i); break;
        case "bad-option": assert.equal(caught?.name, "TypeError"); assert.equal(caught?.message, "Unsupported option: registerCleanup"); break;
      }
    }
    assert.deepEqual(effects.writes, []);
    assert.equal(effects.stdinReads, 0);
    assert.equal(effects.shellDispatches, testCase.dispatches ?? 0);
    assert.deepEqual(effects.reads, testCase.reads ? ["stat"] : []);
    assert.equal(effects.hostCleanups, contexts.length);
    assert.deepEqual(callerEnv, { registerCleanup: "caller-string-data", SURFACE: "unchanged" });
    assert.deepEqual(await memory.readdir("/work"), [{ name: "sentinel", type: "file" }]);
    assert.equal(new TextDecoder().decode(await memory.readFile("/work/sentinel")), "unchanged");
  } finally {
    await shell.dispose();
    controller.abort();
    await new Promise(resolve => setTimeout(resolve, 20));
    emit({ type: "cleanup", name: testCase.name, hostCleanups: effects.hostCleanups, admittedContexts: contexts.length, effects, engine: raw,
      stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString(), resources: process.getActiveResourcesInfo().sort() });
    assert.deepEqual(effects.writes, []);
    assert.equal(effects.hostCleanups, contexts.length);
  }
}

let failures = 0;
emit({ type: "runtime", pid: process.pid, node: process.version, baselineResources, productImport: import.meta.resolve("virtual-bash"), engineMode: "explicit-current-source-hook-injection-not-private-package-import" });
for (const testCase of cases) {
  emit({ type: "start", name: testCase.name });
  try { await execute(testCase); emit({ type: "pass", name: testCase.name }); }
  catch (error) { failures++; emit({ type: "fail", name: testCase.name, error: errorRecord(error), stack: error.stack }); }
}
emit({ type: "complete", total: cases.length, failures, resources: process.getActiveResourcesInfo().sort() });
process.exitCode = failures ? 1 : 0;
