import assert from 'node:assert/strict';
import { readFileSync, realpathSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { owned, product, hash, frozen, save, put, inventory, command, replaceOne } from '../lib.mjs';

const initialCommit = '0219616f7e2dc2f13aebc155933fd52fe1dfac9e';
const authorCommit = '098ce3f4fefed0eebf98881bd835eac1ed9b6e4c';
const authorBase = 'tests/commands/expr-stress/sink-profile-migration-v3-20260827/author';
const independentBase = 'tests/commands/expr-stress/sink-profile-migration-v3-20260827/independent';
const state = JSON.parse(readFileSync(join(owned, 'quota-followup-01/state.json')));
const initial = JSON.parse(frozen(`${independentBase}/run-02/state.json`, initialCommit));
assert.equal(state.archiveSha256, initial.archiveSha256);
assert.equal(state.packageSha256, initial.packageSha256);
for (const key of ['scratch', 'source', 'installed', 'temporary', 'moved']) state[key] = realpathSync(state[key]);
state.env.TMPDIR = state.temporary;
const output = state.output;
const harness = join(state.scratch, 'followup'); mkdirSync(harness);
const recorded = [];
for (const name of ['MANIFEST-v2.json','FREEZE-v2.json','FOLLOWUP-HUNKS-v2.patch.data','HANDOFF.txt']) {
  const bytes = frozen(`${authorBase}/${name}`, authorCommit);
  put(join(output, 'author', name + '.data'), bytes);
  recorded.push({ path: `${authorBase}/${name}`, commit: authorCommit, sha256: hash(bytes) });
}
const manifest = JSON.parse(frozen(`${authorBase}/MANIFEST-v2.json`, authorCommit));
for (const profile of ['original', 'initial', 'corrected']) {
  const prefix = profile === 'corrected' ? 'quota-identity-v2' : `${profile === 'initial' ? 'revised' : 'original'}/quota`;
  for (const name of ['cases.mjs','common.mjs','probe.mjs']) {
    const bytes = frozen(`${authorBase}/${prefix}/${name}`, authorCommit);
    const record = manifest.records.find(record => record.path === `${prefix}/${name}`);
    assert.equal(hash(bytes), record.sha256);
    put(join(harness, profile, name), bytes);
    put(join(output, 'inputs', profile, name + '.data'), bytes);
    recorded.push({ path: `${authorBase}/${prefix}/${name}`, commit: authorCommit, sha256: hash(bytes) });
  }
}
const before = readFileSync(join(harness, 'initial/probe.mjs'), 'utf8');
const after = readFileSync(join(harness, 'corrected/probe.mjs'), 'utf8');
const anchor = "    check('exact worker job count', jobs.length === input.expected.jobs);";
const addition = "    if (input.id === 'stdout-rejection-normal-quota') check('identical stdout rejection without diagnostic attempt', outcome.error === sinkReason && attempts.length === 1 && attempts[0].channel === 'stdout');\n";
assert.equal(after, replaceOne(before, anchor, addition + anchor));
for (const name of ['cases.mjs', 'common.mjs']) assert.deepEqual(readFileSync(join(harness, 'initial', name)), readFileSync(join(harness, 'corrected', name)));
const structural = [
  ['weaken identity', 'outcome.error === sinkReason && attempts.length', 'String(outcome.error) === "sink" && attempts.length'],
  ['remove one-write bound', 'attempts.length === 1', 'attempts.length >= 1'],
  ['change callback', 'if (mode === `reject-${channel}`) throw sinkReason;', 'if (mode === `reject-${channel}`) throw "sink";'],
  ['remove job assertion', anchor, ''],
  ['remove cleanup assertion', "    check('no owned workers at settlement or cleanup', row.activeAtSettlement === 0 && active.size === 0);", ''],
].map(([id, original, replacement]) => {
  const mutated = replaceOne(after, original, replacement);
  assert.throws(() => assert.equal(mutated, replaceOne(before, anchor, addition + anchor), 'only authorized target assertion may differ'), { code: 'ERR_ASSERTION' });
  return { id, assertion: 'only authorized target assertion may differ', rejected: true, positivePassed: true };
});
const initialWrapper = frozen(`${independentBase}/mutant-expr.mjs`, initialCommit).toString();
const wrapper = replaceOne(initialWrapper, "        case 'none': throw reason;", "        case 'none': throw reason;\n        case 'literal-sink-marker': throw 'sink';\n        case 'object-sink-marker': throw { toString() { return 'sink'; } };");
put(join(harness, 'mutant-expr.mjs'), wrapper);
put(join(output, 'inputs/mutant-expr.mjs.data'), wrapper);
const deltas = [];
for (const profile of ['initial','corrected']) {
  const text = readFileSync(join(harness, profile, 'probe.mjs'), 'utf8');
  let changed = replaceOne(text, 'await import(`${base}dist/commands/expr/index.js`)', `await import(${JSON.stringify(pathToFileURL(join(harness, 'mutant-expr.mjs')).href)})`);
  changed = replaceOne(changed, "import { cases, constants } from './cases.mjs';", "import { cases as allCases, constants } from './cases.mjs';\nconst cases = allCases.filter(input => input.id === 'stdout-rejection-normal-quota');");
  put(join(harness, profile, 'negative.mjs'), changed);
  put(join(output, 'inputs', profile, 'negative.mjs.data'), changed);
  deltas.push({ profile, before: hash(text), after: hash(changed), changes: 'Only explicit mutation import seam and one-target selection. Every original/corrected assertion unchanged.' });
}
save(join(output, 'FOLLOWUP-FREEZE.json'), { frozenAt: new Date().toISOString(), product, initialCommit, authorCommit, recorded, exactAdditionalAssertion: addition.trim(), structural, negativeDeltas: deltas, harness: inventory(harness), wrapperSha256: hash(wrapper), reviewScriptSha256: hash(readFileSync(join(owned, 'followup/review.mjs'))), sameArchiveSha256: state.archiveSha256, samePackageSha256: state.packageSha256, installedBefore: inventory(state.installed) });
const counts = {};
try {
  for (const profile of ['original','initial','corrected']) {
    const destination = join(output, `${profile}-quota47.json`);
    const result = command(output, `${profile}-quota47`, process.execPath, [join(harness, profile, 'probe.mjs'), state.installed, destination], state.moved, state.env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const rows = JSON.parse(readFileSync(destination));
    assert.equal(rows.total, 47); assert.equal(rows.passed, profile === 'original' ? 46 : 47);
    assert.equal(rows.safetyTerminations, 0); assert.equal(rows.activeAfterSafety, 0);
    const row = rows.rows.find(row => row.input.id === 'stdout-rejection-normal-quota');
    assert.deepEqual(row.input.argv, ['1']); assert.equal(row.input.cap, 2); assert.equal(row.input.mode, 'reject-stdout');
    assert.equal(row.attempts.length, 1); assert.equal(row.attempts[0].channel, 'stdout');
    counts[profile] = { passed: rows.passed, total: rows.total, failed: rows.rows.filter(row => !row.passed).map(row => row.input.id), directIdentityAssertion: row.checks.find(check => check.name === 'identical stdout rejection without diagnostic attempt') ?? null };
  }
  const sensitivity = [];
  for (const profile of ['initial','corrected']) {
    const mutations = ['none','literal-sink-marker','none','object-sink-marker', ...(profile === 'corrected' ? ['swallow','recast','wrong-error-copy','wrong-sentinel','duplicate-diagnostic'] : [])];
    for (const [index, mutation] of mutations.entries()) {
      const label = `${profile}-${index}-${mutation}`;
      const destination = join(output, label + '.json'), trigger = join(output, label + '-trigger.jsonl');
      const result = command(output, label, process.execPath, [join(harness, profile, 'negative.mjs'), state.installed, destination], state.moved, { ...state.env, REVIEW_INSTALLED: state.installed, REVIEW_MUTATION: mutation, REVIEW_MUTATION_LOG: trigger });
      assert.equal(result.status, 0, result.stderr);
      const actual = JSON.parse(readFileSync(destination));
      const triggers = readFileSync(trigger, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.equal(triggers.length, 1); assert.deepEqual(triggers[0].args, ['1']); assert.equal(triggers[0].options.limits.maxOutputBytes, 2);
      assert.equal(actual.total, 1); assert.equal(actual.safetyTerminations, 0);
      const row = actual.rows[0], failures = row.checks.filter(check => !check.passed).map(check => check.name);
      if (mutation === 'none' || profile === 'initial') assert(row.passed, JSON.stringify(failures));
      else {
        assert(!row.passed);
        assert(failures.includes('identical stdout rejection without diagnostic attempt'));
        if (mutation.includes('sink-marker')) assert.deepEqual(failures, ['identical stdout rejection without diagnostic attempt']);
      }
      sensitivity.push({ profile, mutation, triggers, passed: row.passed, failures, falsePositive: profile === 'initial' && mutation !== 'none', intendedRejectionDetected: profile === 'corrected' && mutation !== 'none' });
    }
  }
  const sourceBefore = JSON.parse(readFileSync(join(output, 'source-before.json')));
  const sourceAfter = Object.fromEntries(Object.entries(inventory(state.source)).filter(([path]) => path !== 'dist' && !path.startsWith('dist/')));
  assert.deepEqual(sourceAfter, sourceBefore);
  assert.deepEqual(inventory(join(state.source, 'dist')), JSON.parse(readFileSync(join(output, 'compiled-before.json'))));
  assert.deepEqual(inventory(state.installed), JSON.parse(readFileSync(join(output, 'installed-before.json'))));
  assert.deepEqual(inventory(harness), JSON.parse(readFileSync(join(output, 'FOLLOWUP-FREEZE.json'))).harness);
  const firstInputs = JSON.parse(frozen(`${independentBase}/audit-03/author/MANIFEST.json.data`, initialCommit));
  const unchanged = firstInputs.records.filter(record => record.path.startsWith('revised/canonical/') || record.path.startsWith('revised/core/') || record.path.startsWith('revised/nearby/') || record.path === 'support/nearby-driver.mjs').map(record => {
    assert.equal(hash(frozen(`${authorBase}/${record.path}`, authorCommit)), record.sha256);
    return { path: record.path, sha256: record.sha256, unchanged: true };
  });
  save(join(output, 'SUMMARY.json'), { counts, positives: sensitivity.filter(row => row.mutation === 'none').length, preservedFalsePositives: sensitivity.filter(row => row.falsePositive).length, correctedMutantsDetected: sensitivity.filter(row => row.intendedRejectionDetected).length, sensitivity, structural, unchangedCanonicalCoreNearby: unchanged, product, initialCommit, authorCommit, sameArchive: state.archiveSha256, samePackage: state.packageSha256, appendAwareSourceDistPackageHarnessUnchanged: true, noProductDefectEstablished: true, comparatorDefectCorrected: true });
  console.log(JSON.stringify({ counts, positives: 4, falsePositivesPreserved: 2, correctedMutantsDetected: 7 }));
} finally {
  save(join(output, 'temporary-before-cleanup.json'), inventory(state.temporary));
  save(join(output, 'task-before-cleanup.json'), inventory(state.scratch));
  assert(state.scratch.includes('/expr-sink-independent-v3-'));
  rmSync(state.scratch, { recursive: true, force: false });
  save(join(output, 'cleanup.json'), { taskRoot: state.scratch, absent: !existsSync(state.scratch), noSIGSTOP: true, finishedAt: new Date().toISOString() });
}
