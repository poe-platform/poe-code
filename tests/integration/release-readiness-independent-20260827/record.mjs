import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundary, cases, hash, inventory } from './fixture-tools.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const [mode, name] = process.argv.slice(2);
assert.ok(['--capture', '--verify'].includes(mode) && /^[a-z0-9-]+$/u.test(name ?? ''), 'usage: node record.mjs --capture|--verify UNIQUE_NAME');
const output = resolve(owned, 'evidence', name);
const inputs = () => inventory(owned).filter(entry => entry.path !== 'evidence' && !entry.path.startsWith('evidence/'));
if (mode === '--verify') {
  const receipt = JSON.parse(readFileSync(join(output, 'receipt.json')));
  assert.deepEqual(inputs(), receipt.fixtureInventory, 'fixture membership/bytes changed');
  for (const [path, expected] of Object.entries(receipt.outputHashes)) assert.equal(hash(readFileSync(join(output, path))), expected);
  const evidenceEntries = inventory(output).filter(entry => entry.type === 'file').map(entry => entry.path).sort();
  assert.deepEqual(evidenceEntries, [...Object.keys(receipt.outputHashes), 'receipt.json'].sort());
  assert.ok(receipt.runs.every(run => run.status === 0 && run.signal === null && !run.error));
  console.log(JSON.stringify({ scope: receipt.scope, runs: receipt.runs.length, outcome: 'recorded fixture checks passed; candidate unverified' }));
} else {
  const fixtureInventory = inputs();
  assert.ok(!fixtureInventory.some(entry => entry.path.startsWith('.fixture-')), 'unremoved fixture work');
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output);
  const startedAt = new Date().toISOString(), runs = [], outputHashes = {};
  function run(label, args) {
    const result = spawnSync(process.execPath, args, { cwd: owned, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    for (const stream of ['stdout', 'stderr']) {
      const path = `${label}.${stream}`, bytes = result[stream] ?? '';
      writeFileSync(join(output, path), bytes, { flag: 'wx' });
      outputHashes[path] = hash(bytes);
    }
    runs.push({ label, executable: process.execPath, args, status: result.status, signal: result.signal, error: result.error?.message ?? null });
  }
  const scripts = fixtureInventory.filter(entry => entry.type === 'file' && entry.path.endsWith('.mjs')).map(entry => entry.path);
  for (const [index, path] of scripts.entries()) run(`syntax-${String(index + 1).padStart(2, '0')}`, ['--check', path]);
  run('selfcheck', ['--test', '--test-reporter=tap', 'selfcheck.mjs']);
  assert.deepEqual(inputs(), fixtureInventory, 'selfcheck must not modify its fixture inputs');
  const receipt = { scope: 'pre-candidate fixture machinery only', startedAt, completedAt: new Date().toISOString(),
    baseline: boundary.revision, sourceCandidate: null, nativeExecuted: false, gateExecuted: false,
    node: { executable: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)) },
    caseDefinitions: cases.length, groups: Object.fromEntries([...new Set(cases.map(entry => entry.group))].map(group => [group, cases.filter(entry => entry.group === group).length])),
    perPathOmissions: boundary.individualMts.map(entry => entry.path), runs, fixtureInventory, outputHashes };
  writeFileSync(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  const failed = runs.filter(run => run.status !== 0 || run.signal !== null || run.error);
  console.log(JSON.stringify({ output: `evidence/${name}`, syntaxChecks: scripts.length, caseDefinitions: cases.length, failedRuns: failed.map(run => run.label), scope: receipt.scope }));
  if (failed.length) process.exitCode = 1;
}
