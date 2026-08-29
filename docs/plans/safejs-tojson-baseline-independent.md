# TOJSON independent bounded baseline procedure

August 29, 2026. Baseline preparation only; Boyle owns the repair and regression tests.

## Bounds

Use the fresh main clone and exact ARG-final runtime projection recorded in out/safejs-remediation/tojson-baseline-independent-20260829/projection/index.json. All 19 listed runtime prerequisite paths must match; no arity annotation is present. No historical fixtures or original audit payloads are needed. Do not alter author tests/oracles or production semantics. Only exact captured source projection is allowed.

Guest code uses finite local records, arrays, counters, and one pure host binding. The passive host does not serialize or invoke the hook. The explicit controls call the existing own hook once. Observe arguments through own data descriptors; never JSON-stringify the raw host argument. Preserve named metadata, aliases, descriptors, complete results, trace, public host journal, promise replay state, pending awaits, and genuine public dump. No network, filesystem, LLM, external callback, security probe, or process signal is granted to the guest. A timeout aborts only the owned run via AbortController, never another process.

## Native oracle

| Case           | Hook calls | Host calls | Explicit hook reason |
| -------------- | ---------: | ---------: | -------------------- |
| plain-passive  |          0 |          1 | none                 |
| array-passive  |          0 |          1 | none                 |
| plain-explicit |          1 |          1 | host-request         |
| array-explicit |          1 |          1 | host-request         |

Both shapes retain marker, numeric value, metadata and its alias, and the callable own toJSON. Native full output, not only this table, is the oracle. A runtime mismatch is preserved as RED; no expected output is rewritten. The separate known native-wrapper length mismatch is not exercised or accepted here.

## Agent-executed commands

Run the following inline command separately with TOJSON_MODE=native, source, and built. For native and built omit --import tsx; source uses the unchanged public source entry. Built imports the package export without instrumentation. Record stdout, stderr, exit status, exact command text and source/build hashes. No executable QA file is created.

