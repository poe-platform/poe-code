import { readFileSync, readdirSync } from 'node:fs';
import { flags, limits, productFiles } from '../bounded-matrix/cases.mjs';
import { base, original, root, read, hashes, oldHarness, remaining, snapshot, same, cleanEnv } from './guard.mjs';

if (process.argv.length !== 2 || !same(process.execArgv, flags)
  || !same(Object.fromEntries(Object.entries(process.env).sort()), cleanEnv)) throw new Error('Fixed clean freeze invocation only');
const old = read(original + 'frozen.json');
const current = snapshot();
for (const name of [...productFiles, ...oldHarness]) {
  if (current.executionHashes[name] !== old.hashes[name]) throw new Error(`Original executable drift: ${name}`);
}
for (const key of ['node', 'v8', 'executable', 'platform', 'arch']) {
  if (old[key] !== current.runtime[key]) throw new Error(`Original runtime identity drift: ${key}`);
}
const evidenceFiles = readdirSync(new URL(original + 'evidence/', root)).sort().map(name => original + 'evidence/' + name);
const artifactFiles = [];
function collect(directory) {
  for (const entry of readdirSync(new URL(directory, root), { withFileTypes: true })) {
    const name = directory + entry.name;
    if (name + '/' === base) continue;
    if (entry.isDirectory()) collect(name + '/');
    else { readFileSync(new URL(name, root)); artifactFiles.push(name); }
  }
}
collect('tests/stress/regex-execution/');
process.stdout.write(JSON.stringify({ utc: new Date().toISOString(),
  originalFreezeCommit: '9653d91', originalEvidenceCommit: 'b0ff710', reviewCommit: '3d8f96e',
  historicalBinaryDigest: null, ids: remaining.map(item => item.id), limits,
  ...current, originalObservationHashes: Object.fromEntries(Object.keys(current.observationHashes).map(name => [name, old.hashes[name]])),
  originalEvidenceHashes: hashes([original + 'frozen.json', ...evidenceFiles]),
  immutableArtifactHashes: hashes(artifactFiles.sort()) }, null, 2) + '\n');
