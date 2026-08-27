import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { frozenPreparation, snapshot } from './common.mjs';
import { loadFrozen } from '../jq-grammar-independent/evidence.mjs';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url)));
test('preparation, historical evidence and structured handoff remain immutable', () => {
  frozenPreparation();
  const evidence = loadFrozen();
  assert.deepEqual(evidence.counts, { grammar: { vectors: 35, executions: 178 }, main: { vectors: 256, executions: 790 }, legacy: { vectors: 94, executions: 376 } });
  snapshot();
});
test('both whole cohort reports retain every failure and exact denominator', () => {
  for (const mode of ['source', 'compiled']) {
    const report = read(`${mode}-cohorts.json`);
    assert.equal(report.results.length, 1344);
    assert.deepEqual(report.summary.main, { vectors: 256, vectorsPassingAll: 256, executions: 790, pass: 790, fail: 0 });
    assert.deepEqual(report.summary.legacy, { vectors: 94, vectorsPassingAll: 94, executions: 376, pass: 376, fail: 0 });
    assert.deepEqual(report.summary.grammar, { vectors: 35, vectorsPassingAll: 34, executions: 178, pass: 174, fail: 4 });
    assert.equal(report.summary.original42IncludedInMain.executions, 84);
    assert.ok(report.results.filter(row => !row.pass).every(row => row.id === 'nonfinite-type-copy-predicates' && row.actual.status === 3));
    for (const row of report.results) for (const tuple of [row.expected, row.actual]) {
      assert.match(tuple.stdoutHex, /^(?:[a-f0-9]{2})*$/u);
      assert.match(tuple.stderrHex, /^(?:[a-f0-9]{2})*$/u);
    }
  }
});
test('new alias-order failure is preserved, not converted into native success', () => {
  for (const mode of ['source', 'compiled']) {
    const report = read(`alias-order-${mode}.json`);
    assert.deepEqual(report.summary, { vectors: 1, vectorsPassingAll: 0, executions: 4, pass: 0, fail: 4 });
    assert.ok(report.rows.every(row => row.differingFields.join() === 'stdoutHex' && row.effectsMatch));
    assert.equal(read(`focused-${mode}.json`).summary.pass, 12);
  }
});
test('historical baseline and host compatibility remain separately reported', () => {
  const review = read('review.json');
  assert.deepEqual(Object.values(review.priorLegacy.categories).map(ids => ids.length), [45, 43, 6]);
  for (const mode of ['source', 'compiled']) assert.equal(review.legacyDiagnosticsNow[mode].rows.filter(row => row.pass).length, 172);
  assert.equal(review.host.rows.length, 8);
  assert.equal(review.wholeProductEstablished, false);
  assert.match(review.verdict, /^NOT ACCEPTED/u);
  for (let repetition = 1; repetition <= 3; repetition++) {
    assert.equal(read(`seven-boundaries-${repetition}.json`).counts.pass, 7);
    assert.equal(read(`safety-${repetition}.json`).counts.fail, 1);
  }
});
test('emitted-root cohort records build provenance and loaded output modules', () => {
  const report = read('compiled-cohorts.json');
  assert.equal(report.build.diagnostics, '');
  assert.equal(report.build.emittedFiles, 520);
  assert.equal(report.build.loaded.length, 130);
  assert.ok(report.build.loaded.includes('index.js'));
  assert.ok(report.build.loaded.includes('commands/structured/jq.js'));
  assert.equal(report.stableProduct, true);
  assert.equal(report.stableTooling, true);
});
