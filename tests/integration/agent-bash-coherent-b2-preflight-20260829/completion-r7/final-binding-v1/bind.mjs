import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const scope = path.dirname(directory);
const stage = path.join(scope, "staged");
const repo = "/Users/kjopek/Workspace/safe-bash";
const capture = "/private/tmp/safe-bash-b2-r7-final-binding";
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const observations = [];
assert.ok(fs.fstatSync(1).isFile() && fs.fstatSync(2).isFile());
function admitted(filename, maximum, expected) {
  const before = fs.lstatSync(filename);
  assert.ok(before.isFile() && !before.isSymbolicLink());
  assert.ok(before.size <= maximum && (before.mode & 0o022) === 0);
  if (expected) assert.equal(before.size, expected.bytes);
  const bytes = fs.readFileSync(filename);
  assert.equal(bytes.length, before.size);
  const after = fs.lstatSync(filename);
  assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino); assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
  const sha256 = digest(bytes);
  if (expected) assert.equal(sha256, expected.sha256);
  observations.push({ path: filename, bytes: bytes.length, sha256, mode: before.mode & 0o777 });
  return bytes;
}
function absent(filename) {
  let missing = false;
  try { fs.lstatSync(filename); } catch (error) { if (error.code !== "ENOENT") throw error; missing = true; }
  assert.equal(missing, true, `unused path required: ${filename}`);
}
function writeExclusive(filename, bytes) {
  const descriptor = fs.openSync(filename, "wx", 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) { const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert.ok(Number.isSafeInteger(count) && count > 0 && count <= bytes.length - offset); offset += count; }
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  assert.deepEqual(fs.readFileSync(filename), bytes);
}
try {
  assert.ok(Date.now() < Date.parse("2026-08-29T15:52:28.070Z"));
  const packetBytes = admitted(path.join(stage, "PACKET.json"), 65536, { bytes: 6519, sha256: "f97901065a7803f72edb92c19f219e66f35dc2f050917d10dd25cb411ba5f65a" });
  const packet = JSON.parse(packetBytes);
  for (const row of packet.files) admitted(path.join(stage, row.path), 1048576, row);
  assert.equal(packet.files.length, 31); assert.equal(packet.source, "3adc676a0ab638c9788ef007e465931d65d2c6fe");
  const reviewPath = repo + "/tests/integration/agent-bash-coherent-b2-independent-20260829/completion-r7-review/PUBLICATION.json";
  admitted(reviewPath, 65536, { bytes: 7167, sha256: "5f627990643cbb13943ee33be52f0bacb6e665d600d553326a01970f2f32a416" });
  admitted(packet.package.path, 1048576, packet.package);
  const recipe = JSON.parse(fs.readFileSync(path.join(stage, "metadata/RECIPE.json")));
  const frozen = JSON.parse(fs.readFileSync(path.join(stage, "metadata/FROZEN-BINDINGS.json")));
  assert.equal(frozen.selectedInputs.length, 309); assert.equal(frozen.actualEmitted.length, 1012); assert.equal(frozen.packageMembers.length, 1014);
  const toolsRoot = "/private/tmp/safe-bash-coherent-stage-a-20260829-r2/tools";
  for (const filename of [recipe.compiler, recipe.npm]) {
    const row = recipe.toolInventory.find(row => path.join(toolsRoot, row.path) === filename);
    assert.ok(row); admitted(filename, 16777216, row);
  }
  for (const member of ["shell/runtime.js", "shell/shell.js", "index.js"]) {
    const row = frozen.actualEmitted.find(row => row.path === member);
    assert.ok(row); admitted(row.observedPath, 4194304, row);
  }
  const node = "/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node";
  const stat = fs.lstatSync(node); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, 112989184);
  const hasher = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(node, { highWaterMark: 65536 })) hasher.update(chunk);
  const nodeSha256 = hasher.digest("hex"); assert.equal(nodeSha256, "5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011");
  observations.push({ path: node, bytes: stat.size, sha256: nodeSha256, mode: stat.mode & 0o777, streamed: true });
  const shellStat = fs.lstatSync("/bin/zsh"); assert.ok(shellStat.isFile() && !shellStat.isSymbolicLink()); assert.ok(shellStat.size <= 16777216);
  const shellHasher = crypto.createHash("sha256"); for await (const chunk of fs.createReadStream("/bin/zsh", { highWaterMark: 65536 })) shellHasher.update(chunk);
  observations.push({ path: "/bin/zsh", bytes: shellStat.size, sha256: shellHasher.digest("hex"), mode: shellStat.mode & 0o777, freshLocalLauncherObservation: true });
  const validator = fs.readFileSync(path.join(stage, "new/support.mjs"), "utf8");
  assert.ok(validator.includes("times.issuedAt <= times.notBefore") && validator.includes("times.deadline - times.notBefore, caps.seconds * 1000") && validator.includes("times.deadline - times.activeDeadline, caps.reserveSeconds * 1000"));
  const authority = JSON.parse(fs.readFileSync(path.join(scope, "PENDING-AUTHORITY.json")));
  assert.equal(authority.schema, "B2_RUNTIME_GO_R7"); assert.equal(authority.authority, "ROOT_B2_672_EXPLICIT_FRESH_GO"); assert.equal(authority.reviewAuthority, "INDEPENDENT_PREEXEC_REVIEW_ACCEPTED");
  assert.equal(authority.caps.seconds, 1800); assert.equal(authority.caps.reserveSeconds, 180); assert.equal(authority.caps.knownOsStarts, 64); assert.equal(authority.caps.loaderAdmissions, 34);
  const grantPath = "/private/tmp/B2-R7-ROOT-GO.json";
  for (const filename of [authority.workRoot, authority.workRoot + ".outer.raw", grantPath]) absent(filename);
  const issued = Date.now(); const notBefore = issued + 300000; const activeEnd = notBefore + 1620000; const expires = notBefore + 1800000;
  Object.assign(authority, { reviewCommit: "7ad82903e3269de5527c8308c755eb1b132bb58c", issuedAt: new Date(issued).toISOString(), notBefore: new Date(notBefore).toISOString(), activeDeadline: new Date(activeEnd).toISOString(), deadline: new Date(expires).toISOString() });
  const grantBytes = Buffer.from(JSON.stringify(authority) + "\n");
  writeExclusive(grantPath, grantBytes);
  writeExclusive(path.join(directory, "GRANT.json"), grantBytes);
  const receipt = { schema: "B2_R7_FINAL_BINDING_V1", grant: { path: grantPath, bytes: grantBytes.length, sha256: digest(grantBytes), mode: "0600" }, packet: { bytes: packetBytes.length, sha256: digest(packetBytes) }, reviewCommit: authority.reviewCommit, reviewReceiptSha256: "5f627990643cbb13943ee33be52f0bacb6e665d600d553326a01970f2f32a416", sourceCandidate: "5d60457781b73783eecdd61e34d33ec7916d891b", issuedAt: authority.issuedAt, notBefore: authority.notBefore, externalLatestStart: new Date(notBefore + 300000).toISOString(), activeDeadline: authority.activeDeadline, deadline: authority.deadline, command: `/bin/zsh ${stage}/new/launch.sh ${grantPath} 6519`, cwd: repo, login: false, rootActualGo: "STILL_REQUIRED_AFTER_DIFFERENT_FINAL_SLOT_REVIEW", loaderAuthority: "ROOT-approved fixed per-role file/hash admission and trusted Node builtin delegation; 34 functional async-loader admissions, not guest or Regex authority", caps: authority.caps, observations, guards: { runtimeRootAbsent: true, outerCaptureAbsent: true, noScheduler: true, noRuntime: true, noWorker: true, noProductImports: true, noRecensus: true, packageNotInflated: true }, qualification: "Fresh 31-file packet, compressed package, review receipt, Node/launcher and sparse consumed entrypoint checks; retained authenticated 309/1012/1014 manifests are not a fresh full source/tool census. Runtime itself retains its full admission checks. Native helper thread totals and OS-wide census unobserved. Initial trusted host shell startup outside cohort; login:false does not suppress all zsh startup files." };
  writeExclusive(path.join(directory, "RECEIPT.json"), Buffer.from(JSON.stringify(receipt, null, 2) + "\n"));
  console.log(JSON.stringify({ status: "BOUND_NOT_ACTIVATED", grant: receipt.grant, issuedAt: receipt.issuedAt, notBefore: receipt.notBefore, externalLatestStart: receipt.externalLatestStart, activeDeadline: receipt.activeDeadline, deadline: receipt.deadline, receiptSha256: digest(fs.readFileSync(path.join(directory, "RECEIPT.json"))) }));
} catch (error) {
  writeExclusive(path.join(capture, "STOP.json"), Buffer.from(JSON.stringify({ status: "STOP", errorPresent: true, error: String(error?.stack ?? error), noActivation: true }) + "\n"));
  throw error;
}
