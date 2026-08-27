import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { owned, root, work, git, save, hash, command } from './prepare.mjs';
const provenance = JSON.parse(readFileSync(join(owned, 'provenance.json')));
const ts = await import(pathToFileURL(join(root, 'node_modules/typescript/lib/typescript.js')));
const path = 'tests/commands/expr/grammar.test.ts';
const parent = git('rev-parse', 'be72c9c8^').toString().trim();
const before = git('show', `${parent}:${path}`).toString(), after = git('show', `be72c9c8:${path}`).toString();
assert.equal(after, git('show', `${provenance.candidate}:${path}`).toString());
assert.deepEqual(git('diff-tree', '--no-commit-id', '--name-only', '-r', 'be72c9c8').toString().trim().split('\n'), [path]);
const oldAssertion = '    assert.match(actual.stderr, /^expr: (syntax error|division by zero|non-integer argument)/u);';
const exactReplacement = `    if (args.length === 0 || (args.length === 1 && args[0] === "--")) {\n      assert.equal(actual.stderr, "expr: missing operand\\nTry 'expr --help' for more information.\\n");\n    } else {\n      assert.match(actual.stderr, /^expr: (syntax error|division by zero|non-integer argument)/u);\n    }`;
assert.equal(before.split(oldAssertion).length, 2);
assert.equal(before.replace(oldAssertion, exactReplacement), after);
function literalArrays(text) {
  const syntax = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const arrays = [];
  function visit(node) { if (ts.isArrayLiteralExpression(node)) arrays.push(node.getText(syntax)); ts.forEachChild(node, visit); }
  visit(syntax); return arrays;
}
assert.deepEqual(literalArrays(before), literalArrays(after));
const helperPath = 'tests/commands/expr/helpers.ts';
const helper = git('show', `${provenance.candidate}:${helperPath}`).toString();
const compiled = ts.transpileModule(helper, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022, verbatimModuleSyntax: true } }).outputText;
const bindings = ['fs/memory/index.js', 'commands/expr/index.js'].map(path => [`../../../src/${path}`, pathToFileURL(join(provenance.installed, 'dist', path)).href]);
let bound = compiled;
for (const [from, to] of bindings) { assert.equal(bound.split(from).length, 2); bound = bound.replace(from, to); }
const outputs = [];
for (const [label, text] of [['parent-original-assertions', before], ['candidate-exact-two-corrections', after]]) {
  const directory = join(work, `grammar-${label}`); mkdirSync(directory);
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n', { flag: 'wx' });
  writeFileSync(join(directory, 'grammar.test.ts'), text, { flag: 'wx' });
  writeFileSync(join(directory, 'helpers.js'), bound, { flag: 'wx' });
  const execution = command(`grammar-${label}`, process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', join(directory, 'grammar.test.ts')]);
  outputs.push({ label, status: execution.status, counts: Object.fromEntries([...execution.stdout.matchAll(/^ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])])) });
}
save('grammar-audit.json', { parent, commit: git('rev-parse', 'be72c9c8').toString().trim(), candidate: provenance.candidate, beforeSha256: hash(before), afterSha256: hash(after), onlyChangedPath: path, onlyTwoSelectedArgv: [[], ['--']], exactSingleReplacementVerified: true, completeArrayLiteralInventoryBeforeAfterIdentical: true, arrays: literalArrays(before), unchangedStatusAndStdoutAssertions: true, otherSixteenInvalidStderrAssertionsUnchanged: true, helperSourceSha256: hash(helper), helperCompiledSha256: hash(compiled), helperBoundSha256: hash(bound), helperImportOnlyBindings: bindings, outputs, historicalQualification: 'Original 239/241 evidence remains untouched. Original grammar assertions rerun against actual installed candidate remain two REDs; new grammar assertions do not retroactively rewrite that historical cohort. Canonical candidate legacy cohort independently remains 240/241 from stale named-locale contract.' });
console.log(JSON.stringify(outputs));
