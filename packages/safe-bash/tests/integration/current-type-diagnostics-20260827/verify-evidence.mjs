import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const scope = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(join(scope, path)));
const inventory = (directory = scope) => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const absolute = join(directory, entry.name);
  const path = relative(scope, absolute);
  assert.ok(!entry.isSymbolicLink(), `Unexpected evidence symlink: ${path}`);
  if (entry.isDirectory()) return inventory(absolute);
  if (path === 'MANIFEST.json') return [];
  const bytes = readFileSync(absolute);
  return [{ path, bytes: bytes.length, sha256: hash(bytes) }];
}).sort((left, right) => left.path.localeCompare(right.path));
function decoded(base, descriptor) {
  const stored = readFileSync(join(scope, base, descriptor.path));
  assert.equal(hash(stored), descriptor.storedSha256);
  const bytes = gunzipSync(Buffer.from(stored.toString().trim(), 'base64'));
  assert.equal(bytes.length, descriptor.bytes);
  assert.equal(hash(bytes), descriptor.sha256);
  return JSON.parse(bytes);
}

const result = [];
for (const [label, coldCount] of [['b494-v3', 30], ['current', 35]]) {
  const base = `evidence/${label}`;
  const summary = json(`${base}/SUMMARY.json`);
  const start = json(`${base}/START.json`);
  assert.equal(start.runnerSha256, hash(readFileSync(join(scope, 'reproduce.mjs'))));
  const inputs = decoded(base, summary.inputs);
  const after = decoded(base, summary.after);
  assert.deepEqual(after, inputs);
  const tools = decoded(base, summary.tools);
  const builds = decoded(base, summary.buildArtifacts);
  const probes = decoded(base, summary.probes);
  const identities = new Map([
    ...inputs.map(entry => [entry.path, entry.sha256]),
    ...tools.map(entry => [`node_modules/${entry.path}`, entry.sha256]),
    ...builds.map(entry => [`dist/${entry.path}`, entry.sha256]),
  ]);
  const counts = {};
  for (const phase of ['cold', 'warm']) {
    const command = json(`${base}/${phase}-typecheck.json`);
    assert.equal(command.status, 2);
    assert.equal(command.diagnostics.length, phase === 'cold' ? coldCount : 11);
    assert.deepEqual(command.args, ['run', 'typecheck']);
    const list = readFileSync(join(scope, base, `${phase}-files.stdout.log`), 'utf8').trim().split('\n');
    for (const path of list) {
      assert.ok(path.startsWith(`${start.snapshot}/`), `Compiler source fallback: ${path}`);
      assert.ok(identities.has(path.slice(start.snapshot.length + 1)), `Unbound compiler input: ${path}`);
      if (phase === 'cold') assert.ok(!path.startsWith(`${start.snapshot}/dist/`));
    }
    if (label === 'current') assert.ok(list.includes(`${start.snapshot}/tests/shell-stress/env-split-consumer/packed-public-types.ts`));
    counts[phase] = list.length;
  }
  for (const command of ['build', 'maintained-consumers-built', 'encoder-import', 'historical-layout-restored']) assert.equal(json(`${base}/${command}.json`).status, 0);
  assert.deepEqual(json(`${base}/encoder-original.json`).diagnostics.map(entry => entry.code), ['TS2749']);
  assert.deepEqual(json(`${base}/encoder-negative.json`).diagnostics.map(entry => entry.code), ['TS2345']);
  assert.equal(probes.filter(entry => entry.path.startsWith('restored-contracts/')).length, 6);
  const cleanup = json(`${base}/CLEANUP.json`);
  assert.equal(cleanup.removed, true);
  assert.ok(!existsSync(cleanup.scratch));
  assert.equal(summary.sourceLauncherUnchanged, '8d5fa5bd883fec0979fc2004f1fe1d99aef40570155d550eadc0b03b55513bf0');
  result.push({ revision: summary.revision, coldDiagnostics: coldCount, warmDiagnostics: 11, buildStatus: 0, compilerInputs: counts, trackedInputs: inputs.length, buildFiles: builds.length });
}
const audit = json('evidence/audit/diagnostics.json');
assert.equal(audit.cohorts.current.coldAddedSinceRetainedOriginal.length, 5);
const guards = json('evidence/audit/hash-guards.json');
assert.deepEqual(guards.counts, { 'historical-cleanup-pin': 10, 'historical-diagnostic-pin': 89 });
for (const cohort of Object.values(guards.audits)) {
  assert.equal(cohort.rawFailureActualEqualsCommittedPreExecutionBlob, true);
  assert.equal(cohort.changedDiagnosticPins.length, 2);
  assert.equal(cohort.changedCleanupPins.length, 1);
}
for (const label of ['b494', 'b494-v2']) {
  assert.equal(json(`evidence/${label}/CLEANUP.json`).removed, true);
  assert.ok(!existsSync(json(`evidence/${label}/CLEANUP.json`).scratch));
}
const entries = inventory();
if (process.argv[2] === '--seal') {
  writeFileSync(join(scope, 'MANIFEST.json'), `${JSON.stringify({ createdAt: new Date().toISOString(), entries, checked: result, historicalFailedHooks: 99, noRuntimeTestsExecuted: true }, null, 2)}\n`, { flag: 'wx' });
} else {
  assert.equal(process.argv.length, 2, 'Only --seal or no arguments is supported');
  assert.ok(lstatSync(join(scope, 'MANIFEST.json')).isFile());
  assert.deepEqual(entries, json('MANIFEST.json').entries);
}
console.log(JSON.stringify({ evidenceFiles: entries.length, cohorts: result, historicalFailedHooks: 99, boundedEvidenceVerified: true }));
