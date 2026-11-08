import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { errorRecord, journal, json, memory, readJson } from "./telemetry.mjs";
import { observeConsumerFailure } from "./consumer-observation.mjs";
import { orderedStop } from "./ordered-stop.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [control, output] = process.argv.slice(2);
const pin = readJson(join(here, "PIN.json")), policy = pin.policy;
const log = journal(join(output, "consumer.samples.jsonl"));
const flow = { chunks: 0, bytes: 0, maxChunkBytes: 0, pending: 0, maxPending: 0, pendingBytes: 0, maxPendingBytes: 0 };
const allocations = [], mutation = { steps: 0, retainedBytes: 0, touchedByte: null };
const observer = memory(log, "fresh-consumer", () => ({ flow: { ...flow }, mutation: { ...mutation } }));
let abortCode = null, decision = null, ready = false;
process.on("message", message => {
  if (message.type === "abort") abortCode = message.code;
  if (decision) { const resolveDecision = decision; decision = null; resolveDecision(message); }
});
const send = message => new Promise((resolveSend, rejectSend) => process.send(message, error => error ? rejectSend(error) : resolveSend()));
function boundary(code) { return Object.assign(new Error(`CONTROL_BOUNDARY:${code}`), { code }); }
async function request(message) {
  const answer = new Promise(resolveDecision => { decision = resolveDecision; });
  await send(message);
  return answer;
}
let result = null, failure = null;
const observation = control === "consumer-failure" ? observeConsumerFailure(output) : null;
const ordering = ["timeout", "allocation-mutant"].includes(control) ? orderedStop(output, control, policy.cleanupGraceMs) : null;
let consumerObservation = null;
let orderedObservation = null;
const observedHash = createHash("sha256");
try {
  const { hashProcess } = await import("./core.mjs");
  observer.sample("before-stream");
  result = await hashProcess(process.execPath, [policy.heapFlag, "--import", join(here, "producer-observer.mjs"), join(here, "stream-fixture.mjs"), String(policy.bytes), control === "producer-exit7" ? "7" : "0"], { cwd: output, env: { ...process.env, V3_CONTROL_OUTPUT: output, ...(observation ? { V31_CONSUMER_TOKEN: observation.token } : {}) } }, {
    expectedBytes: policy.bytes,
    expectedSha256: policy.sha256,
    consume: async part => {
      flow.chunks++;
      flow.bytes += part.byteLength;
      flow.maxChunkBytes = Math.max(flow.maxChunkBytes, part.byteLength);
      flow.pending++;
      flow.pendingBytes += part.byteLength;
      flow.maxPending = Math.max(flow.maxPending, flow.pending);
      flow.maxPendingBytes = Math.max(flow.maxPendingBytes, flow.pendingBytes);
      observedHash.update(part);
      try {
        if (!ready) {
          ready = true;
          observer.sample("first-consume");
          await send({ type: "ready", producer: readJson(join(output, "producer.start.json")) });
        }
        if (abortCode) throw boundary(abortCode);
        if (control === "consumer-failure" && flow.chunks === 16) throw observation.caller(boundary("V3_CONSUMER_FAILURE"), flow.chunks);
        if (control === "timeout" && flow.chunks === 16) {
          observer.sample("timeout-blocked");
          await request({ type: "timeout-ready", chunks: flow.chunks });
          throw await ordering.stop(boundary(abortCode ?? "V3_PROTOCOL_FAILURE"));
        }
        if (control === "allocation-mutant") {
          if (mutation.steps >= policy.allocationMaxSteps) throw boundary("V3_MUTANT_CAP_EXHAUSTED");
          const allocation = Buffer.alloc(policy.allocationStepBytes, 0x5a);
          allocations.push(allocation);
          mutation.steps++;
          mutation.retainedBytes += allocation.byteLength;
          mutation.touchedByte = allocation[0] + allocation[allocation.length - 1];
          const row = observer.sample("allocation-retained");
          await request({ type: "allocation", row });
          if (abortCode) throw await ordering.stop(boundary(abortCode));
        }
        await setImmediate();
      } finally {
        flow.pending--;
        flow.pendingBytes -= part.byteLength;
        if (flow.chunks % 256 === 0) observer.sample("consume");
      }
    },
  });
} catch (error) { failure = errorRecord(error); if (observation) consumerObservation = observation.settled(error); if (ordering) orderedObservation = ordering.settled(error); }
observer.sample("after-stream-settlement");
const receipt = {
  control, pid: process.pid, ppid: process.ppid, execPath: process.execPath, execArgv: process.execArgv,
  scope: "dedicated fresh consumer process, not supervisor/producer/whole verifier; no baseline subtraction",
  assertionState: "not evaluated; persisted before coordinator assertions",
  proposedExitCode: failure ? 17 : 0, failure, result, memory: observer.snapshot(), flow, consumerObservation, orderedObservation,
  observedSha256: observedHash.digest("hex"), mutation, retainedAllocations: allocations.length,
  thresholdBytes: policy.rssExclusiveBytes, operator: "<", coreSha256: pin.sources.find(source => source.name === "v2-core").sha256,
};
json(join(output, "consumer.receipt.json"), receipt);
log.close();
await send({ type: "receipt", control, failed: Boolean(failure), code: failure?.code ?? null, message: failure?.message ?? null });
if (control === "allocation-mutant" && failure?.code === "V3_RSS_LIMIT") {
  await new Promise(() => {});
} else {
  process.exitCode = receipt.proposedExitCode;
  process.disconnect();
}
