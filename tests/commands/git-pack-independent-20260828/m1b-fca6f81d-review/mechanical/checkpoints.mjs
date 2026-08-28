import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { openSession, observeReservations, reasonFacts } from "./session-observation.mjs";

const cases = new Set(["CHECK-CRC", "CHECK-HASH", "CHECK-REPLAY", "INHERIT-blob", "INHERIT-tree", "INHERIT-commit", "INHERIT-tag"]);

export async function runCase(api, caseId) {
  if (!cases.has(caseId)) throw new Error("Unknown checkpoint case");
  const observed = await openSession(api);
  const { session, controller } = observed;
  const ledger = observeReservations(session);
  const originalStep = session.step;
  const originalDescriptor = Object.getOwnPropertyDescriptor(session, "step");
  const checkpoints = [];
  const sentinel = new Error("independent-checkpoint-caller-reason");
  let cancellationInjected = false;
  const cancel = caseId.startsWith("CHECK-");
  let call = 0;
  let failed = false;
  let failure;
  let result;
  const restore = () => {
    if (originalDescriptor === undefined) delete session.step;
    else Object.defineProperty(session, "step", originalDescriptor);
    ledger.restore();
  };
  api.registerCleanup(restore);
  session.step = async function (amount = 1) {
    call++;
    if (call > 32) throw new Error("Checkpoint observation cap");
    checkpoints.push({ call, amount });
    if (cancel && call === (caseId === "CHECK-REPLAY" ? 4 : 2)) {
      cancellationInjected = true;
      controller.abort(sentinel);
    }
    return Reflect.apply(originalStep, this, [amount]);
  };
  const baseBytes = Buffer.from("A");
  const program = Buffer.from([1, 1, 1, 66]);
  const type = caseId.startsWith("INHERIT-") ? caseId.slice(8) : "blob";
  const oid = createHash("sha1").update(`${type} 1\0`).update(Buffer.from("B")).digest("hex");
  await api.captureBytes("checkpoint-program", program);
  try {
    if (caseId === "CHECK-CRC") {
      const { crc32 } = await api.load("dist/commands/git/crc.js");
      result = await crc32(session, Buffer.alloc(8192, 97));
    } else if (caseId === "CHECK-HASH") result = await session.hash(Buffer.alloc(8192, 97));
    else {
      const { applyDelta } = await api.load("dist/commands/git/delta.js");
      result = await applyDelta(session, { type, bytes: baseBytes }, program, oid);
    }
  } catch (error) { failed = true; failure = error; }
  const resultData = !failed && result && typeof result === "object" ? { type: result.type, bytes: Array.from(result.bytes) } : null;
  if (!failed && result && typeof result === "object") session.release(result.bytes);
  const events = ledger.events.map(event => ({ ...event }));
  restore();
  const cleanup = await observed.closeObservation();
  await api.capture("checkpoint-outcome", {
    caseId, checkpoints, events, cancellationInjected, reason: reasonFacts(failed, failure, sentinel),
    result: resultData, cleanupFailed: cleanup.failed,
    scope: "Private exact-module deterministic checkpoint host abort, not scheduler/native-codec timing or public cap success",
  });
  api.check("cleanup", !cleanup.failed);
  if (cancel) {
    api.check("checkpoint-reason", cancellationInjected && failed && Object.is(failure, sentinel));
    api.check("stopped-at-checkpoint", call === (caseId === "CHECK-REPLAY" ? 4 : 2));
    if (caseId === "CHECK-REPLAY") api.check("replay-result-unwind", events.filter(event => event.event === "unreserve" && event.size === 1).length === 1);
  } else api.check("inherited-type-and-bytes", !failed && resultData?.type === type && resultData.bytes.length === 1 && resultData.bytes[0] === 66);
}
