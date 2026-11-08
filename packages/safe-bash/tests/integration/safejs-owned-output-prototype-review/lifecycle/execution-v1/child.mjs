import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { serialize } from "./common.mjs";
import { guardState } from "./guard.mjs";

const root = process.env.SURFACE_ROOT;
const cases = JSON.parse(readFileSync(join(root, "consumer/harness/CASES.json"), "utf8"));
const row = cases.rows.find(entry => entry.id === process.env.LIFECYCLE_ROW);
assert.ok(row);
const source = readFileSync(join(root, "consumer/harness", row.guest), "utf8");
const events = [];
const report = { id: row.id, selected: row, pid: process.pid, node: process.version, started: new Date().toISOString(),
  events, classification: "UNPROVED", containment: false, assertions: [], boundary: [], engineRuns: 0 };
let publicSettled = false;
let outer;
let inner;
let outputOperation;
let serviceOperation;
let graphParent;
let runtimeSignal;
let observedEngineError;
let observedEngineResult;
let callerCaught = false;
let publicError;
let publicResult;
let selectedGuestStatus;
let acquisitions = 0;
let releases = 0;
let accountedWriteCalls = 0;
let ordinaryDestinationWriteCalls = 0;
let cleanupDone = false;
let cleanupErrorObserved = false;
let lateWriteErrorObserved = false;
let diagnosticRejected = false;
let holdEntries = 0;
let lateEntries = 0;
let prefixWritten = false;
let holdRelease;
let holdReleased = false;
let holdReleaseSignalAborted;
let graphClosing = false;
let leftReleases = 0;
let rightReleases = 0;
let lateAcquisitionStarts = 0;
let lateChildCreations = 0;
let rightEffect = "";
let parentAbortedOnNormalClose;
let curlStatus;
let curlWriteoutCalls = 0;
let transportAbortedByConsumer = false;
let transportClosed = false;
let responseDisposed = false;
let uploadEof = false;
let uploadBeforeEof = false;
let transportCleanupRegistered = false;
let authorizeCalls = 0;
const uploadBytes = [];
const bridgePending = new Set();
const stdout = [];
const stderr = [];
const unhandled = [];
const caller = new AbortController();
const callerError = new Error("caller:L05-caller-error");
const executionError = new Error(`execution:${row.id}`);
const cleanupError = new Error(`cleanup:${row.id}`);
const curlConsumerError = Object.assign(new Error("consumer:L06-curl-consumer-closed"), { code: "EPIPE" });
const mark = (event, detail = {}) => {
  assert.ok(events.length < cases.containment.eventMaxCount, "Bounded event journal");
  events.push({ order: events.length + 1, event, publicSettled, ...detail });
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((fulfilled, failed) => { resolve = fulfilled; reject = failed; });
  void promise.catch(() => {});
  return { promise, resolve, reject };
};
const pendingWrite = deferred();
const leftClosed = deferred();
const rightCleanup = deferred();
let rightCleanupEntered = false;
let lateChecksDone = false;
const maybeReleaseRight = () => {
  if (rightCleanupEntered && lateChecksDone) { mark("right-cleanup-explicit-release"); rightCleanup.resolve(); }
};
const onUnhandled = reason => { unhandled.push(serialize(reason)); mark("unhandled-rejection", { error: serialize(reason) }); };
process.on("unhandledRejection", onUnhandled);
const outputFile = join(root, "logs", `${row.id}.json`);
const persist = () => writeFileSync(outputFile, JSON.stringify(report, null, 2) + "\n");
const watchdog = setTimeout(() => {
  report.classification = "FAIL";
  report.containment = true;
  report.watchdog = "Frozen 7000ms child deadline; no acceptance after containment";
  report.guard = guardState();
  persist();
  process.exit(124);
}, cases.containment.childDeadlineMs);
function check(name, action) {
  try { action(); report.assertions.push({ name, pass: true }); }
  catch (error) { report.assertions.push({ name, pass: false, error: serialize(error) }); }
}
function observedContext(context, label) {
  assert.equal(typeof context.registerCleanup, "function");
  return { signal: context.signal, registerCleanup(callback) {
    mark("cleanup-registered", { label });
    context.registerCleanup(callback);
  } };
}
async function closeObserved(operation, label) {
  if (!operation) return;
  mark("close-enter", { label });
  const pending = operation.close();
  assert.equal(operation.close(), pending, "Close completion is shared");
  try { await pending; mark("close-settled", { label }); }
  catch (error) {
    if (error === cleanupError) cleanupErrorObserved = true;
    mark("close-rejected", { label, cleanupIdentity: error === cleanupError, error: serialize(error) });
    throw error;
  }
}
try {
  const product = await import("virtual-bash");
  for (const specifier of ["virtual-bash/shell/runtime", "virtual-bash/commands/safejs/io",
    pathToFileURL("/Users/kjopek/Workspace/safe-bash/dist/index.js").href,
    pathToFileURL("/Users/kjopek/Workspace/poe-code/packages/safejs/src/run.ts").href,
    pathToFileURL(join(root, "product/src/index.ts")).href]) {
    let blocked = false;
    try { await import(specifier); } catch (error) {
      blocked = error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" || /Outside import:|No archive-source fallback/u.test(error.message);
      report.boundary.push({ specifier, blocked, error: serialize(error) });
    }
    assert.equal(blocked, true, specifier);
  }
  const { Shell, MemoryFileSystem, safeJsCommands, makeSafeJsShellModule, createOutputOperation, curlCommands } = product;
  for (const value of [Shell, MemoryFileSystem, safeJsCommands, makeSafeJsShellModule, createOutputOperation, curlCommands]) assert.equal(typeof value, "function");
  const contracts = await import("virtual-bash/contracts/output");
  assert.equal(contracts.createOutputOperation, createOutputOperation);
  const engineLoad = filename => import(pathToFileURL(join(root, "engine/src", filename)).href);
  const { run } = await engineLoad("run.ts");
  const { Budget } = await engineLoad("interp/budget.ts");
  const { makeFsModule } = await engineLoad("modules/fs.ts");
  const { declareHostOperation } = await engineLoad("interp/host-bridge.ts");
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  outer = new Shell({ fs, cwd: "/work", env: {} });
  const limits = { ...cases.defaultSafeJsLimits, ...(row.maxSteps === undefined ? {} : { maxSteps: row.maxSteps }) };
  const runtime = { createBudget(options) {
    report.budgetOptions = options;
    return new Budget(options);
  }, makeFsModule, declareHostOperation, async run(text, options) {
    assert.equal(text, source);
    runtimeSignal = options.signal;
    runtimeSignal.addEventListener("abort", () => mark("facade-signal-aborted", { reason: serialize(runtimeSignal.reason), callerIdentity: runtimeSignal.reason === callerError }), { once: true });
    const modules = { ...options.modules };
    if (row.route === "shell-module") modules.shell = makeSafeJsShellModule(async (command, request) => {
      mark("facade-executor-enter", { command, stdin: request.stdin });
      const pending = inner.exec(command, request);
      bridgePending.add(pending);
      try { return await pending; }
      finally { bridgePending.delete(pending); mark("facade-executor-settled", { command }); }
    }, { fs, signal: options.signal, replayPolicy: "read-side-effect", declareHostOperation });
    report.engineRuns += 1;
    mark("engine-enter", { modules: Object.keys(modules), filename: options.filename });
    try {
      const result = await run(text, { ...options, modules });
      observedEngineResult = result;
      if (!result.ok) observedEngineError = result.error;
      mark("engine-return", { ok: result.ok, returnValue: typeof result.returnValue === "object" ? "object" : result.returnValue, error: result.ok ? undefined : serialize(result.error) });
      return result;
    } catch (error) { observedEngineError = error; mark("engine-rejected", { error: serialize(error) }); throw error; }
  } };
  outer.use(safeJsCommands({ runtime, limits }));
  outer.commands.register({ name: "owned-guest", async execute(context) {
    assert.equal(typeof context.invoke, "function");
    mark("owned-guest-enter");
    const consumer = new AbortController();
    const destination = { async write(bytes) { ordinaryDestinationWriteCalls += 1; await context.stdout.write(bytes); }, ownedOutput: {
      consumerClosed: consumer.signal, async write(bytes) {
        accountedWriteCalls += 1;
        mark("accounted-write-enter", { bytes: Buffer.from(bytes).toString("hex") });
        await context.stdout.write(bytes);
        mark("accounted-write-settled", { bytes: Buffer.from(bytes).toString("hex") });
        if (Buffer.from(bytes).toString() === "queued\n") {
          prefixWritten = true;
          if (row.id === "L03-callback-live") holdRelease?.();
        }
      },
    } };
    outputOperation = createOutputOperation(observedContext(context, "guest-output"), destination);
    mark("operation-created", { label: "guest-output" });
    await outputOperation.acquire(() => {
      acquisitions += 1; mark("acquire-start", { label: "guest-output" }); return { id: row.id };
    }, async resource => {
      assert.equal(resource.id, row.id);
      releases += 1; mark("resource-release-enter", { label: "guest-output" });
      assert.equal(publicSettled, false);
      if (row.id === "L05-caller-error") {
        pendingWrite.reject(executionError);
        try { await pendingWrite.promise; } catch (error) {
          assert.equal(error, executionError); lateWriteErrorObserved = true; mark("late-write-rejection-observed", { executionIdentity: true });
        }
      }
      cleanupDone = true;
      mark("resource-release-done", { label: "guest-output" });
      if (row.workflow === "L05") { cleanupErrorObserved = true; mark("resource-release-rejected", { cleanupIdentity: true }); throw cleanupError; }
    });
    if (row.route === "shell-module") {
      serviceOperation = createOutputOperation(observedContext(context, "inner-shell"), { async write() { throw new Error("Inner service operation has no output route"); } });
      inner = await serviceOperation.acquire(() => { mark("inner-shell-acquire"); return new Shell({ fs, cwd: "/work", env: {} }); }, async resource => {
        mark("inner-dispose-enter"); await resource.dispose(); mark("inner-dispose-settled");
      });
      if (row.workflow === "L03") {
        inner.commands.register({ name: "owned-hold", async execute(current) {
          holdEntries += 1; mark("hold-command-enter");
          const gate = deferred();
          holdRelease = () => {
            if (holdReleased) return;
            holdReleased = true; holdReleaseSignalAborted = runtimeSignal.aborted;
            mark("hold-explicit-release", { facadeSignalAborted: holdReleaseSignalAborted }); gate.resolve();
          };
          const operation = createOutputOperation(observedContext(current, "hold"), current.stdout);
          await operation.acquire(() => { mark("hold-acquired"); return gate; }, resource => {
            assert.equal(resource, gate); holdRelease(); mark("hold-resource-released");
          });
          if (row.id === "L03-callback-live" && prefixWritten) holdRelease();
          try { await gate.promise; return { exitCode: 0 }; }
          finally { await closeObserved(operation, "hold"); }
        } });
        inner.commands.register({ name: "owned-late", async execute(current) {
          lateEntries += 1; mark("late-command-enter");
          await current.fs.writeFile("/work/late.txt", Buffer.from("late\n"), { signal: current.signal });
          mark("late-command-effect"); return { exitCode: 0 };
        } });
      }
      if (row.workflow === "L04") {
        graphParent = createOutputOperation(observedContext(context, "graph-parent"), { async write() { throw new Error("Graph parent has no direct output route"); } });
        inner.commands.register({ name: "owned-leaf", async execute(current) {
          const side = current.args[0]; mark("leaf-command-enter", { side });
          if (side === "late") {
            let denied = false;
            try { graphParent.child(current.stdout); lateChildCreations += 1; } catch (error) { denied = true; mark("late-guest-child-refused", { error: serialize(error) }); }
            assert.equal(denied, true); return { exitCode: 3 };
          }
          assert.ok(side === "left" || side === "right");
          const child = graphParent.child(current.stdout);
          current.registerCleanup(child.close);
          mark("child-enrolled", { side });
          await child.acquire(() => { mark("child-acquire-start", { side }); return side; }, async value => {
            assert.equal(value, side);
            if (side === "left") leftReleases += 1;
            else {
              rightCleanupEntered = true; mark("right-cleanup-enter");
              assert.equal(publicSettled, false); assert.equal(graphClosing, true);
              maybeReleaseRight(); await rightCleanup.promise; rightReleases += 1;
            }
            mark("child-release-done", { side });
          });
          if (side === "left") {
            await child.output.write(Buffer.from("left\n"));
            await closeObserved(child, "left"); leftClosed.resolve();
          } else {
            await leftClosed.promise;
            assert.equal(graphClosing, false); assert.equal(child.signal.aborted, false); assert.equal(rightReleases, 0);
            await child.output.write(Buffer.from("right\n")); rightEffect = "right\n";
            mark("right-effect-after-left-close"); graphClosing = true;
            const closing = graphParent.close();
            assert.equal(graphParent.close(), closing); mark("parent-close-enter");
            let acquisitionError;
            try { await graphParent.acquire(() => { lateAcquisitionStarts += 1; return 1; }, () => {}); }
            catch (error) { acquisitionError = error; mark("late-host-acquire-refused", { error: serialize(error) }); }
            assert.ok(acquisitionError);
            let childError;
            try { graphParent.child(current.stdout); lateChildCreations += 1; }
            catch (error) { childError = error; mark("late-host-child-refused", { error: serialize(error) }); }
            assert.equal(childError, acquisitionError);
            lateChecksDone = true; maybeReleaseRight(); await closing;
            parentAbortedOnNormalClose = graphParent.signal.aborted;
            mark("parent-close-settled", { signalAborted: parentAbortedOnNormalClose });
          }
          return { exitCode: 0 };
        } });
      }
      if (row.workflow === "L06") {
        const uploadGate = deferred();
        const curlConsumer = new AbortController();
        let cleanupPromise;
        const closeTransport = () => cleanupPromise ??= Promise.resolve().then(() => {
          uploadGate.resolve(); transportClosed = true; mark("transport-cleanup-done");
        });
        inner.use(curlCommands({ limits: cases.curlInputs.limits, authorize(request) {
          authorizeCalls += 1; assert.equal(request.url, cases.curlInputs.authorizedUrl); assert.equal(request.method, cases.curlInputs.method);
          assert.equal(request.redirectFrom, undefined); mark("transport-authorized"); return true;
        }, async transport(request) {
          assert.equal(typeof request.registerCleanup, "function");
          request.registerCleanup(closeTransport); transportCleanupRegistered = true; mark("transport-cleanup-registered");
          assert.equal(request.url, cases.curlInputs.authorizedUrl); assert.equal(request.method, cases.curlInputs.method);
          assert.ok(request.body); mark("transport-enter");
          for await (const chunk of request.body) {
            uploadBytes.push(Buffer.from(chunk)); mark("transport-upload-received", { hex: Buffer.from(chunk).toString("hex") });
            if (uploadBytes.length === 1) {
              uploadBeforeEof = !uploadEof; assert.equal(uploadBeforeEof, true);
              if (row.closeCurlConsumer) { curlConsumer.abort(curlConsumerError); mark("curl-consumer-closed", { reasonIdentity: curlConsumer.signal.reason === curlConsumerError }); }
              transportAbortedByConsumer = request.signal.aborted;
              assert.equal(transportAbortedByConsumer, false); uploadGate.resolve();
            }
          }
          assert.equal(uploadEof, true);
          let disposePromise;
          return { status: 200, statusText: "OK", httpVersion: "1.1", headers: cases.curlInputs.responseHeaders,
            body: (async function* () { for (const hex of cases.curlInputs.responseChunksHex) yield Buffer.from(hex, "hex"); })(),
            dispose() { return disposePromise ??= Promise.resolve().then(async () => { responseDisposed = true; mark("response-disposed"); await closeTransport(); }); } };
        } }));
        inner.commands.register({ name: "owned-curl", async execute(current) {
          mark("owned-curl-enter");
          const input = (async function* () {
            const buffer = Buffer.alloc(3);
            buffer.set(Buffer.from(cases.curlInputs.uploadChunksHex[0], "hex")); yield buffer;
            await uploadGate.promise;
            buffer.set(Buffer.from(cases.curlInputs.uploadChunksHex[1], "hex")); yield buffer;
            uploadEof = true; mark("upload-eof");
          })();
          const sink = { async write(bytes) { await current.stdout.write(bytes); }, ownedOutput: { consumerClosed: curlConsumer.signal, async write(bytes) {
            curlWriteoutCalls += 1; mark("curl-accounted-write", { hex: Buffer.from(bytes).toString("hex") }); await current.stdout.write(bytes);
          } } };
          const result = await current.invoke("curl", cases.curlInputs.args, { stdin: input, stdinIsDefault: false, stdout: sink, stderr: current.stderr });
          curlStatus = result.exitCode; mark("curl-invoke-settled", { status: curlStatus, transportClosed, responseDisposed });
          await current.stderr.write(Buffer.from(cases.curlInputs.independentStderr));
          return result;
        } });
      }
    }
    let failed = false;
    let failure;
    let result;
    try {
      report.literalInvoke = { name: "safejs", args: ["-e", source, "--", ...row.guestArgs] };
      result = await context.invoke("safejs", report.literalInvoke.args, { stdout: outputOperation.output, stderr: context.stderr, stdin: context.stdin, stdinIsDefault: false });
      selectedGuestStatus = result.exitCode; mark("safejs-invoke-settled", { status: result.exitCode });
    } catch (error) { failed = true; failure = error; mark("safejs-invoke-rejected", { error: serialize(error), executionIdentity: error === executionError }); }
    for (const [operation, label] of [[outputOperation, "guest-output"], [graphParent, "graph-parent"], [serviceOperation, "inner-shell"]]) {
      try { await closeObserved(operation, label); } catch (error) { if (!failed) { failed = true; failure = error; } }
    }
    if (failed) throw failure;
    return result;
  } });
  const publicStdout = { async write(bytes) {
    const text = Buffer.from(bytes).toString();
    if (row.workflow === "L05" && row.id !== "L05-cleanup-error" && text === "selected\n") {
      mark("public-write-rejection-point");
      if (row.id === "L05-caller-error") {
        queueMicrotask(() => { mark("caller-abort-request"); caller.abort(callerError); });
        return pendingWrite.promise;
      }
      throw executionError;
    }
    stdout.push(Buffer.from(bytes)); mark("public-stdout-accepted", { hex: Buffer.from(bytes).toString("hex") });
  } };
  const publicStderr = { async write(bytes) {
    if (row.id === "L05-execution-error") { diagnosticRejected = true; mark("public-diagnostic-rejected", { executionIdentity: true, attemptedHex: Buffer.from(bytes).toString("hex") }); throw executionError; }
    stderr.push(Buffer.from(bytes)); mark("public-stderr-accepted", { hex: Buffer.from(bytes).toString("hex") });
  } };
  mark("public-exec-enter", { command: "owned-guest" });
  try { publicResult = await outer.exec("owned-guest", { signal: caller.signal, stdin: Buffer.alloc(0), stdout: publicStdout, stderr: publicStderr }); }
  catch (error) { callerCaught = true; publicError = error; }
  publicSettled = true;
  report.atSettlement = { acquisitions, releases, cleanupDone, bridgePending: bridgePending.size, cleanupErrorObserved, lateWriteErrorObserved,
    innerDisposed: events.some(entry => entry.event === "inner-dispose-settled"), callerIdentity: publicError === callerError,
    executionIdentity: publicError === executionError, cleanupIdentity: publicError === cleanupError, callerAborted: caller.signal.aborted,
    ordinaryDestinationWriteCalls, accountedWriteCalls, holdEntries, lateEntries, holdReleased, holdReleaseSignalAborted,
    leftReleases, rightReleases, lateAcquisitionStarts, lateChildCreations, rightEffect, parentAbortedOnNormalClose,
    curlStatus, curlWriteoutCalls, transportAbortedByConsumer, transportClosed, responseDisposed, uploadBeforeEof, uploadEof, authorizeCalls, transportCleanupRegistered };
  mark("public-exec-settled");
  report.publicOutcome = { kind: callerCaught ? "rejection" : "result", result: publicResult && { exitCode: publicResult.exitCode, stdout: publicResult.stdout, stderr: publicResult.stderr },
    error: callerCaught ? serialize(publicError) : undefined, stdoutHex: Buffer.concat(stdout).toString("hex"), stderrHex: Buffer.concat(stderr).toString("hex") };
  report.engine = { ok: observedEngineResult?.ok, returnValue: typeof observedEngineResult?.returnValue === "object" ? "object" : observedEngineResult?.returnValue, error: observedEngineError === undefined ? undefined : serialize(observedEngineError) };
  report.files = {};
  for (const filename of ["/work/late.txt", "/work/body.bin", "/work/headers.txt"]) {
    try { report.files[filename] = { hex: Buffer.from(await fs.readFile(filename)).toString("hex") }; }
    catch (error) { report.files[filename] = { code: error.code }; }
  }
  check("actual engine and supported helper admission", () => {
    assert.equal(report.engineRuns, 1); assert.equal(report.atSettlement.acquisitions, 1); assert.equal(report.atSettlement.releases, 1); assert.equal(report.atSettlement.cleanupDone, true);
    assert.ok(events.find(entry => entry.event === "cleanup-registered" && entry.label === "guest-output").order < events.find(entry => entry.event === "acquire-start").order);
    assert.equal(ordinaryDestinationWriteCalls, 0);
  });
  check("frozen public result and exact accepted bytes", () => {
    assert.equal(report.publicOutcome.kind, row.expect.publicKind);
    if (row.expect.exitCode !== undefined) assert.equal(publicResult?.exitCode, row.expect.exitCode);
    if (row.expect.stdout !== undefined) assert.equal(Buffer.concat(stdout).toString(), row.expect.stdout);
    if (row.expect.stdoutHex !== undefined) assert.equal(Buffer.concat(stdout).toString("hex"), row.expect.stdoutHex);
    if (row.expect.stderr !== undefined) assert.equal(Buffer.concat(stderr).toString(), row.expect.stderr);
    if (row.expect.identity) assert.equal(publicError, { callerError, executionError, cleanupError }[row.expect.identity]);
    if (row.expect.accountedWriteCalls !== undefined) assert.equal(accountedWriteCalls, row.expect.accountedWriteCalls);
  });
  check("before-settlement ownership", () => {
    assert.equal(report.atSettlement.cleanupDone, true); assert.equal(report.atSettlement.bridgePending, 0);
    for (const entry of events.filter(entry => ["resource-release-done", "inner-dispose-settled", "child-release-done", "hold-resource-released", "transport-cleanup-done", "response-disposed"].includes(entry.event))) assert.equal(entry.publicSettled, false);
    if (row.route === "shell-module") assert.equal(report.atSettlement.innerDisposed, true);
  });
  if (row.workflow === "L02") check("same-source real step budget", () => {
    assert.ok(events.some(entry => entry.event === "public-stdout-accepted" && entry.hex === Buffer.from("before-budget\n").toString("hex")));
    if (row.id.endsWith("positive")) assert.equal(observedEngineResult.returnValue, 4096);
    else {
      assert.equal(observedEngineError.code, "budgetExceeded"); assert.equal(observedEngineError.budget, "steps");
      assert.equal(observedEngineError.current, 2049); assert.equal(observedEngineError.limit, 2048); assert.equal(accountedWriteCalls, 1);
    }
  });
  if (row.workflow === "L03") check("queued callback lifetime and actual effects", () => {
    assert.equal(holdEntries, 1); assert.equal(holdReleased, true); assert.equal(prefixWritten, true);
    assert.equal(lateEntries, row.expect.lateEntries);
    if (row.id.endsWith("live")) assert.equal(report.files["/work/late.txt"].hex, Buffer.from("late\n").toString("hex"));
    else {
      assert.equal(report.files["/work/late.txt"].code, "ENOENT"); assert.equal(holdReleaseSignalAborted, true);
      assert.ok(events.find(entry => entry.event === "engine-return").order < events.find(entry => entry.event === "facade-signal-aborted").order);
      assert.ok(events.find(entry => entry.event === "facade-signal-aborted").order < events.find(entry => entry.event === "hold-explicit-release").order);
    }
  });
  if (row.workflow === "L04") check("explicit parent and distinct sibling ownership", () => {
    assert.equal(report.atSettlement.leftReleases, 1); assert.equal(report.atSettlement.rightReleases, 1); assert.equal(report.atSettlement.rightEffect, "right\n");
    assert.equal(report.atSettlement.lateAcquisitionStarts, 0); assert.equal(report.atSettlement.lateChildCreations, 0); assert.equal(report.atSettlement.parentAbortedOnNormalClose, false);
    assert.ok(events.some(entry => entry.event === "late-guest-child-refused"));
    assert.ok(events.find(entry => entry.event === "close-settled" && entry.label === "left").order < events.find(entry => entry.event === "right-effect-after-left-close").order);
  });
  if (row.workflow === "L05") check("exact primary and observed secondary failures", () => {
    assert.equal(cleanupErrorObserved, true);
    if (row.id === "L05-caller-error") { assert.equal(caller.signal.reason, callerError); assert.equal(lateWriteErrorObserved, true); }
    if (row.id === "L05-execution-error") assert.equal(diagnosticRejected, true);
    if (row.id === "L05-cleanup-error") { assert.equal(selectedGuestStatus, 0); assert.equal(observedEngineResult.ok, true); assert.equal(caller.signal.aborted, false); }
  });
  if (row.workflow === "L06") check("streaming transport and independent required effects", () => {
    assert.equal(authorizeCalls, 1); assert.equal(uploadBeforeEof, true); assert.equal(uploadEof, true);
    assert.equal(Buffer.concat(uploadBytes).toString("hex"), cases.curlInputs.uploadChunksHex.join(""));
    assert.equal(report.atSettlement.transportCleanupRegistered, true); assert.equal(report.atSettlement.transportClosed, true); assert.equal(report.atSettlement.responseDisposed, true);
    assert.equal(events.find(entry => entry.event === "curl-invoke-settled").transportClosed, true);
    assert.equal(events.find(entry => entry.event === "curl-invoke-settled").responseDisposed, true);
    assert.equal(transportAbortedByConsumer, false); assert.equal(curlStatus, row.expect.curlStatus); assert.equal(curlWriteoutCalls, row.expect.writeoutAccountedCalls);
    for (const [filename, text] of Object.entries(cases.curlInputs.requiredFiles)) assert.equal(report.files[filename].hex, Buffer.from(text).toString("hex"));
  });
  report.classification = report.assertions.every(entry => entry.pass) ? "PASS" : "FAIL";
  if (observedEngineError?.name === "ParseError" || report.engineRuns === 0) report.classification = "INVALID_FIXTURE";
  if (row.id === "L05-execution-error" && (!callerCaught || !diagnosticRejected)) report.classification = "UNPROVED";
} catch (error) {
  report.fatal = serialize(error);
  report.classification = report.engineRuns === 0 ? "INVALID_FIXTURE" : "FAIL";
} finally {
  report.preTeardown = { publicSettled, guard: guardState(), bridgePending: bridgePending.size, releases, cleanupDone };
  try {
    await inner?.dispose();
    await outer?.dispose();
    report.disposed = true;
  } catch (error) {
    report.disposeError = serialize(error);
    report.disposed = false;
    if (row.workflow === "L05" && (error === cleanupError || error instanceof AggregateError && error.errors.every(entry => entry === cleanupError))) report.expectedDisposeCleanupObserved = true;
    else report.classification = "FAIL";
  }
  report.disposeSettled = true;
  clearTimeout(watchdog);
  report.guard = guardState();
  report.unhandled = unhandled;
  if (report.guard.failures.length || report.guard.activeTimers || unhandled.length || bridgePending.size) report.classification = "FAIL";
  report.finished = new Date().toISOString();
  persist();
  process.off("unhandledRejection", onUnhandled);
}
console.log(JSON.stringify({ id: row.id, classification: report.classification, engineRuns: report.engineRuns, assertions: report.assertions.map(entry => [entry.name, entry.pass]), guard: report.guard }));
process.exitCode = report.classification === "PASS" ? 0 : 1;
