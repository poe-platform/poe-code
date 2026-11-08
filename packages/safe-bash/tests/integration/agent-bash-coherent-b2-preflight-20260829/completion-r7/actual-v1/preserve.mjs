import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const stage = path.join(path.dirname(directory), "staged");
const runtime = "/private/tmp/safe-bash-b2-runtime-r7";
const admin = "/private/tmp/safe-bash-b2-r7-actual-publication";
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
assert.ok(fs.fstatSync(1).isFile() && fs.fstatSync(2).isFile());
assert.ok(Date.now() < Date.parse("2026-08-29T16:22:01.060Z"));
function read(filename, maximum = 1048576) {
  const before = fs.lstatSync(filename); assert.ok(before.isFile() && !before.isSymbolicLink()); assert.ok(before.size <= maximum);
  const bytes = fs.readFileSync(filename); assert.equal(bytes.length, before.size);
  const after = fs.lstatSync(filename); assert.equal(after.ino, before.ino); assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
  return bytes;
}
function jsonl(bytes) { assert.ok(bytes.length > 0 && bytes.at(-1) === 10); return new TextDecoder("utf-8", { fatal: true }).decode(bytes).slice(0, -1).split("\n").map(line => JSON.parse(line)); }
const packetBytes = read(path.join(stage, "PACKET.json"));
assert.equal(packetBytes.length, 6519); assert.equal(hash(packetBytes), "f97901065a7803f72edb92c19f219e66f35dc2f050917d10dd25cb411ba5f65a");
const packet = JSON.parse(packetBytes);
for (const row of packet.files) { const bytes = read(path.join(stage, row.path)); assert.equal(bytes.length, row.bytes); assert.equal(hash(bytes), row.sha256); }
const recipe = JSON.parse(read(path.join(stage, "metadata/RECIPE.json")));
const frozen = JSON.parse(read(path.join(stage, "metadata/FROZEN-BINDINGS.json")));
const partial = JSON.parse(read(path.join(runtime, "PARTIAL-FAILURE.json")));
const events = jsonl(read(path.join(runtime, "children/events.jsonl")));
const starts = events.filter(row => row.spawned === true);
assert.equal(starts.length, 9); assert.equal(partial.retirement.children, 9);
const roles = [];
for (const start of starts) {
  const exits = events.filter(row => row.role === start.role && row.event === "exit");
  const closes = events.filter(row => row.role === start.role && row.event === "close");
  const ownership = events.filter(row => row.role === start.role && Object.hasOwn(row, "unknown"));
  assert.equal(exits.length, 1); assert.equal(closes.length, 1); assert.equal(ownership.length, 1);
  assert.equal(ownership[0].unknown, false); assert.equal(ownership[0].exited, true); assert.equal(ownership[0].closed, true);
  assert.equal(exits[0].pid, start.pid); assert.equal(closes[0].pid, start.pid);
  assert.equal(closes[0].stdoutBytes, closes[0].storedStdout); assert.equal(closes[0].stderrBytes, closes[0].storedStderr);
  roles.push({ role: start.role, pid: start.pid, exit: exits[0], close: closes[0], signals: events.filter(row => row.role === start.role && row.signal && !row.event).map(row => row.signal), ownership: ownership[0], loaderAdmission: start.args.includes("--loader") });
}
assert.equal(roles.at(-1).role, "offline-install"); assert.equal(roles.at(-1).exit.signal, "SIGTERM"); assert.equal(roles.at(-1).close.signal, "SIGTERM");
assert.deepEqual(roles.at(-1).signals, ["SIGTERM"]);
assert.equal(partial.retirement.attemptedBytes, 105843); assert.equal(partial.retirement.storedBytes, 105843);
assert.equal(partial.secondaryPresent, undefined); assert.equal(partial.retirement.secondaryPresent, false);
const cases = []; let created = 0; let disposed = 0; const traces = [];
for (let index = 0; index < 6; index++) {
  const definition = recipe.roles[index]; const role = roles[index];
  assert.equal(definition.role, role.role); assert.equal(role.exit.status, 0); assert.equal(role.close.status, 0);
  const prefix = `${String(index).padStart(2, "0")}-${role.role}`;
  const rows = jsonl(read(path.join(runtime, "children", prefix + ".stdout")));
  const records = rows.slice(0, -1); const summary = rows.at(-1).summary;
  assert.deepEqual(records.map(row => row.id), definition.ids); assert.equal(summary.cases, definition.ids.length); assert.equal(summary.pass, definition.ids.length);
  for (const row of records) {
    assert.equal(row.pass, true); assert.ok(!Object.hasOwn(row, "cleanupError"));
    if (Object.hasOwn(row, "cleanupFailure")) assert.equal(row.cleanupFailure, false);
    if (Object.hasOwn(row, "created")) { assert.equal(row.created, row.disposed); created += row.created; disposed += row.disposed; }
    else { assert.equal(row.disposed, true); created++; disposed++; }
  }
  const traceBytes = read(path.join(runtime, "traces", role.role + ".jsonl"));
  const trace = jsonl(traceBytes);
  const verified = JSON.parse(read(path.join(runtime, "traces", role.role + ".jsonl.verified.json")));
  assert.equal(verified.sha256, hash(traceBytes)); assert.equal(verified.bytes, traceBytes.length); assert.deepEqual(verified.records, trace); assert.equal(verified.afterExitAndClose, true);
  const binding = JSON.parse(read(path.join(runtime, "bindings", role.role + ".json")));
  for (const row of trace) { assert.equal(row.kind, "authenticated-source-prepared"); const member = binding.members.find(member => member.path === row.member); assert.ok(member); assert.equal(member.sha256, row.sha256); }
  cases.push({ role: role.role, count: records.length, ids: definition.ids, summary });
  traces.push({ role: role.role, bytes: traceBytes.length, sha256: hash(traceBytes), preparedRecords: trace.length, actualCaseOutputsSeparateFromTrace: true });
}
assert.equal(cases.reduce((sum, row) => sum + row.count, 0), 224);
const types = [];
for (const [index, negative] of [[6, false], [7, true]]) {
  const role = roles[index]; assert.equal(role.exit.status, negative ? 2 : 0); assert.equal(role.close.status, negative ? 2 : 0);
  const filename = path.join(runtime, "children", `${String(index).padStart(2, "0")}-${role.role}.stdout`);
  const text = read(filename).toString(); const diagnostics = [];
  for (const line of text.split("\n")) {
    if (!/error TS\d+:/.test(line)) continue;
    const match = /^(.*)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line); assert.ok(match);
    assert.equal(path.resolve(runtime, "source-built", match[1]), path.join(runtime, "source-built/__consumer", `consumer-${negative ? "negative" : "positive"}.mts`));
    diagnostics.push({ line: Number(match[2]), column: Number(match[3]), code: Number(match[4]), message: match[5] });
  }
  assert.deepEqual(diagnostics, negative ? recipe.expectedDiagnostics : []); types.push({ role: role.role, exitStatus: role.exit.status, diagnostics });
}
const productRoot = path.join(runtime, "source-built/node_modules/virtual-bash");
const productRows = [];
function productVisit(directory, prefix = "") {
  for (const name of fs.readdirSync(directory).sort()) {
    const filename = path.join(directory, name); const member = prefix ? prefix + "/" + name : name; const stat = fs.lstatSync(filename);
    if (stat.isDirectory()) productVisit(filename, member);
    else { assert.ok(stat.isFile() && !stat.isSymbolicLink()); const bytes = read(filename, 4194304); productRows.push({ path: member, bytes: bytes.length, sha256: hash(bytes), mode: stat.mode & 0o777 }); }
  }
}
productVisit(productRoot);
const compare = (left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
assert.deepEqual(productRows.sort(compare), [...frozen.packageMembers].sort(compare));
const manifest = []; let copied = 0;
function preserve(from, relative) {
  const bytes = read(from); copied += bytes.length; assert.ok(copied <= 16777216);
  const target = path.join(directory, "raw", relative); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
  manifest.push({ path: "raw/" + relative, source: from, bytes: bytes.length, sha256: hash(bytes) });
}
preserve(runtime + ".outer.raw", "outer.raw"); preserve(path.join(runtime, "PARTIAL-FAILURE.json"), "PARTIAL-FAILURE.json");
for (const name of ["children", "traces", "bindings"]) for (const filename of fs.readdirSync(path.join(runtime, name)).sort()) preserve(path.join(runtime, name, filename), name + "/" + filename);
for (const filename of fs.readdirSync(admin).sort()) if (!filename.startsWith("preserve.")) preserve(path.join(admin, filename), "administration/" + filename);
const cacheLogs = path.join(runtime, "cache/_logs");
if (fs.existsSync(cacheLogs)) for (const filename of fs.readdirSync(cacheLogs).sort()) preserve(path.join(cacheLogs, filename), "cache-logs/" + filename);
let logicalBytes = 0; let entries = 0;
function census(directory) {
  for (const name of fs.readdirSync(directory)) {
    const filename = path.join(directory, name); const stat = fs.lstatSync(filename); assert.ok(++entries <= 16384);
    if (stat.isDirectory()) census(filename); else { assert.ok(stat.isFile() || stat.isSymbolicLink()); logicalBytes += stat.size; assert.ok(logicalBytes <= 536870912); }
  }
}
for (const directory of [runtime, stage, path.dirname(fileURLToPath(import.meta.url)), admin]) census(directory);
const result = { schema: "B2_R7_STOP_AUDIT_NOT_RUNTIME_SUCCESS", status: "STOP", originalAttemptExitCode: 78, originalGrantConsumed: true, noRetry: true, primary: partial.primary, primaryRecordQualification: "Original object text/stack retained; runtime secondary object summaries remain abbreviated, not reconstructed raw identity", completed: partial.completed, cases, retainedPassed: 224, retainedUnrun: 448, types, typeRolesPassed: 2, typeRolesUnrun: 4, expectedDiagnosticsMatched: 8, expectedDiagnosticsUnrun: 16, mutantRuns: 0, restoreRuns: 0, bindingRuns: 0, offlineInstall: "Interrupted by owner after work-census ENOENT, not successful install", roles, attemptedAndStoredChildBytes: 105843, outerBytes: fs.statSync(runtime + ".outer.raw").size, traces, created, disposed, loaderAdmissions: roles.filter(row => row.loaderAdmission).length, loaderIndividualExits: "UNOBSERVED", regexWorkers: "No direct construction observed; inherited static-closure expectation zero, not new instrumentation", guestEngines: 0, helperThreadCensus: "UNOBSERVED", packagePostguard: { members: productRows.length, bytesHashesModesAndExtraPathsChecked: true }, packetPostguard: 31, rawCopiedBytes: copied, storageSnapshot: { logicalBytes, entries, duplicateRawCopiesIncluded: true, gitPhysicalStorageExcluded: true }, snapshotUtc: new Date().toISOString(), anchorElapsedMsNotWallRuntime: partial.retirement.elapsedMs, remainingClaims: "No installed/moved/coherent acceptance; historical r6 0/672 unchanged" };
fs.writeFileSync(path.join(directory, "RAW-MANIFEST.json"), JSON.stringify({ files: manifest, copiedBytes: copied }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
fs.writeFileSync(path.join(directory, "RESULT.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ status: result.status, retainedPassed: 224, retainedUnrun: 448, typeRolesPassed: 2, diagnosticsMatched: 8, childrenRetired: roles.length, loaderAdmissions: result.loaderAdmissions, rawCopiedBytes: copied, logicalBytes, resultSha256: hash(fs.readFileSync(path.join(directory, "RESULT.json"))) }));
