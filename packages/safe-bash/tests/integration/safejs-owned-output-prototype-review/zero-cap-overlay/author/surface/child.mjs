import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.SURFACE_ROOT;
const cases = JSON.parse(readFileSync(join(root, "inputs/CASES.json")));
const pins = JSON.parse(readFileSync(join(root, "inputs/PINS.json")));
const selected = cases.cases.find(entry => entry.id === process.env.SURFACE_CASE);
assert.ok(selected);
const sourceBytes = readFileSync(join(root, "inputs", selected.source.path));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(hash(sourceBytes), selected.source.sha256);
const source = sourceBytes.toString("utf8");
const record = {
  id: selected.id, pid: process.pid, node: process.version, started: new Date().toISOString(),
  source: { ...selected.source, actualSha256: hash(sourceBytes), exactText: source },
  argv: ["-e", source, "--", "surface-arg"], events: [], hostDescriptors: [], hostFindings: [],
  hostCounters: { acquired: 0, released: 0, cleanup: 0, childCleanup: 0 },
  runtimeCalls: 0, shellsDisposed: 0, knownWorkerCount: 0,
  engineOutcome: { kind: "not-entered" },
};
let shell;
let innerShell;
let pipe;
let collector;
let operation;
let caller;
let runSignal;
let virtualFs;
const identities = new Map();

function errorInfo(error) {
  if (error === undefined) return { type: "undefined" };
  if (error === null || typeof error !== "object") return { type: typeof error, value: String(error) };
  return Object.fromEntries(["name", "message", "code", "stack"].map(key => [key, typeof error[key] === "string" ? error[key] : null]));
}

function signalInfo(signal) {
  return signal ? { aborted: signal.aborted, reason: errorInfo(signal.reason) } : null;
}

function describe(path, value) {
  let current = value;
  for (let depth = 0; depth < 3 && current !== null; depth += 1) {
    const descriptors = Reflect.ownKeys(current).map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      const member = descriptor && "value" in descriptor ? descriptor.value : undefined;
      const identity = [...identities].filter(([, reference]) => reference === member).map(([name]) => name);
      const detail = { key: String(key), kind: "value" in descriptor ? "data" : "accessor", type: typeof member,
        enumerable: descriptor.enumerable, configurable: descriptor.configurable, identity };
      if (depth === 0 && identity.length) record.hostFindings.push({ path: `${path}.${String(key)}`, type: typeof member, identity });
      return detail;
    });
    record.hostDescriptors.push({ path, depth, descriptors });
    current = Object.getPrototypeOf(current);
  }
}

