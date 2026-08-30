import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import workerThreads from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { cases } from "./cases.mjs";

const selected = cases.find(entry => entry.id === process.argv[2]);
assert.ok(selected, "Unknown bounded case");
const events = [];
const workers = [];
const mark = (event, extra = {}) => {
  const entry = { order: events.length, event, ...extra };
  events.push(entry);
  appendFileSync(process.env.INTEGRATION_EVENTS, `${JSON.stringify(entry)}\n`);
};
let shell;
let nativeAction;
let disposal;
let disposalSettled = false;
let publicSettled = false;
let context;
let inner;
let admission = false;
let cleanupPromise;
let cleanupDone = false;
let cleanupCalls = 0;
let hostCalls = 0;
let runnerCalls = 0;
let retained;
let result;
let failure;
let caught = false;
let rescue = false;
let actionFired = false;
let observerFailure;
const controller = new AbortController();
const reason = selected.reason === "record" ? Object.freeze({ kind: "caller-owned", id: selected.id }) : new Error(`caller:${selected.id}`);
const sinkReason = new Error(`sink:${selected.id}`);
const OriginalWorker = workerThreads.Worker;

workerThreads.Worker = class extends OriginalWorker {
  constructor(filename, options) {
    assert.equal(new URL(filename).pathname, join(process.env.INTEGRATION_ROOT, "consumer/node_modules/virtual-bash/dist/commands/regex-execution/worker.js"));
    super(filename, { ...options, execArgv: [...options.execArgv, `--import=${pathToFileURL(join(process.env.INTEGRATION_ROOT, "consumer/harness/guard.mjs")).href}`] });
    this.proof = { id: workers.length, threadId: this.threadId, exited: false, terminateCalls: 0, terminationSettled: false, posts: 0 };
    workers.push(this);
    mark("worker-created", { id: this.proof.id, threadId: this.threadId });
    this.on("exit", code => { this.proof.exited = true; mark("worker-exit", { id: this.proof.id, code }); });
  }
  postMessage(...args) {
    this.proof.posts += 1;
    mark("worker-post", { id: this.proof.id, count: this.proof.posts });
    const posted = super.postMessage(...args);
    if (nativeAction && !actionFired) {
      actionFired = true;
      queueMicrotask(() => { try { nativeAction(); } catch (error) { observerFailure = error; } });
    }
    return posted;
  }
  terminate() {
    this.proof.terminateCalls += 1;
    mark("worker-terminate", { id: this.proof.id });
    return super.terminate().then(code => {
      this.proof.terminationSettled = true;
      mark("worker-termination-settled", { id: this.proof.id, code });
      return code;
    });
  }
};
syncBuiltinESMExports();

const report = { id: selected.id, node: process.version, pid: process.pid, selected, events, status: "running", containment: false };
function checkpoint(label) {
  const snapshot = { cleanupDone, hostCalls, runnerCalls, workers: workers.map(worker => ({ ...worker.proof })) };
  mark(label, snapshot);
  return snapshot;
}
function assertOwnedDone(snapshot) {
  assert.equal(snapshot.cleanupDone, !selected.preabort, "Cooperative host cleanup must finish before public settlement");
  assertNativeDone(snapshot);
}
function assertNativeDone(snapshot) {
  for (const worker of snapshot.workers) {
    assert.equal(worker.exited, true, "Native worker still alive at public settlement");
    assert.equal(worker.terminationSettled, true, "Native termination promise unsettled at public settlement");
  }
}
function dispose() {
  const first = shell.dispose();
  assert.equal(shell.dispose(), first, "dispose must share completion");
  disposal ??= first.then(() => { disposalSettled = true; return checkpoint("public-dispose-settled"); });
  void disposal.catch(() => {});
}
const watchdog = setTimeout(() => {
  rescue = true;
  mark("child-watchdog-containment");
  report.containment = true;
  report.status = "watchdog-failure";
  writeFileSync(process.env.INTEGRATION_RESULT, `${JSON.stringify(report, null, 2)}\n`);
  for (const worker of workers) if (!worker.proof.exited) void worker.terminate().catch(() => {});
  process.exitCode = 91;
}, 9000);

