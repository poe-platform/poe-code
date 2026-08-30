import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const [flag, beforePath, afterPath, outputPath] = process.argv.slice(2);
assert.equal(flag, '--audit');
assert(beforePath && afterPath && outputPath);
const before = readFileSync(beforePath, 'utf8');
const after = readFileSync(afterPath, 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const diagnostic = "expr: missing operand\nTry 'expr --help' for more information.\n";
async function trace(source) {
  const tests = [], rows = [];
  let active;
  const normalize = value => value && Object.prototype.toString.call(value) === '[object RegExp]' ? { regexp: value.source, flags: value.flags } : value;
  const assertions = Object.fromEntries(['equal', 'match'].map(method => [method, (...args) => active.assertions.push({ method, args: args.map(normalize) })]));
  const modules = {
    'node:assert/strict': assertions,
    'node:test': (name, body) => tests.push({ name, body }),
    './helpers.js': { async run(...args) { active.invocations.push(args); return { exitCode: 2, stdout: '', stderr: diagnostic }; } },
  };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true } }).outputText;
  runInNewContext(compiled, { exports: {}, require(name) { assert(Object.hasOwn(modules, name)); return modules[name]; } });
  for (const test of tests) {
    active = { name: test.name, invocations: [], assertions: [] };
    await test.body();
    rows.push(active);
  }
  return JSON.parse(JSON.stringify(rows));
}
const oldRows = await trace(before), newRows = await trace(after);
assert.equal(oldRows.length, 73);
assert.deepEqual(oldRows.map(row => row.name), newRows.map(row => row.name));
const changes = oldRows.flatMap((row, index) => JSON.stringify(row) === JSON.stringify(newRows[index]) ? [] : [{ before: row, after: newRows[index] }]);
assert.deepEqual(changes.map(change => change.before.name), ['expr invalid []', 'expr invalid ["--"]']);
for (const change of changes) {
  assert.deepEqual(change.before.invocations, change.after.invocations);
  assert.deepEqual(change.before.assertions.slice(0, 2), change.after.assertions.slice(0, 2));
  assert.deepEqual(change.before.assertions[2], { method: 'match', args: [diagnostic, { regexp: '^expr: (syntax error|division by zero|non-integer argument)', flags: 'u' }] });
  assert.deepEqual(change.after.assertions[2], { method: 'equal', args: [diagnostic, diagnostic] });
  assert.equal(change.after.assertions.length, 3);
}
writeFileSync(outputPath, `${JSON.stringify({ classification: 'Structural assertion trace with stubbed run and recording assert; NOT runtime acceptance. Full original/modified bodies preserved separately as .ts.data.', beforePath, afterPath, beforeSha256: hash(before), afterSha256: hash(after), total: 73, unchanged: 71, changed: 2, changes, before: oldRows, after: newRows }, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ total: 73, unchanged: 71, changed: changes.map(change => change.before.name) }));
