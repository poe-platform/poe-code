import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, inventory, read, save, supervised } from '../../html-to-markdown-independent-20260827/fix-review-3ef5811f/common.mjs';

const own = dirname(fileURLToPath(import.meta.url)), repo = resolve(own, '../../../..');
const build = join(repo, 'src/commands/html-to-markdown/node_modules/development/dist');
const output = join(repo, 'src/commands/html-to-markdown/node_modules/development/verify'); mkdirSync(output);
const pandoc = '/opt/homebrew/bin/pandoc';
assert.equal(hash(readFileSync(pandoc)), '61574e53a089110eae07817b91510ff150e826807ac020aa744e0ade23025e0d');
const before = inventory(build), rows = [], ast = [];
const specification = { scope: 'unfrozen development module closure; not committed candidate acceptance', before, driver: hash(readFileSync(new URL(import.meta.url))), pandoc: hash(readFileSync(pandoc)) };
save(join(output, 'PRE.json'), specification);
async function product(job) {
  const row = await supervised(output, job.id, process.execPath, [join(own, '../fix-review/worker.mjs'), build, JSON.stringify(job)], { deadlineMs: 5000, inputs: specification });
  rows.push(row); assert.equal(row.outcome, 'PASS'); assert.equal(row.result.loadedEntrySHA256, before['commands/html-to-markdown/index.js']);
  return row.result;
}
try {
  for (const form of ['unterminated-quoted-attribute', 'repeated-less-than', 'rawtext-close-near-miss', 'long-entity', 'alternating-backticks', 'trim-internal-space', 'unresolved-entity-regex']) for (const size of [8192, 32768, 131072, 524288]) await product({ id: form + '-' + size, form, size });
  for (const size of [32768, 131072, 524288]) await product({ id: 'slash-' + size, form: 'slash-attribute-neighbor', size });
  for (const abort of [100, 'immediate']) await product({ id: 'abort-' + abort, form: 'trim-internal-space', size: 131072, abort, limits: {} });
  for (const entry of read(join(own, '../fix-review/semantics.json'))) {
    const actual = await product({ id: entry.id, input: entry.html, returnOutput: true });
    const native = await supervised(output, entry.id + '-ast', pandoc, ['--sandbox', '--from=commonmark+strikeout', '--to=json'], { input: actual.output, deadlineMs: 5000 });
    assert.equal(native.outcome, 'PASS');
    const tree = read(join(output, entry.id + '-ast.stdout')), observed = [];
    function visit(nodes, styles = []) {
      for (const node of nodes) {
        if (['Para', 'Plain'].includes(node.t)) visit(node.c, styles);
        else if (['Emph', 'Strong', 'Strikeout'].includes(node.t)) visit(node.c, [...styles, node.t]);
        else if (node.t === 'Str') for (const character of node.c) observed.push([character, styles]);
        else if (node.t === 'Space' || node.t === 'SoftBreak') observed.push([' ', styles]);
        else assert.fail('unexpected structure ' + node.t);
      }
    }
    visit(tree.blocks);
    assert.deepEqual(observed, entry.runs.flatMap(([text, styles]) => [...text].map(character => [character, styles])));
    ast.push({ ...entry, markdown: actual.output, observed, outcome: 'PASS' });
  }
  assert.deepEqual(inventory(build), before);
} catch (error) { specification.error = error.stack; process.exitCode = 1; }
finally { save(join(output, 'RESULT.json'), { ...specification, rows, ast }); console.log(JSON.stringify({ output, productChildren: rows.length, ast: ast.length, error: specification.error })); }
