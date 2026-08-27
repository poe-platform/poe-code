import assert from 'node:assert/strict';
import * as host from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const baseline = JSON.parse(await host.readFile(join(owned, 'baseline/before.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const testBodies = (path, source) => {
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return new Map(parsed.statements.flatMap(statement => {
    let terminal = statement;
    let cases = 1;
    while (ts.isForOfStatement(terminal)) {
      let values = terminal.expression;
      if (ts.isAsExpression(values)) values = values.expression;
      assert.ok(ts.isArrayLiteralExpression(values), path);
      cases *= values.elements.length;
      terminal = terminal.statement;
    }
    if (!ts.isExpressionStatement(terminal) || !ts.isCallExpression(terminal.expression)) return [];
    const call = terminal.expression;
    if (call.expression.getText(parsed) !== 'test' || !call.arguments[0]) return [];
    const name = ts.isStringLiteral(call.arguments[0]) ? call.arguments[0].text : call.arguments[0].getText(parsed);
    return [[name, { hash: hash(statement.getText(parsed)), cases }]];
  }));
};
const files = [];
for (const path of Object.keys(baseline.files).filter(path => path.startsWith('tests/commands/metadata-stress/') && path.endsWith('.test.ts'))) {
  const result = spawnSync('git', ['show', `${baseline.head}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(hash(result.stdout), baseline.files[path], `baseline committed bytes: ${path}`);
  const current = await host.readFile(join(root, path), 'utf8');
  const oldBodies = testBodies(path, result.stdout);
  const newBodies = testBodies(path, current);
  const changedOriginalBodies = [...oldBodies].filter(([name, body]) => newBodies.get(name)?.hash !== body.hash).map(([name]) => name);
  files.push({ path, baselineHash: baseline.files[path], currentHash: hash(current), originalBodies: Object.fromEntries(oldBodies), addedBodies: [...newBodies.keys()].filter(name => !oldBodies.has(name)), changedOriginalBodies });
}
const report = { baselineHead: baseline.head, parser: `TypeScript ${ts.version}; read-only AST parsing, no emitted code`, files, originalBodies: files.reduce((total, file) => total + Object.keys(file.originalBodies).length, 0), unchangedOriginalBodies: files.reduce((total, file) => total + Object.keys(file.originalBodies).length - file.changedOriginalBodies.length, 0), originalCases: files.reduce((total, file) => total + Object.values(file.originalBodies).reduce((count, body) => count + body.cases, 0), 0), addedBodies: files.reduce((total, file) => total + file.addedBodies.length, 0), note: 'Byte identity of each original test registration body, including complete loop statements and their original literal domains. Not a claim that surrounding imports/provenance initialization remained byte-identical. Seven metadata author files are separately full-file hashed. Plugin hash drift is separately recorded, never called unchanged71.' };
console.log(JSON.stringify(report, null, 2));
assert.equal(report.originalCases, 48);
assert.equal(report.unchangedOriginalBodies, report.originalBodies);
