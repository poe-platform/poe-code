import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { blob, controls, directory, identify, inventory, pins, save, sha } from './bind.mjs';
import { compose, copyRegular, materializeSource } from './workspace.mjs';
import { child } from './series.mjs';

controls();
const root = `${directory}/auxiliary-01`; mkdirSync(root); mkdirSync(`${root}/records`);
const source = `${root}/source`; const binding = JSON.parse(readFileSync(`${directory}/BINDING.json`));
const route = JSON.parse(readFileSync(`${directory}/ROOT-ROUTE-v2.json`)); assert.equal(route.authorization, 'ROOT_EXECUTION_AUTHORIZED'); assert.equal(route.bindingSha256, sha(JSON.stringify(binding)));
materializeSource(compose(binding), source);
const sourceBefore = inventory(source);
const tools = `${directory}/tool-inputs`; const toolsBefore = inventory(tools);
const client = `${root}/consumer`; mkdirSync(client); writeFileSync(`${client}/package.json`, JSON.stringify({ type: 'module', private: true }));
for (const [name, from] of Object.entries({ 'entry.mjs': 'aux-entry.mjs', 'fixtures.mjs': 'fixtures-v3.mjs', 'mapping.mjs': 'mapping.mjs', 'series.mjs': 'series.mjs' })) copyRegular(`${directory}/${from}`, `${client}/${name}`);
copyRegular(`${directory}/../cases-v1.mjs`, `${client}/cases-v1.mjs`);
const regressionPath = 'tests/shell/fs-error-diagnostics.test.ts'; const regression = `${root}/regression/${regressionPath}`;
mkdirSync(`${root}/regression/tests/shell`, { recursive: true }); writeFileSync(regression, blob(pins.baseline, regressionPath));
const expectedControl = JSON.parse(readFileSync(`${directory}/AUXILIARY-PRESEAL.json`)); assert.equal(sha(readFileSync(regression)), expectedControl.regression.sha256);
const clientBefore = inventory(client); const regressionBefore = inventory(`${root}/regression`);
const allowed = Object.fromEntries([source, tools, client, `${root}/regression`].flatMap(base => Object.entries(inventory(base)).filter(([, entry]) => entry.kind === 'file').map(([path, entry]) => [resolve(base, path), entry.sha256])));
const record = (name, value) => writeFileSync(`${root}/records/${name}.json`, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const run = async (name, override, statuses) => {
  const config = { authorization: route.authorization, binding, route, mode: 'source', consumer: client, packageRoot: source, compiler: `${tools}/typescript/lib/typescript.js`, allowed, resultPath: `${root}/records/${name}-result.json`, ...override };
  const configPath = `${root}/records/${name}-config.json`; writeFileSync(configPath, JSON.stringify(config));
  const capture = await child(`${tools}/node/node`, [`${client}/entry.mjs`, configPath], { cwd: client, env: { PATH: `${tools}/node`, HOME: root, TMPDIR: root, CD_REVIEW_CONFIG_SHA256: sha(readFileSync(configPath)) } });
  record(`${name}-child`, capture); assert(capture.naturalSettlement && capture.cleanupClean && !capture.groupStillPresent); assert(statuses.includes(capture.status));
  assert.deepEqual(inventory(source), sourceBefore); assert.deepEqual(inventory(client), clientBefore); assert.deepEqual(inventory(tools), toolsBefore); assert.deepEqual(inventory(`${root}/regression`), regressionBefore); controls();
  return { capture, result: JSON.parse(readFileSync(config.resultPath)) };
};
const originalPublic = JSON.parse(readFileSync(`${directory}/attempt-02/records/source-cases-result.json`));
const mutants = [];
for (const mutation of expectedControl.mutations) {
  const positive = originalPublic.results.find(row => row.id === mutation.case); assert(positive.status.startsWith('public-pass') && positive.cleanup === 'clean');
  const { capture, result } = await run(mutation.name, { mutation, only: [mutation.case] }, [1]);
  assert.equal(result.results.length, 1); assert.equal(result.results[0].status, 'assertion-failure'); assert.equal(result.results[0].cleanup, 'clean'); assert.equal(result.stopped, false);
  const runtimeLoad = result.loaded.find(entry => entry.path === `${source}/src/shell/runtime.ts`); assert.equal(runtimeLoad.variantSha256, mutation.sha256); assert.equal(runtimeLoad.sha256, binding.runtime.sha256);
  mutants.push({ name: mutation.name, case: mutation.case, passingWitness: 'attempt-02 source public result', status: 'semantic-mutant-killed', captureStatus: capture.status, loadedRuntime: runtimeLoad, assertion: result.results[0].assertionFailure });
}
const regressionResult = await run('F07-regression', { regression, regressionAlias: `${root}/regression` }, [0]);
for (const [label, expected] of [['tests', 20], ['pass', 20], ['fail', 0], ['cancelled', 0], ['skipped', 0], ['todo', 0]]) {
  const match = regressionResult.capture.stdout.match(new RegExp(`^# ${label} (\\d+)$`, 'mu')); assert(match, `missing test summary ${label}`); assert.equal(Number(match[1]), expected);
}
record('SUMMARY', { mutants, regression: { ...expectedControl.regression, tests: 20, pass: 20, fail: 0, skipped: 0, cancelled: 0, todo: 0, loaded: regressionResult.result.loaded }, privateHelperExecutions: 0, nativeRuns: 0, serviceRuns: 0, sourceBefore, sourceAfter: inventory(source), toolsBefore, toolsAfter: inventory(tools), consumerBefore: clientBefore, consumerAfter: inventory(client) });
console.log(JSON.stringify({ mutants: mutants.length, killed: mutants.length, regression: '20/20', privateHelperFixtures: 0, nativeRuns: 0, serviceRuns: 0 }));
