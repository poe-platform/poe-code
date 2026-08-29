import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const scope = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const sealBytes = fs.readFileSync(path.join(scope, "PRESEAL.json")); assert.equal(hash(sealBytes), process.argv[2]);
const seal = JSON.parse(sealBytes); assert.ok(Date.now() < Date.parse(seal.deadline));
for (const row of seal.files) { const stat = fs.lstatSync(path.join(scope, row.path)); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, row.bytes); assert.equal(hash(fs.readFileSync(path.join(scope, row.path))), row.sha256); }
const { sampleTree } = await import("./staged/new/cache-census.mjs");
const { publishOwnedCopy } = await import("./publication.mjs");
const root = "/private/tmp/safe-bash-b2-r8-controls"; fs.mkdirSync(root, { mode: 0o700 });
const result = { controls: [], children: [], productRuns: 0, workers: 0, started: new Date().toISOString() };
const directory = { isDirectory: () => true }; const file = size => ({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false, size });
const enoent = Object.assign(new Error("synthetic missing"), { code: "ENOENT" });
function model(target, operation, reason, size = 5) {
  return { lstatSync(filename) { if (filename === target && operation === "lstat") throw reason; return ["/r", "/r/cache", "/r/cache/d"].includes(filename) ? directory : file(size); }, readdirSync(filename) { if (filename === target && operation === "readdir") throw reason; return filename === "/r" ? ["cache", "immutable"] : filename === "/r/cache" ? ["d"] : ["file"]; } };
}
const options = io => ({ cacheRoot: "/r/cache", active: true, reservationBytes: 32, maximumBytes: 100, io });
function control(id, run) { run(); result.controls.push({ id, pass: true }); }
try {
  control("T01-cache-lstat-race", () => { const value = sampleTree(["/r"], options(model("/r/cache/d/file", "lstat", enoent))); assert.equal(value.snapshotRaceCount, 1); assert.equal(value.bytes, 37); });
  control("T02-cache-readdir-race", () => { const value = sampleTree(["/r"], options(model("/r/cache/d", "readdir", enoent))); assert.equal(value.snapshotRaceCount, 1); assert.equal(value.races[0].kind, "SNAPSHOT_RACE"); });
  control("T03-immutable-missing", () => assert.throws(() => sampleTree(["/r"], options(model("/r/immutable", "lstat", enoent))), error => error === enoent));
  control("T04-other-falsy-errors", () => { for (const reason of [Object.assign(new Error("denied"), { code: "EACCES" }), false, undefined]) { let caught = false; try { sampleTree(["/r"], options(model("/r/cache/d/file", "lstat", reason))); } catch (error) { caught = true; assert.equal(error, reason); } assert.equal(caught, true); } });
  control("T05-quiescent-strict", () => assert.throws(() => sampleTree(["/r"], { ...options(model("/r/cache/d/file", "lstat", enoent)), active: false }), error => error === enoent));
  control("T06-reservation-and-aggregate", () => { assert.throws(() => sampleTree(["/r"], { ...options(model("none", "none", null, 33)) })); assert.throws(() => sampleTree(["/r"], { ...options(model("none", "none", null)), maximumBytes: 36 })); });
  control("T07-cache-anchor-missing", () => assert.throws(() => sampleTree(["/r"], options(model("/r/cache", "lstat", enoent))), error => error === enoent));
  control("T08-publication-identities", () => {
    const source = path.join(root, "source"); const other = path.join(root, "other"); const target = path.join(root, "published/copy"); const bytes = Buffer.from("identity\n"); fs.writeFileSync(source, bytes, { flag: "wx" }); fs.writeFileSync(other, bytes, { flag: "wx" });
    const expected = { bytes: bytes.length, sha256: hash(bytes) };
    assert.equal(publishOwnedCopy(source, target, expected, root).outcome, "created-copy"); assert.equal(publishOwnedCopy(source, target, expected, root).outcome, "verified-existing-copy");
    assert.throws(() => publishOwnedCopy(other, target, expected, root));
    fs.writeFileSync(source, "different\n"); const changed = fs.readFileSync(source); assert.throws(() => publishOwnedCopy(source, target, { bytes: changed.length, sha256: hash(changed) }, root)); assert.deepEqual(fs.readFileSync(target), bytes);
  });
  for (const id of ["H01", "H02"]) {
    const home = path.join(root, id); fs.mkdirSync(home); const cache = path.join(home, "cache"); fs.mkdirSync(cache); fs.writeFileSync(path.join(home, "immutable"), "unchanged\n");
    const stdout = fs.openSync(path.join(home, "stdout.raw"), "wx"); const stderr = fs.openSync(path.join(home, "stderr.raw"), "wx");
    const record = { id, samples: 0, snapshotRaces: 0, exited: false, closed: false, signals: [], started: new Date().toISOString() }; result.children.push(record);
    const child = spawn(process.execPath, [path.join(scope, "churn.mjs"), cache], { cwd: home, env: { PATH: path.dirname(process.execPath), HOME: home, NODE_OPTIONS: "", NODE_PATH: "" }, stdio: ["ignore", stdout, stderr] }); record.pid = child.pid;
    const timer = setTimeout(() => { record.signals.push("SIGKILL"); child.kill("SIGKILL"); }, 10000);
    let sampleFailure; let sampleFailurePresent = false;
    const sampling = setInterval(() => { try { const value = sampleTree([home], { cacheRoot: cache, active: true, reservationBytes: 1048576, maximumBytes: 2097152 }); record.samples++; record.snapshotRaces += value.snapshotRaceCount; } catch (error) { if (!sampleFailurePresent) { sampleFailurePresent = true; sampleFailure = error; record.signals.push("SIGTERM"); child.kill("SIGTERM"); } } }, 1);
    await new Promise(resolve => { child.on("error", error => { record.error = String(error); }); child.on("exit", (code, signal) => { record.exited = true; record.exitCode = code; record.exitSignal = signal; }); child.on("close", (code, signal) => { record.closed = true; record.closeCode = code; record.closeSignal = signal; clearTimeout(timer); clearInterval(sampling); resolve(); }); });
    fs.closeSync(stdout); fs.closeSync(stderr); record.closedAt = new Date().toISOString();
    if (sampleFailurePresent) throw sampleFailure;
    assert.equal(record.exited, true); assert.equal(record.closed, true); assert.equal(record.exitCode, 0); assert.equal(record.closeCode, 0); assert.equal(record.signals.length, 0);
    assert.equal(fs.readFileSync(path.join(home, "stdout.raw"), "utf8"), "CHURN256\n"); assert.equal(fs.statSync(path.join(home, "stderr.raw")).size, 0); assert.equal(fs.readFileSync(path.join(home, "immutable"), "utf8"), "unchanged\n");
    record.reconciliation = sampleTree([home], { cacheRoot: cache }); assert.equal(record.reconciliation.snapshotRaceCount, 0); assert.equal(record.reconciliation.observedCacheBytes, 0); assert.equal(record.reconciliation.reservedCacheBytes, 0);
  }
  result.status = "PASS";
} catch (error) { result.status = "STOP"; result.errorPresent = true; result.error = String(error?.stack ?? error); process.exitCode = 1; }
result.ended = new Date().toISOString(); fs.writeFileSync(path.join(root, "RESULT.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ status: result.status, controls: result.controls.length, children: result.children.length, observedRaces: result.children.map(row => row.snapshotRaces) }));
