import assert from "node:assert/strict";
import { setImmediate as turn } from "node:timers/promises";

export function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

function observe(promise) {
  const state = { settled: false, value: undefined, error: undefined, rejected: false };
  state.promise = Promise.resolve(promise).then(value => { state.value = value; }, error => { state.error = error; state.rejected = true; }).finally(() => { state.settled = true; });
  return state;
}

async function aborted(signal) {
  if (signal.aborted) return;
  await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
}

function fixture(api, configuration = {}) {
  const events = [], cleanups = [], output = [], diagnostics = [];
  const caller = new AbortController(), consumer = new AbortController();
  const firstRead = deferred(), retiring = deferred(), released = deferred(), diagnosticStarted = deferred(), diagnosticRelease = deferred();
  let reads = 0, returns = 0, acquisitions = 0, acquiredSignal, iteratorCreated = 0;
  const pendingNext = deferred();
  const source = signal => ({ [Symbol.asyncIterator]() {
    iteratorCreated++;
    return {
      async next() {
        reads++;
        events.push("next");
        firstRead.resolve();
        if (configuration.blockRead) {
          const onAbort = () => pendingNext.reject(signal.reason);
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
          try { return await pendingNext.promise; }
          finally { signal.removeEventListener("abort", onAbort); }
        }
        return reads === 1 ? { done: false, value: Buffer.from(configuration.input ?? "<p>x</p>") } : { done: true, value: undefined };
      },
      async return() {
        returns++;
        events.push("return-start");
        pendingNext.resolve({ done: true, value: undefined });
        retiring.resolve();
        if (configuration.blockReturn) await released.promise;
        events.push("return-end");
        return { done: true, value: undefined };
      },
    };
  } });
  const fs = new Proxy({}, { get(_target, property) {
    if (property === "readStream") return (_name, options) => {
      acquisitions++;
      events.push("acquire");
      if (!configuration.noHook) assert.ok(cleanups.length > 0, "cleanup must be registered BEFORE readStream acquisition");
      acquiredSignal = options.signal;
      return source(options.signal);
    };
    if (property === "then") return undefined;
    return () => assert.fail(`converter unexpected filesystem access/mutation: ${String(property)}`);
  } });
  const sink = { async write() { assert.fail("enrolled output must use owned accounting destination"); }, ownedOutput: {
    consumerClosed: consumer.signal, async write(chunk) { events.push("owned-write"); output.push(Buffer.from(chunk)); },
  } };
  const context = {
    command: "html-to-markdown", args: configuration.args ?? ["/input"], cwd: "/", env: {}, fs,
    signal: caller.signal, stdin: { [Symbol.asyncIterator]() { assert.fail("file case must not acquire stdin"); } },
    stdout: configuration.opaque ? { async write(chunk) { output.push(Buffer.from(chunk)); } } : sink,
    stderr: { async write(chunk) {
      diagnosticStarted.resolve();
      if (configuration.blockDiagnostic) await diagnosticRelease.promise;
      diagnostics.push(Buffer.from(chunk));
    } },
    ...(configuration.noHook ? {} : { registerCleanup(cleanup) { events.push("register"); cleanups.push(cleanup); } }),
  };
  return { context, caller, consumer, events, cleanups, firstRead, retiring, released, diagnosticStarted, diagnosticRelease, pendingNext,
    counts: () => ({ reads, returns, acquisitions, iteratorCreated }), signal: () => acquiredSignal,
    stdout: () => Buffer.concat(output).toString(), stderr: () => Buffer.concat(diagnostics).toString(),
    start: () => observe(api.createHtmlToMarkdownCommand({ limits: configuration.limits }).execute(context)),
  };
}

