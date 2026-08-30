import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const base = path.dirname(root);
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function read(filename, expected, maximum = 2097152) {
  const before = fs.lstatSync(filename);
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= maximum);
  if (expected) assert.equal(before.size, expected.bytes);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor);
    assert.equal(opened.ino, before.ino); assert.equal(opened.dev, before.dev);
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) { const count = fs.readSync(descriptor, bytes, offset, Math.min(65536, bytes.length - offset), offset); assert.ok(count > 0); offset += count; }
    const after = fs.fstatSync(descriptor);
    assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
    if (expected) assert.equal(sha(bytes), expected.sha256);
    return bytes;
  } finally { fs.closeSync(descriptor); }
}
async function streamed(filename, expected) {
  const before = fs.lstatSync(filename);
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 134217728);
  if (expected) assert.equal(before.size, expected.bytes);
  const hash = crypto.createHash("sha256"); let count = 0;
  for await (const bytes of fs.createReadStream(filename, { highWaterMark: 65536 })) { count += bytes.length; assert.ok(count <= before.size); hash.update(bytes); }
  const after = fs.lstatSync(filename);
  assert.equal(after.ino, before.ino); assert.equal(after.dev, before.dev); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(count, before.size);
  const row = { path: filename, bytes: count, sha256: hash.digest("hex") };
  if (expected) assert.equal(row.sha256, expected.sha256);
  return row;
}
function absent(filename) {
  try { fs.lstatSync(filename); } catch (error) { if (error.code === "ENOENT") return { path: filename, absent: true }; throw error; }
  throw new Error(`exclusive path already exists: ${filename}`);
}
function write(filename, bytes) {
  const descriptor = fs.openSync(filename, "wx", 0o600);
  try { let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert.ok(count > 0); offset += count; } fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}
const preseal = JSON.parse(read(path.join(root, "PRESEAL.json")));
assert.ok(Date.now() < Date.parse(preseal.preparationDeadline));
for (const row of preseal.inputs) read(path.join(root, row.path), row);
const template = JSON.parse(read(path.join(root, "review-PENDING-AUTHORITY.json")));
const packetBytes = read(path.join(base, "staged/PACKET.json"), { bytes: 6222, sha256: "a2a5a6a23f4c30bd490b3a1db29f0cdc6e4e57a4f179ba0368489af7652fb554" });
const packet = JSON.parse(packetBytes);
const bindings = [];
for (const row of packet.files) {
  const filename = path.join(base, "staged", row.path);
  read(filename, row); bindings.push({ ...row, absolute: filename });
}
const { caps, grant } = await import(pathToFileURL(path.join(base, "staged/new/support.mjs")).href);
assert.deepEqual(template.requiredRootGrant.caps, caps);
const consumed = JSON.parse(read(path.join(base, "SOURCE-QUALIFICATION.json"))).consumed;
for (const row of consumed) read(row.filename, row);
const recipe = JSON.parse(read(path.join(base, "staged/metadata/RECIPE.json")));
const toolsRoot = "/private/tmp/safe-bash-coherent-stage-a-20260829-r2/tools";
const tools = [await streamed(preseal.node.path, preseal.node), await streamed("/bin/zsh")];
for (const filename of [recipe.compiler, recipe.npm]) {
  const relative = path.relative(toolsRoot, filename);
  assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative));
  const row = recipe.toolInventory.find(item => item.path === relative);
  assert.ok(row); tools.push(await streamed(filename, row));
}
const workRoot = template.requiredRootGrant.workRoot;
const unused = [absent(workRoot), absent(workRoot + ".outer.raw"), absent(template.rootGrantPath)];
const issued = Date.now(), anchor = issued + 1200000;
const document = { ...template.requiredRootGrant,
  reviewCommit: "bab8cae4da9bdb780ad26c4123451df2549cc1c6",
  issuedAt: new Date(issued).toISOString(), notBefore: new Date(anchor).toISOString(),
  activeDeadline: new Date(anchor + 1620000).toISOString(), deadline: new Date(anchor + 1800000).toISOString()
};
assert.deepEqual(Object.keys(document), Object.keys(template.requiredRootGrant));
grant(document, anchor);
assert.throws(() => grant(document, anchor - 1));
assert.throws(() => grant(document, anchor + 1620000));
const bytes = Buffer.from(JSON.stringify(document, null, 2) + "\n");
write(path.join(root, "B2-R6-ROOT-GO.json"), bytes);
write(template.rootGrantPath, bytes);
assert.equal(fs.statSync(template.rootGrantPath).mode & 0o777, 0o600);
const result = { schema: "B2_R6_FINAL_BINDING_V1", status: "BOUND_PENDING_DIFFERENT_REVIEW_AND_ROOT_ACTUAL_GO",
  reviewCommit: document.reviewCommit, reviewReceiptSha256: "7d4e01900cd8630d2331a237283c7e6e43bfad5e00080d8099f3cbddca67a897",
  grant: { path: template.rootGrantPath, bytes: bytes.length, sha256: sha(bytes), mode: "0600" },
  packet: { bytes: packetBytes.length, sha256: sha(packetBytes), files: packet.files.length },
  window: { issuedAt: document.issuedAt, notBefore: document.notBefore, latestStartRetainingFull1800Seconds: document.notBefore, activeDeadline: document.activeDeadline, deadline: document.deadline,
    qualification: "Scheduled anchor twenty minutes after issuance; not a twenty-minute anytime-launch grace. Earlier launches reject. Later launches consume the same anchored inclusive budget. No renewal or new schema keys." },
  command: template.command, authenticatedFiles: bindings, consumedPins: consumed, tools, unusedAtBinding: unused,
  loaderAuthority: "ROOT approved fixed per-role file/hash admission and trusted Node builtins only within frozen functional profile; not arbitrary guest side effects or host containment",
  actualCalls: 0, compiler: 0, install: 0, Workers: 0, nativeHelperThreads: "UNOBSERVED",
  requiresBeforeActual: ["different final-binding review", "fresh ROOT actual GO", "UTC admission and full-window policy", "exclusive work/capture recheck", "runtime consumed-input reauthentication", "fresh 64-known-role administration ledger"],
  noPriorAdministrationCountsBorrowed: true
};
write(path.join(root, "BINDING.json"), Buffer.from(JSON.stringify(result, null, 2) + "\n"));
console.log(JSON.stringify({ status: result.status, grant: result.grant, window: result.window, authenticatedFiles: bindings.length, freshConsumedPins: consumed.length, freshTools: tools.length }));
