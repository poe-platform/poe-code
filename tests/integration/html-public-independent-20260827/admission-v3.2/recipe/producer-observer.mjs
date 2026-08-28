import { join } from "node:path";
import { errorMonitor } from "node:events";
import { errorRecord, journal, json, memory, readJson } from "./telemetry.mjs";

const output = process.env.V3_CONTROL_OUTPUT;
const log = journal(join(output, "producer.samples.jsonl"));
const flow = { writes: 0, acceptedBytes: 0, maxChunkBytes: 0, falseWrites: 0, drains: 0, pendingDrains: 0, maxPendingDrains: 0, maxWritableLength: 0, writableHighWaterMark: process.stdout.writableHighWaterMark };
const observer = memory(log, "producer", () => ({ flow: { ...flow, writableLength: process.stdout.writableLength } }));
let uncaught = null;
let stdoutError = null;
if (process.env.V31_CONSUMER_TOKEN) process.stdout.on(errorMonitor, error => { stdoutError = error; });
if (process.env.V31_CONSUMER_TOKEN) process.on("uncaughtExceptionMonitor", (error, origin) => {
  let caller = null, callerReadError = null;
  try { caller = readJson(join(output, "CALLER-FAILURE.json")); }
  catch (readError) { callerReadError = errorRecord(readError); }
  uncaught = {
    event: "uncaughtExceptionMonitor", pid: process.pid, ppid: process.ppid,
    token: process.env.V31_CONSUMER_TOKEN, origin, error: { ...errorRecord(error), syscall: error.syscall ?? null, errno: error.errno ?? null },
    stdoutErrorMonitorObserved: stdoutError !== null, stdoutErrorSameObject: stdoutError === error,
    stdoutErroredSameObjectAtUncaught: process.stdout.errored === error, stdoutDestroyed: process.stdout.destroyed,
    stdoutFd: process.stdout.fd, caller, callerReadError,
  };
  json(join(output, "PRODUCER-UNCAUGHT.json"), uncaught);
});
json(join(output, "producer.start.json"), { pid: process.pid, ppid: process.ppid, execPath: process.execPath, execArgv: process.execArgv, memory: observer.snapshot() });
const write = process.stdout.write;
process.stdout.write = function (...args) {
  const result = Reflect.apply(write, this, args);
  const bytes = typeof args[0] === "string" ? Buffer.byteLength(args[0], typeof args[1] === "string" ? args[1] : undefined) : args[0].byteLength;
  flow.writes++;
  flow.acceptedBytes += bytes;
  flow.maxChunkBytes = Math.max(flow.maxChunkBytes, bytes);
  flow.maxWritableLength = Math.max(flow.maxWritableLength, process.stdout.writableLength);
  if (!result) { flow.falseWrites++; flow.pendingDrains++; flow.maxPendingDrains = Math.max(flow.maxPendingDrains, flow.pendingDrains); }
  if (flow.writes === 1 || flow.writes % 256 === 0) observer.sample("write");
  return result;
};
process.stdout.on("drain", () => { flow.drains++; flow.pendingDrains--; });
let finalized = false;
function finish(status, signal) {
  if (finalized) return;
  finalized = true;
  observer.sample("before-process-settlement");
  json(join(output, "producer.receipt.json"), { pid: process.pid, ppid: process.ppid, status, signal, uncaught, memory: observer.snapshot(), flow: { ...flow, writableLength: process.stdout.writableLength }, scope: "producer only; accepted writes are not a claim of delivered bytes" });
  log.close();
}
process.once("SIGTERM", () => { finish(null, "SIGTERM"); process.kill(process.pid, "SIGTERM"); });
process.once("exit", status => finish(status, null));
observer.sample("observer-ready");