```sh
env -u TERM TOJSON_MODE=source node --import tsx --input-type=module <<'JS'
const mode = process.env.TOJSON_MODE;
const selection = process.env.TOJSON_SELECTION ?? "all";
const api = mode === "native" ? undefined : await import(mode === "built" ? "@poe-code/safejs" : "./packages/safejs/src/index.ts");
const definitions = [
  { id: "plain-passive", array: false, explicit: false },
  { id: "array-passive", array: true, explicit: false },
  { id: "plain-explicit", array: false, explicit: true },
  { id: "array-explicit", array: true, explicit: true }
].filter(definition => selection === "all" || !definition.explicit);
const describeError = error => ({ name: error?.name ?? null, message: error?.message ?? String(error), stack: error?.stack ?? null, code: error?.code ?? null, budget: error?.budget ?? null, current: error?.current ?? null, limit: error?.limit ?? null });
async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise).then(value => ({ status: "fulfilled", value }), error => ({ status: "rejected", error: describeError(error) })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ status: "timeout", label, milliseconds }), milliseconds); })
    ]);
  } finally { clearTimeout(timer); }
}
function observeArgument(payload) {
  const descriptors = Object.getOwnPropertyDescriptors(payload);
  const metadata = descriptors.metadata.value;
  return {
    array: Array.isArray(payload),
    descriptors: Object.entries(descriptors).map(([key, descriptor]) => ({ key, enumerable: descriptor.enumerable, configurable: descriptor.configurable, writable: descriptor.writable, valueType: typeof descriptor.value, data: Object.hasOwn(descriptor, "value") })),
    marker: descriptors.marker.value,
    scalar: descriptors[Array.isArray(payload) ? "0" : "value"].value,
    metadata: { label: Object.getOwnPropertyDescriptor(metadata, "label").value, rank: Object.getOwnPropertyDescriptor(metadata, "rank").value },
    metadataAlias: descriptors.alias.value === metadata,
    ownHook: Object.hasOwn(descriptors, "toJSON"),
    hookType: typeof descriptors.toJSON.value
  };
}
const results = [];
for (const definition of definitions) {
  const source = [
    "let count = 0;",
    "const trace = [];",
    definition.array ? "const payload = [7];" : "const payload = { value: 7 };",
    'payload.marker = "retained";',
    'payload.metadata = { label: "unchanged", rank: 3 };',
    "payload.alias = payload.metadata;",
    'payload.toJSON = (reason) => { count += 1; trace.push({ event: "hook", reason, ordinal: count }); return { hookResult: "done", ordinal: count }; };',
    'trace.push({ event: "before-host" });',
    "const hostResult = await host(payload);",
    'trace.push({ event: "after-host" });',
    'return { count, trace, hostResult, hookPresent: typeof payload.toJSON === "function", marker: payload.marker, metadataAlias: payload.alias === payload.metadata };'
  ].join("\n");
  const hostEvents = [];
  let hostCalls = 0;
  let providerCalls = 0;
  const host = async payload => {
    hostCalls += 1;
    hostEvents.push({ event: "host-enter", ordinal: hostCalls });
    const before = observeArgument(payload);
    let hookResult = null;
    if (definition.explicit) {
      hostEvents.push({ event: "host-request-hook" });
      const hook = Object.getOwnPropertyDescriptor(payload, "toJSON").value;
      hookResult = await Reflect.apply(hook, payload, ["host-request"]);
      hostEvents.push({ event: "host-hook-returned", hookResult });
    }
    const after = observeArgument(payload);
    hostEvents.push({ event: "host-exit", ordinal: hostCalls });
    return { acknowledgment: "host-done", before, after, hookResult };
  };
  const controller = new AbortController();
  const budget = api === undefined ? undefined : new api.Budget({ maxSteps: 100000, maxCallDepth: 40, stringLength: 20000, arrayLength: 1000, dataSize: 1000000, deadline: Date.now() + 2500 });
  const execution = api === undefined
    ? new (Object.getPrototypeOf(async function () {}).constructor)("host", source)(host)
    : api.run(source, { bindings: { host: api.declareHostOperation(host, "read-side-effect") }, budget, randomSeed: 17, signal: controller.signal, hostCallResumeProvider: () => { providerCalls += 1; throw new Error("Unexpected provider request in fresh baseline"); } });
  const settled = await bounded(execution, 3000, definition.id + " execution");
  const observation = { id: definition.id, mode, source, expectedNativeHookCalls: definition.explicit ? 1 : 0, expectedNativeHostCalls: 1, execution: { status: settled.status }, hostCalls, providerCalls, hostEvents };
  if (settled.status === "fulfilled") {
    if (api === undefined) observation.execution.returnValue = settled.value;
    else {
      const result = settled.value;
      observation.execution.ok = result.ok;
      if (result.ok) observation.execution.returnValue = api.deepCopyFromSandbox(result.returnValue);
      else observation.execution.error = describeError(result.error);
      const snapshot = result.snapshot;
      observation.publicState = {
        pendingAwaits: snapshot.pendingAwaits ?? [],
        replayError: snapshot.replayError ?? null,
        promiseReplay: snapshot.promiseReplay ?? null,
        replay: snapshot.replay ?? null,
        hostCalls: snapshot.hostCalls?.map(record => ({ ...record, ...(record.outcome === undefined ? {} : { outcome: record.outcome.status === "fulfilled" ? { status: "fulfilled", value: api.deepCopyFromSandbox(record.outcome.value) } : { status: "rejected", reason: api.deepCopyFromSandbox(record.outcome.reason) } }) })) ?? []
      };
      const captured = await bounded(api.dump(result, { mode: "replay" }), 1000, definition.id + " completed dump");
      observation.publicCapture = captured.status === "fulfilled" ? { status: captured.status, snapshot: JSON.parse(captured.value) } : captured;
    }
  } else {
    observation.execution = settled;
    if (api !== undefined) {
      const captured = await bounded(api.dump(execution, { mode: "replay" }), 1000, definition.id + " pending dump");
      observation.publicCapture = captured.status === "fulfilled" ? { status: captured.status, snapshot: JSON.parse(captured.value) } : captured;
      controller.abort();
      observation.ownRunAbortAfterBound = true;
      observation.afterAbort = await bounded(execution, 500, definition.id + " own-run cleanup").then(value => ({ status: value.status, ...(value.error ? { error: value.error } : {}) }));
    }
  }
  observation.hostCalls = hostCalls;
  observation.providerCalls = providerCalls;
  observation.counterMatchesNative = observation.execution.returnValue?.count === observation.expectedNativeHookCalls;
  observation.hostCountMatchesNative = hostCalls === 1;
  if (budget !== undefined) observation.budget = { stepsUsed: budget.stepsUsed, currentCallDepth: budget.currentCallDepth, peakCallDepth: budget.peakCallDepth, currentDataSize: budget.currentDataSize, peakDataSize: budget.peakDataSize };
  results.push(observation);
}
console.log(JSON.stringify({ mode, selection, cases: results }, null, 2));
process.exitCode = results.every(result => result.counterMatchesNative && result.hostCountMatchesNative) ? 0 : 1;
JS
```

For bounded ARG causality, replace only host-call.ts with the captured post-H5/Map/HOST pre-ARG source, run source with TOJSON_SELECTION=passive, then restore the exact ARG postimage. Compare these two outputs to the same post-ARG cases; do not rebuild or run broad suites for this comparison. Leave built artifacts at the post-ARG baseline. Preserve any failure and bound every wait.

## Handoff

Freeze full observations and an additive baseline report in the ignored output subtree. No repaired GREEN, release approval, crypto/graph fingerprint policy change, historical marker rewrite, or all-stack closure is claimed. A later exact Boyle candidate requires separate genuine RED/GREEN, compatibility and full publication gates.

## Additive diagnostic capture after default-process failures

The original source and built all-case commands both exited 1 on an unhandled SandboxError with code reentry before emitting their final aggregate. Preserve those original receipts. To obtain bounded state without mistaking a crash for success, run each case in a fresh child process with the following diagnostic-only unhandledRejection recorder. It does not modify the runtime, guest source, host behavior, or native expectations; it keeps the child alive long enough to print the rejection and snapshots, and still exits 1 whenever a rejection or native mismatch occurs. The initial default-process crash remains the authoritative termination observation. A final 20 ms event-loop turn collects late rejection diagnostics. No OS signal is sent.

