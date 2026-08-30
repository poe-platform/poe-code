import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import workerThreads from "node:worker_threads";

const [manifestPath, scenario] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const snapshot = realpathSync(manifest.snapshot);
const [command, mode] = scenario.split(":");
const regexOverrides = mode.endsWith("sibling") ? { idleTimeoutMs: 5000 } : {};
const nativeWorker = workerThreads.Worker;
const workers = [];
const workerRecords = new WeakMap();
const events = [];
const boundaries = [];
const imports = new Map();
const unhandled = [];
let requestObserver;
let sequence = 0;
let passed = false;
let sourcePinned = false;
let failure;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const event = (name, detail = {}) => { const recorded = { sequence: ++sequence, name, ...detail }; events.push(recorded); return recorded.sequence; };

assert.equal(digest(readFileSync(fileURLToPath(import.meta.url))), manifest.probeHash);
assert.equal(digest(readFileSync(join(snapshot, "package.json"))), manifest.packageHash);
const packageManifest = JSON.parse(readFileSync(join(snapshot, "package.json"), "utf8"));
const publicEntry = realpathSync(join(snapshot, packageManifest.exports["."].import));
assert.equal(publicEntry, join(snapshot, "dist/index.js"));

function emitted(path) {
  const canonical = realpathSync(path);
  const relativePath = relative(snapshot, canonical);
  assert.ok(relativePath.startsWith("dist/"), `Unexpected product import: ${canonical}`);
  const hash = digest(readFileSync(canonical));
  assert.equal(hash, manifest.emittedHashes[relativePath], `Emitted identity: ${relativePath}`);
  return { path: relativePath, sha256: hash };
}

workerThreads.Worker = class ObservedNativeWorker extends nativeWorker {
  constructor(filename, options) {
    const identity = emitted(filename instanceof URL ? fileURLToPath(filename) : filename);
    assert.equal(identity.path, "dist/commands/regex-execution/worker.js");
    super(filename, options);
    const record = { id: workers.length + 1, ...identity, exited: false, terminateCalls: 0, terminationDone: false, requests: [] };
    workers.push(record);
    workerRecords.set(this, record);
    event("native-worker-created", { worker: record.id });
    this.on("exit", code => { record.exited = true; record.exitCode = code; event("native-worker-exit", { worker: record.id, code }); });
  }
  postMessage(message, ...options) {
    super.postMessage(message, ...options);
    const record = workerRecords.get(this);
    record.requests.push({ id: message.id, kind: message.descriptor?.kind, rows: message.rows?.length });
    event("native-request-sent", { worker: record.id, id: message.id, rows: message.rows?.length });
    requestObserver?.(record, message);
  }
  terminate() {
    const record = workerRecords.get(this);
    record.terminateCalls++;
    event("native-terminate-called", { worker: record.id });
    const retirement = super.terminate();
    void retirement.then(code => {
      record.terminationDone = true;
      event("native-terminate-resolved", { worker: record.id, code });
    }, error => { record.terminationFailure = String(error); event("native-terminate-rejected", { worker: record.id }); });
    return retirement;
  }
};
syncBuiltinESMExports();
const guard = registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith("file:")) {
      const identity = emitted(fileURLToPath(url));
      imports.set(identity.path, identity.sha256);
    }
    return nextLoad(url, context);
  },
});
const rejected = reason => { unhandled.push(String(reason)); };
process.on("unhandledRejection", rejected);

function deferred() {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  return { promise, resolve };
}

function boundary(name, owned = workers) {
  const record = { sequence: event(name), name, workers: owned.map(worker => ({ id: worker.id, exited: worker.exited, terminateCalls: worker.terminateCalls, terminationDone: worker.terminationDone })) };
  boundaries.push(record);
  assert.ok(owned.length > 0, `${name}: no actual worker observed`);
  for (const worker of record.workers) {
    assert.equal(worker.exited, true, `${name}: worker ${worker.id} has not exited`);
    assert.ok(worker.terminateCalls > 0, `${name}: no native retirement started`);
    assert.equal(worker.terminationDone, true, `${name}: native termination promise incomplete`);
  }
}

