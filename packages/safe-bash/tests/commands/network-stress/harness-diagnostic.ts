import assert from "node:assert/strict";
import { createLab } from "./lab.js";
import { loadEvidence } from "./evidence.js";
import { loopbackTransport } from "./transport.js";

await loadEvidence();
let reproduced = 0;
for (let iteration = 0; iteration < 20; iteration++) {
  const lab = await createLab();
  const injected = loopbackTransport(lab);
  const controller = new AbortController();
  const reason = new Error("Synthetic failing upload; no product module imported");
  const timer = setTimeout(() => controller.abort(new Error("Harness diagnostic watchdog")), 2000);
  let cleanupError: string | undefined;
  let recoveryError: string | undefined;
  try {
    await assert.rejects(injected.transport({
      url: `${lab.origins.A}/echo`, method: "POST",
      headers: [["accept", "*/*"], ["content-type", "application/x-www-form-urlencoded"]],
      body: (async function* () { throw reason; yield new Uint8Array(); })(),
      signal: controller.signal,
    }), (error: unknown) => error === reason);
    await lab.waitForIdle();
    await injected.close();
    try { await lab.close(); }
    catch (error) { cleanupError = String(error); reproduced++; }
    assert.deepEqual(lab.traces, []);
  } finally {
    clearTimeout(timer);
    controller.abort(new Error("Diagnostic cleanup"));
    await injected.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
    try { await lab.close(); }
    catch (error) { recoveryError = String(error); }
  }
  process.stdout.write(`${JSON.stringify({ iteration, productExecutions: 0, cleanupError: cleanupError ?? null, recoveryError: recoveryError ?? null, requests: lab.traces.length })}\n`);
  assert.equal(recoveryError, undefined, "Deferred close-event cleanup must settle");
}
process.stdout.write(`${JSON.stringify({ productExecutions: 0, iterations: 20, reproduced, conclusion: reproduced ? "Frozen lab close assertion can fail without any product module; deferred close event settles" : "Not reproduced; attribution remains unverified", frozenExpectationsChanged: false })}\n`);