Run separately with TOJSON_MODE=source or built and TOJSON_SELECTION equal to one case ID (native may also be repeated for exact recorder parity). For pre-ARG causality use selection=passive.

```sh
env -u TERM TOJSON_MODE=source TOJSON_SELECTION=plain-passive node --import tsx --input-type=module <<'JS'
const observedUnhandledRejections = [];
process.on("unhandledRejection", reason => observedUnhandledRejections.push(describeError(reason)));
const mode = process.env.TOJSON_MODE;
const selection = process.env.TOJSON_SELECTION ?? "all";
const api = mode === "native" ? undefined : await import(mode === "built" ? "@poe-code/safejs" : "./packages/safejs/src/index.ts");
const definitions = [
  { id: "plain-passive", array: false, explicit: false },
  { id: "array-passive", array: true, explicit: false },
  { id: "plain-explicit", array: false, explicit: true },
  { id: "array-explicit", array: true, explicit: true }
].filter(definition => selection === "all" || definition.id === selection || (selection === "passive" && !definition.explicit));
const describeError = error => ({ name: error?.name ?? null, message: error?.message ?? String(error), stack: error?.stack ?? null, code: error?.code ?? null, budget: error?.budget ?? null, current: error?.current ?? null, limit: error?.limit ?? null });
async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise).then(value => ({ status: "fulfilled", value }), error => ({ status: "rejected", error: describeError(error) })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ status: "timeout", label, milliseconds }), milliseconds); })
    ]);
  } finally { clearTimeout(timer); }
}
function observeArgument(payload) {
  const descriptors = Object.getOwnPropertyDescriptors(payload);
  const metadata = descriptors.metadata.value;
  return {
    array: Array.isArray(payload),
    descriptors: Object.entries(descriptors).map(([key, descriptor]) => ({ key, enumerable: descriptor.enumerable, configurable: descriptor.configurable, writable: descriptor.writable, valueType: typeof descriptor.value, data: Object.hasOwn(descriptor, "value") })),
    marker: descriptors.marker.value,
    scalar: descriptors[Array.isArray(payload) ? "0" : "value"].value,
    metadata: { label: Object.getOwnPropertyDescriptor(metadata, "label").value, rank: Object.getOwnPropertyDescriptor(metadata, "rank").value },
    metadataAlias: descriptors.alias.value === metadata,
    ownHook: Object.hasOwn(descriptors, "toJSON"),
    hookType: typeof descriptors.toJSON.value
  };
}
const results = [];
for (const definition of definitions) {
  const source = [
    "let count = 0;",
    "const trace = [];",
    definition.array ? "const payload = [7];" : "const payload = { value: 7 };",
    'payload.marker = "retained";',
    'payload.metadata = { label: "unchanged", rank: 3 };',
    "payload.alias = payload.metadata;",
    'payload.toJSON = (reason) => { count += 1; trace.push({ event: "hook", reason, ordinal: count }); return { hookResult: "done", ordinal: count }; };',
    'trace.push({ event: "before-host" });',
    "const hostResult = await host(payload);",
    'trace.push({ event: "after-host" });',
    'return { count, trace, hostResult, hookPresent: typeof payload.toJSON === "function", marker: payload.marker, metadataAlias: payload.alias === payload.metadata };'
  ].join("\n");
  const hostEvents = [];
  let hostCalls = 0;
  let providerCalls = 0;
  const host = async payload => {
    hostCalls += 1;
    hostEvents.push({ event: "host-enter", ordinal: hostCalls });
    const before = observeArgument(payload);
    let hookResult = null;
    if (definition.explicit) {
      hostEvents.push({ event: "host-request-hook" });
      const hook = Object.getOwnPropertyDescriptor(payload, "toJSON").value;
      hookResult = await Reflect.apply(hook, payload, ["host-request"]);
      hostEvents.push({ event: "host-hook-returned", hookResult });
    }
    const after = observeArgument(payload);
    hostEvents.push({ event: "host-exit", ordinal: hostCalls });
    return { acknowledgment: "host-done", before, after, hookResult };
  };
  const controller = new AbortController();
  const budget = api === undefined ? undefined : new api.Budget({ maxSteps: 100000, maxCallDepth: 40, stringLength: 20000, arrayLength: 1000, dataSize: 1000000, deadline: Date.now() + 2500 });
  const execution = api === undefined
    ? new (Object.getPrototypeOf(async function () {}).constructor)("host", source)(host)
    : api.run(source, { bindings: { host: api.declareHostOperation(host, "read-side-effect") }, budget, randomSeed: 17, signal: controller.signal, hostCallResumeProvider: () => { providerCalls += 1; throw new Error("Unexpected provider request in fresh baseline"); } });
  const settled = await bounded(execution, 3000, definition.id + " execution");
  const observation = { id: definition.id, mode, source, expectedNativeHookCalls: definition.explicit ? 1 : 0, expectedNativeHostCalls: 1, execution: { status: settled.status }, hostCalls, providerCalls, hostEvents };
  if (settled.status === "fulfilled") {
    if (api === undefined) observation.execution.returnValue = settled.value;
    else {
      const result = settled.value;
      observation.execution.ok = result.ok;
      if (result.ok) observation.execution.returnValue = api.deepCopyFromSandbox(result.returnValue);
      else observation.execution.error = describeError(result.error);
      const snapshot = result.snapshot;
      observation.publicState = {
        pendingAwaits: snapshot.pendingAwaits ?? [],
        replayError: snapshot.replayError ?? null,
        promiseReplay: snapshot.promiseReplay ?? null,
        replay: snapshot.replay ?? null,
        hostCalls: snapshot.hostCalls?.map(record => ({ ...record, ...(record.outcome === undefined ? {} : { outcome: record.outcome.status === "fulfilled" ? { status: "fulfilled", value: api.deepCopyFromSandbox(record.outcome.value) } : { status: "rejected", reason: api.deepCopyFromSandbox(record.outcome.reason) } }) })) ?? []
      };
      const captured = await bounded(api.dump(result, { mode: "replay" }), 1000, definition.id + " completed dump");
      observation.publicCapture = captured.status === "fulfilled" ? { status: captured.status, snapshot: JSON.parse(captured.value) } : captured;
    }
  } else {
    observation.execution = settled;
    if (api !== undefined) {
      const captured = await bounded(api.dump(execution, { mode: "replay" }), 1000, definition.id + " pending dump");
      observation.publicCapture = captured.status === "fulfilled" ? { status: captured.status, snapshot: JSON.parse(captured.value) } : captured;
      controller.abort();
      observation.ownRunAbortAfterBound = true;
      observation.afterAbort = await bounded(execution, 500, definition.id + " own-run cleanup").then(value => ({ status: value.status, ...(value.error ? { error: value.error } : {}) }));
    }
  }
  observation.hostCalls = hostCalls;
  observation.providerCalls = providerCalls;
  observation.counterMatchesNative = observation.execution.returnValue?.count === observation.expectedNativeHookCalls;
  observation.hostCountMatchesNative = hostCalls === 1;
  if (budget !== undefined) observation.budget = { stepsUsed: budget.stepsUsed, currentCallDepth: budget.currentCallDepth, peakCallDepth: budget.peakCallDepth, currentDataSize: budget.currentDataSize, peakDataSize: budget.peakDataSize };
  results.push(observation);
}
await new Promise(resolve => setTimeout(resolve, 20));
console.log(JSON.stringify({ mode, selection, diagnosticRejectionObserver: true, observedUnhandledRejections, cases: results }, null, 2));
process.exitCode = observedUnhandledRejections.length === 0 && results.every(result => result.counterMatchesNative && result.hostCountMatchesNative) ? 0 : 1;
JS
```

