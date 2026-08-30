import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const started = performance.now();
const [filename, expectedHash, expectedSize] = process.argv.slice(2);
const digest = body => crypto.createHash('sha256').update(body).digest('hex');
function admit(file, expected) {
  const stat = fs.lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, expected.bytes); assert.ok(stat.size <= 4194304);
  const body = fs.readFileSync(file); assert.equal(body.length, expected.bytes); assert.equal(digest(body), expected.sha256); return body;
}
try {
  assert.equal(process.argv.length, 5);
  const seal = JSON.parse(admit(filename, { bytes: Number(expectedSize), sha256: expectedHash }));
  assert.equal(seal.action, 'PURE_B1_R2_CONTROLS_ONLY'); assert.equal(seal.groups, 12);
  const source = JSON.parse(admit(seal.source.path, seal.source));
  for (const entry of [...source.files, ...seal.files]) admit(path.resolve(entry.path), entry);
  assert.ok(performance.now() - started < 10000);
  const deadline = setTimeout(() => { console.error('PURE_CONTROL_DEADLINE'); process.exit(78); }, 20000);
  try { await import('./controls.mjs'); } finally { clearTimeout(deadline); }
  for (const entry of [...source.files, ...seal.files]) admit(path.resolve(entry.path), entry);
  assert.ok(performance.now() - started < 30000);
} catch (error) { console.error(error); process.exitCode = 78; }
