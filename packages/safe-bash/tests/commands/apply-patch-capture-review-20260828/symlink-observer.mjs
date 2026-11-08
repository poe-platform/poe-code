import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [scratch, payloadPath, phase] = process.argv.slice(2);
assert.ok(['initial', 'restored'].includes(phase));
const payload = JSON.parse(fs.readFileSync(payloadPath));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const observerHash = hash(fs.readFileSync(fileURLToPath(import.meta.url)));
for (const entry of payload.files) {
  const filename = path.join(scratch, entry.path), stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.size, entry.bytes); assert.equal(stat.mode & 0o777, entry.mode);
  assert.equal(hash(fs.readFileSync(filename)), entry.sha256);
}
const moduleRoot = path.join(scratch, 'capture-membership-v3');
const capture = await import(pathToFileURL(path.join(moduleRoot, 'capture-io.mjs')).href);
const admission = await import(pathToFileURL(path.join(moduleRoot, 'controller-admission.mjs')).href);
const fixtureRoot = path.join(moduleRoot, 'runs/author-01/work');
const link = path.join(fixtureRoot, 'file-symlink/synthetic-stdout-0.json');
const target = path.join(fixtureRoot, 'file-symlink/synthetic.json');
const events = [], rows = [], controls = [];
let active = 'idle';
const original = { readFileSync: fs.readFileSync, lstatSync: fs.lstatSync, readdirSync: fs.readdirSync };
fs.readFileSync = function(filename, ...args) {
  events.push({ sequence: events.length, active, operation: 'read', path: String(filename) });
  return original.readFileSync.call(this, filename, ...args);
};
fs.lstatSync = function(filename, ...args) {
  const stat = original.lstatSync.call(this, filename, ...args);
  events.push({ sequence: events.length, active, operation: 'lstat', path: String(filename), symlink: stat.isSymbolicLink() });
  return stat;
};
fs.readdirSync = function(filename, ...args) {
  const result = original.readdirSync.call(this, filename, ...args);
  events.push({ sequence: events.length, active, operation: 'census', path: String(filename), count: result.length });
  return result;
};
function assessNegative(observation) {
  assert.equal(observation.caught, true, 'REFUSAL_REQUIRED');
  assert.equal(observation.reason?.code, 'CAPTURE_ADMISSION', 'EXACT_CODE');
  assert.equal(observation.reason?.message, 'regular file required', 'EXACT_TYPE_REFUSAL');
  assert.equal(observation.events.some(event => event.operation === 'read' && [link, target].includes(event.path)), false, 'READ_BEFORE_TYPE');
  const type = observation.events.find(event => event.operation === 'lstat' && event.path === link && event.symlink);
  assert.ok(type, 'TYPE_OBSERVATION_REQUIRED');
  assert.ok(observation.events.some(event => event.operation === 'census' && event.path === path.dirname(link) && event.count === 6 && event.sequence < type.sequence), 'EXACT_CENSUS_BEFORE_TYPE');
}
function invoke(label, profile, route, extraRead = false) {
  active = label;
  const first = events.length;
  let value, reason, caught = false;
  try {
    if (extraRead) fs.readFileSync(target);
    const directory = path.join(fixtureRoot, profile);
    value = route === 'helper' ? { bytes: capture.readCapture(directory, 'synthetic', profile) } : admission.admitCapturedTree(directory, 'synthetic', profile);
  } catch (error) { caught = true; reason = { name: error.name, code: error.code, message: error.message }; }
  const observation = { label, profile, route, caught, reason, events: events.slice(first) };
  if (value) {
    observation.base64 = value.bytes.toString('base64'); observation.sha256 = hash(value.bytes);
    if (value.entries) observation.entries = value.entries.map(entry => ({ mode: entry.mode, type: entry.type, oid: entry.blob, pathHex: entry.pathBytes.toString('hex') }));
    if (value.root) observation.root = value.root;
  }
  return observation;
}
try {
  const profiles = phase === 'initial' ? ['positive', 'file-symlink'] : ['file-symlink'];
  for (const profile of profiles) for (const route of ['helper', 'shared-controller']) {
    const negative = phase === 'initial' && profile === 'file-symlink';
    const observation = invoke(`${phase}:${profile}:${route}`, profile, route);
    try {
      if (negative) assessNegative(observation);
      else {
        assert.equal(observation.caught, false);
        assert.equal(observation.base64, payload.expected.stdoutBase64);
        if (route === 'shared-controller') { assert.deepEqual(observation.entries, payload.expected.entries); assert.equal(observation.root, payload.expectedRoot); }
      }
      observation.status = 'PASS';
    } catch (error) { observation.status = 'FAIL'; observation.failure = error.message; }
    rows.push(observation);
  }
  if (phase === 'initial') {
    const known = rows.find(row => row.profile === 'file-symlink' && row.route === 'helper');
    const readMutant = invoke('control:actual-target-read', 'file-symlink', 'helper', true);
    const examples = [
      ['actual-target-read', readMutant, 'READ_BEFORE_TYPE'],
      ['wrong-code', { ...known, reason: { ...known.reason, code: 'ERR_ASSERTION' } }, 'EXACT_CODE'],
      ['census-substitution', { ...known, reason: { ...known.reason, message: 'exact capture namespace' } }, 'EXACT_TYPE_REFUSAL'],
      ['missing-type-telemetry', { ...known, events: known.events.filter(event => event.operation !== 'lstat') }, 'TYPE_OBSERVATION_REQUIRED']
    ];
    for (const [id, example, expected] of examples) {
      let rejection;
      try { assessNegative(example); } catch (error) { rejection = error.message; }
      controls.push({ id, expected, rejection, status: rejection?.includes(expected) ? 'PASS' : 'FAIL', observation: example });
    }
  }
} finally { Object.assign(fs, original); }
console.log(JSON.stringify({ schema: 'c18-symlink-observation-v1', phase, observerHash, moduleBindings: payload.files.filter(entry => entry.path.endsWith('.mjs')).map(({ path, sha256 }) => ({ path, sha256 })), rows, controls, events, fixtureBodyPreauthentication: false, productActual: 0 }));
process.exitCode = [...rows, ...controls].some(row => row.status !== 'PASS') ? 1 : 0;