## Candidate fresh-process replay and compatibility

The input JSON contains only this worker's unchanged genuine public completed captures: eight candidate captures and four ARG-baseline captures. Run each reader API in a new process. Candidate captures must reproduce the full native graph and exact journal with zero host/provider calls. Old plain-object captures must fail the existing reset identity check before host/provider calls; old named-array controls must replay unchanged. This is a qualification of these recorded workflows, not a universal detector of any historical hook property. No snapshot marker, source identity, proof, or version is edited.

```sh
env -u TERM TOJSON_MODE=source TOJSON_REPLAY_INPUT=out/safejs-remediation/static-digest-tojson-independent-20260829/replay/inputs.json node --import tsx --input-type=module <<'JS'
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
const mode = process.env.TOJSON_MODE;
const api = await import(mode === "built" ? "@poe-code/safejs" : "./packages/safejs/src/index.ts");
const inputs = JSON.parse(readFileSync(process.env.TOJSON_REPLAY_INPUT, "utf8")).cases;
const describeError = error => ({ name: error?.name ?? null, message: error?.message ?? String(error), stack: error?.stack ?? null, code: error?.code ?? null, action: error?.action ?? null, callId: error?.callId ?? null, lifecycle: error?.lifecycle ?? null });
async function bounded(promise, milliseconds) {
  let timer;
  try { return await Promise.race([Promise.resolve(promise).then(value => ({ status: "fulfilled", value }), error => ({ status: "rejected", error: describeError(error) })), new Promise(resolve => { timer = setTimeout(() => resolve({ status: "timeout", milliseconds }), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
const results = [];
for (const input of inputs) {
  let hostCalls = 0;
  let providerCalls = 0;
  const controller = new AbortController();
  const outcome = { id: input.id, kind: input.kind, caseId: input.caseId, expectedDisposition: input.expectedDisposition };
  try {
    const restored = api.restore(input.snapshot, { source: input.source });
    const execution = api.run(input.source, { snapshot: restored, signal: controller.signal, bindings: { host: api.declareHostOperation(() => { hostCalls += 1; throw new Error("Completed replay must not reissue host"); }, "read-side-effect") }, hostCallResumeProvider: () => { providerCalls += 1; throw new Error("Completed replay must not request proof"); } });
    const settled = await bounded(execution, 3000);
    outcome.executionStatus = settled.status;
    if (settled.status === "fulfilled") {
      const result = settled.value;
      outcome.ok = result.ok;
      if (result.ok) outcome.returnValue = api.deepCopyFromSandbox(result.returnValue);
      else outcome.error = describeError(result.error);
      outcome.publicState = { pendingAwaits: result.snapshot.pendingAwaits ?? [], promiseReplay: result.snapshot.promiseReplay ?? null, replayError: result.snapshot.replayError ?? null, replay: result.snapshot.replay ?? null, hostCalls: result.snapshot.hostCalls?.map(record => ({ ...record, ...(record.outcome === undefined ? {} : { outcome: record.outcome.status === "fulfilled" ? { status: "fulfilled", value: api.deepCopyFromSandbox(record.outcome.value) } : { status: "rejected", reason: api.deepCopyFromSandbox(record.outcome.reason) } }) })) ?? [] };
      const captured = await bounded(api.dump(result, { mode: "replay" }), 1000);
      outcome.publicCapture = captured.status === "fulfilled" ? { status: captured.status, snapshot: JSON.parse(captured.value) } : captured;
      outcome.journalMatchesOriginal = isDeepStrictEqual(outcome.publicState.hostCalls, input.originalJournal);
    } else if (settled.status === "rejected") outcome.error = settled.error;
    else { controller.abort(); outcome.ownRunAbortAfterBound = true; }
  } catch (error) { outcome.executionStatus = "rejected"; outcome.error = describeError(error); }
  outcome.hostCalls = hostCalls;
  outcome.providerCalls = providerCalls;
  outcome.fullReturnMatchesNative = isDeepStrictEqual(outcome.returnValue, input.expectedReturn);
  outcome.matchesExpectedDisposition = input.expectedDisposition === "reset"
    ? outcome.error?.action === "reset" && outcome.error.message.includes("does not match the next restored invocation") && hostCalls === 0 && providerCalls === 0
    : outcome.ok === true && outcome.fullReturnMatchesNative && outcome.journalMatchesOriginal && hostCalls === 0 && providerCalls === 0;
  results.push(outcome);
}
console.log(JSON.stringify({ mode, cases: results }, null, 2));
process.exitCode = results.every(result => result.matchesExpectedDisposition) ? 0 : 1;
JS
```

