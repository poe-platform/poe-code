import assert from "node:assert/strict";
import { Socket } from "node:net";
import { closeResources } from "./close-resources.js";
import { createLab } from "./lab-v2.js";
import { loadEvidence } from "./evidence.js";
import { loopbackTransport } from "./transport.js";

await loadEvidence();
class ControlledSocket extends Socket {
  override destroy(): this { return this; }
}
const delayed = new ControlledSocket();
const delayedSet = new Set([delayed]);
delayed.once("close", () => delayedSet.delete(delayed));
let settled = false;
const waiting = closeResources([], delayedSet).then(() => { settled = true; });
await new Promise<void>((resolve) => setImmediate(resolve));
assert.equal(settled, false, "Destroy is not a close event");
delayed.emit("close");
await waiting;
assert.equal(delayedSet.size, 0);
const stuck = new ControlledSocket();
await assert.rejects(closeResources([], new Set([stuck]), 30), /cleanup deadline/);
assert.equal(stuck.listenerCount("close"), 0, "Timeout removes only its own listeners");
const untracked = new ControlledSocket();
const untrackedResult = closeResources([], new Set([untracked]));
untracked.emit("close");
await assert.rejects(untrackedResult, /Fixture socket cleanup incomplete/, "Zero-resource assertion must still run");
process.stdout.write(`${JSON.stringify({ selfchecks: 3, passed: 3, productExecutions: 0 })}\n`);
for (let iteration = 0; iteration < 100; iteration++) {
  const lab = await createLab();
  const injected = loopbackTransport(lab);
  const controller = new AbortController();
  const reason = new Error("Synthetic upload failure without product execution");
  const timer = setTimeout(() => controller.abort(new Error("Selfcheck watchdog")), 2000);
  try {
    await assert.rejects(injected.transport({
      url: `${lab.origins.A}/echo`, method: "POST", headers: [],
      body: (async function* () { throw reason; yield new Uint8Array(); })(), signal: controller.signal,
    }), (error: unknown) => error === reason);
    await lab.waitForIdle();
    await injected.close();
    await lab.close();
    assert.deepEqual(lab.traces, []);
  } finally {
    clearTimeout(timer);
    controller.abort();
    await injected.close();
    await lab.close();
  }
  process.stdout.write(`${JSON.stringify({ iteration, passed: true, requests: 0, productExecutions: 0 })}\n`);
}