try {
  const product = await import("virtual-bash");
  const { Shell, MemoryFileSystem, standardCommands, searchCommands, safeJsCommands, makeSafeJsShellModule } = product;
  const load = name => import(pathToFileURL(join(process.env.INTEGRATION_ROOT, "consumer/packages/safejs/src", name)).href);
  const { run } = await load("run.ts");
  const { Budget } = await load("interp/budget.ts");
  const { makeFsModule } = await load("modules/fs.ts");
  const { declareHostOperation } = await load("interp/host-bridge.ts");
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input", Buffer.from("alpha 1\nbeta\nalpha 2\n"));
  await fs.writeFile("/work/many", Buffer.from(Array.from({ length: 1024 }, (_, index) => `alpha ${index}\n`).join("")));
  const regex = { startupTimeoutMs: 2500, requestTimeoutMs: 1500, maxWorkers: 1, idleTimeoutMs: 5000 };
  const configure = target => target.use(standardCommands({ regex })).use(searchCommands({ regex }));
  const cleanup = () => {
    cleanupCalls += 1;
    if (!cleanupPromise) {
      admission = false;
      mark("host-cleanup-start");
      cleanupPromise = Promise.resolve().then(async () => {
        await inner?.dispose();
        if (selected.cooperative) {
          await new Promise(resolve => setTimeout(resolve, 12));
          mark("cooperative-release-before-public-settlement", { publicSettled, disposalSettled });
          assert.equal(publicSettled, false);
          assert.equal(disposalSettled, false);
        }
        cleanupDone = true;
        mark("host-cleanup-done");
      });
    }
    return cleanupPromise;
  };
  const observer = { name: "owned-safejs-companion-host", setup(host) {
    host.use(async (current, next) => {
      if (current.command === "safejs") {
        assert.equal(context, undefined, "One guest invocation per strict child");
        context = current;
        assert.equal(typeof current.registerCleanup, "function");
        current.registerCleanup(cleanup);
        mark("host-cleanup-registered");
        admission = true;
        if (selected.route === "bridge") inner = configure(new Shell({ fs, cwd: "/work" }));
        mark("host-admitted");
        try { return await next(); } finally { await cleanup(); }
      }
      if (current.command === "grep" || current.command === "rg") {
        mark("registered-search-entry", { command: current.command, args: current.args, stdinIsDefault: current.stdinIsDefault });
        const register = current.registerCleanup;
        assert.equal(typeof register, "function");
        current.registerCleanup = callback => {
          mark("product-cleanup-registered", { command: current.command });
          register(callback);
        };
      }
      return await next();
    });
  } };
  shell = configure(new Shell({ fs, cwd: "/work" })).use(observer);
  const runtime = { createBudget: options => new Budget(options), makeFsModule, declareHostOperation,
    run: async (source, options) => {
      runnerCalls += 1;
      assert.equal(admission, true);
      const search = declareHostOperation(async (name, args) => {
        options.signal.throwIfAborted();
        if (!admission) throw new Error("Companion invocation is closed");
        assert.ok(name === "grep" || name === "rg");
        assert.ok(Array.isArray(args) && args.every(value => typeof value === "string"));
        hostCalls += 1;
        mark("guest-search-enter", { name, args });
        const outcome = await context.invoke(name, args);
        mark("guest-search-settled", { exitCode: outcome.exitCode });
        return outcome.exitCode;
      }, "read-side-effect");
      retained = { search, signal: options.signal, modules: options.modules };
      const modules = { ...options.modules, companion: { search } };
      if (selected.route === "bridge") {
        inner.use(observer);
        modules.shell = makeSafeJsShellModule(async (text, request) => {
          hostCalls += 1;
          mark("guest-shell-enter", { text });
          try { return await inner.exec(text, request); }
          finally { assertNativeDone(checkpoint("inner-public-exec-settled")); }
        }, { fs, signal: options.signal, replayPolicy: "read-side-effect", declareHostOperation });
      }
      mark("actual-engine-run");
      return await run(source, { ...options, modules });
    },
  };
  shell.use(safeJsCommands({ runtime, limits: { timeoutMs: 6500, maxSteps: selected.maxSteps ?? 200000, maxOutputBytes: 65536 } }));
  nativeAction = selected.action ? () => {
    mark("caller-action", { action: selected.action });
    if (selected.action === "abort" || selected.action === "overlap") controller.abort(reason);
    if (selected.action === "dispose" || selected.action === "overlap") dispose();
  } : undefined;
  if (selected.preabort) controller.abort(reason);
  const quote = text => `'${text.replaceAll("'", "'\\''")}'`;
  const argv = `safejs -e ${quote(selected.guest)}${selected.pipeline ? " | head -n 1" : ""}`;
  report.publicArgv = argv;
  mark("public-exec-enter", { argv });
  try {
    result = await shell.exec(argv, { signal: controller.signal,
      ...(selected.sinkError ? { stdout: { async write() { mark("caller-sink-error"); throw sinkReason; } } } : {}) });
  } catch (error) { failure = error; caught = true; }
  publicSettled = true;
  const atSettlement = checkpoint("public-exec-settled");
  report.atSettlement = atSettlement;
  report.result = result && { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  report.error = caught ? { type: typeof failure, name: failure?.name, message: failure?.message, callerIdentity: failure === reason, sinkIdentity: failure === sinkReason } : null;
  assert.equal(observerFailure, undefined);
  assert.equal(rescue, false, "Watchdog containment never counts as product cleanup");
  assertOwnedDone(atSettlement);
  assert.equal(runnerCalls, selected.preabort ? 0 : 1);
  assert.equal(hostCalls, selected.preabort ? 0 : 1);
  if (!selected.preabort) {
    assert.ok(workers.length > 0, "Must exercise actual native regex worker");
    assert.ok(events.some(entry => entry.event === "product-cleanup-registered"));
    assert.ok(events.find(entry => entry.event === "product-cleanup-registered").order < events.find(entry => entry.event === "worker-created").order);
  }
  if (selected.action || selected.preabort) {
    assert.equal(caught, true);
    if (selected.action !== "dispose") assert.equal(failure, reason, "Strict original caller reason identity");
    else assert.match(failure.message, /disposed/u);
    if (selected.action) assert.equal(actionFired, true);
  } else if (selected.sinkError) {
    if (selected.statusControl) {
      assert.equal(caught, false);
      assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
        { exitCode: 2, stdout: "", stderr: `grep: sink:${selected.id}\n` });
    } else {
      assert.equal(caught, true);
      assert.equal(failure, sinkReason, "Strict caller sink error identity");
    }
  } else {
    assert.equal(caught, false, String(failure));
    assert.equal(result.exitCode, selected.exitCode, result.stderr);
    assert.equal(result.stdout, selected.output);
    if (selected.budget) assert.match(result.stderr, /budget exceeded.*steps/iu);
    else if (selected.guestError) assert.match(result.stderr, /bounded guest failure/u);
    else assert.equal(result.stderr, "");
  }
  if (selected.retained) {
    assert.equal(retained.signal.aborted, true);
    await assert.rejects(retained.search("grep", ["^alpha", "/work/input"]));
    await assert.rejects(retained.modules.stdio.write("late output"));
    assert.equal(hostCalls, 1);
    mark("retained-capabilities-refused");
  }
  if (!disposal) dispose();
  const disposed = await disposal;
  assertOwnedDone(disposed);
  assert.equal(disposalSettled, true);
  if (!selected.preabort) assert.equal(events.filter(entry => entry.event === "host-cleanup-done").length, 1);
  if (selected.cooperative) assert.ok(cleanupCalls >= 2, "Runtime drain and finally must overlap the same cleanup");
  report.cleanupCalls = cleanupCalls;
  report.status = "pass";
} catch (error) {
  report.status = "fail";
  report.assertion = { name: error.name, message: error.message, stack: error.stack };
  checkpoint("failure-before-rescue");
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  if (!publicSettled || workers.some(worker => !worker.proof.exited)) {
    rescue = true;
    mark("known-handles-failure-rescue");
    controller.abort(new Error("failed child containment"));
    await Promise.allSettled(workers.filter(worker => !worker.proof.exited).map(worker => worker.terminate()));
  }
  if (shell && !disposalSettled) await shell.dispose().catch(error => mark("rescue-dispose-error", { message: String(error) }));
  const tooling = await import("esbuild");
  tooling.stop();
  const processes = globalThis[Symbol.for("owned-cleanup-tool-processes")];
  await Promise.all(processes.map(({ child, proof }) => proof.closed ? undefined : new Promise(resolve => child.once("close", resolve))));
  report.toolProcesses = processes.map(({ proof }) => proof);
  report.toolProcessesClosed = processes.every(({ proof }) => proof.closed);
  report.loader = await globalThis[Symbol.for("owned-cleanup-loader-stop")]();
  assert.equal(report.loader.closed, true);
  mark("owned-tooling-closed", { processes: report.toolProcesses, loader: report.loader });
  report.containment = rescue;
  report.workers = workers.map(worker => ({ ...worker.proof }));
  report.finishedAt = new Date().toISOString();
  writeFileSync(process.env.INTEGRATION_RESULT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ id: selected.id, status: report.status, containment: rescue, workers: workers.length }));
}