For the built reader set TOJSON_MODE=built and omit --import tsx. The built package remains unmodified. Record any failure rather than normalizing the journal or weakening return assertions.

## Independent progress at the resource pause — August 29, 2026

Root was informed before this pause that direct named-array hooks remain inert before and after ARG, while plain-object dispatch already reproduces pre-ARG. This establishes no new ARG exposure; root retains the hold/publication decision. The sealed independent baseline manifest is 07910ed6d05339137598e5201cdeb0d01e4b428b018f3bf8846728dde0cf420d.

The unchanged author regressions independently reproduce source RED 12 failed / 7 passed and built-public RED 6 failed / 8 passed (nine author runtime cases plus five unchanged H5/Nash controls). After applying only the pinned production postimage, source is 19/19 GREEN and built-public is 14/14 GREEN. All eight independent source/built GREEN observations match complete native returns and host observations: passive hooks zero, explicitly requested hooks one, host one, provider zero, no pending awaits, and recorded callback counts exactly zero/one. Default-process baseline crashes and diagnostic-only baseline observations remain separate and preserved.

The owned forced build passed 67 tasks with zero cached tasks. The already-running default npm test gate completed naturally with exit 0: 25,909 passed / 41 skipped, 1,000 files passed / 3 skipped, no cache hits, 225.11 seconds Vitest duration. No owned process was cancelled and no timeout was changed. All owned commands are now quiescent.

Root requested no new heavy tests/builds until a brief resource window is released. The clean clone is pulled and projected, with dependencies installed, but its forced build/default full gate and the remaining types/lint/format/strict-diff gates have not run. Fresh-process replay/old-capture compatibility inputs and the inline procedure are prepared but not executed yet. No independent final READY or publication approval is issued at this checkpoint.

## Additive replay-recorder adjudication after light-work release

The first two fresh-process recorder commands exited 1 and remain preserved. Their successful replays already matched every recorded return/journal JSON field. The failed predicates compared live null-prototype guest objects to JSON-loaded ordinary objects and incorrectly required internal reset metadata on the public wrapped Error. Every new completed dump differed only in bindings.host.async because the replay guard stub was synchronous, unlike the original async stub. This is an independent recorder/context correction, not a candidate fix or an author expectation edit.

The corrected bounded command retains all complete JSON fields, aligns the pure guard stub as async, checks the exact public reset Error message/stack derived from the unchanged captured call ID and source location, and strengthens replay checks to require the entire completed public capture graph to match. No snapshot, journal, source, historical marker, or version is changed. These JSON data checks do not claim native prototype parity beyond the recorded own-data observations.

