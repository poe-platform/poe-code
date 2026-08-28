import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import * as admission from "./admission.mjs";
import * as storageModule from "./storage.mjs";
import * as lifecycle from "./lifecycle.mjs";
import * as observer from "./observer.mjs";
import * as nativeDriver from "./node-driver.mjs";
import * as cli from "./cli.mjs";
import * as data from "./data.mjs";

export const moduleUrl = import.meta.url;
const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const packet = path.resolve(moduleRoot, "../..");
const precode = JSON.parse(fs.readFileSync(path.join(packet, "observer-v1/PRECODE.json")));
const supplement = JSON.parse(fs.readFileSync(path.join(packet, "observer-v1/PRECODE-v2.json")));
const original = JSON.parse(fs.readFileSync(path.join(packet, "OBSERVATIONS.json")));
const additions = JSON.parse(fs.readFileSync(path.join(packet, "OBSERVATIONS-addendum-v2.json")));
const modules = [admission, storageModule, lifecycle, observer, nativeDriver, cli, data, { moduleUrl }];
const hashes = Object.fromEntries(modules.map(namespace => { const filename = fileURLToPath(namespace.moduleUrl); return [path.basename(filename), admission.digest(fs.readFileSync(filename))]; }));

export class Model {
  constructor(scenario) {
    this.scenario = scenario; this.files = new Map(); this.sequence = 0; this.time = 0;
    this.timers = new Map(); this.timerSequence = 0; this.maximumTimers = 0; this.events = 0; this.starts = 0; this.releases = 0; this.lateErrors = 0; this.mutations = [];
    this.put("/", "directory"); this.put("/controls", "directory"); this.put("/controls/modules", "directory");
    for (const name of Object.keys(hashes)) this.put(`/controls/modules/${name}`, "file", fs.readFileSync(path.join(moduleRoot, name)));
    this.put("/controls/bash", "file", Buffer.from("FINITE CHILD MODEL — NOT AN EXECUTABLE"));
    this.put("/controls/node", "file", Buffer.from("FINITE PARENT MODEL — NOT AN EXECUTABLE"));
    for (const name of ["config", "seal", "rows"]) this.put(`/controls/${name}`, "file", Buffer.from(name));
  }
  put(filename, kind, bytes = Buffer.alloc(0)) {
    const mode = kind === "directory" ? (filename.startsWith("/owned") ? 0o700 : 0o755) : ["/controls/bash", "/controls/node"].includes(filename) ? 0o755 : filename.startsWith("/owned/records/") ? 0o600 : 0o644;
    this.files.set(filename, { kind, mode, identity: ++this.sequence, bytes: Buffer.from(bytes) });
  }
  stat(filename) {
    if (this.scenario === "mkdir-after-acquisition-inspection-failure" && filename === "/owned" && this.files.has(filename)) throw new Error("injected post-mkdir inspection failure");
    const record = this.files.get(filename); if (!record) throw new Error(`missing: ${filename}`);
    return { kind: record.kind, mode: record.mode, identity: record.identity, bytes: record.bytes.length };
  }
  read(filename) { const record = this.files.get(filename); if (!record) throw new Error(`missing: ${filename}`); return Buffer.from(record.bytes); }
  hash(filename, maximumBytes) { const bytes = this.read(filename); assert.equal(bytes.length, maximumBytes); return admission.digest(bytes); }
  runtimeIdentity() { return { path: "/controls/node", version: this.scenario === "runtime-version-mismatch-before-launch" ? "WRONG" : "FINITE_MODEL", platform: "synthetic", arch: "synthetic" }; }
  list(directory) { return [...this.files.keys()].filter(name => name !== directory && path.dirname(name) === directory).map(name => path.basename(name)); }
  canonical(filename) { return filename; }
  mkdir(filename) {
    if (this.files.has(filename)) throw new Error("exists");
    this.put(filename, "directory");
    if (this.scenario === "whole-deadline-before-launch" && filename.endsWith("/tmp")) this.time = 150001;
  }
  rmdir(filename) {
    if (this.scenario === "cleanup-failure-refused" && filename.endsWith("/tmp")) throw new Error("injected rmdir failure");
    assert.deepEqual(this.list(filename), []); this.files.delete(filename);
    if (filename === "/owned/fixture") {
      const targets = { "final-module-drift": "/controls/modules/lifecycle.mjs", "final-authorization-drift": "/controls/authorization", "final-config-drift": "/controls/config", "final-seal-drift": "/controls/seal", "final-row-input-drift": "/controls/rows", "final-runtime-drift": "/controls/node" };
      if (targets[this.scenario]) { const target = targets[this.scenario]; this.files.get(target).bytes = Buffer.from("changed after final row"); this.mutations.push(target); }
    }
  }
  writeExclusive(filename, bytes) {
    if (this.scenario === "post-spawn-receipt-failure-accounted" && filename.includes("/spawn-")) throw new Error("injected receipt persistence failure");
    assert.equal(this.files.has(filename), false); this.put(filename, "file", bytes);
    if (filename === "/owned/records/final.json") {
      const targets = { "post-persistence-module-drift": "/controls/modules/lifecycle.mjs", "post-persistence-binary-drift": "/controls/bash", "post-persistence-receipt-drift": "/owned/records/attempt-N01.json" };
      if (targets[this.scenario]) { const target = targets[this.scenario]; this.files.get(target).bytes = Buffer.from("changed during final persistence"); this.mutations.push(target); }
      if (this.scenario === "post-persistence-new-module") { this.put("/controls/modules/extra.mjs", "file"); this.mutations.push("/controls/modules/extra.mjs"); }
      if (this.scenario === "post-persistence-receipt-new-entry") { this.put("/owned/records/foreign", "file"); this.mutations.push("/owned/records/foreign"); }
    }
  }
  now() { return this.time; }
  timer(delay, callback) { const id = ++this.timerSequence; this.timers.set(id, { at: this.time + delay, callback }); this.maximumTimers = Math.max(this.maximumTimers, this.timers.size); return id; }
  clearTimer(id) { this.timers.delete(id); }
  start(spec, callbacks) {
    this.starts++; assert.equal(spec.executable, "/controls/bash");
    assert.deepEqual(Object.keys(spec.env).sort(), ["BASH_ENV", "ENV", "HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "TZ"].sort());
    assert.equal(spec.env.PATH, ""); assert.equal(spec.args[0], "--noprofile"); assert.equal(spec.args[1], "--norc");
    if (this.scenario === "sync-spawn-throw-no-close") throw new Error("injected synchronous spawn throw");
    if (this.scenario === "async-spawn-error-no-close") {
      this.timer(0, () => callbacks.error(new Error("injected asynchronous spawn error")));
      return { pid: undefined, release: () => { this.releases++; } };
    }
    let alive = true, closed = false;
    const code = this.scenario === "native-nonzero-observation" ? 7 : 0;
    const close = () => {
      if (closed) return; closed = true;
      if (this.scenario !== "surviving-group-hard-terminal") alive = false;
      callbacks.exit(code, null); callbacks.close(code, null);
      if (this.scenario === "replaced-directory-not-deleted") this.put("/owned/fixture/tmp", "directory");
      if (this.scenario === "new-fixture-entry-refused") this.put("/owned/fixture/foreign", "file", Buffer.from("preserve"));
    };
    this.timer(0, callbacks.spawn);
    if (this.scenario === "stdin-write-error") this.timer(5, () => callbacks.error(new Error("injected stdin EIO")));
    if (!["missing-close-hard-terminal", "surviving-group-hard-terminal"].includes(this.scenario)) {
      this.timer(10, () => {
        const repeated = this.scenario === "repeated-faults-timer-bound";
        const bytes = Buffer.alloc(repeated || this.scenario === "output-overflow" ? 65537 : this.scenario === "aggregate-output-overflow" ? 65536 : 5, 65);
        for (let index = 0; index < (repeated ? 200 : 1); index++) callbacks.data("stdout", bytes);
      });
      this.timer(20, close);
    } else if (this.scenario === "surviving-group-hard-terminal") this.timer(20, close);
    if (this.scenario === "late-stream-error-handled") this.timer(30, () => { this.lateErrors++; callbacks.error(new Error("handled after terminal")); });
    return {
      pid: 1000 + this.starts,
      signalGroup: () => {
        if (this.scenario === "surviving-group-hard-terminal") return;
        alive = false;
        if (this.scenario !== "missing-close-hard-terminal") this.timer(1, close);
      },
      groupExists: () => alive,
      release: () => { this.releases++; },
    };
  }
  async drive(promise) {
    let settled = false, value, failure;
    promise.then(result => { settled = true; value = result; }, error => { settled = true; failure = error; });
    while (!settled || this.timers.size) {
      await Promise.resolve(); await Promise.resolve();
      if (settled && !this.timers.size) break;
      const next = [...this.timers].sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!next) { if (settled) break; throw new Error("model stalled without scheduled event"); }
      assert.ok(++this.events <= 4096, "finite event ceiling");
      this.timers.delete(next[0]); this.time = Math.max(this.time, next[1].at);
      assert.ok(this.time <= 150001, "finite virtual time ceiling"); next[1].callback();
    }
    if (failure) throw failure; return value;
  }
}
export function configFor(model) {
  const rows = [...original.rows, ...additions.rows];
  const rowIds = rows.slice(0, model.scenario === "aggregate-output-overflow" ? 17 : 1).map(row => row.id);
  if (model.scenario === "empty-cohort-refused") rowIds.length = 0;
  if (model.scenario === "unselected-row-refused") rowIds[0] = "A99";
  const runtime = { path: "/controls/node", version: "FINITE_MODEL", platform: "synthetic", arch: "synthetic", mode: 0o755, bytes: model.stat("/controls/node").bytes, sha256: admission.digest(model.read("/controls/node")) };
  const config = { schema: "mapfile-observer-v1", mode: "synthetic", runtime, protected: {}, protectedModes: {}, moduleRoot: "/controls/modules", moduleFiles: Object.keys(hashes), moduleSealSha256: admission.digest(Buffer.from("seal")), authorizationPath: "/controls/authorization", recipeSha256: admission.digest(Buffer.from(JSON.stringify(rows))), rows, rowIds, outputRoot: "/owned", binary: "/controls/bash", binaryBytes: model.stat("/controls/bash").bytes, binaryMode: 0o755, binarySha256: admission.digest(model.read("/controls/bash")) };
  const authority = { kind: model.scenario === "missing-root-go" ? "NOT_AUTHORIZED" : "SYNTHETIC_ONLY", runtime, moduleSealSha256: model.scenario === "wrong-go-seal" ? "wrong" : config.moduleSealSha256, recipeSha256: config.recipeSha256, outputRoot: config.outputRoot, rowIds };
  model.put(config.authorizationPath, "file", Buffer.from(JSON.stringify(authority)));
  config.authorizationSha256 = admission.digest(model.read(config.authorizationPath));
  for (const [filename, record] of model.files) if (record.kind === "file" && ![config.binary, runtime.path].includes(filename)) { config.protected[filename] = admission.digest(record.bytes); config.protectedModes[filename] = 0o644; }
  if (model.scenario === "runtime-byte-drift-before-launch") model.files.get(runtime.path).bytes = Buffer.alloc(runtime.bytes, 1);
  if (model.scenario === "bad-binary-hash") config.binarySha256 = "0".repeat(64);
  if (model.scenario === "extra-module-refused") model.put("/controls/modules/extra.mjs", "file", Buffer.from("unadmitted"));
  return config;
}

export async function syntheticControls() {
  const sealPath = path.join(packet, "observer-v1/MODULE-SEAL.json");
  const seal = JSON.parse(fs.readFileSync(sealPath));
  for (const [relative, expected] of Object.entries(seal.artifacts)) {
    const filename = path.join(packet, relative); assert.equal(fs.realpathSync(filename), filename);
    assert.equal(fs.lstatSync(filename).mode & 0o7777, seal.artifactModes[relative]);
    assert.equal(admission.digest(fs.readFileSync(filename)), expected, relative);
  }
  const results = [];
  for (const scenario of [...precode.controls, ...supplement.controls]) {
    const model = new Model(scenario), config = configFor(model);
    let report;
    const result = { scenario, pass: false };
    try {
      if (scenario === "outside-receipt-refused") {
        const owned = new storageModule.OwnedStorage(model, "/owned"); owned.acquire("/owned"); owned.acquire("/owned/records");
        assert.throws(() => owned.write("../escape", {})); assert.equal(model.files.has("/escape"), false);
        result.scope = "whole storage module; no child";
      } else {
        report = await model.drive(observer.runObserver(model, config));
        const positive = ["natural-zero", "native-nonzero-observation", "late-stream-error-handled"].includes(scenario);
        assert.equal(report.success, positive);
        if (positive) { assert.equal(report.launched, 1); assert.equal(report.actualCloseEvents, 1); assert.equal(report.rows[0].groupAbsent, true); }
        if (scenario === "native-nonzero-observation") assert.equal(report.rows[0].code, 7);
        if (scenario === "late-stream-error-handled") assert.equal(model.lateErrors, 1);
        if (scenario.startsWith("final-")) { assert.equal(model.mutations.length, 1); assert.ok(report.failures.some(row => row.phase === "final-integrity")); }
        if (["sync-spawn-throw-no-close", "async-spawn-error-no-close"].includes(scenario)) { assert.equal(report.actualCloseEvents, 0); assert.equal(report.launched, 0); assert.equal(report.spawnCalls, 1); }
        if (["missing-close-hard-terminal", "surviving-group-hard-terminal"].includes(scenario)) { assert.equal(report.rows[0].terminal, "terminal-cleanup-uncertain"); assert.equal(report.rows[0].elapsed, 3000); assert.equal(report.cleanupUncertain, true); }
        if (scenario === "missing-close-hard-terminal") assert.equal(report.actualCloseEvents, 0);
        if (scenario === "surviving-group-hard-terminal") assert.equal(report.rows[0].groupAbsent, false);
        if (scenario === "post-spawn-receipt-failure-accounted") { assert.equal(report.launched, 1); assert.equal(report.remaining.length, 0); assert.match(report.rows[0].fault, /persistence after spawn/u); }
        if (scenario === "mkdir-after-acquisition-inspection-failure") { assert.equal(report.directories[0].planned, true); assert.equal(report.directories[0].acquired, true); assert.equal(report.directories[0].identity, null); assert.equal(report.cleanupUncertain, true); assert.equal(model.starts, 0); }
        if (scenario === "replaced-directory-not-deleted") assert.ok(model.files.has("/owned/fixture/tmp"));
        if (scenario === "new-fixture-entry-refused") assert.equal(model.read("/owned/fixture/foreign").toString(), "preserve");
        if (["bad-binary-hash", "missing-root-go", "wrong-go-seal", "unselected-row-refused", "empty-cohort-refused", "extra-module-refused", "whole-deadline-before-launch"].includes(scenario)) assert.equal(model.starts, 0);
        if (scenario.includes("output-overflow")) { assert.match(report.rows.at(-1).fault, /output ceiling/u); assert.ok(report.outputBytesRetained <= 1048576); }
        if (scenario === "stdin-write-error") assert.match(report.rows[0].fault, /stdin EIO/u);
        if (scenario.startsWith("runtime-")) { assert.equal(model.starts, 0); assert.equal(report.directories.length, 0); }
        if (scenario.startsWith("post-persistence-")) {
          assert.equal(model.mutations.length, 1); assert.equal(report.launched, 1); assert.equal(report.actualCloseEvents, 1);
          assert.ok(report.failures.some(row => row.phase === (scenario.includes("receipt") ? "post-persistence-storage" : "post-persistence-integrity")));
          if (scenario.endsWith("new-entry")) assert.ok(model.files.has("/owned/records/foreign"));
        }
        if (scenario === "repeated-faults-timer-bound") {
          assert.match(report.rows[0].fault, /output ceiling/u); assert.ok(model.maximumTimers <= 16);
          assert.ok(report.rows[0].signals.length <= 4); assert.ok(report.outputBytesRetained <= 65536); assert.equal(model.starts, 1);
        }
        result.report = report;
      }
      assert.equal(model.timers.size, 0); result.pass = true;
    } catch (error) { result.failure = { message: error.message, stack: error.stack }; result.report = report; }
    result.model = { events: model.events, virtualTime: model.time, starts: model.starts, releases: model.releases, maximumTimers: model.maximumTimers, pendingTimers: model.timers.size, discardedInMemoryEntries: model.files.size };
    model.files.clear(); results.push(result);
  }
  await assert.rejects(cli.main([]), /explicit ROOT authorization/u);
  for (const [relative, expected] of Object.entries(seal.artifacts)) {
    const filename = path.join(packet, relative); assert.equal(fs.realpathSync(filename), filename);
    assert.equal(fs.lstatSync(filename).mode & 0o7777, seal.artifactModes[relative]);
    assert.equal(admission.digest(fs.readFileSync(filename)), expected, relative);
  }
  const runtimeHash = createHash("sha256"), runtimePath = fs.realpathSync(process.execPath);
  for await (const bytes of fs.createReadStream(runtimePath, { highWaterMark: 65536 })) runtimeHash.update(bytes);
  const parentRuntime = { path: runtimePath, bytes: fs.statSync(runtimePath).size, mode: fs.statSync(runtimePath).mode & 0o7777, sha256: runtimeHash.digest("hex"), version: process.version, platform: process.platform, arch: process.arch };
  return { version: 2, kind: "WHOLE_MODULE_SYNTHETIC_ONLY", parentRuntime, moduleSealSha256: admission.digest(fs.readFileSync(sealPath)), actualImportedModuleHashes: hashes, actualImportedModuleUrls: modules.map(namespace => namespace.moduleUrl), scenarios: results, passed: results.filter(row => row.pass).length, total: results.length, originalTotal: precode.controls.length, supplementalTotal: supplement.controls.length, cliMissingAdmissionRejected: true, actualChildProcesses: 0, actualNativeCalls: 0, productImports: 0, nativeDriverInstantiations: 0, qualification: "Dependency filesystem/clock/child model. No actual OS spawn/group/timeout behavior proved; native driver imported as code but not instantiated." };
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await syntheticControls();
  const json = Buffer.from(JSON.stringify(report)); assert.ok(json.length <= precode.limits.retainedSyntheticReportBytes);
  const capture = path.join(packet, "observer-v1/captures", `synthetic-${Date.now()}-${process.pid}.json.gz.base64`);
  fs.mkdirSync(path.dirname(capture), { recursive: true });
  fs.writeFileSync(capture, gzipSync(json).toString("base64") + "\n", { flag: "wx" });
  console.log(JSON.stringify({ capture, passed: report.passed, total: report.total, actualChildProcesses: 0, actualNativeCalls: 0 }));
  if (report.passed !== report.total) process.exitCode = 1;
}
