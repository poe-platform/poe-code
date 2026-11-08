import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url));
const capture = join(own, process.argv[2] ?? 'capture-01');
const output = join(capture, 'semantic-assertions.json'); assert(!existsSync(output));
const native = JSON.parse(readFileSync(join(capture, 'author-pandoc.json'))).native;
const rows = [];
const parse = name => JSON.parse(readFileSync(join(capture, 'comparative/parse-' + name + '.stdout')));
const collect = (tree, type) => {
  const result = [];
  function visit(value) { if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') { if (value.t === type) result.push(value); Object.values(value).forEach(visit); } }
  visit(tree); return result;
};
const check = (id, assertion) => { try { assertion(); rows.push({ id, outcome: 'PASS' }); } catch (error) { rows.push({ id, outcome: 'FAIL', error: error.stack }); } };
for (const name of ['R01-ordered-period-text', 'R02-ordered-paren-text']) check(name + '-semantics', () => assert.equal(collect(parse(name), 'OrderedList').length, 0, 'plain paragraph must not become list'));
check('R03-strike-text-semantics', () => assert.equal(collect(parse('R03-strike-text'), 'Strikeout').length, 0, 'plain text must not become strikethrough in the declared extension profile'));
check('R06-adjacent-emphasis-semantics', () => assert.equal(collect(parse('R06-adjacent-emphasis'), 'Str').map(node => node.c).join(''), 'ab', 'no literal marker insertion'));
check('U-title-alt-injection-v2-semantics', () => {
  const tree = parse('title-alt'); assert.equal(collect(tree, 'RawInline').length + collect(tree, 'RawBlock').length, 0);
  assert.deepEqual([...collect(tree, 'Link'), ...collect(tree, 'Image')].map(node => node.c[2]), [['https://safe.test', ''], ['https://safe.test/i', '']]);
});
writeFileSync(output, JSON.stringify({ native, meaning: 'Independent semantic assertions using authenticated Pandoc CommonMark-extension reader; not all-renderer/security equivalence', rows }, null, 2) + '\n');
console.log(JSON.stringify({ total: rows.length, pass: rows.filter(row => row.outcome === 'PASS').length, fail: rows.filter(row => row.outcome === 'FAIL').length }));