```sh
env -u TERM TOJSON_MODE=source TOJSON_REPLAY_INPUT=out/safejs-remediation/static-digest-tojson-independent-20260829/replay/inputs.json node --import tsx --input-type=module <<'JS'
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
const mode = process.env.TOJSON_MODE;
const api = await import(mode === "built" ? "@poe-code/safejs" : "./packages/safejs/src/index.ts");
const inputs = JSON.parse(readFileSync(process.env.TOJSON_REPLAY_INPUT, "utf8")).cases;
const describeError = error => ({ name: error?.name ?? null, message: error?.message ?? String(error), stack: error?.stack ?? null, code: error?.code ?? null, action: error?.action ?? null, callId: error?.callId ?? null, lifecycle: error?.lifecycle ?? null });
async function bounded(promise, milliseconds) {
  let timer;
  try { return await Promise.race([Promise.resolve(promise).then(value => ({ status: "fulfilled", value }), error => ({ status: "rejected", error: describeError(error) })), new Promise(resolve => { timer = setTimeout(() => resolve({ status: "timeout", milliseconds }), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
const results = [];
for (const input of inputs) {
  let hostCalls = 0;
  let providerCalls = 0;
  const controller = new AbortController();
  const outcome = { id: input.id, kind: input.kind, caseId: input.caseId, expectedDisposition: input.expectedDisposition };
  try {
    const restored = api.restore(input.snapshot, { source: input.source });
    const execution = api.run(input.source, { snapshot: restored, signal: controller.signal, bindings: { host: api.declareHostOperation(async () => { hostCalls += 1; throw new Error("Completed replay must not reissue host"); }, "read-side-effect") }, hostCallResumeProvider: () => { providerCalls += 1; throw new Error("Completed replay must not request proof"); } });
    const settled = await bounded(execution, 3000);
    outcome.executionStatus = settled.status;
    if (settled.status === "fulfilled") {
      const result = settled.value;
      outcome.ok = result.ok;
      if (result.ok) outcome.returnValue = api.deepCopyFromSandbox(result.returnValue);
      else outcome.error = describeError(result.error);
      outcome.publicState = { pendingAwaits: result.snapshot.pendingAwaits ?? [], promiseReplay: result.snapshot.promiseReplay ?? null, replayError: result.snapshot.replayError ?? null, replay: result.snapshot.replay ?? null, hostCalls: result.snapshot.hostCalls?.map(record => ({ ...record, ...(record.outcome === undefined ? {} : { outcome: record.outcome.status === "fulfilled" ? { status: "fulfilled", value: api.deepCopyFromSandbox(record.outcome.value) } : { status: "rejected", reason: api.deepCopyFromSandbox(record.outcome.reason) } }) })) ?? [] };
      const captured = await bounded(api.dump(result, { mode: "replay" }), 1000);
      outcome.publicCapture = captured.status === "fulfilled" ? { status: captured.status, snapshot: JSON.parse(captured.value) } : captured;
      outcome.journalMatchesOriginal = isDeepStrictEqual(JSON.parse(JSON.stringify(outcome.publicState.hostCalls)), input.originalJournal);
      outcome.fullCaptureMatchesOriginal = outcome.publicCapture.status === "fulfilled" && isDeepStrictEqual(outcome.publicCapture.snapshot, input.snapshot);
      outcome.returnPrototypeObservation = { actualNullPrototype: result.ok && Object.getPrototypeOf(outcome.returnValue) === null, recordedOracleNullPrototype: Object.getPrototypeOf(input.expectedReturn) === null };
    } else if (settled.status === "rejected") outcome.error = settled.error;
    else { controller.abort(); outcome.ownRunAbortAfterBound = true; }
  } catch (error) { outcome.executionStatus = "rejected"; outcome.error = describeError(error); }
  outcome.hostCalls = hostCalls;
  outcome.providerCalls = providerCalls;
  outcome.fullReturnMatchesNative = outcome.returnValue !== undefined && isDeepStrictEqual(JSON.parse(JSON.stringify(outcome.returnValue)), input.expectedReturn);
  const callLines = input.source.split("\n");
  const callLine = callLines.findIndex(line => line.includes("host(payload)"));
  const resetMessage = "Host call " + input.originalJournal[0].id + " does not match the next restored invocation; reset is required.";
  const expectedPublicReset = { name: "Error", message: resetMessage, stack: "Error: " + resetMessage + "\n    at host (line " + (callLine + 1) + ", column " + (callLines[callLine].indexOf("host(payload)") + 1) + ")", code: null, action: null, callId: null, lifecycle: null };
  outcome.publicResetMatchesExact = isDeepStrictEqual(outcome.error, expectedPublicReset);
  outcome.matchesExpectedDisposition = input.expectedDisposition === "reset"
    ? outcome.executionStatus === "rejected" && outcome.publicResetMatchesExact && hostCalls === 0 && providerCalls === 0
    : outcome.ok === true && outcome.fullReturnMatchesNative && outcome.journalMatchesOriginal && outcome.fullCaptureMatchesOriginal && hostCalls === 0 && providerCalls === 0;
  results.push(outcome);
}
console.log(JSON.stringify({ mode, cases: results }, null, 2));
process.exitCode = results.every(result => result.matchesExpectedDisposition) ? 0 : 1;
JS
```

Repeat with TOJSON_MODE=built and no --import tsx. Both commands remain bounded functional observations, not full-unit/build jobs.

