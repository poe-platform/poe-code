import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";

export function createTrace(filename, io = fs) {
  let total = 0;
  let identity;
  let failed = false;
  return value => {
    assert.ok(!failed, "failed trace cannot be reused");
    const bytes = Buffer.from(JSON.stringify(value) + "\n");
    assert.ok(total + bytes.length <= 524288);
    let descriptor;
    let owned = false;
    let primaryPresent = false;
    let primary;
    try {
      descriptor = io.openSync(filename, identity ? fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW : fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      owned = true;
      const opened = io.fstatSync(descriptor);
      assert.ok(opened.isFile());
      assert.equal(opened.size, total);
      if (identity) { assert.equal(opened.dev, identity.dev); assert.equal(opened.ino, identity.ino); }
      else identity = { dev: opened.dev, ino: opened.ino };
      let offset = 0;
      while (offset < bytes.length) {
        const count = io.writeSync(descriptor, bytes, offset, bytes.length - offset);
        assert.ok(Number.isSafeInteger(count) && count > 0 && count <= bytes.length - offset, "trace write must make valid progress");
        offset += count;
      }
      assert.equal(io.fstatSync(descriptor).size, total + bytes.length);
    } catch (error) { primaryPresent = true; primary = error; }
    if (owned) {
      try { io.closeSync(descriptor); }
      catch (error) { if (!primaryPresent) { primaryPresent = true; primary = error; } }
    }
    if (primaryPresent) { failed = true; throw primary; }
    total += bytes.length;
  };
}

export function verifyRetiredTrace(filename, result) {
  assert.equal(result.exited, true); assert.equal(result.closed, true);
  const before = fs.lstatSync(filename);
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 524288);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let bytes;
  try {
    const opened = fs.fstatSync(descriptor);
    assert.equal(opened.dev, before.dev); assert.equal(opened.ino, before.ino); assert.equal(opened.size, before.size);
    bytes = Buffer.alloc(opened.size); let offset = 0;
    while (offset < bytes.length) { const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset); assert.ok(count > 0); offset += count; }
    const after = fs.fstatSync(descriptor);
    assert.equal(after.size, opened.size); assert.equal(after.mtimeMs, opened.mtimeMs);
  } finally { fs.closeSync(descriptor); }
  assert.ok(bytes.length > 0 && bytes.at(-1) === 10, "complete JSONL trace required");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const records = text.slice(0, -1).split("\n").map(line => JSON.parse(line));
  return { bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), records, afterExitAndClose: true, crashDurability: false };
}
