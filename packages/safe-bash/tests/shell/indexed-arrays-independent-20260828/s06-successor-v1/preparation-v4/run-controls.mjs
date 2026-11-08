import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate, digest } from '../../candidate-v1/boundary-app.mjs';
import { put } from '../preparation-v3/staging.mjs';
import { ownership, retired, supervise } from './supervisor.mjs';
import { deadline } from './deadline.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), own = path.resolve(here, '../..');
const clock = deadline(180000), [sealHash, label] = process.argv.slice(2);
assert.match(sealHash ?? '', /^[a-f0-9]{64}$/u); assert.match(label ?? '', /^[A-Z0-9-]{1,30}$/u);
const seal = JSON.parse(authenticate(path.join(here, 'SEAL.json'), sealHash));
const verify = () => {
  clock.check('source-and-tool-authentication');
  authenticate(path.join(here, 'SEAL.json'), sealHash);
  for (const role of seal.roles) {
    const file = path.join(own, role.path);
    assert.equal(authenticate(file, role.sha256).length, role.bytes); assert.equal(fs.lstatSync(file).mode & 0o777, role.mode);
  }
  authenticate(seal.node.path, seal.node.sha256);
  assert.equal(fs.realpathSync(process.execPath), seal.node.path); assert.equal(process.version, seal.node.version);
  clock.check('after-source-and-tool-authentication');
};
verify();
const capturePath = path.join(here, `LAUNCH-CAPTURE-${label}.json`);
assert.equal(fs.existsSync(capturePath), false);
const oldRuns = fs.readdirSync(here).filter(name => name.startsWith('RUN-')).sort();
const owners = [], results = []; let captured = 0, nested = 0, observedScratchBytes = 0, unsafe;
const boundScratch = entries => {
  const bytes = Object.values(entries).reduce((total, entry) => total + (entry.bytes ?? 0), 0);
  observedScratchBytes += bytes; assert.ok(observedScratchBytes <= 16777216, 'aggregate final physical synthetic scratch bound');
};
const checkRoles = [
  { id: 'WHOLE-CONTROLLER', file: 'controller-controls.mjs', args: [sealHash, label], timeoutMs: 30000, code: 0 },
  { id: 'POSITIVE-BEFORE', file: 'mutant-controls.mjs', args: [sealHash, 'controller.mjs', '["owner","final"]', `${label}-BEFORE`], code: 0, modes: ['owner','final'] },
  { id: 'LATE-OWNER', file: 'mutant-controls.mjs', args: [sealHash, 'controller-late-owner.mjs', '["owner"]', `${label}-OWNER`], code: 1, modes: ['owner'] },
  { id: 'EARLY-FINISH', file: 'mutant-controls.mjs', args: [sealHash, 'controller-early-finish.mjs', '["final"]', `${label}-FINAL`], code: 1, modes: ['final'] },
  { id: 'POSITIVE-AFTER', file: 'mutant-controls.mjs', args: [sealHash, 'controller.mjs', '["owner","final"]', `${label}-AFTER`], code: 0, modes: ['owner','final'] },
  { id: 'NO-GRANT', file: 'dispatch.mjs', args: [], code: 78 }
];
assert.equal(checkRoles.length, seal.preparation.maxPrimaryChildren);
try {
  for (const role of checkRoles) {
    verify(); clock.check('before-control-child', (role.timeoutMs ?? 10000) + 3000);
    const owner = ownership(owners.length + 1, role.id); owners.push(owner);
    const run = await supervise(seal.node.path, [path.join(here, role.file), ...role.args], { cwd: here, env: { LC_ALL: 'C', TZ: 'UTC' }, timeoutMs: role.timeoutMs ?? 10000, maxBytes: 2097152 }, owner, clock);
    captured += run.bytes; assert.ok(captured <= 8388608);
    const row = { id: role.id, pass: false, run }; results.push(row);
    assert.ok(retired(owner) && run.closeObserved && run.groupAbsent === true && !run.fault && !run.spawnError && !run.signal, 'unsafe primary child stops dependents');
    verify();
    if (role.id === 'WHOLE-CONTROLLER') {
      const file = path.join(here, `CONTROL-CAPTURE-${label}.json`); const bytes = fs.readFileSync(file), value = JSON.parse(bytes);
      assert.equal(value.sealHash, sealHash); assert.equal(value.allRetired, true); assert.equal(value.ownedScratchRetired, true);
      assert.equal(fs.existsSync(path.join(here, `CONTROLS-${label}`)), false); assert.ok(bytes.length <= 2097152);
      assert.equal(value.actualProductExecutions, 0); assert.equal(value.nativeCalls, 0);
      nested += value.ownedLaunchAttempts; assert.ok(nested <= 36); row.captureSha256 = digest(bytes);
      boundScratch(value.finalCensus);
      row.actualPids = value.actualPids; row.nestedLaunchAttempts = value.ownedLaunchAttempts;
      try {
        assert.equal(run.code, role.code); assert.deepEqual(value.results.map(entry => entry.id), seal.preparation.cases);
        assert.equal(value.passed, 43); assert.equal(value.observations, 43);
        const summary = JSON.parse(run.stdout); assert.equal(summary.captureSha256, row.captureSha256);
        row.pass = true;
      } catch (reason) { row.error = String(reason?.stack ?? reason); }
    } else if (role.modes) {
      const value = JSON.parse(run.stdout); assert.equal(value.unsafe, false); assert.equal(value.ownedScratchRetired, true);
      boundScratch(value.finalCensus);
      assert.ok(value.owners.every(entry => entry.closeObserved && entry.groupAbsent === true));
      nested += value.owners.length; assert.ok(nested <= 36); row.nestedLaunchAttempts = value.owners.length;
      assert.equal(fs.existsSync(path.join(here, `MUTATION-${role.args[3]}`)), false);
      const moduleName = role.args[1], moduleFile = path.join(here, moduleName);
      const moduleRole = seal.roles.find(entry => path.join(own, entry.path) === moduleFile); assert.ok(moduleRole);
      assert.ok(value.loads.some(entry => entry.path === moduleFile && entry.sha256 === moduleRole.sha256), 'actual exact loaded controller required');
      row.loadedModule = { path: moduleFile, sha256: moduleRole.sha256 };
      try {
        assert.equal(run.code, role.code); assert.deepEqual(value.observations.map(entry => entry.id), role.modes);
        assert.ok(value.observations.every(entry => entry.pass === (role.code === 0)));
        if (role.code === 1) assert.match(value.observations[0].error, role.id === 'LATE-OWNER' ? /receipt failure must not erase newest child/u : /Missing expected rejection/u);
        row.pass = true;
      } catch (reason) { row.error = String(reason?.stack ?? reason); }
    } else {
      assert.deepEqual(fs.readdirSync(here).filter(name => name.startsWith('RUN-')).sort(), oldRuns, 'no-grant dispatch created no candidate work');
      try {
        assert.equal(run.code, 78); assert.equal(run.stdout, ''); assert.match(run.stderr, /explicit sealed recipe and new ROOT actual GO required/u); row.pass = true;
      } catch (reason) { row.error = String(reason?.stack ?? reason); }
    }
    assert.ok(owners.length + nested <= 42); clock.check('after-control-child');
  }
} catch (reason) { unsafe = String(reason?.stack ?? reason); }
finally {
  try {
    assert.ok(owners.every(retired)); verify();
    assert.deepEqual(fs.readdirSync(here).filter(name => name.startsWith('RUN-')).sort(), oldRuns);
    assert.ok(!fs.readdirSync(here).some(name => name === `CONTROLS-${label}` || name.startsWith(`MUTATION-${label}-`)));
    clock.check('preparation-final-publication');
    const value = { schema: 'array-harness-v4-synthetic-preparation', sealHash, node: seal.node, results, unsafe, allPrimaryRetired: owners.every(retired), actualPrimaryPids: owners.filter(owner => owner.pid !== null).map(owner => owner.pid), primary: owners.length, nestedLaunchAttempts: nested, capturedBytes: captured, observedScratchBytes, elapsedBeforePublicationMs: clock.elapsed(), actualCandidateExecutions: 0, actualNativeCalls: 0, coordinatorNotIncludedInChildren: true, requiresZeroCoordinatorExit: true };
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n'); assert.ok(bytes.length < 8388608); put(capturePath, bytes);
    clock.check('preparation-after-final-publication');
    const accepted = !unsafe && results.length === 6 && results.every(row => row.pass);
    console.log(JSON.stringify({ accepted, unsafe, roles: results.length, passed: results.filter(row => row.pass).length, primary: owners.length, nestedLaunchAttempts: nested, captureSha256: digest(bytes), actualCandidateExecutions: 0, failures: results.filter(row => !row.pass).map(row => ({ id: row.id, error: row.error })) }));
    clock.check('preparation-terminal-exit'); process.exitCode = accepted ? 0 : 78;
  } catch (reason) { console.error(`unsafe preparation finalization: ${String(reason?.stack ?? reason)}`); process.exitCode = 78; }
}