export async function runLifecycle(id, api) {
  if (id === "L08" || id === "L09") return pipeline(id, api);
  if (id === "L10") return shellAbort(api);
  const configuration = {
    L01: {}, L02: {}, L03: { blockRead: true, blockReturn: true },
    L04: { blockRead: true, blockReturn: true }, L05: { args: ["--bad"] },
    L06: { input: "abc", limits: { maxInputBytes: 2 }, blockDiagnostic: true },
    L07: { blockRead: true, blockReturn: true },
    L11: { blockRead: true, noHook: true, opaque: true },
  }[id];
  assert.ok(configuration, id);
  const probe = fixture(api, configuration);
  const reason = id === "L04" ? { code: "EFBIG", identity: "admitted-caller-abort" } : new api.FsError("EPIPE");
  if (id === "L02" || id === "L05") probe.consumer.abort(reason);
  const execution = probe.start();
  if (id === "L03" || id === "L04") {
    await probe.firstRead.promise;
    assert.equal(probe.counts().reads, 1);
    (id === "L04" ? probe.caller : probe.consumer).abort(reason);
    await probe.retiring.promise;
    await turn();
    assert.equal(execution.settled, false, "direct handler must await cooperative iterator retirement");
    assert.equal(probe.signal().reason, reason);
    probe.released.resolve();
  }
  if (id === "L06") {
    await probe.diagnosticStarted.promise;
    probe.consumer.abort(reason);
    await turn();
    assert.equal(execution.settled, false, "required stderr must not be abandoned on stdout close");
    probe.diagnosticRelease.resolve();
  }
  if (id === "L07") {
    await probe.firstRead.promise;
    const closing = observe(Promise.all(probe.cleanups.flatMap(cleanup => [cleanup(), cleanup()])));
    await probe.retiring.promise;
    await turn();
    assert.equal(closing.settled, false);
    assert.equal(execution.settled, false);
    probe.released.resolve();
    await closing.promise;
  }
  if (id === "L11") {
    await probe.firstRead.promise;
    probe.consumer.abort(reason);
    await turn();
    assert.equal(execution.settled, false, "unrelated close does not enroll opaque destination");
    assert.equal(probe.signal().aborted, false);
    probe.pendingNext.resolve({ done: true, value: undefined });
  }
  await execution.promise;
  if (id === "L01") {
    assert.equal(execution.rejected, false);
    assert.equal(execution.value.exitCode, 0);
    assert.equal(probe.stdout(), "x\n");
    assert.equal(probe.stderr(), "");
    assert.notEqual(probe.signal(), probe.caller.signal, "pure stdout input uses operation signal");
    assert.ok(probe.events.indexOf("register") < probe.events.indexOf("acquire"));
    assert.ok(probe.events.includes("owned-write"));
  }
  if (id === "L02" || id === "L05") {
    assert.deepEqual(probe.counts(), { reads: 0, returns: 0, acquisitions: 0, iteratorCreated: 0 });
    assert.equal(probe.stdout(), "");
  }
  if (id === "L04") {
    assert.equal(execution.rejected, true);
    assert.equal(execution.error, reason);
    assert.equal(probe.stderr(), "");
  }
  if (id === "L05" || id === "L06") {
    assert.equal(execution.rejected, false);
    assert.equal(execution.value.exitCode, id === "L05" ? 2 : 1);
    assert.equal(probe.stderr(), id === "L05" ? "html-to-markdown: unknown option: --bad\n" : "html-to-markdown: EFBIG: html-to-markdown input limit exceeded\n");
  }
  if (["L03", "L04", "L07"].includes(id)) {
    assert.equal(probe.counts().returns, 1);
    assert.ok(probe.events.includes("return-end"));
  }
  if (id !== "L04") assert.equal(probe.caller.signal.aborted, false);
  await Promise.all(probe.cleanups.map(cleanup => cleanup()));
  return { events: probe.events, counts: probe.counts(), stdout: probe.stdout(), stderr: probe.stderr(), disposition: execution.rejected ? { rejected: true, code: execution.error?.code, message: execution.error?.message } : execution.value,
    boundary: ["L02", "L03", "L07"].includes(id) ? "resource invariants only; direct output-close disposition remains unscored" : "frozen assertions" };
}

