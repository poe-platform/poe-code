import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { isUint8Array } from "node:util/types";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { Model, configFor } from "./modules/synthetic.mjs";
import { assertOwnData, describeReason } from "./modules/data.mjs";

const here = path.dirname(fileURLToPath(import.meta.url)), packet = path.dirname(here);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sealPath = path.join(here, "MODULE-SEAL.json"), sealBytes = fs.readFileSync(sealPath), seal = JSON.parse(sealBytes);
const precodePath = path.join(here, "CHRONOLOGY-v4.json"), precode = JSON.parse(fs.readFileSync(precodePath));
const mode = process.argv[2] ?? "candidate";
assert.ok(["baseline", "candidate"].includes(mode)); assert.ok(process.argv.length <= 3);
const cases = mode === "baseline" ? precode.cases.filter(item => precode.baselineSelection.includes(item.id)) : precode.cases;
const sources = new Map(seal.moduleFiles.map(name => [name, fs.readFileSync(path.join(here, "modules", name))]));
const checkSeal = () => {
  for (const [relative, expected] of Object.entries(seal.artifacts)) {
    const filename = path.join(packet, relative); assert.equal(fs.realpathSync(filename), filename);
    const stat = fs.lstatSync(filename); assert.ok(stat.isFile()); assert.equal(stat.mode & 0o7777, seal.artifactModes[relative]);
    assert.equal(hash(fs.readFileSync(filename)), expected, relative);
  }
  assertOwnData(fs.readdirSync(path.join(here, "modules")).sort(), seal.moduleFiles.slice().sort());
};
checkSeal();

let active;
const current = () => { assert.ok(active, "no model bound"); return active; };
class TraceModel extends Model {
  constructor(test) {
    super(test.name); this.test = test; this.alive = false; this.children = []; this.trace = []; this.descriptors = new Map(); this.nextDescriptor = 20;
    this.reason = test.reason === "false" ? false : Object.freeze({ message: "chronology sentinel", id: test.id });
    this.secondReason = 0; this.peakDescriptors = 0; this.signalLog = [];
  }
  metadata(filename) {
    const entry = this.files.get(filename); assert.ok(entry, filename);
    return { size: entry.bytes.length, dev: 1, ino: entry.identity, mode: entry.mode, mtimeMs: 0, ctimeMs: 0, isFile: () => entry.kind === "file", isDirectory: () => entry.kind === "directory", isSymbolicLink: () => entry.kind === "symlink" };
  }
  open(filename, flags) {
    assert.equal(flags, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); assert.equal(this.files.get(filename)?.kind, "file");
    const descriptor = ++this.nextDescriptor; this.descriptors.set(descriptor, { filename, offset: 0 }); this.peakDescriptors = Math.max(this.peakDescriptors, this.descriptors.size); return descriptor;
  }
  readDescriptor(descriptor, buffer, offset, length, position) {
    assert.equal(position, null); const entry = this.descriptors.get(descriptor); assert.ok(entry);
    const bytes = this.read(entry.filename), count = Math.min(length, bytes.length - entry.offset);
    bytes.copy(buffer, offset, entry.offset, entry.offset + count); entry.offset += count; return count;
  }
  spawn(executable, args, options) {
    this.starts++; assert.ok(this.starts <= 2); assert.equal(executable, "/controls/bash");
    assertOwnData(args.slice(0, 3), ["--noprofile", "--norc", "-c"]);
    assertOwnData(options.stdio, ["pipe", "pipe", "pipe"]); assert.equal(options.detached, true);
    assertOwnData(options.env, { PATH: "", ENV: "", BASH_ENV: "", HOME: "/owned/fixture/home", TMPDIR: "/owned/fixture/tmp", LANG: "C", LC_ALL: "C", TZ: "UTC" });
    this.trace.push({ event: "spawn-call", at: this.time, pid: this.test.noPid ? null : 1001 });
    if (this.test.syncThrow) throw this.reason;
    const child = new EventEmitter(); child.pid = this.test.noPid ? undefined : 1001;
    this.alive = !this.test.noPid;
    for (const channel of ["stdin", "stdout", "stderr"]) {
      const stream = new EventEmitter(); stream.destroyed = false; stream.destroyCalls = 0;
      stream.destroy = () => { stream.destroyCalls++; stream.destroyed = true; };
      if (channel === "stdin") stream.end = (bytes, callback) => { child.input = Buffer.from(bytes); callback(); };
      child[channel] = stream;
    }
    child.unref = () => { this.releases++; if (this.test.releaseThrow) throw this.reason; };
    this.children.push(child);
    for (const [delay, event, value] of this.test.events) this.timer(delay, () => {
      this.trace.push({ event, at: this.time, value: value ?? null });
      if (event === "absent") this.alive = false;
      else if (event === "spawn") child.emit("spawn");
      else if (event === "exit" || event === "close") child.emit(event, value, null);
      else if (event === "error") child.emit("error", value === "second" ? this.secondReason : this.reason);
      else if (event === "stream-error") child.stdout.emit("error", this.reason);
      else if (event === "data") { const bytes = Buffer.from(value, "hex"); child.stdout.emit("data", bytes); bytes.fill(0); }
      else throw new Error("unadmitted event");
    });
    return child;
  }
  kill(pid, signal) {
    assert.equal(pid, -1001); this.trace.push({ event: "group-query-or-signal", at: this.time, signal });
    if (!this.alive) { const reason = new Error("modeled group absent"); reason.code = "ESRCH"; throw reason; }
    if (signal !== 0) this.signalLog.push(signal);
  }
  async drive(promise) {
    let settled = false, rejected = false, value, reason;
    promise.then(result => { settled = true; value = result; }, error => { settled = true; rejected = true; reason = error; });
    while (!settled || this.timers.size) {
      for (let index = 0; index < 12; index++) await Promise.resolve();
      if (settled && !this.timers.size) break;
      const next = [...this.timers].sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      assert.ok(next, "no model progress"); assert.ok(++this.events <= precode.bounds.modelEventsPerScenario);
      this.timers.delete(next[0]); this.time = Math.max(this.time, next[1].at); assert.ok(this.time <= precode.bounds.modelMilliseconds); next[1].callback();
    }
    if (rejected) throw reason; return value;
  }
}