## Additive compatibility checkpoint — August 29, 2026

Status: bounded compatibility review passes; **NOT final READY**. The remaining clean-projection default build/full-unit and publication gates await ROOT CPU GO. No new heavy phase ran during this light-work window. Root has now lifted the ARG hold based on independently confirmed pre-ARG/post-ARG causality; historical hold statements above and in the untouched author plan remain as-of records. Arity is excluded.

The aligned fresh-process source command exited 0 in 849 ms and the unmodified public-built command exited 0 in 292 ms. Each restored the same twelve genuine captures. Across both readers:

- Sixteen candidate completed restores preserve the complete native JSON return, entire journal, and entire completed public snapshot graph.
- Four old direct named-array completed restores preserve the complete return, journal, and public snapshot graph.
- Four old plain-object attempts reject with the exact existing public reset Error message/stack before any host or provider call. These are expected rejections, not successful returns.
- All twenty-four dispositions make zero host/provider calls. No timeout occurs; no timeout limit, source, journal, version, historical marker, or capture is changed.

The initial recorder exits of 1 remain in the evidence with their diagnosis. Aligning the captured async host binding and JSON-data comparison fixes the recorder context, not the candidate, and adds the stronger whole-capture equality requirement. Public reset Error fields are recorded completely; absent internal action/code/callId/lifecycle metadata is null in the recorder, not invented. The comparison is of complete finite JSON data and encoded graph identity, not a claim of native prototype parity.

Compatibility is narrowly qualified: the tested old plain-object captures have changed invocation digests and therefore require explicit reset under existing identity checks. This does not assert that every historical hook-bearing capture resets. Do not edit a mismatched snapshot, digest, source identity, historical marker, or version to force replay. A caller-authorized reset starts a fresh execution without that incompatible snapshot only after reconciling prior external effects; never blindly repeat non-idempotent work. This operational caution follows `packages/safejs/CHECKPOINT_REPLAY.md:134` and `packages/safejs/CHECKPOINT_REPLAY.md:156`; the unchanged author scope is `docs/plans/safejs-fix-static-digest-tojson.md:55` and `docs/plans/safejs-fix-static-digest-tojson.md:57`. No migration, automatic host reissue, or broad fingerprint/version change is introduced.

The already completed independent default workspace gate also passes the unchanged package controls: PPR2 integration adjudication 19, promise aliases 19, references 99, public promise recovery 10, promise order 39, promise compatibility 14, and PPR2 integration history 40. Six package fixture hashes, including the v7 alias capture, remain exact across preimage/postimage/live source. These are approved package fixtures, not original audit payloads. Together with old-array full replay, this is bounded evidence against a broader legacy regression, not an exhaustive historical compatibility guarantee. The earlier workspace total remains 25,909 passed / 41 skipped; clean-projection gates are still pending.

Receipts and complete observations are under `out/safejs-remediation/static-digest-tojson-independent-20260829/light-resume/`. `compatibility-summary.json` indexes the individual actual dispositions, exact reset errors, legacy log lines and fixture hashes. Both first and aligned recorder outputs retain full graphs and journals. The four author publication files and built artifact hashes remain unchanged.

The initial targeted five-file Prettier check exited 1 solely for this independently owned review document. Its receipt is retained. Formatting is applied only to this report via `apply_patch`; all four author files remain byte-identical. The subsequent targeted check and strict-diff results are recorded in the light checkpoint.

## Final independent disposition — August 29, 2026

**READY for root approval and ordered publisher intake, not authorization to publish.** This additive disposition supersedes the earlier pending-gate status without removing any baseline failure, recorder failure, or as-of checkpoint. The candidate remains `c4b2ef45aad35d53df5d131fadbdaa0146c9501e69ce0783677cdcc59d0b3891`: four unchanged author publication files plus this independent review, exactly five publication paths. The sole production delta is `packages/safejs/src/interp/host-call.ts`. The 108 prerequisites are separate; host callback arity is excluded. No candidate implementation or author expectation was edited by this reviewer.

### Actual clean-projection gates

The fresh pulled clean projection is `/Users/kjopek/Workspace/poe-code-safejs-tojson-final-independent-projection`, base HEAD `0b89539b8378fb3646b6eea46de8bb6e5a606b15`. All 108 projected prerequisite paths were checked against the frozen index, with only the intended candidate override. ROOT CPU GO permitted one sequential execution phase. `env -u TERM` applies to every command; exact argv, working directories, timestamps, exit codes, stdout and stderr are retained under `out/safejs-remediation/static-digest-tojson-independent-20260829/clean-gates/commands/`.

