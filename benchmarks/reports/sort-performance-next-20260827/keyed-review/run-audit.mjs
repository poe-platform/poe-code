import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { acceptedIndependentCommit } from './holdouts.mjs';
import { holdoutsV2 } from './holdouts-v2.mjs';
import { caps } from './bind-caps.mjs';
import { instrument } from './instrument.mjs';
import { authenticate, childRun, consumerCopy, directory, git, hash, inventory, json, repo } from './harness.mjs';

const compiler = createRequire(import.meta.url)(join(repo, 'node_modules/typescript'));
const priorPath = 'benchmarks/reports/sort-performance-next-20260827/workloads.json';
const priorBytes = git(acceptedIndependentCommit, priorPath);
export const diagnosed = JSON.parse(priorBytes).specimens.filter(row => ['numeric-key-8000', 'numeric-stable-8000'].includes(row.id)).map(row => ({ id: row.id, script: row.script, input: row.stdin, expected: row.expected }));
export const auditRows = [...holdoutsV2(), ...caps(), ...diagnosed];
const excluded = new Set(['local-replaces-global-numeric', 'whitespace-blanks-transform', 'guard-multiple-keys', 'guard-nonnumeric-local', 'guard-numeric-fold-transform', 'guard-check-disorder', 'numeric-stable-8000']);

export function auditFailures(results, candidate = true) {
  const failures = [];
  const require = (condition, id, rule) => { if (!condition) failures.push({ id, rule }); };
  for (const row of results) {
    const count = row.counters;
    require(count !== null, row.id, 'instrumentation loaded');
    if (!candidate) { require(!count.keyedConstructions, row.id, 'baseline has no keyed cache'); continue; }
    const eligible = !excluded.has(row.id);
    require((count.keyedConstructions ?? 0) === Number(eligible), row.id, 'exact guard construction');
    if (!eligible) require(!count.keyedAdmissions, row.id, 'excluded guard admission');
    require((count.entriesPeak ?? 0) <= 16384, row.id, 'entry cap');
    require((count.retainedPeak ?? 0) <= 1048576, row.id, 'retained cap');
    require((count.charged ?? 0) === (count.independentBackingCharge ?? 0), row.id, 'full selected backing charge');
    require(!count.unexpectedDescriptor, row.id, 'descriptor owns only strings/boolean');
    if (['entry-above', 'fallback-mid-sort-stable-ties', 'empty-keys-entry-cap'].includes(row.id)) {
      require(count.entriesPeak === 16384, row.id, 'entry saturation reached');
      require(count.entryFallback > 0, row.id, 'entry uncached fallback exercised');
    }
    if (row.id === 'entry-below') require(count.keyedAdmissions === 16383 && !count.fallback, row.id, 'entry below');
    if (row.id === 'entry-at') require(count.keyedAdmissions === 16384 && !count.fallback, row.id, 'entry at');
    if (row.id === 'retained-below') require(count.retainedPeak === 1048570 && !count.fallback, row.id, 'retained below');
    if (row.id === 'retained-at') require(count.retainedPeak === 1048576 && !count.fallback, row.id, 'retained at');
    if (['retained-above', 'oversized-extracted-small-prefix'].includes(row.id)) require(count.byteFallback > 0, row.id, 'byte fallback exercised');
    if (row.id === 'oversized-record-small-key') require(count.keyedAdmissions === 3 && count.retainedPeak === 24 && count.existingRecordBytes > 170000, row.id, 'whole-record owned separately, selected strings only');
    if (row.id === 'numeric-key-8000') require(count.keyedAdmissions === 8000 && count.parses === 8000 && count.extractions === 8000 && count.fieldObjects === 24000, row.id, 'one preparation per owned record');
  }
  return failures;
}

export async function runInstrumented(prepared, label, original, mutate, rows = auditRows, worker = 'public-worker.mjs') {
  const root = consumerCopy(prepared, label);
  const evidence = join(directory, label); mkdirSync(evidence);
  const instrumented = instrument(original);
  const final = mutate ? mutate(instrumented) : instrumented;
  const output = compiler.transpileModule(final, { fileName: 'text.ts', compilerOptions: { target: compiler.ScriptTarget.ES2023, module: compiler.ModuleKind.ES2022, sourceMap: false } }).outputText;
  writeFileSync(join(root, 'node_modules/virtual-bash/dist/commands/text.js'), output);
  writeFileSync(join(evidence, 'instrumented-source.ts.txt'), final, { flag: 'wx' });
  json(join(root, 'cases.json'), rows);
  for (const file of ['public-worker.mjs', 'loaded-worker.mjs']) copyFileSync(join(directory, file), join(root, file));
  if (worker !== 'public-worker.mjs') copyFileSync(join(directory, worker), join(root, 'public-worker.mjs'));
  json(join(root, 'module-manifest.json'), inventory(root));
  const child = await childRun(root, ['--test', '--test-reporter=tap', 'loaded-worker.mjs'], join(evidence, 'audit'));
  for (const file of ['results.json', 'loaded-proof.json']) copyFileSync(join(root, file), join(evidence, file));
  const results = JSON.parse(readFileSync(join(root, 'results.json')));
  const counters = auditFailures(results, prepared.commit !== '08a26051438f5c6bdde100a4fe724dbb84f6fca4');
  const metadata = { commit: prepared.commit, sourceSha256: hash(original), instrumentedSha256: hash(final), emittedSha256: hash(output), recipeSource: { commit: acceptedIndependentCommit, path: priorPath, sha256: hash(priorBytes) }, casesSha256: hash(JSON.stringify(rows)), child, counterFailures: counters, ...authenticate(prepared), instrumentationOnly: true, timingClaims: false };
  json(join(evidence, 'metadata.json'), metadata);
  return { results, metadata };
}

if (process.argv[1].endsWith('/run-audit.mjs')) {
  const baseline = JSON.parse(readFileSync(join(directory, 'baseline-attempt1/prepared.json')));
  const candidate = JSON.parse(readFileSync(join(directory, 'candidate-preparation/prepared.json')));
  const before = await runInstrumented(baseline, 'baseline-audit', git(baseline.commit, 'src/commands/text.ts').toString());
  const after = await runInstrumented(candidate, 'candidate-audit', git(candidate.commit, 'src/commands/text.ts').toString());
  const equivalence = before.results.map((row, index) => {
    const next = after.results[index];
    assert.equal(row.id, next.id);
    assert.deepEqual(row.actual, next.actual);
    assert.deepEqual(row.stdout, next.stdout);
    assert.equal(row.counters.sortComparisons, next.counters.sortComparisons);
    assert.equal(row.counters.numericComparisons, next.counters.numericComparisons);
    return { id: row.id, sameBytesEffectsAndComparisons: true, baseline: row.counters, candidate: next.counters };
  });
  json(join(directory, 'operation-comparison.json'), equivalence);
  assert.equal(before.metadata.child.failed, 0);
  assert.equal(after.metadata.child.failed, 0);
  assert.deepEqual(after.metadata.counterFailures, []);
  console.log(JSON.stringify({ baseline: before.metadata.child, candidate: after.metadata.child, counterFailures: after.metadata.counterFailures, diagnosed: equivalence.filter(row => row.id.includes('8000')) }));
}
