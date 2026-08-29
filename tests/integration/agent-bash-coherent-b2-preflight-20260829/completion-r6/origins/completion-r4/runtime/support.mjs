import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";

export const caps = Object.freeze({ seconds: 1800, reserveSeconds: 180, knownOsStarts: 43, peakOs: 2, rawBytes: 100663296, childRawBytes: 67108864, workBytes: 536870912, terminalReserveBytes: 4194304, traceBytesPerRole: 524288, loaderAdmissions: 34, regexWorkers: 0, regexLoaderAdmissions: 0, guestEngines: 0, loaderThreads: 34, peakLoaderThreads: 1, decoderBytes: 67108864, maximumInventoryEntries: 16384 });
export const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
export function canonical(filename) { assert.equal(typeof filename, "string"); assert.ok(filename.startsWith("/private/tmp/") && !filename.includes("\0")); assert.equal(path.normalize(filename), filename); return filename; }
export function admit(filename, expected, maximum = 33554432) {
  assert.ok(expected && Number.isSafeInteger(expected.bytes) && expected.bytes >= 0 && expected.bytes <= maximum);
  assert.match(expected.sha256, /^[a-f0-9]{64}$/);
  const before = fs.lstatSync(filename);
  assert.ok(before.isFile() && !before.isSymbolicLink()); assert.equal(before.size, expected.bytes);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor); assert.equal(opened.ino, before.ino); assert.equal(opened.dev, before.dev);
    const bytes = Buffer.alloc(expected.bytes); let offset = 0;
    while (offset < bytes.length) { const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset); assert.ok(count > 0); offset += count; }
    const after = fs.fstatSync(descriptor); assert.equal(after.size, opened.size); assert.equal(after.mtimeMs, opened.mtimeMs); assert.equal(sha(bytes), expected.sha256); return bytes;
  } finally { fs.closeSync(descriptor); }
}
export function bounded(filename, maximum) { const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum); const bytes = fs.readFileSync(filename); assert.equal(bytes.length, stat.size); return bytes; }
export function grant(value, now = Date.now()) {
  assert.equal(value.schema, "B2_RUNTIME_GO_R4");
  assert.equal(value.authority, "ROOT_B2_672_EXPLICIT_FRESH_GO");
  assert.equal(value.reviewAuthority, "INDEPENDENT_PREEXEC_REVIEW_ACCEPTED");
  assert.match(value.reviewCommit, /^[a-f0-9]{40}$/); assert.match(value.packetSha256, /^[a-f0-9]{64}$/);
  for (const [key, expected] of Object.entries(caps)) { assert.ok(Number.isSafeInteger(value.caps[key]) && Number.isFinite(value.caps[key])); assert.equal(value.caps[key], expected); }
  const times = {};
  for (const key of ["issuedAt", "notBefore", "activeDeadline", "deadline"]) { assert.equal(typeof value[key], "string"); assert.match(value[key], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); times[key] = Date.parse(value[key]); assert.ok(Number.isFinite(times[key])); assert.equal(new Date(times[key]).toISOString(), value[key]); }
  assert.ok(Number.isFinite(now) && times.issuedAt <= times.notBefore && times.notBefore <= now && now < times.activeDeadline && times.activeDeadline < times.deadline);
  assert.equal(times.deadline - times.notBefore, caps.seconds * 1000); assert.equal(times.deadline - times.activeDeadline, caps.reserveSeconds * 1000);
  canonical(value.workRoot); assert.equal(value.workRoot, "/private/tmp/safe-bash-b2-runtime-r4-01a04d95");
  return Object.freeze({ ...value, times: Object.freeze(times), started: performance.now() - (now - times.notBefore) });
}
export function census(roots) {
  const rows = []; let bytes = 0; let entries = 0;
  function visit(filename) {
    assert.ok(++entries <= caps.maximumInventoryEntries);
    const stat = fs.lstatSync(filename);
    if (stat.isDirectory()) for (const child of fs.readdirSync(filename).sort()) visit(path.join(filename, child));
    else { assert.ok(stat.isFile() || stat.isSymbolicLink()); bytes += stat.size; rows.push(Object.freeze({ path: filename, bytes: stat.size, symlinkNotFollowed: stat.isSymbolicLink() })); }
  }
  for (const root of roots) if (fs.existsSync(root)) visit(root);
  assert.ok(bytes <= caps.workBytes);
  return Object.freeze({ bytes, entries, rows: Object.freeze(rows) });
}
export function ledger(roots, deadline) {
  let written = 0; let terminalWritten = 0;
  function charge(count, terminal = false) {
    assert.ok(Number.isSafeInteger(count) && count >= 0);
    assert.ok(Date.now() < deadline);
    if (terminal) { terminalWritten += count; assert.ok(terminalWritten <= caps.terminalReserveBytes); }
    else { written += count; assert.ok(written <= caps.workBytes - caps.terminalReserveBytes); }
  }
  function write(filename, body, terminal = false) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body); charge(bytes.length, terminal);
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    const descriptor = fs.openSync(filename, "wx", 0o600);
    try { let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset); assert.ok(count > 0); offset += count; } fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  }
  function replace(filename, bytes) {
    assert.ok(Buffer.isBuffer(bytes)); charge(bytes.length);
    const before = fs.lstatSync(filename); assert.ok(before.isFile() && !before.isSymbolicLink());
    const descriptor = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW);
    try {
      const opened = fs.fstatSync(descriptor); assert.equal(opened.ino, before.ino); assert.equal(opened.dev, before.dev);
      let offset = 0;
      while (offset < bytes.length) { const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset, offset); assert.ok(count > 0); offset += count; }
      fs.ftruncateSync(descriptor, bytes.length); fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
  }
  const io = Object.create(fs); io.writeSync = (descriptor, buffer, offset, length) => { charge(length); return fs.writeSync(descriptor, buffer, offset, length); };
  return Object.freeze({ write, replace, io, observe() { assert.ok(Date.now() < deadline); const sample = census(roots); assert.ok(sample.bytes <= caps.workBytes - caps.terminalReserveBytes); const rawBytes = sample.rows.filter(row => /(?:\.stdout|\.stderr|\.outer\.raw|\.jsonl)$/.test(row.path)).reduce((sum, row) => sum + row.bytes, 0); assert.ok(rawBytes <= caps.rawBytes); return sample; }, terminal(filename, value) { write(filename, JSON.stringify(value, null, 2) + "\n", true); }, snapshot() { return Object.freeze({ written, terminalWritten, census: census(roots) }); } });
}
export function rows(text) { return text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); }
