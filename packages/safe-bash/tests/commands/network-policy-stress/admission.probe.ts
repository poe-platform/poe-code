import assert from "node:assert/strict";
import { bounded, deferred, drain, response, start } from "./helpers.js";

async function probe(name: string, armObserver: boolean, abortDepth: number) {
  const entered = deferred<void>();
  const decision = deferred<boolean>();
  const events: string[] = [];
  const requests: { aborted: boolean; sameReason: boolean }[] = [];
  const reason = new Error(name);
  let sideEffects = 0;
  const execution = start(["http://allowed.invalid/"], {
    authorize() { events.push("authorize-entered"); entered.resolve(); return decision.promise; },
    transport: async request => {
      events.push(`transport-aborted:${request.signal.aborted}`);
      requests.push({ aborted: request.signal.aborted, sameReason: request.signal.reason === reason });
      request.signal.throwIfAborted();
      sideEffects++;
      return response();
    },
  });
  try {
    await bounded(entered.promise, "authorize-entered");
    if (armObserver) { await Promise.resolve(); await Promise.resolve(); }
    events.push("resolve-true");
    decision.resolve(true);
    const abort = (remaining: number): void => {
      if (remaining > 0) queueMicrotask(() => abort(remaining - 1));
      else { events.push("caller-abort"); execution.controller.abort(reason); }
    };
    abort(abortDepth);
    const result = await bounded(execution.done.then(
      value => ({ kind: "resolved", exitCode: value.exitCode }),
      error => ({ kind: "rejected", exactCallerReason: error === reason }),
    ), "command result");
    await drain();
    assert.deepEqual(result, { kind: "rejected", exactCallerReason: true });
    assert.equal(sideEffects, 0);
    console.log(JSON.stringify({ diagnostic: true, name, events, dispatchCount: requests.length, requests, result, sideEffects }));
  } finally { decision.resolve(false); execution.controller.abort(); await execution.done.catch(() => {}); }
}

async function main() {
  const watchdog = setTimeout(() => { process.stderr.write("probe watchdog expired\n"); process.exit(90); }, 8000);
  try {
    await probe("entered-then-one-microtask-abort", false, 1);
    await probe("armed-observer-one-microtask-abort", true, 1);
    await probe("armed-observer-two-microtask-abort", true, 2);
    await probe("armed-observer-three-microtask-abort", true, 3);
  } finally { clearTimeout(watchdog); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
