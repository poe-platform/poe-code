import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const destination = path.dirname(fileURLToPath(import.meta.url));
const runtime = "/private/tmp/safe-bash-b2-runtime-r6";
const stage = path.join(path.dirname(destination), "staged");
const expiry = Date.parse("2026-08-29T15:45:12.109Z");
assert.ok(fs.fstatSync(1).isFile() && fs.fstatSync(2).isFile());
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const selected = ["PARTIAL-FAILURE.json", "children/events.jsonl", "children/00-retained-source-built-redirections-v3.stdout", "children/00-retained-source-built-redirections-v3.stderr", "traces/retained-source-built-redirections-v3.jsonl", "bindings/retained-source-built-redirections-v3.json"];
let retainedBytes = 0, entries = 0;
const inventory = [];
function read(filename, maximum) {
  assert.ok(Date.now() < expiry);
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum);
  const bytes = fs.readFileSync(filename); assert.equal(bytes.length, stat.size);
  return bytes;
}
function write(name, bytes) {
  retainedBytes += bytes.length; assert.ok(retainedBytes <= 4194304);
  const filename = path.join(destination, name);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(filename, "wx", 0o600);
  try { let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert.ok(count > 0); offset += count; } fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}
async function walk(directory, label) {
  for (const name of fs.readdirSync(directory).sort()) {
    assert.ok(++entries <= 16384); assert.ok(Date.now() < expiry);
    const filename = path.join(directory, name), relative = label + "/" + name;
    const before = fs.lstatSync(filename); assert.ok(!before.isSymbolicLink());
    if (before.isDirectory()) await walk(filename, relative);
    else {
      assert.ok(before.isFile() && before.size <= 33554432);
      const hash = crypto.createHash("sha256"); let bytes = 0;
      for await (const chunk of fs.createReadStream(filename, { highWaterMark: 65536 })) { bytes += chunk.length; assert.ok(bytes <= before.size); hash.update(chunk); }
      const after = fs.lstatSync(filename); assert.equal(after.ino, before.ino); assert.equal(after.dev, before.dev); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(bytes, before.size);
      inventory.push({ path: relative, bytes, sha256: hash.digest("hex") });
    }
  }
}
const copied = [];
for (const name of selected) {
  const bytes = read(path.join(runtime, name), 4194304);
  write("raw/" + name, bytes); copied.push({ path: "raw/" + name, bytes: bytes.length, sha256: sha(bytes) });
}
const outer = read(runtime + ".outer.raw", 2097152);
write("raw/runtime.outer.raw", outer); copied.push({ path: "raw/runtime.outer.raw", bytes: outer.length, sha256: sha(outer) });
const events = read(path.join(runtime, "children/events.jsonl"), 4194304).toString().trim().split("\n").map(JSON.parse);
const spawned = events.filter(row => row.spawned === true), exited = events.filter(row => row.event === "exit"), closed = events.filter(row => row.event === "close");
assert.equal(spawned.length, 1); assert.equal(exited.length, 1); assert.equal(closed.length, 1);
assert.equal(exited[0].pid, closed[0].pid); assert.equal(exited[0].status, 1); assert.equal(closed[0].status, 1); assert.equal(closed[0].signal, null);
assert.ok(events.some(row => row.exited === true && row.closed === true && row.unknown === false));
assert.equal(closed[0].stdoutBytes, 0); assert.equal(closed[0].stderrBytes, 1748); assert.equal(closed[0].storedStderr, 1748);
const partial = JSON.parse(read(path.join(runtime, "PARTIAL-FAILURE.json"), 4194304));
assert.deepEqual(partial.completed, []); assert.equal(partial.successSchema, false); assert.equal(partial.automaticRetry, false);
assert.equal(fs.existsSync(path.join(runtime, "RESULT.json")), false);
const packetBytes = read(path.join(stage, "PACKET.json"), 1048576);
assert.equal(sha(packetBytes), "a2a5a6a23f4c30bd490b3a1db29f0cdc6e4e57a4f179ba0368489af7652fb554");
const packet = JSON.parse(packetBytes);
for (const row of packet.files) { const bytes = read(path.join(stage, row.path), 2097152); assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256); }
const recipe = JSON.parse(read(path.join(stage, "metadata/RECIPE.json"), 2097152));
const roles = recipe.roles.map(row => ({ role: row.role, kind: row.kind, layout: row.layout, cases: row.ids?.length ?? 0, status: row.role === spawned[0].role ? "BOOTSTRAP_FAILED_BEFORE_FIRST_CASE" : "UNRUN" }));
assert.equal(roles.length, 41);
await walk(runtime, "runtime"); await walk(stage, "stage");
const logicalBytes = inventory.reduce((sum, row) => sum + row.bytes, 0) + outer.length + retainedBytes;
assert.ok(logicalBytes <= 536870912);
const trace = read(path.join(runtime, "traces/retained-source-built-redirections-v3.jsonl"), 524288).toString().trim().split("\n").map(JSON.parse);
assert.equal(trace.length, 1); assert.equal(trace[0].member, "harness/redirections.mjs");
const report = { schema: "B2_R6_ACTUAL_V2_STOP", status: "STOP_FIRST_CHILD_LOADER_FSYNC_PERMISSION_DENIAL", utc: new Date().toISOString(), runtimeCommandInvocations: 1,
  ownerSession: 7195, ownerToolExitCode: 78, supervisedChildren: 1, child: { role: spawned[0].role, pid: closed[0].pid, exitCode: 1, closeCode: 1, signal: null, unknownRetirement: false },
  retainedDeclared: 672, retainedExecuted: 0, retainedPassed: 0, retainedFailedAssertions: 0, typeProcessesExecuted: 0, negativeTypeDiagnosticIdentitiesObserved: 0,
  mutantsExecuted: 0, restoresExecuted: 0, bindingsExecuted: 0, offlineInstalls: 0, roles,
  exactFailure: { code: "ERR_ACCESS_DENIED", message: "fsync API is disabled when Permission Model is enabled.", permission: "", resource: "", path: "staged/new/loader.mjs", line: 17, productDefectDemonstrated: false },
  loader: { consumerAdmissions: 1, hookExecutionEvidence: "Node internal ESM worker stack and one trace record", trace, completedSourceSupplyNotProved: true, reason: "trace writes the record then throws at fsync before load returns source", individualLoaderExit: "UNOBSERVED", nativeThreadTotals: "UNOBSERVED", regexOrGuestEntries: 0 },
  capture: { childAttempted: partial.retirement.attemptedBytes, childStored: partial.retirement.storedBytes, stdout: 0, stderr: 1748, outer: outer.length },
  ownership: { knownChildExitCloseObserved: true, knownActiveChildren: 0, groupAbsenceClaim: false, arbitraryProviderQuiescenceClaim: false },
  timing: { anchoredElapsedMillisecondsAtFailure: partial.retirement.elapsedMs, qualifier: "Elapsed since fixed notBefore, not measured runtime wall duration; dispatch admission at15:18:01.141UTC was already late" },
  sourcePostguardMembers: packet.files.length, inventory, logicalBytesIncludingSelectedCopies: logicalBytes, copiedRaw: copied,
  earlierPhase: "ae4deaf7738595e19be6d70b809b369fc46280e9 preserved and separately counted; ROOT adjudicated before this new attempt", noRetry: true, runtimeCodeChanges: false, expectationChanges: false };
write("RESULT.json", Buffer.from(JSON.stringify(report, null, 2) + "\n"));
console.log(JSON.stringify({ status: report.status, roles: roles.length, supervisedChildren: 1, retainedExecuted: 0, childCapture: report.capture, logicalBytes, copiedRawBytes: copied.reduce((sum, row) => sum + row.bytes, 0), activeKnownChildren: 0 }));