const mockFs = {
  constants: { O_RDONLY: fs.constants.O_RDONLY, O_NOFOLLOW: fs.constants.O_NOFOLLOW },
  lstatSync: filename => current().metadata(filename), realpathSync: filename => current().canonical(filename),
  readFileSync: filename => current().read(filename), readdirSync: filename => current().list(filename),
  mkdirSync: (filename, options) => { assertOwnData(options, { mode: 0o700 }); current().mkdir(filename); },
  rmdirSync: filename => current().rmdir(filename),
  writeFileSync: (filename, bytes, options) => { assertOwnData(options, { flag: "wx", mode: 0o600 }); current().writeExclusive(filename, bytes); },
  openSync: (filename, flags) => current().open(filename, flags),
  fstatSync: descriptor => { const entry = current().descriptors.get(descriptor); assert.ok(entry); return current().metadata(entry.filename); },
  readSync: (...args) => current().readDescriptor(...args),
  closeSync: descriptor => { assert.equal(current().descriptors.delete(descriptor), true); },
};
const mockProcess = { execPath: "/controls/node", version: "FINITE_MODEL", platform: "synthetic", arch: "synthetic", kill: (...args) => current().kill(...args) };
const context = vm.createContext({ Buffer, process: mockProcess, setTimeout: (callback, delay) => current().timer(delay, callback), clearTimeout: timer => current().clearTimer(timer) }, { codeGeneration: { strings: false, wasm: false } });
const builtins = {
  "node:assert/strict": { default: assert }, "node:path": { default: path }, "node:crypto": { createHash },
  "node:util/types": { isUint8Array }, "node:fs": { default: mockFs },
  "node:child_process": { spawn: (...args) => current().spawn(...args) },
  "node:perf_hooks": { performance: { now: () => current().now() } },
};
const moduleCache = new Map(), builtinCache = new Map(), loads = [];
function sourceModule(name) {
  if (moduleCache.has(name)) return moduleCache.get(name);
  const bytes = sources.get(name); assert.ok(bytes, `not admitted: ${name}`);
  const identifier = pathToFileURL(path.join(here, "modules", name)).href;
  const module = new vm.SourceTextModule(bytes.toString(), { context, identifier, initializeImportMeta(meta) { meta.url = identifier; } });
  moduleCache.set(name, module); loads.push({ name, sha256: hash(bytes), bytes: bytes.length, identifier }); return module;
}
async function link(specifier) {
  if (Object.hasOwn(builtins, specifier)) {
    if (!builtinCache.has(specifier)) {
      const values = builtins[specifier]; builtinCache.set(specifier, new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context, identifier: `injected:${specifier}` }));
    }
    return builtinCache.get(specifier);
  }
  assert.match(specifier, /^\.\/[a-z-]+\.mjs$/u); return sourceModule(specifier.slice(2));
}
const observer = sourceModule("observer.mjs"), driver = sourceModule("node-driver.mjs");
await observer.link(link); await driver.link(link); await observer.evaluate(); await driver.evaluate();
const results = [];
for (const test of cases) {
  active = new TraceModel(test); const model = active, config = configFor(model), result = { id: test.id, name: test.name, pass: false };
  if (!test.success) {
    config.rowIds = ["N01", "N02"];
    const authorization = JSON.parse(model.read(config.authorizationPath)); authorization.rowIds = config.rowIds;
    model.files.get(config.authorizationPath).bytes = Buffer.from(JSON.stringify(authorization));
    config.authorizationSha256 = hash(model.read(config.authorizationPath)); config.protected[config.authorizationPath] = config.authorizationSha256;
  }
  let report;
  try {
    const port = driver.namespace.nodePort("ROOT_NATIVE_GO");
    let settledBytes;
    report = await model.drive(observer.namespace.runObserver(port, config).then(value => { settledBytes = JSON.stringify(value); return value; }));
    result.report = report;
    assert.equal(report.success, test.success); assert.equal(model.starts, 1); assert.equal(report.rows.length, 1);
    if (!test.success) assertOwnData(report.remaining, ["N02"]);
    if (mode === "candidate") {
      const row = report.rows[0]; assert.equal(row.chronologyViolation !== null, test.violation === true);
      if (test.violation) assert.equal(row.lifecycleState, "invalid");
      if (test.id === "T03" || test.id === "T04") { assert.equal(row.chronologyViolation.event, "exit"); assert.equal(row.chronologyViolation.at, 1); assert.equal(row.chronologyViolation.state, "awaiting-spawn"); assert.equal(row.spawnObserved, true); assert.equal(row.exitObserved, true); assert.equal(row.closeObserved, true); }
      if (["T05", "T06", "T07"].includes(test.id)) assert.equal(row.eventCounts[{ T05: "spawn", T06: "exit", T07: "close" }[test.id]], 2);
      if (test.id === "T06") assertOwnData(row.events.filter(event => event.name === "exit").map(event => event.code), [0, 7]);
      if (test.id === "T07") assertOwnData(row.events.filter(event => event.name === "close").map(event => event.code), [0, 7]);
      if (test.id === "T17") { assert.equal(JSON.stringify(report), settledBytes); assertOwnData(row.eventCounts, { spawn: 1, exit: 1, close: 1, error: 0 }); assert.equal(row.code, 0); }
    }
    if (test.reason) { assert.ok(Object.is(report.failureReason, model.reason)); assert.ok(Object.is(report.rows[0].failureReason, model.reason)); }
    if (test.noPid || test.syncThrow) { assert.equal(report.launched, 0); assert.equal(report.actualCloseEvents, 0); }
    if (test.survives) { assert.equal(report.rows[0].terminal, "terminal-cleanup-uncertain"); assert.equal(report.rows[0].elapsed, 3000); assert.equal(report.cleanupUncertain, true); assert.equal(model.alive, true); }
    if (test.id === "T20") assert.equal(Buffer.from(report.rows[0].stdoutBase64, "base64").toString("hex"), "00ff4142");
    assert.equal(model.releases, test.syncThrow ? 0 : 1);
    assert.equal(model.timers.size, 0); assert.equal(model.descriptors.size, 0);
    for (const child of model.children) {
      for (const channel of ["stdin", "stdout", "stderr"]) { assert.equal(child[channel].destroyed, true); assert.equal(child[channel].destroyCalls, 1); assert.ok(child[channel].listenerCount("error") >= 1); }
      assert.ok(child.listenerCount("error") >= 1);
    }
    result.pass = true;
  } catch (reason) { result.failure = { message: describeReason(reason) }; result.report = report; }
  result.model = { starts: model.starts, releases: model.releases, events: model.events, clock: model.time, pending: model.timers.size, descriptors: model.descriptors.size, peakDescriptors: model.peakDescriptors, aliveAtReport: model.alive, discardedEntries: model.files.size, signals: model.signalLog, trace: model.trace };
  assert.equal(model.timers.size, 0); assert.equal(model.descriptors.size, 0);
  model.files.clear(); model.children.length = 0; model.alive = false; active = undefined; results.push(result);
}
checkSeal();
const runtimePath = fs.realpathSync(process.execPath), runtimeHash = createHash("sha256");
for await (const bytes of fs.createReadStream(runtimePath, { highWaterMark: 65536 })) runtimeHash.update(bytes);
const parentRuntime = { path: runtimePath, version: process.version, bytes: fs.statSync(runtimePath).size, mode: fs.statSync(runtimePath).mode & 0o7777, sha256: runtimeHash.digest("hex"), flags: process.execArgv };
const result = { schema: "mapfile-chronology-results-v4", mode, parentRuntime, moduleSealSha256: hash(sealBytes), precodeSha256: hash(fs.readFileSync(precodePath)), executorSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))), loads, boundSourceCount: sources.size, passed: results.filter(item => item.pass).length, total: results.length, results, actualChildren: 0, nativeCalls: 0, productImports: 0, privateEngineImports: 0, modelNetworkCapabilities: 0, qualification: "Whole unmodified module bodies evaluated in Node VM with only finite injected filesystem/child/process/timer primitives. No real OS or native chronology claim." };
const bytes = Buffer.from(JSON.stringify(result)); assert.ok(bytes.length <= precode.bounds.captureBytes);
const capture = path.join(here, "captures", `chronology-v4-${mode}-${Date.now()}-${process.pid}.json.gz.base64`);
assert.equal(fs.realpathSync(path.dirname(capture)), path.dirname(capture));
fs.writeFileSync(capture, gzipSync(bytes).toString("base64") + "\n", { flag: "wx" });
console.log(JSON.stringify({ capture, passed: result.passed, total: result.total, actualChildren: 0, nativeCalls: 0 }));
if (result.passed !== result.total) process.exitCode = 1;
