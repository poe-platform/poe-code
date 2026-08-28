import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { Model, configFor } from "./modules/synthetic.mjs";
import * as admission from "./modules/admission.mjs";
import * as data from "./modules/data.mjs";
import { runObserver } from "./modules/observer.mjs";

const here = path.dirname(fileURLToPath(import.meta.url)), packet = path.dirname(here);
const precode = JSON.parse(fs.readFileSync(path.join(here, "REPAIR-v3.json")));
const sealPath = path.join(here, "MODULE-SEAL.json"), sealBytes = fs.readFileSync(sealPath), seal = JSON.parse(sealBytes);
const checkSeal = () => {
  for (const [relative, expected] of Object.entries(seal.artifacts)) {
    const filename = path.join(packet, relative); assert.equal(fs.realpathSync(filename), filename);
    const stat = fs.lstatSync(filename); assert.ok(stat.isFile()); assert.equal(stat.mode & 0o7777, seal.artifactModes[relative]);
    assert.equal(admission.digest(fs.readFileSync(filename)), expected, relative);
  }
  assert.deepEqual(fs.readdirSync(path.join(here, "modules")).sort(), seal.moduleFiles.slice().sort());
};

class RepairModel extends Model {
  constructor(scenario) { super(scenario); this.nativeChecks = 0; }
  hash(filename, maximumBytes) {
    const hash = super.hash(filename, maximumBytes);
    if (filename === "/controls/bash") {
      this.nativeChecks++;
      if (this.scenario === "deadline-crossed-during-auth" && this.nativeChecks === 2) this.time = 150000;
      if (this.scenario === "deadline-crossed-final-admission" && this.nativeChecks === 3) this.time = 150000;
      if (this.scenario === "just-before-final-admission-boundary" && this.nativeChecks === 2) this.time = 149999;
    }
    return hash;
  }
  mkdir(filename) {
    super.mkdir(filename);
    if (this.scenario === "directory-mode-after-acquisition" && filename === "/owned") this.files.get(filename).mode = 0o777;
  }
  rmdir(filename) {
    super.rmdir(filename);
    if (filename === "/owned/fixture") {
      if (this.scenario === "final-directory-mode") this.files.get("/owned/records").mode = 0o777;
    }
  }
  writeExclusive(filename, bytes) {
    super.writeExclusive(filename, bytes);
    if (filename.includes("/attempt-")) {
      if (this.scenario === "deadline-crossed-during-attempt") this.time = 150000;
      if (this.scenario === "row-admission-deadline-during-attempt") this.time = 2500;
      if (this.scenario === "mode-change-during-attempt") this.files.get("/controls/modules/lifecycle.mjs").mode = 0o777;
      if (this.scenario === "receipt-mode-after-write") this.files.get(filename).mode = 0o666;
    }
    if (this.scenario === "second-row-mode-change" && filename === "/owned/records/row-N01.json") this.files.get("/controls/modules/lifecycle.mjs").mode = 0o777;
    if (this.scenario === "final-receipt-mode" && filename === "/owned/records/final.json") this.files.get(filename).mode = 0o666;
    if (this.scenario === "final-mode-only" && filename === "/owned/records/final.json") this.files.get("/controls/modules/storage.mjs").mode = 0o777;
  }
  start(spec, callbacks) {
    const special = ["close-without-spawn", "close-without-exit", "close-before-spawn", "spawn-after-terminal", "just-before-final-admission-boundary"].includes(this.scenario);
    if (!special) {
      const handle = super.start(spec, callbacks);
      if (this.scenario === "deadline-crossed-during-start") this.time = 150000;
      return handle;
    }
    this.starts++; assert.equal(spec.executable, "/controls/bash");
    assert.deepEqual(spec.args.slice(0, 3), ["--noprofile", "--norc", "-c"]);
    let alive = true;
    const close = () => { alive = false; if (this.scenario !== "close-without-exit") callbacks.exit(0, null); callbacks.close(0, null); };
    if (this.scenario === "spawn-after-terminal") this.timer(3100, () => { callbacks.spawn(); close(); });
    else if (this.scenario === "close-before-spawn") { this.timer(5, close); this.timer(20, callbacks.spawn); }
    else {
      if (this.scenario !== "close-without-spawn") this.timer(0, callbacks.spawn);
      this.timer(this.scenario === "just-before-final-admission-boundary" ? 0 : 20, close);
    }
    return { pid: 2000 + this.starts, signalGroup: () => { alive = false; }, groupExists: () => alive, release: () => { this.releases++; } };
  }
}

const exactThrow = (operation, expected) => {
  let caught = false;
  try { operation(); } catch (reason) { caught = true; assert.ok(Object.is(reason, expected)); }
  assert.equal(caught, true);
};
const exactRejection = async (operation, expected) => {
  let caught = false;
  try { await operation(); } catch (reason) { caught = true; assert.ok(Object.is(reason, expected)); }
  assert.equal(caught, true);
};

