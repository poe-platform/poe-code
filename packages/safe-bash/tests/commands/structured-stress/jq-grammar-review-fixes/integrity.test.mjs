import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { digest, snapshot } from './common.mjs';

const read = name => JSON.parse(readFileSync(new URL(`${name}.json`, import.meta.url)));

test('frozen source, old evidence and canonical assertions retain recorded hashes', () => {
  const audit = read('audit');
  assert.equal(snapshot().structuredSha256, audit.finalStructuredSha256);
  for (const [path, hash] of Object.entries({ ...audit.unchangedReviewer, ...audit.historicalFiles, ...audit.canonical })) assert.equal(digest(readFileSync(path)), hash, path);
});

test('before failures and after exact denominators are retained separately', () => {
  for (const mode of ['source', 'compiled']) {
    const before = read(`before-${mode}-cohorts`).summary;
    const after = read(`after-${mode}-cohorts`).summary;
    assert.equal(before.main.pass, 790);
    assert.equal(after.main.pass, 790);
    assert.equal(before.legacy.pass, 376);
    assert.equal(after.legacy.pass, 376);
    assert.deepEqual([before.grammar.pass, before.grammar.executions], [174, 178]);
    assert.deepEqual([after.grammar.pass, after.grammar.executions], [178, 178]);
    assert.equal(read(`before-focused-${mode}`).summary.reviewer.pass, 12);
    assert.equal(read(`after-focused-${mode}`).summary.reviewer.pass, 16);
    assert.equal(read(`after-focused-${mode}`).summary.neighbors.pass, 16);
    assert.equal(read(`after-host-${mode}`).rows.length, 16);
  }
  assert.deepEqual(read('broad-unchanged').counts, { tests: 1580, pass: 1550, fail: 30, cancelled: 0, skipped: 0, todo: 0 });
  assert.equal(read('author-new').counts.pass, 2157);
});

test('owned evidence seal matches without rewriting any artifact', () => {
  const lines = readFileSync(new URL('MANIFEST.sha256', import.meta.url), 'utf8').trimEnd().split('\n');
  for (const line of lines) {
    const [hash, name] = line.split(/\s+/u);
    assert.equal(digest(readFileSync(new URL(name, import.meta.url))), hash, name);
  }
});
