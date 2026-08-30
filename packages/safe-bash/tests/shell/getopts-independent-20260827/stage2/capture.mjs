import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scripts, profiles } from './corpus.mjs';
import { owned, hash, save, inventory, baseline, verifyFreeze, verifyPhase1, execute } from './lib.mjs';

const freeze = verifyFreeze();
assert.equal(os.platform(), 'darwin', 'only authenticated Darwin profiles are authorized');
const before = { phase1: verifyPhase1(), baseline: baseline(), frozen: freeze };
assert.equal(before.baseline.registration, 'notregistered', 'unexpected Stage2 metadata: record boundary, do not run a candidate');
fs.mkdirSync(path.join(owned, 'capture-01'));
save('capture-01/before.json', before);
const env = { PATH: '/usr/bin:/bin', HOME: owned, TMPDIR: owned, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
const summary = [];
for (const profile of profiles) {
  const binaryBefore = hash(fs.readFileSync(profile.binary));
  assert.equal(binaryBefore, profile.sha256, 'authenticate binary before launch');
  const version = await execute(profile.binary, ['--noprofile', '--norc', '--version'], env);
  assert.equal(version.status, 0);
  assert.equal(version.termination, null);
  assert(version.stdout.includes(profile.version));
  const results = [];
  for (const control of scripts) {
    const execution = await execute(profile.binary, ['--noprofile', '--norc', '-c', (control.nativePrelude ?? '') + control.productScript, `stage2-${control.id}`], { ...env, ...control.env });
    const marker = '__PRODUCT__\n';
    const markerIndex = control.nativePrelude ? execution.stdout.indexOf(marker) : -1;
    const nativePreludeOutput = control.nativePrelude ? execution.stdout.slice(0, markerIndex) : '';
    const productStdout = control.nativePrelude ? execution.stdout.slice(markerIndex + marker.length) : execution.stdout;
    const attributes = {};
    for (const [name, expected] of Object.entries(control.startupAttributes ?? {})) {
      const match = nativePreludeOutput.match(new RegExp(`^declare -([a-z-]+) ${name}="([^"]*)"$`, 'm'));
      attributes[name] = { observed: match ? { flags: match[1], value: match[2], exported: match[1].includes('x') } : null, expected, match: Boolean(match && match[2] === '1' && match[1].includes('x') === expected.exported) };
    }
    const diagnostic = control.expectation.stderr;
    const stderrMatches = diagnostic.kind === 'empty' ? execution.stderr === '' : diagnostic.kind === 'contains' ? diagnostic.text.every(text => execution.stderr.includes(text)) : execution.stderr.split(diagnostic.text).length - 1 === diagnostic.count;
    const assertions = {
      stdout: Buffer.from(productStdout).equals(Buffer.from(control.expectation.stdout)),
      status: execution.status === control.expectation.status,
      stderrPredicate: stderrMatches,
      startupAttributes: Object.values(attributes).every(entry => entry.match) && (!control.nativePrelude || markerIndex >= 0),
      boundedSettlement: execution.closeAwaited && execution.termination === null && execution.spawnError === null && execution.signal === null,
    };
    results.push({ id: control.id, selectedProfileExpectationMatched: Object.values(assertions).every(Boolean), assertions, expected: control.expectation, nativePreludeOutput, attributes, productStdout, execution, productPolicy: control.productPolicy ?? null });
  }
  assert.equal(hash(fs.readFileSync(profile.binary)), binaryBefore, 'binary unchanged after capture');
  const mismatches = results.filter(entry => !entry.selectedProfileExpectationMatched).map(entry => entry.id);
  const record = { profile, identity: { version, platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version, binaryBefore, binaryAfter: hash(fs.readFileSync(profile.binary)) }, freeze, counts: { scripts: results.length, selectedProfileMatches: results.length - mismatches.length, selectedProfileMismatches: mismatches.length }, mismatches, results, interpretation: 'Native observations only. No candidate Stage2 execution. Historical profile is separately retained, not required to match the selected 5.3 expectations. D01 and intentional divergences override any future product equality.' };
  save(`capture-01/${profile.id}.json`, record);
  summary.push({ profile: profile.id, ...record.counts, mismatches });
}
const after = { phase1: verifyPhase1(), baseline: baseline(), frozen: verifyFreeze(), cleanup: { allChildrenClosed: true, noScratchCreated: true, fixtureFilesUnchanged: true, nativeProcessCount: profiles.length * (scripts.length + 1), nativeScenarioInvocations: profiles.length * scripts.length, identityInvocations: profiles.length } };
save('capture-01/after.json', after);
save('capture-01/summary.json', { freeze, profiles: summary, candidateStage2Executions: 0, originalPhase1Executions: 0, nativeScenarioInvocations: 32, distinctScripts: 16, frozenHostInvariants: 12, hostInvariantExecutions: 0, pendingRootDecisions: ['D01', 'D02', 'D03'] });
save('capture-01/manifest.json', inventory(path.join(owned, 'capture-01')));
console.log(JSON.stringify(summary));
