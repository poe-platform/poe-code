import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

const corpus = JSON.parse(await readFile(new URL('./corpus.json', import.meta.url), 'utf8'));
test('oracle expectations and fixtures equal the immutable benchmark commit', () => {
  const path = 'benchmarks/reports/expanded-20260827/native-corrected/native.json';
  const bytes = execFileSync('git', ['show', `${corpus.benchmarkCommit}:${path}`], { maxBuffer: 64 * 1024 * 1024 });
  assert.equal(createHash('sha256').update(bytes).digest('hex'), corpus.provenance[path].sha256);
  const native = JSON.parse(bytes.toString());
  for (const entry of corpus.cases) {
    assert.deepEqual(entry.specimen, native.recipes.find((specimen: { id: string }) => specimen.id === entry.specimen.id));
    assert.deepEqual(entry.expected, native.observations.find((observation: { id: string }) => observation.id === entry.specimen.id));
  }
});
test('all seven frozen recipes remain complete and byte-identical', () => {
  assert.deepEqual(corpus.cases.map((entry: { specimen: { id: string } }) => entry.specimen.id), ['type', 'executable-file', 'env-shebang', 'source', 'dot', 'eval', 'parameter'].map(name => `kernel/${name}/${name}`));
  for (const entry of corpus.cases) {
    assert.equal(createHash('sha256').update(JSON.stringify(entry.specimen)).digest('hex'), entry.expected.recipeHash);
    assert.deepEqual(entry.expected, entry.frozen.expected);
    assert.equal(entry.frozen['virtual-bash'].status, 'fail');
    assert.equal(entry.frozen['just-bash'].status, 'pass');
  }
});
test('execution and comparison helpers are unmodified frozen harness copies', async () => {
  for (const name of ['common', 'engine']) {
    const bytes = await readFile(new URL(`./frozen/${name}.mjs`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), corpus.provenance[`benchmarks/expanded/${name}.mjs`].sha256);
  }
});
