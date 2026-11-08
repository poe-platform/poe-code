import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const commit = '1b2ddea9e38b25cc91134a2f35a318e27f4d7c29';
const name = process.argv[3];
assert(process.argv[2] === '--capture' && /^[a-z0-9-]+$/u.test(name ?? ''), 'Usage: audit-canonical.mjs --capture UNIQUE-NAME');
const output = join(owned, name);
assert(!existsSync(output), 'refuse overwrite');
mkdirSync(output);
function git(...args) {
  const result = spawnSync('git', args, { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}
const paths = git('ls-tree', '-r', '--name-only', commit, '--', 'tests/commands/expr').toString().trim().split('\n');
const tests = paths.filter(filename => filename.endsWith('.test.ts'));
const fixtures = ['tests/commands/expr/diagnostics/cases.ts', 'tests/commands/expr/regex-cases.ts', 'tests/commands/expr/native-cases.ts'];
const files = [...tests, ...fixtures].map(filename => {
  const bytes = git('show', `${commit}:${filename}`);
  const text = bytes.toString();
  return {
    filename, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    observationLines: text.split('\n').flatMap((line, index) => /parse|syntax|grammar|jobs|requests|workers\.length|checkpoints/iu.test(line) ? [{ line: index + 1, text: line }] : []),
  };
});
const excerpts = [
  ['tests/commands/expr/diagnostics-regression.test.ts', 39, 52],
  ['tests/commands/expr/diagnostics/cases.ts', 8, 75],
  ['tests/commands/expr/regex-lifecycle.test.ts', 67, 76],
  ['tests/commands/expr/inactive-prefix.test.ts', 97, 114],
  ['tests/commands/expr/inactive-prefix.test.ts', 144, 209],
  ['tests/commands/expr/grammar.test.ts', 47, 59],
].map(([filename, start, end]) => ({ filename, start, end, text: git('show', `${commit}:${filename}`).toString().split('\n').slice(start - 1, end).join('\n') }));
writeFileSync(join(output, 'inventory-and-excerpts.json'), `${JSON.stringify({ commit, canonicalFileCount: tests.length, fixtureFileCount: fixtures.length, files, excerpts, method: 'Historical committed canonical expr tests only. Static assertion/input inspection, not execution or candidate acceptance. No postfreeze parser source or author implementation imported.' }, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ commit, canonicalFileCount: tests.length, fixtureFileCount: fixtures.length }));
