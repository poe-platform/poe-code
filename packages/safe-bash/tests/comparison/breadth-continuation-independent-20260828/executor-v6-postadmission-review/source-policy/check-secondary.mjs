import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = '/Users/kjopek/Workspace/safe-bash';
const directory = path.dirname(fileURLToPath(import.meta.url));
const relativeDirectory = path.relative(root, directory);
const resultPath = `${relativeDirectory}/CHECK-RESULTS.json`;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const commit = process.argv[2];
assert.match(commit, /^[a-f0-9]{40}$/);
const originalBytes = execFileSync('git', ['show', `${commit}:${resultPath}`], { cwd: root, maxBuffer: 262144 });
assert.deepEqual(fs.readFileSync(path.join(root, resultPath)), originalBytes);
const original = JSON.parse(originalBytes);
const compilerPath = path.join(root, original.tooling.path);
assert.equal(digest(fs.readFileSync(compilerPath)), original.tooling.sha256Before);
const ts = createRequire(import.meta.url)(compilerPath);
const view = path.join(root, 'tests/comparison/breadth-continuation-20260828/executor-v6/runs/admission-v6-01/views/baseline-installed');
const texts = new Map();
const beforeAfter = [];
for (const entry of [...original.sources.map(source => ({ ...source, absolute: path.join(view, source.path) })), ...original.authenticated.map(source => ({ ...source, absolute: path.join(root, source.path) }))]) {
  const bytes = fs.readFileSync(entry.absolute);
  assert.equal(digest(bytes), entry.sha256Before);
  texts.set(entry.path, bytes.toString('utf8'));
  beforeAfter.push({ path: entry.path, absolute: entry.absolute, sha256Before: digest(bytes) });
}
const parsed = new Map();
const nodes = new Map();
const describe = (source, node) => ({
  kind: ts.SyntaxKind[node.kind], parentKind: ts.SyntaxKind[node.parent.kind],
  byteStart: Buffer.byteLength(source.text.slice(0, node.getStart(source))),
  byteEndExclusive: Buffer.byteLength(source.text.slice(0, node.end)),
  line: source.text.slice(0, node.getStart(source)).split('\n').length,
  text: node.getText(source).slice(0, 1800),
});
for (const entry of original.sources) {
  const source = ts.createSourceFile(entry.path, texts.get(entry.path), ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  assert.equal(source.parseDiagnostics.length, 0);
  parsed.set(entry.path, source);
  const descendants = [];
  const visit = node => { descendants.push(node); ts.forEachChild(node, visit); };
  visit(source);
  nodes.set(entry.path, descendants);
}
const results = [];
const check = (name, operation) => {
  try { results.push({ name, pass: true, detail: operation() }); }
  catch (error) { results.push({ name, pass: false, error: error.message }); }
};
const mentions = [];
for (const [relative, descendants] of nodes) {
  const source = parsed.get(relative);
  for (const node of descendants) if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && node.text.includes('getBuiltinModule')) mentions.push({ path: relative, ...describe(source, node), parent: describe(source, node.parent) });
}
check('AST token classification, not three executable property queries', () => {
  assert.equal(mentions.length, 3);
  assert.deepEqual(mentions.map(mention => mention.kind).sort(), ['Identifier', 'StringLiteral', 'StringLiteral']);
  const query = mentions.find(mention => mention.kind === 'Identifier');
  assert.equal(query.byteStart, 503554);
  assert.equal(query.line, 808);
  assert.equal(query.parentKind, 'PropertyAccessExpression');
  const literals = mentions.filter(mention => mention.kind === 'StringLiteral');
  assert.deepEqual(literals.map(literal => literal.byteStart), [1750, 1851]);
  assert.deepEqual(literals.map(literal => literal.parentKind), ['PropertyAssignment', 'PropertyAssignment']);
  return mentions;
});
check('complete-source e/t/Ks binding inventories', () => {
  assert.equal(original.bindings.e.length, 6);
  assert.equal(original.bindings.t.length, 3);
  assert.equal(original.bindings.Ks.length, 3);
  assert.deepEqual(original.bindings.e.map(node => node.parentKind), ['VariableDeclaration', 'TypeOfExpression', 'CallExpression', 'TypeOfExpression', 'CallExpression', 'CallExpression']);
  assert.deepEqual(original.bindings.t.map(node => node.parentKind), ['VariableDeclaration', 'PropertyAccessExpression', 'PropertyAccessExpression']);
  assert.deepEqual(original.bindings.Ks.map(node => node.parentKind), ['ImportSpecifier', 'TypeOfExpression', 'CallExpression']);
  return { e: 6, t: 3, Ks: 3 };
});
const shimPath = original.sources.find(source => source.path.endsWith('/chunk-NCUTH6QL.js')).path;
const shim = parsed.get(shimPath);
const shimExport = nodes.get(shimPath).find(node => ts.isExportSpecifier(node) && node.name.text === 'a');
check('fallback export a is local m', () => {
  assert.equal(shimExport.propertyName.text, 'm');
  return describe(shim, shimExport.parent.parent);
});
const guardPath = original.sources.find(source => source.path.endsWith('/chunk-ZBUZKIPX.js')).path;
const guardSource = parsed.get(guardPath);
const guardLiteral = nodes.get(guardPath).find(node => ts.isStringLiteral(node) && node.text === 'getBuiltinModule');
const guardObject = guardLiteral.parent.parent;
let guardBinding = guardObject;
while (guardBinding && !ts.isVariableDeclaration(guardBinding)) guardBinding = guardBinding.parent;
const guardBindingName = guardBinding?.name.getText(guardSource);
const guardBindingMentions = nodes.get(guardPath).filter(node => ts.isIdentifier(node) && node.text === guardBindingName).map(node => ({ ...describe(guardSource, node), parent: describe(guardSource, node.parent) }));
const guardMethods = nodes.get(guardPath).filter(node => ts.isMethodDeclaration(node) && node.getText(guardSource).includes(guardBindingName)).map(node => describe(guardSource, node));
const guardCoordinates = [];
const references = [
  ['executor-v6/worker.mjs', 36, 55], ['executor-v6/worker.mjs', 102, 116],
  ['executor-v6/loader.mjs', 19, 36], ['executor-v6/loader.mjs', 38, 85],
  ['executor-v3/offline.mjs', 29, 65], ['executor-v3/offline.mjs', 98, 117],
  ['executor-v3/regular-read.mjs', 9, 24],
];
for (const [suffix, first, last] of references) {
  const relative = `tests/comparison/breadth-continuation-20260828/${suffix}`;
  const text = texts.get(relative);
  const lines = text.split('\n');
  const prefix = lines.slice(0, first - 1).join('\n') + (first > 1 ? '\n' : '');
  const excerpt = lines.slice(first - 1, last).join('\n');
  guardCoordinates.push({ path: relative, lineStart: first, lineEnd: last, byteStart: Buffer.byteLength(prefix), byteEndExclusive: Buffer.byteLength(prefix + excerpt), text: excerpt });
}
for (const entry of beforeAfter) {
  entry.sha256After = digest(fs.readFileSync(entry.absolute));
  assert.equal(entry.sha256Before, entry.sha256After);
  delete entry.absolute;
}
const output = {
  schema: 'INDEPENDENT_SUPPLEMENTAL_SOURCE_CLASSIFICATION_V1', date: '2026-08-28',
  originalResultsCommit: commit, originalResultsSha256: digest(originalBytes),
  presealSha256: digest(fs.readFileSync(path.join(directory, 'SECONDARY-PRESEAL.md'))),
  checkerSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))),
  originalSummaryUnchanged: original.summary,
  scope: { comparatorImports: 0, productImports: 0, engineExecutions: 0, builtinProbes: 0, archiveReads: 0, guardImplementation: false },
  beforeAfter, results, mentions,
  additionalGuardContext: { path: guardPath, object: describe(guardSource, guardObject), binding: guardBindingName, bindingMentionsBySpellingNotSymbolProof: guardBindingMentions, enclosingMethods: guardMethods },
  shimExport: describe(shim, shimExport.parent.parent), guardCoordinates,
  summary: { checks: results.length, passed: results.filter(result => result.pass).length, failed: results.filter(result => !result.pass).length },
};
const bytes = Buffer.from(`${JSON.stringify(output, null, 2)}\n`);
assert.ok(bytes.length < 262144);
fs.writeFileSync(path.join(directory, 'SECONDARY-RESULTS.json'), bytes, { flag: 'wx' });
console.log(JSON.stringify({ ...output.summary, outputBytes: bytes.length, engineExecutions: 0 }));
if (output.summary.failed) process.exitCode = 1;
