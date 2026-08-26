import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import type { NetworkAuthorization } from "../../../src/commands/network/index.js";
import { bounded, deferred, drain, response, start } from "./helpers.js";

const mode = process.argv[2];
assert.ok(mode === "abort" || mode === "deadline");
const watchdog = setTimeout(() => { process.stderr.write("child watchdog expired\n"); process.exit(90); }, 4000);
const entered = deferred<NetworkAuthorization>();
const decision = deferred<boolean>();
let transports = 0;
const reason = new Error("late-policy-caller-abort");
const execution = start(["http://allowed.invalid/"], {
  limits: { maxTimeMs: mode === "deadline" ? 50 : 2000 },
  authorize(request) { entered.resolve(request); return decision.promise; },
  transport: async () => { transports++; return response(); },
});
try {
  const policy = await bounded(entered.promise, "child authorizer entered");
  assert.equal(policy.signal.aborted, false);
  if (mode === "abort") {
    execution.controller.abort(reason);
    await assert.rejects(bounded(execution.done, "child caller cancellation"), error => error === reason);
    assert.equal(policy.signal.reason, reason);
  } else {
    assert.equal((await bounded(execution.done, "child policy deadline")).exitCode, 28);
    assert.equal(policy.signal.reason.exitCode, 28);
  }
  assert.equal(policy.signal.aborted, true);
  assert.equal(getEventListeners(policy.signal, "abort").length, 0);
  decision.reject(new Error("deliberately-late-policy-rejection"));
  await drain();
  assert.equal(transports, 0);
  assert.equal(getEventListeners(policy.signal, "abort").length, 0);
  process.stdout.write(`late-${mode}:ok\n`);
} finally {
  decision.resolve(false);
  execution.controller.abort();
  await execution.done.catch(() => {});
  clearTimeout(watchdog);
}
