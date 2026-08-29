import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";

const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
export function publishOwnedCopy(source, destination, expected, ownedRoot, identityRoot) {
  assert.equal(path.normalize(destination), destination); assert.ok(destination.startsWith(ownedRoot + path.sep));
  assert.equal(path.normalize(ownedRoot), ownedRoot); assert.equal(path.normalize(identityRoot), identityRoot);
  assert.ok(path.isAbsolute(ownedRoot) && path.isAbsolute(identityRoot));
  assert.ok(identityRoot !== ownedRoot && !identityRoot.startsWith(ownedRoot + path.sep) && !ownedRoot.startsWith(identityRoot + path.sep), "payload and receipt namespaces must be disjoint");
  const before = fs.lstatSync(source); assert.ok(before.isFile() && !before.isSymbolicLink()); assert.equal(before.size, expected.bytes); assert.ok(before.size <= 16777216);
  const bytes = fs.readFileSync(source); assert.equal(bytes.length, expected.bytes); assert.equal(hash(bytes), expected.sha256);
  const after = fs.lstatSync(source); assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(after.size, before.size);
  const identity = { source: path.resolve(source), dev: before.dev, ino: before.ino, bytes: expected.bytes, sha256: expected.sha256 };
  fs.mkdirSync(identityRoot, { recursive: true, mode: 0o700 });
  const identityPath = path.join(identityRoot, hash(Buffer.from(destination)) + ".json");
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  let descriptor;
  try { descriptor = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if (Object.getOwnPropertyDescriptor(error, "code")?.value !== "EEXIST") throw error;
    const identityStat = fs.lstatSync(identityPath); assert.ok(identityStat.isFile() && !identityStat.isSymbolicLink() && identityStat.size <= 16384);
    assert.deepEqual(JSON.parse(fs.readFileSync(identityPath)), identity);
    const stat = fs.lstatSync(destination); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, expected.bytes);
    const existing = fs.readFileSync(destination); assert.equal(existing.length, expected.bytes); assert.equal(hash(existing), expected.sha256); assert.deepEqual(existing, bytes);
    const stable = fs.lstatSync(destination); assert.equal(stable.dev, stat.dev); assert.equal(stable.ino, stat.ino); assert.equal(stable.mtimeMs, stat.mtimeMs); assert.equal(stable.size, stat.size);
    return Object.freeze({ outcome: "verified-existing-copy", source, destination, bytes: bytes.length, sha256: expected.sha256 });
  }
  try { let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert.ok(Number.isSafeInteger(count) && count > 0 && count <= bytes.length - offset); offset += count; } }
  finally { fs.closeSync(descriptor); }
  assert.deepEqual(fs.readFileSync(destination), bytes);
  fs.writeFileSync(identityPath, JSON.stringify(identity) + "\n", { flag: "wx", mode: 0o600 });
  return Object.freeze({ outcome: "created-copy", source, destination, bytes: bytes.length, sha256: expected.sha256 });
}
