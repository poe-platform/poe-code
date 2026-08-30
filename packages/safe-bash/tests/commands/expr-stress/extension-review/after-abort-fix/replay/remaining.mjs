import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { addEvidence, git, owned, sha256, verifyFrozen } from './review.mjs';
import { containedJob } from './watchdog.mjs';

const label = process.argv[2];
if (!label) { verifyFrozen(); console.log('Read-only verification; explicit unique capture required.'); process.exit(0); }
assert(/^[a-z0-9-]+$/.test(label));
const destination = `${owned}/${label}`;
assert(!existsSync(destination));
const candidate = JSON.parse(readFileSync(`${owned}/candidate-27a77935/stage.json`));
const oldBase = 'tests/commands/expr-stress/extension-review/execution';
const commit = 'f6e0533920d9583af80f044a327bfcaa381d7cac';
const rows = [], inputOrigins = [];
async function run(id, file, payload, expect = value => !value.controlFailure && value.passed !== false) {
  const outer = await containedJob(pathToFileURL(resolve(owned, file)).href, { installed: candidate.installed, ...payload });
  const value = outer.state === 'returned' && outer.value?.state === 'fulfilled' ? outer.value.value : null;
  let passed = false, assertion;
  try {
    assert(value);
    assert.equal(value.activeBeforeSafetyCleanup ?? value.liveWorkers ?? 0, 0);
    assert(expect(value));
    passed = true;
  } catch (error) { assertion = error.message; }
  rows.push({ id, file, payload, outer, passed, assertion });
  if (!passed) console.log(JSON.stringify({ id, assertion, failure: value?.controlFailure }));
}
function oldInputs(directory) {
  const path = `${oldBase}/${directory}/controls.json`;
  const bytes = git('show', `${commit}:${path}`);
  const inputs = JSON.parse(bytes).rows.map(({ id, payload }) => ({ id, payload }));
  inputOrigins.push({ commit, path, sha256: sha256(bytes), selection: 'Only id and payload reused; no old results copied or rescored.' });
  return inputs;
}
for (const { id, payload } of oldInputs('boundary-variants-fe7083d9')) await run(id, payload.mode ? 'extra-driver.mjs' : 'protocol-driver.mjs', payload);
const realRoot = mkdtempSync(join(tmpdir(), 'expr-postfix-byte-vfs-'));
try {
  for (const { id, payload: original } of oldInputs('final-boundaries-fe7083d9')) {
    const payload = original.realRoot ? { ...original, realRoot } : original;
    if (payload.scenario) await run(id, 'lifecycle-driver.mjs', payload);
    else await run(id, 'runtime-driver.mjs', payload, value => {
      if (id === 'shell-output-over-bound' || id === 'shell-shared-command-budget') return value.controlFailure?.name === 'ShellLimitError' && value.controlFailure.message === `Shell limit exceeded: ${id === 'shell-output-over-bound' ? 'maxOutputBytes' : 'maxCommands'}`;
      if (value.controlFailure) return false;
      const result = value.result;
      if (id === 'real-vfs-invalid-utf8-capture') return result.status === 0 && result.stdoutBase64 === 'Mgo=' && result.stderrBase64 === '' && result.files['/fragment'] === 'wwo=';
      if (id === 'shell-shortcircuit-0' || id === 'shell-shortcircuit-1') return !value.events.some(event => event.type === 'request' || event.type === 'workerStart') && result.status === (id.endsWith('0') ? 0 : 1) && result.stdoutBase64 === (id.endsWith('0') ? 'a2VwdAo=' : 'MAo=') && result.stderrBase64 === '';
      return result.status === 0 && result.stdoutBase64 === (id === 'shell-output-at-bound' ? 'MQoyCg==' : 'MQo=') && result.stderrBase64 === '';
    });
  }
  assert.deepEqual(readdirSync(realRoot), ['fragment']);
} finally { rmSync(realRoot, { recursive: true }); }
for (const reason of ['zero', 'error', 'undefined-native']) await run(`shell-lifecycle-${reason}`, 'shell-lifecycle-driver.mjs', { reason });
verifyFrozen();
addEvidence(`${destination}/controls.json`, { candidate: candidate.commit, inputOrigins, driverHashes: ['protocol-driver.mjs', 'lifecycle-driver.mjs', 'runtime-driver.mjs', 'extra-driver.mjs', 'shell-lifecycle-driver.mjs', 'watchdog.mjs'].map(path => ({ path, sha256: sha256(readFileSync(`${owned}/${path}`)) })), bindingChanges: 'Original payloads unchanged except fresh realRoot; corrected committed lifecycle-driver retains target80ms and separate sibling500ms. This is not unchanged all80ms acceptance.', subcases: rows.length, failed: rows.filter(row => !row.passed).map(row => row.id), rows, realVfsScratchRemoved: !existsSync(realRoot) });
console.log(JSON.stringify({ subcases: rows.length, failed: rows.filter(row => !row.passed).map(row => row.id) }));
