import { parentPort, workerData } from "node:worker_threads";
import { acquire, channel, decodeMetadata, encodeMetadata, phases, publish, stopped, waitReply, type NodeFrame } from "./channel.js";
import { publishNodeObservation } from "./diagnostics.js";
import { integer, record, text } from "./values.js";
import { NODE_ENGINE_ABI, type NodeBridge, type NodeEngineAdapter } from "./worker-types.js";
import { NodeProfileError, nodeLimits, type NodeCompletion, type NodeHostResponse, type NodeSourceRequest } from "./types.js";

if (!parentPort) throw new NodeProfileError("static Worker entry");
const port = parentPort;
const input = record(workerData, ["request", "entry", "identity", "sab"]);
await new Promise<void>((resolve, reject) => {
  port.once("message", value => {
    try { const start = record(value, ["kind"]); if (start.kind !== "start") throw new NodeProfileError("Worker start admission"); resolve(); }
    catch (error) { reject(error); }
  });
});
const request = input.request as NodeSourceRequest;
const shared = channel(input.sab as SharedArrayBuffer);
let frameNumber = 0;
let sequence = 0;
let delivered = 0;
let entryCount = 0;
let printRefused = false;
let pending: { kind: NodeHostResponse["kind"] } | undefined;
let limitObserved = false;
let transportFailed = false;
let cutoffSent = false;
const empty = new Uint8Array(0);
const notify = (value: unknown): void => port.postMessage(value);
function exchange(phase: number, total = 0, offset = 0, bytes: Uint8Array = empty): NodeFrame {
  if (++frameNumber > nodeLimits.frames) throw new NodeProfileError("Worker frame count");
  publish(shared, 1, { frame: frameNumber, sequence, phase, total, offset, bytes });
  notify({ kind: "frame", frame: frameNumber, sequence }); waitReply(shared);
  return acquire(shared, 2, frameNumber, sequence);
}
const transportBridge: NodeBridge = function (op, authority, path, flag, body, moduleKey) {
  if (arguments.length !== 6 || [op, authority, path, flag, body, moduleKey].some(value => value !== null && typeof value !== "string")) throw new NodeProfileError("bridge primitive tuple");
  stopped(shared);
  if (cutoffSent) throw new NodeProfileError("closed guest continuation");
  if (op === "cutoff") {
    if ([authority, path, flag, body, moduleKey].some(value => value !== null) || entryCount !== 1 || pending || sequence !== delivered) throw new NodeProfileError("entry-return cutoff witness");
    cutoffSent = true; notify({ kind: "entryReturn" }); return undefined;
  }
  if (op === "entry" || op === "printRefusal") {
    if ([authority, path, flag, body, moduleKey].some(value => value !== null)) throw new NodeProfileError("entry event fields");
    if (op === "entry") { if (++entryCount !== 1) throw new NodeProfileError("duplicate guest entry"); notify({ kind: "guestEntry" }); }
    else { if (printRefused || entryCount !== 1 || request.selector !== "print") throw new NodeProfileError("print refusal origin"); printRefused = true; }
    return undefined;
  }
  if (op === "delivered") {
    if (!pending || authority !== "postcopy-v1" || path !== String(sequence) || flag !== pending.kind || body !== null || moduleKey !== null || delivered + 1 !== sequence) throw new NodeProfileError("guest postcopy witness");
    pending = undefined; delivered = sequence; notify({ kind: "delivered", sequence }); return undefined;
  }
  if (pending || sequence !== delivered || ++sequence > nodeLimits.operations) throw new NodeProfileError("Worker request sequence");
  if (body !== null) text(body, nodeLimits.operationBytes, "Worker upload bytes");
  const total = body === null ? 0 : Buffer.byteLength(body);
  let reply = exchange(phases.metadata, 0, 0, encodeMetadata({ sequence, op, authority, path, flag, moduleKey, hasText: body !== null, total }));
  let upload: Uint8Array | undefined;
  let uploaded = 0;
  while (reply.phase === phases.uploadCredit) {
    if (reply.total !== total || reply.offset !== uploaded || reply.bytes.length !== 0 || uploaded >= total) throw new NodeProfileError("upload credit reply");
    upload ??= new TextEncoder().encode(body!);
    const end = Math.min(uploaded + 65536, total);
    reply = exchange(phases.upload, total, uploaded, upload.subarray(uploaded, end)); uploaded = end;
  }
  upload = undefined;
  if (uploaded !== total || reply.phase !== phases.result || reply.offset !== 0) throw new NodeProfileError("result metadata reply");
  const metadata = record(decodeMetadata(reply.bytes), ["sequence", "kind", "error", "cacheKey", "total"]);
  const bytes = integer(metadata.total, nodeLimits.operationBytes, "result bytes");
  if (metadata.sequence !== sequence || reply.total !== bytes || !["void", "text", "fsError", "denied", "unsupported"].includes(metadata.kind as string) || metadata.kind !== "text" && bytes !== 0) throw new NodeProfileError("result metadata fields");
  let assembled: Uint8Array | undefined = new Uint8Array(bytes);
  let copied = 0;
  while (copied < bytes) {
    reply = exchange(phases.dataCredit, bytes, copied);
    if (reply.phase !== phases.data || reply.total !== bytes || reply.offset !== copied || reply.bytes.length !== Math.min(65536, bytes - copied)) throw new NodeProfileError("result data reply");
    assembled.set(reply.bytes, copied); copied += reply.bytes.length;
  }
    const resultText = metadata.kind === "text" ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(assembled) : null;
  assembled = undefined;
  reply = exchange(phases.final, bytes, copied);
  if (reply.phase !== phases.final || reply.total !== 0 || reply.offset !== 0 || reply.bytes.length !== 0) throw new NodeProfileError("final reply");
  pending = { kind: metadata.kind as NodeHostResponse["kind"] };
  return JSON.stringify({ sequence, kind: metadata.kind, text: resultText, error: metadata.error, cacheKey: metadata.cacheKey });
};
const bridge: NodeBridge = (...args) => { try { return transportBridge(...args); } catch (error) { transportFailed = true; throw error; } };
async function observation(reason: unknown): Promise<Awaited<ReturnType<typeof publishNodeObservation>>["observation"]> {
  const publication = await publishNodeObservation(reason, value => notify({ kind: "observation", observation: value }));
  if (publication.publisherFault) { try { notify({ kind: "diagnosticFault" }); } catch {} }
  return publication.observation;
}
let result: NodeCompletion;
try {
  const entry = text(input.entry, nodeLimits.metadataBytes, "adapter entry");
  const namespace: unknown = await import(entry);
  if (namespace === null || typeof namespace !== "object") throw new NodeProfileError("adapter module namespace");
  const keys = Reflect.ownKeys(namespace);
  const exported = Object.getOwnPropertyDescriptor(namespace, "default");
  const tag = Object.getOwnPropertyDescriptor(namespace, Symbol.toStringTag);
  if (keys.length !== 2 || !keys.includes("default") || !keys.includes(Symbol.toStringTag) || !exported || !Object.hasOwn(exported, "value") || !tag || !Object.hasOwn(tag, "value") || tag.value !== "Module") throw new NodeProfileError("adapter exports");
  const adapter = record(exported.value, ["abi", "identity", "execute"]);
  if (adapter.abi !== NODE_ENGINE_ABI || adapter.identity !== input.identity || typeof adapter.execute !== "function") throw new NodeProfileError("engine adapter identity/ABI");
  const execute = adapter.execute as NodeEngineAdapter["execute"];
  notify({ kind: "engineAttempt" });
  const observed = record(await execute({ request, bridge, limited: () => { if (!limitObserved) { limitObserved = true; notify({ kind: "engineLimit" }); } } }), ["ok"], ["error"]);
  if (typeof observed.ok !== "boolean" || observed.ok && Object.hasOwn(observed, "error") || !observed.ok && !Object.hasOwn(observed, "error")) throw new NodeProfileError("engine result shape");
  if (observed.ok && !printRefused && !limitObserved && !transportFailed) {
    if (entryCount !== 1 || pending || sequence !== delivered) throw new NodeProfileError("entry return contradiction");
    result = { kind: "entryReturned", observation: { state: "unknown", fault: false, name: null, message: null, code: null } };
  } else {
    result = { kind: printRefused || limitObserved || transportFailed ? "profileFailure" : "guestFailure", observation: await observation(observed.error) };
  }
} catch (error) {
  result = { kind: "profileFailure", observation: await observation(error) };
}
try { if (!cutoffSent) notify({ kind: "terminal", completion: result }); }
finally { port.close(); }
