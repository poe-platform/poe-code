import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const scope = path.dirname(directory);
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
assert.ok(fs.fstatSync(1).isFile() && fs.fstatSync(2).isFile());
const sealBytes = fs.readFileSync(path.join(directory, "PRESEAL.json"));
assert.equal(hash(sealBytes), process.argv[2]);
const seal = JSON.parse(sealBytes); assert.ok(Date.now() < Date.parse(seal.deadline));
for (const row of seal.files) {
  const filename = path.join(scope, row.path); const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, row.bytes);
  assert.equal(hash(fs.readFileSync(filename)), row.sha256);
}
const { publishOwnedCopy } = await import("../publication-v2.mjs");
const root = "/private/tmp/safe-bash-b2-r8-publication-v2";
fs.mkdirSync(root, { mode: 0o700 });
const sources = path.join(root, "sources"); const payload = path.join(root, "payload"); const identities = path.join(root, "identities");
fs.mkdirSync(sources); const bindings = [];
for (const fixture of seal.fixtures) {
  const filename = path.join(sources, fixture.name); const bytes = Buffer.from(fixture.text);
  fs.writeFileSync(filename, bytes, { flag: "wx", mode: 0o600 });
  const stat = fs.lstatSync(filename);
  bindings.push({ name: fixture.name, filename, bytes: bytes.length, sha256: hash(bytes), dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs });
}
const result = { groups: [], publicationReceipts: [], sourcePostchecks: [], started: new Date().toISOString(), product: 0, workers: 0, npm: 0, compiler: 0, childSpawns: 0 };
const publish = (binding, destination, identityRoot = identities) => publishOwnedCopy(binding.filename, destination, { bytes: binding.bytes, sha256: binding.sha256 }, payload, identityRoot);
function inventory(root, relative = "") {
  const rows = [];
  if (!fs.existsSync(root)) return rows;
  for (const name of fs.readdirSync(root).sort()) {
    const filename = path.join(root, name); const member = relative ? relative + "/" + name : name; const stat = fs.lstatSync(filename);
    assert.ok(!stat.isSymbolicLink());
    if (stat.isDirectory()) rows.push(...inventory(filename, member));
    else { assert.ok(stat.isFile() && stat.size <= 65536); const bytes = fs.readFileSync(filename); rows.push({ path: member, bytes: bytes.length, sha256: hash(bytes) }); }
  }
  return rows;
}
try {
  for (const binding of bindings.slice(0, 2)) {
    const destination = path.join(payload, binding.name);
    const first = publish(binding, destination); assert.equal(first.outcome, "created-copy"); result.publicationReceipts.push(first);
    const repeated = publish(binding, destination); assert.equal(repeated.outcome, "verified-existing-copy"); result.publicationReceipts.push(repeated);
    assert.equal(hash(fs.readFileSync(destination)), binding.sha256);
  }
  assert.deepEqual(fs.readdirSync(payload).sort(), ["copy", "copy.source.json"]);
  assert.equal(fs.readdirSync(identities).length, 2);
  result.groups.push({ id: "V2-01-legitimate-sidecar-name", pass: true, distinctPayloads: 2, verifiedExistingCopies: 2 });

  const target = path.join(payload, "copy"); const beforePayload = inventory(payload); const beforeIdentities = inventory(identities);
  assert.throws(() => publish(bindings[2], target));
  assert.throws(() => publish(bindings[3], target));
  assert.deepEqual(inventory(payload), beforePayload); assert.deepEqual(inventory(identities), beforeIdentities);
  for (const invalid of [payload, path.join(payload, "reserved"), root]) {
    assert.throws(() => publish(bindings[0], path.join(payload, "must-not-exist"), invalid));
    assert.equal(fs.existsSync(path.join(payload, "must-not-exist")), false);
  }
  assert.throws(() => publish(bindings[0], path.join(identities, "reserved-payload")));
  assert.deepEqual(inventory(payload), beforePayload); assert.deepEqual(inventory(identities), beforeIdentities);
  const tamperTarget = path.join(payload, "tamper-control"); result.publicationReceipts.push(publish(bindings[0], tamperTarget));
  const wrong = Buffer.from("wrong bytes\n"); fs.writeFileSync(tamperTarget, wrong);
  assert.throws(() => publish(bindings[0], tamperTarget)); assert.deepEqual(fs.readFileSync(tamperTarget), wrong);
  result.groups.push({ id: "V2-02-conflicts-and-reserved-namespace", pass: true, differentBytesRefused: true, differentSourceSameBytesRefused: true, overlappingRootsRefused: 3, reservedNamespaceRefused: true, tamperedDestinationNotOverwritten: true });

  for (const binding of bindings) {
    const stat = fs.lstatSync(binding.filename); const bytes = fs.readFileSync(binding.filename);
    assert.equal(stat.dev, binding.dev); assert.equal(stat.ino, binding.ino); assert.equal(stat.size, binding.bytes); assert.equal(stat.mtimeMs, binding.mtimeMs); assert.equal(hash(bytes), binding.sha256);
    result.sourcePostchecks.push({ ...binding, unchanged: true });
  }
  for (const row of seal.files) assert.equal(hash(fs.readFileSync(path.join(scope, row.path))), row.sha256);
  result.logicalSnapshot = inventory(root);
  result.logicalBytes = result.logicalSnapshot.reduce((sum, row) => sum + row.bytes, 0); assert.ok(result.logicalBytes <= 1048576);
  result.status = "PASS";
} catch (error) {
  result.status = "STOP"; result.primaryPresent = true; result.primary = String(error?.stack ?? error); process.exitCode = 1;
} finally {
  result.ended = new Date().toISOString();
  fs.writeFileSync(path.join(root, "RESULT.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ status: result.status, groups: result.groups.length, sourcePostchecks: result.sourcePostchecks.length, logicalBytes: result.logicalBytes }));
}
