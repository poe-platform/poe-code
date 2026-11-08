import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, inventory, read, save, supervised } from '../../html-to-markdown-independent-20260827/fix-review-3ef5811f/common.mjs';

const own = dirname(fileURLToPath(import.meta.url)), state = read(process.argv[2]);
const output = join(state.capture, 'nested-supplement');
assert(!existsSync(output)); mkdirSync(output);
const fixtures = read(join(own, 'NESTED.json')), rows = [];
save(join(output, 'PRE.json'), { revision: state.revision, fixtureSHA256: hash(readFileSync(join(own, 'NESTED.json'))), driverSHA256: hash(readFileSync(new URL(import.meta.url))) });
for (const [layout, root] of [['source', state.output], ['moved', state.moved]]) {
  const before = inventory(root), harness = join(output, layout); mkdirSync(harness);
  for (const name of ['batch.mjs', 'audit-loader.mjs']) cpSync(join(state.capture, 'harness-' + layout, name), join(harness, name));
  save(join(harness, 'cases.json'), fixtures);
  const row = await supervised(harness, 'product', process.execPath, ['--permission', '--allow-fs-read=' + harness, '--allow-fs-read=' + root + '/dist', '--allow-fs-read=' + root + '/package.json', '--import', join(harness, 'audit-loader.mjs'), join(harness, 'batch.mjs'), join(harness, 'cases.json')], { cwd: harness, env: { REVIEW_PACKAGE: root }, inputs: { before }, deadlineMs: 5000 });
  assert.equal(row.outcome, 'PASS');
  for (const load of row.loads) {
    const path = fileURLToPath(load.url);
    assert(path.startsWith(root + '/dist/') || path.startsWith(harness + '/'));
    assert.equal(load.sha256, hash(readFileSync(path)));
  }
  for (const [index, fixture] of fixtures.entries()) {
    const actual = row.result.rows[index];
    const native = await supervised(harness, fixture.id, state.pandoc.path, ['--sandbox', '--from=commonmark+strikeout', '--to=json'], { input: actual.markdown, deadlineMs: 5000 });
    assert.equal(native.outcome, 'PASS');
    rows.push({ layout, ...fixture, actual, ast: read(join(harness, fixture.id + '.stdout')) });
  }
  assert.deepEqual(inventory(root), before);
}
save(join(output, 'RESULT.json'), { rows, inventoriesUnchangedIncludingNewEntries: true });
console.log(JSON.stringify(rows.map(({ layout, id, actual }) => ({ layout, id, outcome: actual.outcome }))));