async function pipeline(id, api) {
  const caller = new AbortController(), firstRead = deferred(), disposing = deferred(), release = deferred();
  const events = [];
  let requests = 0, reads = 0, returns = 0, disposals = 0, transportSignal;
  const shell = new api.Shell({ fs: new api.MemoryFileSystem(), limits: { pipeHighWaterMark: 1 } });
  shell.use(api.agentCommands());
  shell.use(api.networkCommands({ authorize: () => true, async transport(request) {
    requests++;
    events.push("transport");
    transportSignal = request.signal;
    assert.equal(typeof request.registerCleanup, "function");
    let retirement;
    const retire = () => retirement ??= (async () => { events.push("dispose-start"); disposals++; disposing.resolve(); await release.promise; events.push("dispose-end"); })();
    request.registerCleanup(retire);
    return { status: 200, statusText: "OK", headers: [], body: { [Symbol.asyncIterator]() { return {
      async next() {
        reads++;
        events.push("transport-next");
        firstRead.resolve();
        await aborted(request.signal);
        throw request.signal.reason;
      },
      async return() { returns++; events.push("transport-return"); return { done: true, value: undefined }; },
    }; } }, dispose: retire };
  } }));
  shell.use(async (context, next) => {
    if (id === "L08" && context.command === "head") await firstRead.promise;
    if (id === "L09" && ["curl", "html-to-markdown"].includes(context.command)) {
      assert.ok(context.stdout.ownedOutput, "controlled zero-read profile requires explicit output enrollment");
      await aborted(context.stdout.ownedOutput.consumerClosed);
      events.push(`${context.command}-admitted-after-close`);
    }
    return next();
  });
  const execution = observe(shell.exec("curl https://fixture.invalid/html | html-to-markdown | head -n 0", { signal: caller.signal }));
  if (id === "L08") {
    await disposing.promise;
    await turn();
    assert.equal(execution.settled, false, "public exec must drain cooperative transport disposal");
    assert.equal(transportSignal.aborted, true);
    release.resolve();
  }
  await execution.promise;
  assert.equal(execution.rejected, false);
  assert.equal(execution.value.exitCode, 0, "default pipeline selects final head status");
  assert.equal(execution.value.stdout, "");
  assert.equal(caller.signal.aborted, false);
  if (id === "L08") {
    assert.equal(requests, 1);
    assert.equal(reads, 1);
    assert.equal(returns, 1);
    assert.equal(disposals, 1);
    assert.ok(events.includes("dispose-end"));
  } else assert.deepEqual({ requests, reads, returns, disposals }, { requests: 0, reads: 0, returns: 0, disposals: 0 });
  await shell.dispose();
  return { events, requests, reads, returns, disposals, stderrObservation: execution.value.stderr, boundary: "controlled ordering only; early-close diagnostic policy not inferred" };
}

async function shellAbort(api) {
  const probe = fixture(api, { blockRead: true, blockReturn: true, noHook: true });
  const shell = new api.Shell({ fs: probe.context.fs });
  shell.use(api.agentCommands());
  const reason = { code: "ENOENT", identity: "shell-inflight-abort" };
  const execution = observe(shell.exec("html-to-markdown /input", { signal: probe.caller.signal }));
  await probe.firstRead.promise;
  probe.caller.abort(reason);
  await probe.retiring.promise;
  const disposal = observe(shell.dispose()), overlapping = observe(shell.dispose());
  await turn();
  for (const state of [execution, disposal, overlapping]) assert.equal(state.settled, false);
  probe.released.resolve();
  await Promise.all([execution.promise, disposal.promise, overlapping.promise]);
  assert.equal(execution.error, reason);
  assert.equal(execution.rejected, true);
  assert.equal(disposal.rejected, false);
  assert.equal(overlapping.rejected, false);
  assert.equal(probe.counts().returns, 1);
  return { events: probe.events, counts: probe.counts(), exactReason: true };
}