async function snapshotVfs(directory = "/") {
  const entries = [];
  async function visit(current) {
    assert.ok(entries.length < 100, "Bounded VFS inventory");
    const stat = await virtualFs.lstat(current);
    if (stat.type === "directory") {
      entries.push({ path: current, type: "directory" });
      for (const entry of await virtualFs.readdir(current)) await visit(current === "/" ? `/${entry.name}` : `${current}/${entry.name}`);
    } else if (stat.type === "file") {
      const bytes = await virtualFs.readFile(current, { maxBytes: 65536 });
      entries.push({ path: current, type: "file", bytes: bytes.length, base64: Buffer.from(bytes).toString("base64"), sha256: hash(bytes) });
    } else entries.push({ path: current, type: stat.type, target: await virtualFs.readlink(current) });
  }
  await visit(directory);
  return entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

try {
  const product = await import("virtual-bash");
  const { run } = await import(pathToFileURL(join(root, "engine/src/run.ts")).href);
  const { Budget } = await import(pathToFileURL(join(root, "engine/src/interp/budget.ts")).href);
  const { makeFsModule } = await import(pathToFileURL(join(root, "engine/src/modules/fs.ts")).href);
  const { declareHostOperation } = await import(pathToFileURL(join(root, "engine/src/interp/host-bridge.ts")).href);
  record.runtimeIdentity = { productImport: "virtual-bash", privateHead: pins.privateEngine.lastRecordedHead,
    qualification: "Actual unchanged copied source-hook injection, not installed private package import", engineEntries: pins.privateEngine.sourceEntries };
  for (const name of ["Shell", "MemoryFileSystem", "createBytePipe", "createOutputOperation", "createSafeJsCommands", "safeJsCommands", "makeSafeJsFsModule", "makeSafeJsShellModule"]) {
    assert.equal(typeof product[name], "function", name);
  }
  virtualFs = new product.MemoryFileSystem();
  await virtualFs.mkdir("/work", { recursive: true });
  await virtualFs.writeFile("/work/input", Buffer.from("seed\n"));
  record.vfsBefore = await snapshotVfs();
  caller = new AbortController();
  pipe = product.createBytePipe({ highWaterMark: 1024, signal: caller.signal });
  const captured = [];
  let capturedBytes = 0;
  collector = (async () => {
    for await (const chunk of pipe.readable) {
      capturedBytes += chunk.length;
      assert.ok(capturedBytes <= 65536, "Bounded collector");
      captured.push(Buffer.from(chunk));
    }
    return Buffer.concat(captured);
  })();
  void collector.catch(() => {});
  const limits = { maxOutputBytes: 65536, maxCommands: 8, maxLoopIterations: 8, maxSubstitutionDepth: 4,
    maxSourceBytes: 65536, maxExpansionFields: 64, maxExpansionBytes: 65536, pipeHighWaterMark: 1024 };
  shell = new product.Shell({ fs: virtualFs, cwd: "/work", env: { TAG: "surface" }, limits });
  const runtime = {
    createBudget(options) { record.budgetOptions = { ...options }; return new Budget(options); },
    makeFsModule,
    declareHostOperation,
    async run(actualSource, options) {
      record.runtimeCalls += 1;
      assert.equal(actualSource, source);
      assert.ok(options.budget instanceof Budget);
      runSignal = options.signal;
      record.runtimeOptions = { filename: options.filename, moduleNames: Object.keys(options.modules).sort(),
        budgetLimits: options.budget.limits, signalBefore: signalInfo(options.signal), sinkKeys: Object.keys(options.sink).sort() };
      let forwarded = options;
      if (selected.id === "04-shell-module") {
        innerShell = new product.Shell({ fs: virtualFs, cwd: "/work", env: { TAG: "surface" }, limits });
        innerShell.use(product.standardCommands());
        const shellModule = product.makeSafeJsShellModule((text, executionOptions) => innerShell.exec(text, executionOptions), {
          fs: virtualFs, signal: options.signal, replayPolicy: "read-side-effect", declareHostOperation,
        });
        forwarded = { ...options, modules: { ...options.modules, shell: shellModule } };
      }
      record.forwardedModuleNames = Object.keys(forwarded.modules).sort();
      for (const [name, module] of Object.entries(forwarded.modules)) {
        describe(name, module);
        for (const [key, value] of Object.entries(module)) {
          if (typeof value === "function" || value && typeof value === "object") describe(`${name}.${key}`, value);
        }
      }
      record.engineOutcome = { kind: "entered" };
      record.events.push("actual-engine-run-start");
      let result;
      let callReturned = false;
      try {
        const pending = run(actualSource, forwarded);
        callReturned = true;
        result = await pending;
      } catch (reason) {
        record.engineOutcome = {
          kind: callReturned ? "await-rejected" : "call-threw",
          reasonType: typeof reason,
          reasonIsNull: reason === null,
        };
        record.events.push(callReturned ? "actual-engine-run-rejected" : "actual-engine-run-threw");
        throw reason;
      }
      record.engineOutcome = { kind: "fulfilled" };
      record.events.push("actual-engine-run-settled");
      record.engine = result.ok ? { ok: true, returnValue: result.returnValue, resultKeys: Object.keys(result).sort() }
        : { ok: false, error: errorInfo(result.error), resultKeys: Object.keys(result).sort() };
      record.budgetUsed = { steps: options.budget.stepsUsed, deadline: options.budget.deadline, limits: options.budget.limits };
      return result;
    },
  };
  const definitions = product.createSafeJsCommands({ runtime, limits: cases.safeJsLimits });
  assert.equal(definitions.length, 1);
  const definition = definitions[0];
  shell.register({ ...definition, async execute(context) {
    assert.deepEqual(context.args, record.argv);
    assert.equal(context.stdinIsDefault, false);
    assert.equal(typeof context.invoke, "function");
    assert.equal(typeof context.registerCleanup, "function");
    const metadata = context.stdout.ownedOutput;
    assert.ok(metadata);
    assert.ok(metadata.consumerClosed instanceof AbortSignal);
    assert.equal(metadata.consumerClosed, pipe.writable.ownedOutput.consumerClosed);
    assert.equal(typeof metadata.write, "function");
    operation = product.createOutputOperation(context, context.stdout);
    assert.deepEqual(Object.keys(operation).sort(), pins.api.operationKeys);
    assert.deepEqual(Object.keys(operation.output), ["write"]);
    assert.ok(operation.signal instanceof AbortSignal);
    for (const [name, value] of Object.entries({ context, metadata, operation, operationOutput: operation.output,
      consumerClosed: metadata.consumerClosed, metadataWrite: metadata.write, operationSignal: operation.signal,
      contextRegisterCleanup: context.registerCleanup, operationRegisterCleanup: operation.registerCleanup,
      operationAcquire: operation.acquire, operationChild: operation.child, operationClose: operation.close })) identities.set(name, value);
    record.premise = { actualMetadata: true, metadataKeys: Object.keys(metadata).sort(), metadataSignalSameAsPublicPipe: true,
      operationKeys: Object.keys(operation).sort(), outputKeys: Object.keys(operation.output), operationSignalIsAbortSignal: true,
      rawGrantToGuest: false, contextForwarding: "Only stdout replaced with real operation.output; every other original field retained",
      callerSignal: signalInfo(context.signal), consumerSignal: signalInfo(metadata.consumerClosed), contextKeys: Object.keys(context).sort() };
    const token = Object.freeze({ value: "host-positive-token" });
    const acquired = await operation.acquire(signal => { assert.equal(signal, operation.signal); record.hostCounters.acquired += 1; return token; },
      resource => { assert.equal(resource, token); record.hostCounters.released += 1; });
    assert.equal(acquired, token);
    operation.registerCleanup(() => { record.hostCounters.cleanup += 1; });
    const child = operation.child(context.stdout);
    child.registerCleanup(() => { record.hostCounters.childCleanup += 1; });
    try { return await definition.execute({ ...context, stdout: operation.output }); }
    finally { await operation.close(); record.events.push("operation-close-settled"); }
  } });
  shell.register({ name: "surface-entry", async execute(context) {
    return context.invoke("safejs", record.argv);
  } });
  record.events.push("shell-exec-start");
  const result = await shell.exec("surface-entry", { stdin: "surface-input", stdout: pipe.writable, signal: caller.signal });
  record.shell = { rejected: false, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
    stdoutBase64: Buffer.from(result.stdoutBytes).toString("base64"), stderrBase64: Buffer.from(result.stderrBytes).toString("base64") };
  record.events.push("shell-exec-settled");
} catch (error) {
  record.failure = errorInfo(error);
  record.shell ??= { rejected: true, error: errorInfo(error) };
} finally {
  const failures = [];
  for (const [name, cleanup] of [
    ["operation", async () => { if (operation) await operation.close(); }],
    ["pipe", async () => { if (pipe) await pipe.close(); }],
    ["collector", async () => { if (collector) { const bytes = await collector; record.collectedStdout = bytes.toString("utf8"); record.collectedStdoutBase64 = bytes.toString("base64"); } }],
    ["innerShell", async () => { if (innerShell) { await innerShell.dispose(); record.shellsDisposed += 1; } }],
    ["shell", async () => { if (shell) { await shell.dispose(); record.shellsDisposed += 1; } }],
  ]) {
    try { await cleanup(); record.events.push(`${name}-cleanup-settled`); }
    catch (error) { failures.push({ name, error: errorInfo(error) }); }
  }
  if (virtualFs) {
    try { record.vfsAfter = await snapshotVfs(); } catch (error) { failures.push({ name: "vfs-after", error: errorInfo(error) }); }
  }
  record.cleanupFailures = failures;
  record.signalsAfter = { caller: signalInfo(caller?.signal), runtime: signalInfo(runSignal), operation: signalInfo(operation?.signal), consumer: signalInfo(pipe?.writable.ownedOutput?.consumerClosed) };
  record.activeResourcesAtResult = process.getActiveResourcesInfo();
  record.activeHandlesAtResult = process._getActiveHandles().map(handle => handle.constructor?.name ?? "unknown");
  record.completed = new Date().toISOString();
  writeFileSync(process.env.SURFACE_RESULT, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify({ id: record.id, runtimeCalls: record.runtimeCalls, resultWritten: true }) + "\n");
}