checkSeal();
const results = [];
for (const scenario of precode.controls) {
  const model = new RepairModel(scenario), config = configFor(model), result = { scenario, pass: false };
  try {
    if (scenario === "accessor-no-coercion") {
      let reads = 0;
      Object.defineProperty(config.runtime, "version", { get() { reads++; return "FINITE_MODEL"; }, enumerable: true });
      await assert.rejects(runObserver(model, config), /accessor/u); assert.equal(reads, 0); assert.equal(model.starts, 0);
      result.scope = "whole observer rejects own accessor before acquisition";
    } else if (scenario === "array-hole-and-extra-rejection") {
      const hole = new Array(1), inherited = new Array(1); Object.setPrototypeOf(inherited, { 0: "entry" });
      const extra = ["entry"]; extra.extra = true;
      const symbol = ["entry"]; symbol[Symbol("extra")] = true;
      for (const value of [hole, inherited, extra, symbol, [Infinity], [NaN]]) assert.throws(() => data.snapshotOwnData(value), TypeError);
      result.scope = "whole own-data module, six rejected data forms";
    } else if (scenario === "own-data-trap-reason-identity") {
      const reason = { sentinel: "unmodified" };
      const keys = new Proxy({}, { ownKeys() { throw reason; } });
      const descriptors = new Proxy({ value: 1 }, { getOwnPropertyDescriptor() { throw reason; } });
      exactThrow(() => data.snapshotOwnData(keys), reason); exactThrow(() => data.assertOwnData(descriptors, { value: 1 }), reason);
      await exactRejection(() => runObserver(model, keys), reason);
      result.scope = "two direct validation traps and whole observer rejection retain reference";
    } else if (scenario === "captured-falsy-reason-identity") {
      let messageReads = 0;
      const opaque = Object.defineProperty({}, "message", { get() { messageReads++; throw new Error("must not read"); } });
      const reasons = [undefined, null, false, 0, "", Symbol("reason"), opaque];
      for (const reason of reasons) {
        const port = new RepairModel(scenario), input = configFor(port);
        port.stat = () => { throw reason; };
        const report = await port.drive(runObserver(port, input));
        assert.equal(report.success, false); assert.ok(Object.hasOwn(report, "failureReason"));
        assert.ok(Object.is(report.failureReason, reason)); assert.ok(Object.is(report.failures[0].reason, reason));
        assert.equal(port.starts, 0); assert.equal(port.timers.size, 0); JSON.stringify(report); port.files.clear();
      }
      assert.equal(messageReads, 0); result.scope = "seven whole-observer captured reasons; identity checked before JSON";
    } else if (scenario === "config-toJSON-not-executed") {
      let calls = 0; config.toJSON = () => { calls++; return {}; };
      await assert.rejects(runObserver(model, config), /own-data/u); assert.equal(calls, 0); assert.equal(model.starts, 0);
      result.scope = "whole observer rejects function data without toJSON execution";
    } else {
      if (scenario === "module-mode-only") model.files.get("/controls/modules/lifecycle.mjs").mode = 0o777;
      if (scenario === "native-not-executable") model.files.get("/controls/bash").mode = 0o644;
      if (scenario === "runtime-not-executable") model.files.get("/controls/node").mode = 0o644;
      if (scenario === "mode-policy-omission") delete config.protectedModes;
      if (scenario === "second-row-mode-change") {
        config.rowIds = config.rows.slice(0, 2).map(row => row.id);
        const authorization = JSON.parse(model.read(config.authorizationPath)); authorization.rowIds = config.rowIds;
        model.files.get(config.authorizationPath).bytes = Buffer.from(JSON.stringify(authorization));
        config.authorizationSha256 = admission.digest(model.read(config.authorizationPath)); config.protected[config.authorizationPath] = config.authorizationSha256;
      }
      if (scenario === "prototype-distinct-own-data") {
        Object.setPrototypeOf(config, { ignoredInherited: true });
        const originalIdentity = model.runtimeIdentity.bind(model), originalList = model.list.bind(model);
        model.runtimeIdentity = () => Object.assign(Object.create(null), originalIdentity());
        model.list = directory => Object.setPrototypeOf(originalList(directory), Object.create(Array.prototype));
        data.assertOwnData(Object.assign(Object.create(null), { key: [1, 2] }), { key: [1, 2] });
      }
      const report = await model.drive(runObserver(model, config)); result.report = report;
      const positive = ["prototype-distinct-own-data", "just-before-final-admission-boundary"].includes(scenario);
      assert.equal(report.success, positive);
      if (["module-mode-only", "native-not-executable", "runtime-not-executable", "mode-policy-omission", "directory-mode-after-acquisition", "receipt-mode-after-write", "mode-change-during-attempt", "deadline-crossed-during-auth", "deadline-crossed-during-attempt", "row-admission-deadline-during-attempt", "deadline-crossed-final-admission"].includes(scenario)) assert.equal(model.starts, 0);
      if (["module-mode-only", "native-not-executable", "runtime-not-executable", "mode-policy-omission"].includes(scenario)) assert.equal(report.directories.length, 0);
      if (scenario === "directory-mode-after-acquisition") { assert.equal(report.directories[0].acquired, true); assert.ok(model.files.has("/owned")); }
      if (scenario === "receipt-mode-after-write") assert.ok(model.files.has("/owned/records/attempt-N01.json"));
      if (scenario === "final-directory-mode") assert.ok(model.files.has("/owned/records"));
      if (scenario === "final-receipt-mode") assert.ok(report.failures.some(failure => failure.phase === "post-persistence-storage"));
      if (scenario === "final-mode-only") assert.ok(report.failures.some(failure => failure.phase === "post-persistence-integrity"));
      if (scenario === "second-row-mode-change") { assert.equal(model.starts, 1); assert.equal(report.launched, 1); assert.deepEqual(report.remaining, ["N02"]); }
      if (["deadline-crossed-during-attempt", "row-admission-deadline-during-attempt", "deadline-crossed-final-admission"].includes(scenario)) {
        assert.equal(report.rows[0].attemptRegistered, true); assert.equal(report.rows[0].spawnCalled, false); assert.equal(report.rows[0].terminal, "admission-refused");
      }
      if (scenario === "just-before-final-admission-boundary") { assert.equal(report.rows[0].admittedAt, 149999); assert.equal(report.elapsed, 149999); assert.equal(report.launched, 1); }
      if (scenario === "deadline-crossed-during-start") { assert.equal(model.starts, 1); assert.equal(report.rows[0].submitted, true); assert.equal(report.launched, 1); assert.equal(report.actualCloseEvents, 1); }
      if (["close-without-spawn", "close-without-exit", "close-before-spawn"].includes(scenario)) {
        assert.equal(report.rows[0].terminal, "inconsistent-driver-completion"); assert.equal(report.cleanupUncertain, true); assert.equal(report.actualCloseEvents, 1);
        assert.equal(report.launched, scenario === "close-without-exit" ? 1 : 0);
      }
      if (scenario === "spawn-after-terminal") { assert.equal(report.rows[0].terminal, "terminal-cleanup-uncertain"); assert.equal(report.rows[0].elapsed, 3000); assert.equal(report.launched, 0); assert.equal(report.actualCloseEvents, 0); assert.equal(model.time, 3100); }
      if (positive) { assert.equal(report.launched, 1); assert.equal(report.actualCloseEvents, 1); }
    }
    assert.equal(model.timers.size, 0); result.pass = true;
  } catch (reason) { result.failure = { message: data.describeReason(reason) }; }
  result.model = { starts: model.starts, events: model.events, time: model.time, pendingTimers: model.timers.size, releases: model.releases, nativeHashChecks: model.nativeChecks, discardedEntries: model.files.size };
  model.files.clear(); results.push(result);
}
checkSeal();
const runtimePath = fs.realpathSync(process.execPath), runtimeHash = createHash("sha256");
for await (const bytes of fs.createReadStream(runtimePath, { highWaterMark: 65536 })) runtimeHash.update(bytes);
const report = { schema: "mapfile-observer-repair-results-v3", precodeSha256: admission.digest(fs.readFileSync(path.join(here, "REPAIR-v3.json"))), moduleSealSha256: admission.digest(sealBytes), executorSha256: admission.digest(fs.readFileSync(fileURLToPath(import.meta.url))), moduleHashes: Object.fromEntries(seal.moduleFiles.map(name => [name, admission.digest(fs.readFileSync(path.join(here, "modules", name)))])), parentRuntime: { path: runtimePath, version: process.version, sha256: runtimeHash.digest("hex"), mode: fs.statSync(runtimePath).mode & 0o7777 }, results, passed: results.filter(result => result.pass).length, total: results.length, actualChildren: 0, nativeCalls: 0, productImports: 0, engineImports: 0, realDriverInstantiations: 0, qualification: "Finite dependency-model repair checks; prototype variants, not a separately executed realm. No OS/native qualification." };
const bytes = Buffer.from(JSON.stringify(report)); assert.ok(bytes.length <= precode.unchangedLimits.syntheticReportBytes);
const capture = path.join(here, "captures", `repair-v3-${Date.now()}-${process.pid}.json.gz.base64`);
fs.writeFileSync(capture, gzipSync(bytes).toString("base64") + "\n", { flag: "wx" });
console.log(JSON.stringify({ capture, passed: report.passed, total: report.total, actualChildren: 0, nativeCalls: 0 }));
if (report.passed !== report.total) process.exitCode = 1;
