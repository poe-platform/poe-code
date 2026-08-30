import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import threads from "node:worker_threads";
import { fileURLToPath } from "node:url";

const NativeWorker = threads.Worker;
const records = [], events = [], waiters = new Set();
let mode = "ordinary";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function event(record, kind, details = {}) { events.push({ sequence: events.length, worker: record.id, kind, ...details }); for (const wake of [...waiters]) wake(); }
class ObservedWorker extends NativeWorker {
  constructor(filename, options) {
    const original = fileURLToPath(filename), control = mode === "silent-ready";
    const actual = control ? new URL("./silent-worker.mjs", import.meta.url) : filename;
    const workerGuard = new URL("./worker-guard.mjs", import.meta.url);
    const record = { id: records.length, original, originalSha256: digest(readFileSync(original)), actual: fileURLToPath(actual), actualSha256: digest(readFileSync(actual)), control, resourceLimits: options.resourceLimits, requestedExecArgv: options.execArgv, online: false, closed: false, requests: 0, terminations: 0, held: [], stderr: "", ready: 0 };
    super(actual, { ...options, execArgv: [...options.execArgv, "--import", workerGuard.href], stderr: true });
    this.record = record; record.worker = this; records.push(record); event(record, "constructor");
    this.once("online", () => { record.online = true; event(record, "online"); });
    this.once("exit", code => { record.closed = true; event(record, "exit", { code }); });
    record.stderrDone = new Promise(resolve => this.stderr.once("end", resolve));
    this.stderr.on("data", bytes => { record.stderr += bytes.toString(); });
  }
  emit(name, ...args) {
    const value = args[0];
    if (name === "message" && value?.ready === true) { this.record.ready++; event(this.record, "ready"); }
    if (name === "message" && value?.operation === "expr-match" && mode === "hold-real-replies") {
      this.record.held.push(args); event(this.record, "held-real-reply", { request: value.id }); return true;
    }
    return super.emit(name, ...args);
  }
  postMessage(value, transfers) {
    if (value?.descriptor?.kind === "expr-match") { this.record.requests++; event(this.record, "expr-request", { request: value.id }); }
    return super.postMessage(value, transfers);
  }
  terminate() {
    this.record.terminations++; event(this.record, "product-terminate");
    return super.terminate().then(code => { event(this.record, "termination-settled", { code }); return code; });
  }
  release() {
    for (const args of this.record.held.splice(0)) { event(this.record, "release-real-reply", { request: args[0].id }); super.emit("message", ...args); }
  }
}
threads.Worker = ObservedWorker; syncBuiltinESMExports();
export const observe = {
  records, events,
  begin() { return records.length; },
  setMode(value) { assert.ok(["ordinary", "silent-ready", "hold-real-replies"].includes(value)); mode = value; },
  mark(label) { events.push({ sequence: events.length, kind: label }); },
  async wait(predicate) {
    if (predicate()) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(wake); reject(new Error("author observer handshake deadline")); }, 5000);
      function wake() { if (predicate()) { clearTimeout(timer); waiters.delete(wake); resolve(); } }
      waiters.add(wake); wake();
    });
  },
  async end(start) {
    const selected = records.slice(start); assert.ok(selected.every(record => record.closed), "owned workers not retired at invocation settlement");
    await Promise.all(selected.map(record => record.stderrDone));
    for (const record of selected) {
      assert.match(record.original, /\/consumer\/node_modules\/virtual-bash\/dist\/commands\/regex-execution\/worker\.js$/u);
      const loads = record.stderr.split("\n").filter(line => line.startsWith("EXPR_WORKER_LOAD ")).map(line => JSON.parse(line.slice(17)));
      const expectedSuffixes = record.control ? ["/silent-worker.mjs"] : ["/commands/regex-execution/worker.js", "/commands/regex-execution/protocol.js", "/commands/regex-execution/matching.js", "/commands/expr/bre-worker.js"];
      for (const suffix of expectedSuffixes) assert.ok(loads.some(entry => entry.path.endsWith(suffix)), `missing actual worker load: ${suffix}`);
      record.loads = loads;
    }
    return { workerCreations: selected.length, workerRequests: selected.reduce((count, record) => count + record.requests, 0), workerOldGenerationMb: selected.map(record => record.resourceLimits.maxOldGenerationSizeMb), workerStackMb: selected.map(record => record.resourceLimits.stackSizeMb) };
  },
  serializable() { return { events, workers: records.map(({ worker: _worker, stderrDone: _done, held: _held, ...record }) => record) }; },
  restore() { assert.ok(records.every(record => record.closed)); threads.Worker = NativeWorker; syncBuiltinESMExports(); },
};
