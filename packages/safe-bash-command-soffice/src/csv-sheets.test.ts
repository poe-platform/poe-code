import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSofficeBudget, parseCsvExportOptions, planCsvSheetExports, SofficeError } from './index.js';

const limits = { argumentBytes: 4096, files: 20, inputBytes: 4096, retainedBytes: 4096, outputBytes: 4096, nodes: 100, pages: 10, work: 10000 };
const request = { sheetNames: ['One', 'Two', 'Three'], currentSheet: 1, selector: 0, directory: '/dst', stem: 'book', extension: 'csv' };
const failure = (code: string) => (error: unknown) => error instanceof SofficeError && error.code === code;

test('current sheet uses base name; explicit and all selections use sheet names in order', () => {
  const budget = createSofficeBudget(limits, new AbortController().signal);
  try {
    assert.deepEqual(planCsvSheetExports(request, budget), [{ sheetIndex: 1, path: '/dst/book.csv' }]);
    assert.deepEqual(planCsvSheetExports({ ...request, selector: 2 }, budget), [{ sheetIndex: 1, path: '/dst/book-Two.csv' }]);
    assert.deepEqual(planCsvSheetExports({ ...request, selector: -1 }, budget), [
      { sheetIndex: 0, path: '/dst/book-One.csv' }, { sheetIndex: 1, path: '/dst/book-Two.csv' }, { sheetIndex: 2, path: '/dst/book-Three.csv' }
    ]);
  } finally { budget.close(); }
});
test('invalid and out-of-range selectors never fabricate empty exports', () => {
  const budget = createSofficeBudget(limits, new AbortController().signal);
  try {
    for (const selector of [-23, -2, 4, 1.5, NaN]) assert.throws(() => planCsvSheetExports({ ...request, selector }, budget), failure('invalid-argument'));
    assert.throws(() => planCsvSheetExports({ ...request, sheetNames: [] }, budget), failure('invalid-argument'));
    assert.throws(() => planCsvSheetExports({ ...request, currentSheet: 3 }, budget), failure('invalid-argument'));
    assert.equal(budget.used('retainedBytes'), 0);
  } finally { budget.close(); }
});
test('paths and duplicate destinations are rejected before any publication', () => {
  const budget = createSofficeBudget(limits, new AbortController().signal);
  try {
    for (const name of ['../escape', 'a/b', 'a\\b', 'a\0b', '\ud800', '']) {
      assert.throws(() => planCsvSheetExports({ ...request, selector: -1, sheetNames: ['Good', name] }, budget), failure('invalid-argument'));
      assert.equal(budget.used('retainedBytes'), 0);
    }
    assert.throws(() => planCsvSheetExports({ ...request, selector: -1, sheetNames: ['Same', 'Same'] }, budget), failure('invalid-argument'));
    for (const directory of ['relative', '/dst/../other', '/dst//other', '/dst/']) assert.throws(() => planCsvSheetExports({ ...request, directory }, budget), failure('invalid-argument'));
    assert.equal(budget.used('retainedBytes'), 0);
    assert.deepEqual(planCsvSheetExports({ ...request, selector: 1, sheetNames: ['café:;|'], directory: '/' }, budget), [{ sheetIndex: 0, path: '/book-café:;|.csv' }]);
  } finally { budget.close(); }
});
test('retention, node and work limits roll back retention and cancellation stops planning', () => {
  for (const override of [{ retainedBytes: 1 }, { retainedBytes: 34 }, { nodes: 1 }, { work: 1 }]) {
    const budget = createSofficeBudget({ ...limits, ...override }, new AbortController().signal);
    try {
      assert.throws(() => planCsvSheetExports({ ...request, selector: -1 }, budget), failure('limit'));
      assert.equal(budget.used('retainedBytes'), 0);
    } finally { budget.close(); }
  }
  const controller = new AbortController();
  const budget = createSofficeBudget(limits, controller.signal);
  controller.abort();
  assert.throws(() => planCsvSheetExports(request, budget), failure('cancelled'));
  budget.close();
  assert.throws(() => planCsvSheetExports(request, budget), failure('closed'));
});

test('parsed twelfth-token selection feeds preflight with exact path retention accounting', () => {
  const budget = createSofficeBudget(limits, new AbortController().signal);
  try {
    const options = parseCsvExportOptions('44,34,76,1,,0,false,true,false,false,false,-1,true,false,0', budget);
    const parserRetained = budget.used('retainedBytes');
    const targets = planCsvSheetExports({ ...request, selector: options.sheet }, budget);
    assert.equal(budget.used('retainedBytes') - parserRetained, targets.reduce((total, target) => total + 2 * target.path.length, 0));
    assert.equal(budget.used('nodes'), 3);
    for (const resource of ['inputBytes', 'outputBytes', 'pages'] as const) assert.equal(budget.used(resource), 0);
    const retained = budget.used('retainedBytes');
    assert.throws(() => planCsvSheetExports({ ...request, selector: -1, sheetNames: ['One', '../escape'] }, budget), failure('invalid-argument'));
    assert.equal(budget.used('retainedBytes'), retained);
  } finally { budget.close(); }
});