try {
  const { Shell, MemoryFileSystem, CommandRegistry, createStandardCommands, createSearchCommands } = await import(pathToFileURL(publicEntry).href);
  sourcePinned = true;
  const definitions = [...createStandardCommands({ regex: regexOverrides }), ...createSearchCommands({ regex: regexOverrides })];
  const makeShell = () => new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(definitions) });
  const shell = makeShell();
  assert.ok(shell.commands.has("grep"));
  assert.ok(shell.commands.has("rg"));
  assert.ok(shell.commands.has("head"));
  const source = command === "grep" ? "grep -E '^a'" : "rg '^a'";
  const input = "ab\n".repeat(200);
  const stdout = [];
  const stderr = [];
  const sinks = {
    stdout: { async write(chunk) { stdout.push(...chunk); } },
    stderr: { async write(chunk) { stderr.push(...chunk); } },
  };
  if (mode === "normal" || mode === "early-pipe") {
    const result = await shell.exec(mode === "early-pipe" ? `${source} | head -n 1` : source, { stdin: input, ...sinks });
    boundary("exec-settled");
    const expected = mode === "early-pipe" ? "ab\n" : input;
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
    assert.deepEqual([...result.stdoutBytes], [...Buffer.from(expected)]);
    assert.deepEqual(stdout, [...Buffer.from(expected)]);
    assert.deepEqual(stderr, []);
    await shell.dispose();
    boundary("dispose-settled");
  } else if (mode === "caller-abort") {
    const controller = new AbortController();
    const reason = { marker: "public-caller-abort", code: "EPIPE" };
    let aborted = false;
    requestObserver = (_worker, message) => {
      if (!aborted && message.rows.length > 0) { aborted = true; event("caller-abort"); controller.abort(reason); }
    };
    let rejectedExecution = false;
    await shell.exec(source, { stdin: input, signal: controller.signal, ...sinks }).then(() => assert.fail("Expected caller rejection"), error => {
      rejectedExecution = true;
      boundary("exec-rejected");
      assert.equal(error, reason);
    });
    assert.equal(aborted, true);
    assert.equal(rejectedExecution, true);
    assert.deepEqual(stdout, []);
    assert.deepEqual(stderr, []);
    await shell.dispose();
    boundary("dispose-settled");
  } else {
    assert.ok(mode === "same-shell-sibling" || mode === "other-shell-sibling");
    const siblingShell = mode === "same-shell-sibling" ? shell : makeShell();
    const siblingReady = deferred();
    const releaseSibling = deferred();
    const siblingOutput = [];
    let siblingSignal;
    let siblingSettled = false;
    siblingShell.use((context, next) => {
      if (context.command === command && context.args.includes("^b")) siblingSignal = context.signal;
      return next();
    });
    const siblingSource = command === "grep" ? "grep -E '^b'" : "rg '^b'";
    const siblingExecution = siblingShell.exec(siblingSource, {
      stdin: { async *[Symbol.asyncIterator]() {
        yield Buffer.from("bb\n");
        await releaseSibling.promise;
        yield Buffer.from("bb\n");
      } },
      stdout: { async write(chunk) {
        siblingOutput.push(...chunk);
        if (Buffer.from(siblingOutput).toString() === "bb\n") siblingReady.resolve();
      } },
    }).then(result => { siblingSettled = true; return result; });
    void siblingExecution.catch(() => {});
    await siblingReady.promise;
    assert.equal(siblingSettled, false);
    assert.ok(siblingSignal);
    const controller = new AbortController();
    const reason = { marker: "only-this-invocation" };
    let ownedWorker;
    requestObserver = (worker, message) => {
      if (!ownedWorker && message.rows.length > 0 && message.descriptor.patterns.includes("^a")) {
        ownedWorker = worker;
        event("caller-abort", { worker: worker.id });
        controller.abort(reason);
      }
    };
    await shell.exec(source, { stdin: input, signal: controller.signal, ...sinks }).then(() => assert.fail("Expected caller rejection"), error => {
      assert.ok(ownedWorker);
      boundary("exec-rejected-owned", [ownedWorker]);
      assert.equal(error, reason);
    });
    assert.equal(siblingSignal.aborted, false);
    assert.equal(siblingSettled, false);
    assert.deepEqual(stdout, []);
    assert.deepEqual(stderr, []);
    if (mode === "other-shell-sibling") {
      await shell.dispose();
      boundary("dispose-settled-owned", [ownedWorker]);
      assert.equal(siblingSignal.aborted, false);
      assert.equal(siblingSettled, false);
    }
    requestObserver = undefined;
    event("release-sibling-input");
    releaseSibling.resolve();
    const result = await siblingExecution;
    boundary("sibling-exec-settled");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "bb\nbb\n");
    assert.equal(result.stderr, "");
    assert.equal(siblingSignal.aborted, false);
    assert.ok(workers.length >= 2, "Sibling must issue a real request after its shared worker retires");
    await siblingShell.dispose();
    boundary("sibling-dispose-settled");
    await shell.dispose();
    boundary("dispose-settled-owned", [ownedWorker]);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(workers.filter(worker => !worker.exited).length, 0);
  assert.deepEqual(unhandled, []);
  assert.ok(imports.has("dist/index.js"));
  passed = true;
} catch (error) {
  failure = { name: error?.name, message: error?.message, stack: error?.stack };
  process.exitCode = 1;
} finally {
  guard.deregister();
  workerThreads.Worker = nativeWorker;
  syncBuiltinESMExports();
  process.off("unhandledRejection", rejected);
  console.log(JSON.stringify({ scenario, passed, failure, runtimeCommit: manifest.runtimeCommit, callbackCommit: manifest.callbackCommit, sourcePinned, regexOverrides, publicEntry, imports: Object.fromEntries(imports), workers, boundaries, events, liveWorkers: workers.filter(worker => !worker.exited).length, unhandled }));
}
