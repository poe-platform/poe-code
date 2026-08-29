import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sealBytes = fs.readFileSync(path.join(root, 'PRESEAL.json'));
assert.equal(hash(sealBytes), process.argv[2]);
const seal = JSON.parse(sealBytes);
assert(Date.now() < seal.deadline);
assert.equal(process.permission.has('child'), false);
assert.equal(process.permission.has('worker'), false);
for (const row of seal.pureInputs) {
  const stat = fs.lstatSync(row.path);
  assert(stat.isFile() && stat.size === row.bytes && stat.size <= 65536);
  assert.equal(hash(fs.readFileSync(row.path)), row.sha256);
}
await import(pathToFileURL(path.join(seal.packet, 'finalization-controls.mjs')));
const {finalize} = await import(pathToFileURL(path.join(seal.packet, 'finalization.mjs')));
const rows = [];
function check(id, body) {
  try { body(); rows.push({id, pass: true}); }
  catch (reason) { rows.push({id, pass: false, reasonPresent: true, reason: String(reason)}); }
}
check('N01', () => {
  const primary = {}, censusReason = {}, publicationReason = {};
  const state = finalize({primaryPresent: true, primary, census() { throw censusReason; }, publish() { throw publicationReason; }});
  assert.equal(state.primary, primary);
  assert.deepEqual(state.secondary.map(row => row.phase), ['final-census', 'terminal-publication']);
  assert.equal(state.secondary[0].reason, censusReason);
  assert.equal(state.secondary[1].reason, publicationReason);
});
check('N02', () => {
  const primary = Symbol('owned-primary');
  const state = finalize({primaryPresent: true, primary, census() { throw undefined; }, publish() {}});
  assert.equal(state.primary, primary);
  assert.equal(state.secondaryPresent, true);
  assert.equal(state.secondary[0].present, true);
  assert.equal(state.secondary[0].reason, undefined);
});
check('N03', () => {
  const state = finalize({primaryPresent: false, primary: 'absent', census() { throw -0; }, publish() { throw 0; }});
  assert(Object.is(state.primary, -0));
  assert(Object.is(state.secondary[0].reason, 0));
  assert.equal(state.publicationSucceeded, false);
});
check('N04', () => {
  const state = finalize({primaryPresent: false, census: () => undefined, publish(current) {
    assert.equal(current.sampledWorkPresent, true);
    assert.equal(current.sampledWork, undefined);
  }});
  assert.equal(state.primaryPresent, false);
  assert.equal(state.publicationSucceeded, true);
});
check('N05', () => {
  const state = finalize({primaryPresent: false, primary: 'not-a-failure', census() { throw undefined; }, publish() { throw false; }});
  assert.equal(state.primaryPresent, true);
  assert.equal(state.primary, undefined);
  assert.equal(state.secondary[0].reason, false);
  assert.equal(state.secondary[0].phase, 'terminal-publication');
});
check('N06', () => {
  let attempts = 0;
  const state = finalize({primaryPresent: false, census() { throw 0; }, publish(current) {
    attempts++;
    assert.equal(current.primaryPresent, true);
    assert.equal(current.primary, 0);
    assert.equal(current.publicationAttempted, true);
    assert.equal(current.publicationSucceeded, false);
    assert.equal(current.sampledWorkPresent, false);
  }});
  assert.equal(attempts, 1);
  assert.equal(state.publicationSucceeded, true);
});
check('N07', () => {
  const primary = Error('prior'), sample = {bytes: 0};
  const state = finalize({primaryPresent: true, primary, census: () => sample, publish() {}});
  assert.equal(state.primary, primary);
  assert.equal(state.sampledWork, sample);
  assert.equal(state.secondaryPresent, false);
  assert.equal(state.secondary.length, 0);
});
check('N08', () => {
  const failed = finalize({primaryPresent: false, census() { throw false; }, publish() { throw null; }});
  const clean = finalize({primaryPresent: false, census: () => 0, publish() {}});
  assert.equal(failed.primary, false);
  assert.equal(clean.primaryPresent, false);
  assert.equal(clean.secondary.length, 0);
  assert.notEqual(clean.secondary, failed.secondary);
  assert.equal(clean.sampledWorkPresent, true);
  assert.equal(clean.sampledWork, 0);
});
for (const row of seal.pureInputs) assert.equal(hash(fs.readFileSync(row.path)), row.sha256);
console.log(JSON.stringify({scope: 'PURE callback state only',authorGroups: 6, authorRows: 18, novel: rows, productCalls: 0}));
if (rows.some(row => !row.pass)) process.exitCode = 1;