| Actual command / scope                                                                   | Result                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TURBO_FORCE=true npm run build`                                                         | Exit 0; 67/67 dependency builds, zero cached, then configured code generation, root TypeScript and default public bundling; 30,523 ms total.                                         |
| `TURBO_FORCE=true npm test`                                                              | Exit 0; 25,909 passed / 41 skipped, 1,000 passed files / 3 skipped, zero cached; 209,612 ms total.                                                                                   |
| `npm run lint:types`; configured SafeJS and H5 `tsc -p ... --noEmit`                     | All exit 0.                                                                                                                                                                          |
| Strict author-owned test types; all 28 introduced roots; configured-plus-added 153 roots | All exit 0; zero diagnostics in the 153-root check.                                                                                                                                  |
| Existing adjacent source regression selection                                            | 274/274 in 18 files.                                                                                                                                                                 |
| Existing combined source and public-built configurations                                 | 78/78 each in 12 files; internal representation tests remain source-level, not mislabeled as public-export tests.                                                                    |
| `npm run lint:eslint`, `npm run lint:packages`, `npm run lint:workflows`                 | All exit 0.                                                                                                                                                                          |
| Targeted five-publication-file Prettier check; `git diff --check`                        | Both exit 0; final review-only formatting rechecked at capture.                                                                                                                      |
| Default `npm run format`                                                                 | **Exit 1 retained:** 1,433 warnings, every warned file byte-identical to clean base HEAD; no new warning. Historical author count 1,434 belongs to its older base, not an invariant. |
| Expanded legacy 42-root diagnostic check                                                 | **Exit 2 retained:** 56 diagnostics exactly equal to the pinned ordered-preimage and author-candidate diagnostic records; this optional broader check is not claimed clean.          |

The formatting and expanded-legacy type results are qualified RED gates, not blanket passes. No unrelated source, test timeout, warning suppression, or configuration was changed. The CPU-release receipt records quiescence; no further heavy command runs during final sealing.

### Complete functional and compatibility bounds

The unchanged finite procedure was repeated in the clean projection on native execution, current source, and the unmodified default-built public package. Both current modes match native complete JSON returns and host-observation traces for plain/named-array passive and explicit-hook cases: passive hooks zero, explicit hooks exactly one, host calls one, provider calls zero, no pending awaits, and recorded callbacks zero/one respectively. Actual host argument properties, aliases and callable hooks remain present. Complete public graphs, journals, traces and proof/promise observations are retained in the command stdout receipts, not reduced to the recorder exit predicate.

The default root build legitimately packages `packages/safejs/dist/index.js` through the existing `scripts/bundle.mjs:176` path after the Turbo TypeScript builds. Its SHA is `73b321711e85b91f6ba460ab1cba0aeca056af778a30d5b6513df81272ac4518`; the complete local public import graph is hashed in `clean-gates/default-public-bundle-graph.json`. This differs from the earlier TypeScript-only public index and was independently tested as built, without custom bundling, instrumentation, private exports, or forged provenance.

Fresh source and default-built processes also read the same genuine, unchanged completed captures. Each compatibility round consists of exactly **16 current-candidate completed-capture replay checks** (eight genuine captured runs read by both modes), **four successful old named-array replays**, and **four old plain-object reset attempts**. The 20 successful replays match the complete native JSON return, entire original journal, and entire completed public graph. All four old-object attempts produce the exact existing public reset Error before any host/provider call. All 24 dispositions have zero host/provider calls. The clean-projection repetition confirms this same scope; it is not a claim of 48 distinct historical cases or 16 distinct original captures.

These results establish the tested reset boundary only. They do not say every old hook-bearing graph resets or every legacy capture remains compatible. No snapshot/source/version/marker migration or broad graph fingerprint is introduced. Explicit reset requires caller authorization and reconciliation of prior external effects; do not rewrite captured identities or blindly reissue non-idempotent host work. The unchanged v7/history fixture controls and their exact hashes remain additional bounded compatibility evidence. The earlier recorder failures and baseline default-process reentry failures remain immutable.

### Static scope and publisher handoff

The existing plain-object digest hook bug reproduces before ARG as well as after ARG; direct named-array hooks remain inert in both. Root lifted the ARG hold independently of this repair. The production change constructs only fresh inert null-prototype own-data digest containers, excludes callable hooks from encoding, and leaves actual host arguments unchanged. The no-accessor-invocation conclusion is limited to the reviewed own-data normalization traversal, not the entire converter. Unchanged bridge/value bytes preserve the reviewed generic native-function rejection and source-closure/proof provenance boundaries. This is not an exhaustive security certification, a future arity review, or final published-all-stack closure.

The handoff manifest is `out/safejs-remediation/static-digest-tojson-independent-20260829/candidate/manifest.json`. It lists exactly four author files plus this review, SHA-256/byte counts, captured paths, actual clean-base preimages, absent new-file preimages, and ordered post-prerequisite preimages. The production ordered preimage is `cb7a921e2bd1b32a545683e5a42a9df2643eea2e83cac5942a35c46b7db2cae2`; candidate postimage is `f1c3392085369b3a028950282569a3be9c3ee0f32850544c1984117a5c7db160`. The remaining four publication paths are additions at this captured base/order. Publisher must use these captured bytes, verify fresh actual preimages and prerequisites after HOST/ARG, obtain root approval, and run its required fresh publication gates. This review does not authorize a commit or push.

Only this review and ignored independent evidence are reviewer-authored changes. Generated build outputs are not publications. No original audit payloads were read, no new security probes were introduced, no README or skills sync occurred, and no commit/push or other-clone source write was performed.
