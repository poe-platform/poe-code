import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const destination = 'benchmarks/reports/comparison-fairness-20260827/audit';
const expanded = 'benchmarks/reports/expanded-20260827';
const breadth = 'benchmarks/reports/baseline-only-20260827';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = filename => JSON.parse(fs.readFileSync(filename));
const gitBytes = (revision, filename) => execFileSync('git', ['show', `${revision}:${filename}`], { maxBuffer: 32 * 1024 * 1024 });
const checks = [];
const check = (label, condition, detail = null) => { checks.push({ label, pass: Boolean(condition), detail }); assert.ok(condition, label); };
const report = read(`${expanded}/corrected-bd2cacb/report.json`);
const functional = read(`${expanded}/corrected-bd2cacb/functional.json`);
const oldGold = read(`${expanded}/native-corrected/native.json`);
const newGold = read(`${expanded}/native-scratch-aligned/native.json`);
const inputs = read(`${breadth}/coverage-execution/attempt-002/execution-inputs.json`);
const review = read(`${breadth}/coverage-review/measured/review-matrix.json`);
const author = read(`${breadth}/coverage-execution/attempt-002/results.json`);
const manifest = read(`${breadth}/coverage-execution/attempt-002/manifest.json`);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const fields = ['stdout', 'stderr', 'exitCode', 'entries'];
check('224 unique functional IDs', functional.length === 224 && new Set(functional.map(row => row.id)).size === 224);
const expandedTotals = {};
for (const engine of ['virtual-bash', 'just-bash']) {
  const passing = functional.filter(row => fields.every(field => same(row.expected[field], row[engine].observation[field])));
  expandedTotals[engine] = { total: functional.length, pass: passing.length, fail: functional.length - passing.length };
  check(`${engine} recomputed historical score`, passing.length === report.totals[engine].pass && functional.every(row => row[engine].status === (fields.every(field => same(row.expected[field], row[engine].observation[field])) ? 'pass' : 'fail')));
}
check('all product sources match historical git archive', Object.entries(report.sourceHashes).every(([filename, digest]) => hash(gitBytes(report.revision, filename)) === digest), { files: Object.keys(report.sourceHashes).length });
check('all historical harness hashes match claimed git revision', Object.entries(report.harnessHashes).every(([filename, digest]) => hash(gitBytes(report.harnessRevision, `benchmarks/expanded/${filename}`)) === digest));
const changedNative = [];
for (const [gold, revision, filename] of [[oldGold, report.harnessRevision, `${expanded}/native-corrected/native.json`], [newGold, 'd1b10a3', `${expanded}/native-scratch-aligned/native.json`]]) {
  check(`capture sources match frozen ${revision}`, Object.entries(gold.sourceHashes).every(([name, digest]) => hash(gitBytes(revision, `benchmarks/expanded/${name}`)) === digest));
  check(`capture remains immutable ${filename}`, hash(fs.readFileSync(filename)) === hash(gitBytes(gold === oldGold ? '8e09db9' : 'd1b10a3', filename)));
  check(`capture has 228 unique valid observations ${revision}`, gold.observations.length === 228 && new Set(gold.observations.map(row => row.id)).size === 228 && gold.observations.every(row => row.oracleValid) && gold.invalidCount === 0);
  check(`recipe hashes ${revision}`, [...gold.recipes, ...gold.performanceRecipes].every(recipe => gold.observations.find(row => row.id === recipe.id)?.recipeHash === hash(JSON.stringify(recipe))));
}
check('scratch profiles preserve every recipe', same(oldGold.recipes, newGold.recipes) && same(oldGold.performanceRecipes, newGold.performanceRecipes));
assert.deepEqual(oldGold.toolIdentities, newGold.toolIdentities);
for (const current of newGold.observations) {
  const old = oldGold.observations.find(row => row.id === current.id);
  assert.ok(['recipeHash', 'stdout', 'stderr', 'exitCode'].every(field => same(old[field], current[field])));
  if (!same(old.entries, current.entries)) changedNative.push(current.id);
}
check('exact one-row native effects delta', same(changedNative, ['command/patch/dry-run']));
const oldDry = oldGold.observations.find(row => row.id === changedNative[0]);
const newDry = newGold.observations.find(row => row.id === changedNative[0]);
const { tmp, ...withoutTmp } = oldDry.entries;
check('only dry-run empty tmp removed', same(tmp, { type: 'directory' }) && same(withoutTmp, newDry.entries));
const performanceRows = read(`${expanded}/corrected-bd2cacb/performance.json`);
const timing = performanceRows.map(row => {
  for (const trial of row.trials) assert.ok(fields.every(field => same(oldGold.observations.find(observation => observation.id === row.id)[field], trial.observation[field])));
  const medians = Object.fromEntries(['virtual-bash', 'just-bash'].map(engine => {
    const times = row.trials.filter(trial => trial.engine === engine).map(trial => trial.observation.executeMs).sort((left, right) => left - right);
    if (times.length) assert.equal(times[2], row.summary[engine].executeMs.median);
    return [engine, { count: times.length, medianMs: times.length ? times[2] : null }];
  }));
  return { id: row.id, eligible: row.eligible, trials: row.trials.length, medians, eligibility: Object.fromEntries(Object.entries(row.eligibility).map(([engine, value]) => [engine, value.status])) };
});
check('30 equivalent measured trials across three eligible workloads', timing.reduce((total, row) => total + row.trials, 0) === 30 && timing.filter(row => row.eligible).length === 3);
const stable = entry => ({ path: entry.path, type: entry.type, ...(entry.mode === undefined ? {} : { mode: entry.mode & 4095 }), ...(entry.base64 === undefined ? {} : { base64: entry.base64 }), ...(entry.target === undefined ? {} : { target: entry.target }) });
function predicate(recipe, capture) {
  const observation = capture.report;
  if (!observation?.result || observation.captureErrors.length || observation.executionError || !observation.before.complete || !observation.after.complete) return false;
  const expected = recipe.expected;
  if (!expected) return null;
  const result = observation.result;
  const after = new Map(observation.after.entries.map(entry => [entry.path, entry]));
  const valid = [result.exitCode === expected.exitCode];
  for (const key of ['stdoutBase64', 'stderrBase64']) if (key in expected) valid.push(result[key] === expected[key]);
  for (const value of expected.stdoutIncludes ?? []) valid.push(result.stdout.includes(value));
  for (const value of expected.stdoutExcludes ?? []) valid.push(!result.stdout.includes(value));
  if (expected.elapsedAtLeastMs !== undefined) valid.push(observation.productElapsedMs >= expected.elapsedAtLeastMs);
  for (const [filename, requirement] of Object.entries(expected.files)) {
    const entry = after.get(`/fixture/${filename}`), bytes = Buffer.from(entry?.base64 ?? '', 'base64');
    valid.push(entry?.type === 'file');
    if (requirement.base64 !== undefined) valid.push(entry?.base64 === requirement.base64);
    if (requirement.prefixBase64 !== undefined) valid.push(bytes.subarray(0, Buffer.from(requirement.prefixBase64, 'base64').length).toString('base64') === requirement.prefixBase64);
    if (requirement.minBytes !== undefined) valid.push(bytes.length >= requirement.minBytes);
    for (const value of requirement.includes ?? []) valid.push(bytes.includes(Buffer.from(value)));
  }
  for (const filename of expected.absent) valid.push(!after.has(`/fixture/${filename}`));
  if (expected.preserveInputs) for (const entry of observation.before.entries.filter(entry => entry.path.startsWith('/fixture/') || entry.path.startsWith('/tmp/'))) valid.push(after.has(entry.path) && same(stable(entry), stable(after.get(entry.path))));
  for (const [filename, fixture] of Object.entries(recipe.files)) {
    const initial = observation.before.entries.find(entry => entry.path === `/fixture/${filename}`);
    valid.push(initial?.base64 === fixture.base64);
    if (fixture.mode !== undefined) valid.push((initial?.mode & 4095) === fixture.mode);
  }
  for (const [filename, target] of Object.entries(recipe.symlinks)) {
    const initial = observation.before.entries.find(entry => entry.path === `/fixture/${filename}`);
    valid.push(initial?.type === 'symlink' && initial.target === target);
  }
  return valid.every(Boolean);
}
const target = recipe => ['historical-unmeasured', 'additional-optional'].includes(recipe.cohort);
const rows = [];
for (const recipe of [...inputs.cases, ...inputs.diagnostics]) for (const engine of ['ours', 'baseline']) {
  const recorded = [...author.observations, ...author.diagnosticObservations].find(row => row.id === recipe.id);
  const rawPath = recorded.rawPaths?.[engine] ?? `${breadth}/coverage-execution/attempt-002/raw/${recipe.id}.${engine}.json`;
  const raw = read(rawPath);
  const reviewed = review.observations.find(row => row.id === recipe.id)?.[engine];
  const normal = raw.exitCode === 0 && !raw.signal && !raw.parentTimeout;
  const intent = predicate(recipe, raw);
  if (reviewed) {
    const replay = read(reviewed.raw);
    assert.equal(hash(fs.readFileSync(reviewed.raw)), reviewed.rawSha256);
    assert.deepEqual(replay.report.result, raw.report.result);
    for (const phase of ['before', 'after']) assert.deepEqual(replay.report[phase].entries.map(stable), raw.report[phase].entries.map(stable));
    assert.equal(replay.exitCode, raw.exitCode); assert.equal(replay.signal, raw.signal);
    if (recipe.expected) assert.equal(intent, reviewed.productIntentSatisfied, `${recipe.id}/${engine} predicate`);
  }
  const operational = Boolean(intent && normal && recipe.operationalCredit !== false && !['help', 'wait', 'node'].includes(recipe.name) && recipe.cohort !== 'direct-diagnostic');
  if (reviewed) assert.equal(operational, reviewed.operationalCredit, `${recipe.id}/${engine} credit`);
  rows.push({ id: recipe.id, name: recipe.name, cohort: recipe.cohort, engine, target: target(recipe), intent, normal, operational, status: raw.report.result.exitCode, stderr: raw.report.result.stderr, source: rawPath, reviewerRawCompared: Boolean(reviewed) });
}
check('136 distinct case-engine observations, 61 primary plus seven diagnostics per engine', rows.length === 136 && new Set(rows.map(row => `${row.id}/${row.engine}`)).size === 136 && inputs.cases.length === 61 && inputs.diagnostics.length === 7);
const missing = inputs.cases.filter(target).map(recipe => {
  const candidates = rows.filter(row => row.engine === 'ours' && row.name === recipe.name);
  return { name: recipe.name, primaryId: recipe.id, confirmedBy: candidates.filter(row => row.normal && row.status === 127 && row.stderr.includes(`${recipe.name}: command not found`)).map(row => row.id) };
});
check('54 missing compatible dispatch names reached via primary or direct diagnostic', missing.length === 54 && missing.every(row => row.confirmedBy.length));
const breadthTotals = Object.fromEntries(['ours', 'baseline'].map(engine => [engine, { defaultTargetPositives: rows.filter(row => row.engine === engine && row.cohort === 'historical-unmeasured' && row.operational).length, primaryTargetPositives: rows.filter(row => row.engine === engine && row.target && row.operational).length, allPrimaryPositives: rows.filter(row => row.engine === engine && row.operational).length, normalChildren: rows.filter(row => row.engine === engine && row.normal).length }]));
assert.equal(breadthTotals.baseline.defaultTargetPositives, 45);
assert.equal(breadthTotals.ours.defaultTargetPositives, 0);
check('47 baseline target positives, zero ours; 135 normal children', breadthTotals.baseline.primaryTargetPositives === 47 && breadthTotals.ours.primaryTargetPositives === 0 && rows.filter(row => row.normal).length === 135);
const findings = { auditedAt: new Date().toISOString(), method: 'Static artifact verification only. No product/native recipe execution and no 224 replay.', checks, sourceIdentity: { expandedRevision: report.revision, expandedHarness: report.harnessRevision, breadthSourceSha256: inputs.sourceSha256, breadthSourceCapturedHead: manifest.sourceCapturedHead, breadthManifestHead: manifest.head, breadthSourceIsGitRevision: false }, expandedTotals, correction: { changedNative, oldTmp: tmp, sourceAssertionsMovedToNewCapture: true, historicalSourcesIndependentlyCheckedAgainstHistoricalGit: true }, performance: { runtime: report.runtime, rows: timing }, breadthTotals, missingDispatch: missing, exceptionalChildren: rows.filter(row => !row.normal), baselineTargetNonpositives: rows.filter(row => row.engine === 'baseline' && row.target && !row.operational).map(({ stderr, ...row }) => row), historicalFailingCases: functional.filter(row => row['virtual-bash'].status !== 'pass').map(row => ({ id: row.id, fields: row['virtual-bash'].comparison.assertions.filter(assertion => !assertion.pass).map(assertion => assertion.field), sourceRevision: report.revision, currentStatus: 'not measured by auditor' })) };
const text = JSON.stringify(findings, null, 2);
execFileSync('apply_patch', [`*** Begin Patch\n*** Add File: ${destination}/verification.json\n${text.split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`]);
console.log(JSON.stringify({ checks: checks.length, expandedTotals, breadthTotals, comparedRawRows: rows.filter(row => row.reviewerRawCompared).length, exceptional: rows.filter(row => !row.normal).map(row => `${row.id}/${row.engine}`) }, null, 2));
