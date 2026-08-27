import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base, git, hash, save, snapshot } from './replay.mjs';

const gate = JSON.parse(readFileSync(`${base}/final-gate.json`, 'utf8'));
const path = 'src/commands/diff-patch/unified.ts';
const observations = [];
for (const [label, historical] of [['mutation-original-matcher', '72f780d'], ['mutation-overrestrictive-matcher', 'd841ece']]) {
  const directory = snapshot(gate.revision, label);
  const target = resolve(directory, path);
  const before = readFileSync(target, 'utf8');
  const after = git('show', `${historical}:${path}`).toString();
  assert.notEqual(hash(before), hash(after), 'Mutation must change accepted source');
  execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Update File: ${target}\n@@\n${before.trimEnd().split('\n').map(line => `-${line}`).join('\n')}\n${after.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`, maxBuffer: 1024 * 1024 });
  const probe = spawnSync(process.execPath, ['--import', 'tsx', `${base}/probe.mjs`, label], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.equal(probe.status, 0, probe.stderr);
  const evaluation = spawnSync(process.execPath, [`${base}/evaluate.mjs`, label], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.equal(evaluation.status, 1, 'Negative control must be detected');
  const record = JSON.parse(readFileSync(`${base}/${label}-evaluation.json`, 'utf8'));
  assert.deepEqual(record.checks.filter(row => !row.passed).map(row => row.name), [historical === '72f780d'
    ? 'repeated hunk later matching line control: complete virtual outcome'
    : 'repeated hunk second matching line control: complete virtual outcome']);
  observations.push({ label, historicalRevision: git('rev-parse', historical).toString().trim(), path, acceptedSha256: hash(before), mutantSha256: hash(readFileSync(target)), fixtureChanges: 0, productOnlyIsolatedMutation: true, detected: true, failures: record.checks.filter(row => !row.passed), evaluation: { status: evaluation.status, stdout: evaluation.stdout, stderr: evaluation.stderr } });
}
save(`${base}/final-mutation-controls.json`, { gateRevision: gate.revision, observations, coverage: 'Two isolated source mutations; not additional semantic coverage' });
console.log(observations.map(row => ({ label: row.label, detected: row.detected, failures: row.failures.map(failure => failure.name) })));
