import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { owned, hash, put, save, inventory, command, replaceOne } from './lib.mjs';

const state = JSON.parse(readFileSync(join(owned, process.argv[2], 'state.json')));
const output = join(state.output, 'negative'); mkdirSync(output);
const negativeRoot = join(state.scratch, 'negative'); mkdirSync(negativeRoot);
const harness = state.harness ?? join(state.scratch, 'harness');
const seamUrl = pathToFileURL(join(owned, 'mutant-expr.mjs')).href;
const targets = ['canonical', 'core', 'quota', 'nearby'];
const mutations = ['none', 'swallow', 'recast', 'wrong-error-copy', 'wrong-sentinel', 'duplicate-diagnostic'];
const deltas = [];
for (const target of targets) {
  const directory = join(negativeRoot, target); mkdirSync(directory);
  if (target === 'canonical') {
    for (const name of ['contracts.test.js', 'helpers.js', 'package.json']) {
      const original = readFileSync(join(harness, 'revised/emitted', name), 'utf8');
      const changed = name === 'helpers.js' ? replaceOne(original, pathToFileURL(join(state.installed, 'dist/commands/expr/index.js')).href, seamUrl) : original;
      put(join(directory, name), changed);
      deltas.push({ target, path: name, beforeSha256: hash(original), afterSha256: hash(changed), change: name === 'helpers.js' ? 'Only createExprCommand import to explicit mutation wrapper' : 'unchanged' });
    }
  } else {
    const originalPath = target === 'core' ? 'revised/core/runtime-driver.mjs' : target === 'quota' ? 'revised/quota/probe.mjs' : 'support/nearby-driver.mjs';
    const original = readFileSync(join(harness, originalPath), 'utf8');
    let changed = replaceOne(original, 'await import(`${base}dist/commands/expr/index.js`)', `await import(${JSON.stringify(seamUrl)})`);
    if (target === 'quota') changed = replaceOne(changed, "import { cases, constants } from './cases.mjs';", "import { cases as allCases, constants } from './cases.mjs';\nconst cases = allCases.filter(input => input.id === 'stdout-rejection-normal-quota');");
    put(join(directory, 'driver.mjs'), changed);
    deltas.push({ target, path: originalPath, beforeSha256: hash(original), afterSha256: hash(changed), change: 'Only explicit mutation import seam' + (target === 'quota' ? ' and single target selection; all assertions unchanged' : '; all assertions unchanged') });
    if (target === 'quota') for (const name of ['cases.mjs', 'common.mjs']) put(join(directory, name), readFileSync(join(harness, 'revised/quota', name)));
    if (target === 'nearby') {
      const controls = JSON.parse(readFileSync(join(harness, 'revised/nearby/controls.json')));
      controls.controls = controls.controls.filter(specimen => specimen.id === 'stdout-failure-no-regex-replay');
      assert.equal(controls.controls.length, 1);
      save(join(directory, 'controls.json'), controls);
    }
    if (target === 'core') put(join(directory, 'entry.mjs'), "import { run } from './driver.mjs';\nconsole.log(JSON.stringify(await run({installed:process.env.REVIEW_INSTALLED,mode:'sink-rejection'})));\n");
  }
}
save(join(output, 'freeze.json'), { frozenAt: new Date().toISOString(), deltas, inputs: inventory(negativeRoot), negativeDriverSha256: hash(readFileSync(join(owned, 'negative.mjs'))), wrapperSha256: hash(readFileSync(join(owned, 'mutant-expr.mjs'))), actualProductUnmodified: true, method: 'Run actual c3 execute to its original stdout rejection and completed cooperative cleanup; explicit test-only wrapper mutates subsequent settlement or diagnostic output. Original sink callbacks and all migrated assertions execute. One selected target per profile, not a broad cohort replay.' });
const results = [];
for (const target of targets) for (const mutation of mutations) {
  const directory = join(negativeRoot, target);
  const destination = join(output, `${target}-${mutation}.json`);
  const args = target === 'canonical' ? ['--test', '--test-reporter=spec', '--test-name-pattern=sink failure preserves', join(directory, 'contracts.test.js')] : target === 'core' ? [join(directory, 'entry.mjs')] : target === 'quota' ? [join(directory, 'driver.mjs'), state.installed, destination] : [join(directory, 'driver.mjs'), state.installed, join(directory, 'controls.json')];
  const log = join(output, `${target}-${mutation}-trigger.jsonl`);
  const processResult = command(output, `${target}-${mutation}`, process.execPath, args, state.moved, { ...state.env, REVIEW_INSTALLED: state.installed, REVIEW_MUTATION: mutation, REVIEW_MUTATION_LOG: log });
  assert(existsSync(log), 'actual stdout rejection seam must be reached');
  const triggers = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const wanted = target === 'core' ? ['41', '+', '1'] : target === 'nearby' ? ['a', ':', 'a'] : ['1'];
  assert.deepEqual(triggers[0].args, wanted);
  if (target === 'quota') assert.equal(triggers[0].options.limits.maxOutputBytes, 2);
  let detected, failure;
  if (target === 'canonical') {
    detected = processResult.status === 1 && processResult.stdout.includes('ERR_ASSERTION');
    failure = processResult.stdout;
    if (mutation === 'none') assert.equal(processResult.status, 0, processResult.stdout + processResult.stderr);
  } else {
    assert.equal(processResult.status, 0, processResult.stderr);
    const result = target === 'quota' ? JSON.parse(readFileSync(destination)) : JSON.parse(processResult.stdout);
    if (target !== 'quota') save(destination, result);
    if (target === 'core') { detected = result.controlFailure?.name === 'AssertionError'; failure = result.controlFailure?.message; assert.equal(result.activeBeforeSafetyCleanup, 0); }
    if (target === 'quota') { assert.equal(result.total, 1); detected = !result.rows[0].passed; failure = result.rows[0].checks.filter(check => !check.passed).map(check => check.name); assert.equal(result.safetyTerminations, 0); }
    if (target === 'nearby') { assert.equal(result.cases.length, 1); detected = !result.cases[0].passed; failure = result.cases[0].failures; assert.equal(result.activeWorkers, 0); assert.equal(result.cases[0].jobs.length, 1); }
  }
  if (mutation === 'none') assert(!detected, JSON.stringify(failure));
  else assert(detected, `${target}/${mutation} must fail the migrated assertion, not an import/setup failure`);
  results.push({ target, mutation, expectedPositive: mutation === 'none', detected: Boolean(detected), failure, triggers });
}
save(join(output, 'summary.json'), { positives: results.filter(result => result.expectedPositive).length, rejectedMutants: results.filter(result => !result.expectedPositive && result.detected).length, results });
assert.deepEqual(inventory(negativeRoot), JSON.parse(readFileSync(join(output, 'freeze.json'))).inputs);
console.log('Four positive controls and twenty behavior mutants verified.');
