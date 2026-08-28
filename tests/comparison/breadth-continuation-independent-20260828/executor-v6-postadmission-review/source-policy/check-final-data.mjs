import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = '/Users/kjopek/Workspace/safe-bash';
const directory = path.dirname(fileURLToPath(import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const first = JSON.parse(fs.readFileSync(path.join(directory, 'CHECK-RESULTS.json')));
const run = 'tests/comparison/breadth-continuation-20260828/executor-v6/runs/admission-v6-01';
const view = `${run}/views/baseline-installed`;
const beforeAfter = [];
for (const entry of [...first.authenticated, ...first.sources.map(source => ({ ...source, path: `${view}/${source.path}` }))]) {
  const bytes = fs.readFileSync(path.join(root, entry.path));
  assert.equal(digest(bytes), entry.sha256Before);
  beforeAfter.push({ path: entry.path, sha256Before: digest(bytes) });
}
const config = JSON.parse(fs.readFileSync(path.join(root, run, 'child-003.json')));
const receipt = JSON.parse(fs.readFileSync(path.join(root, run, 'child-003.receipt.json')));
const loads = receipt.records.filter(record => record.kind === 'nextLoad');
assert.equal(loads.length, 21);
assert.deepEqual(loads.map(load => load.path).sort(), first.sources.map(source => source.path).sort());
const directLoadAgreement = [];
for (const load of loads) {
  const entry = config.view.files.find(file => file.path === load.path);
  const source = first.sources.find(file => file.path === load.path);
  for (const key of ['path', 'bytes', 'sha256']) {
    assert.equal(load[key], entry[key]);
    assert.equal(load[key], source[key]);
  }
  directLoadAgreement.push({ path: load.path, bytes: load.bytes, sha256: load.sha256 });
}
const compilerPath = path.join(root, first.tooling.path);
assert.equal(digest(fs.readFileSync(compilerPath)), first.tooling.sha256Before);
const ts = createRequire(import.meta.url)(compilerPath);
const relative = first.sources.find(source => source.path.endsWith('/chunk-ZBUZKIPX.js')).path;
const text = fs.readFileSync(path.join(root, view, relative), 'utf8');
const source = ts.createSourceFile(relative, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
assert.equal(source.parseDiagnostics.length, 0);
const nodes = [];
const visit = node => { nodes.push(node); ts.forEachChild(node, visit); };
visit(source);
const describe = node => {
  const content = node.getText(source);
  const bytes = Buffer.from(content);
  const excerpt = bytes.subarray(0, 2000).toString('utf8');
  return {
    path: relative, kind: ts.SyntaxKind[node.kind], name: node.name?.getText(source),
    byteStart: Buffer.byteLength(text.slice(0, node.getStart(source))),
    byteEndExclusive: Buffer.byteLength(text.slice(0, node.end)),
    line: text.slice(0, node.getStart(source)).split('\n').length,
    excerptBytes: Buffer.byteLength(excerpt), truncated: bytes.length > 2000, text: excerpt,
  };
};
const methods = new Set(['applyPatches', 'applyPatch', 'restorePatches', 'createBlockingProxy', 'protectDynamicImport', 'protectModuleMethod']);
const excerpts = source.statements.filter(ts.isImportDeclaration).map(describe);
const initializationIndex = source.statements.findIndex(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => declaration.name.getText(source) === 'P'));
assert.ok(initializationIndex >= 0);
excerpts.push(describe(source.statements[initializationIndex]), describe(source.statements[initializationIndex + 1]));
for (const node of nodes) {
  if (ts.isFunctionDeclaration(node) && ['S', 'I'].includes(node.name?.text) || ts.isMethodDeclaration(node) && methods.has(node.name?.getText(source))) excerpts.push(describe(node));
}
for (const entry of beforeAfter) {
  entry.sha256After = digest(fs.readFileSync(path.join(root, entry.path)));
  assert.equal(entry.sha256Before, entry.sha256After);
}
const output = {
  schema: 'FINAL_BOUNDED_SOURCE_DATA_CROSSCHECK', date: '2026-08-28',
  presealSha256: digest(fs.readFileSync(path.join(directory, 'FINAL-DATA-PRESEAL.md'))),
  checkerSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))),
  originalResultsSha256: digest(fs.readFileSync(path.join(directory, 'CHECK-RESULTS.json'))),
  supplementalResultsSha256: digest(fs.readFileSync(path.join(directory, 'SECONDARY-RESULTS.json'))),
  directLoadAgreement, beforeAfter, excerpts,
  summary: { matchedLoadRecords: 21, matchedBeforeAfterFiles: beforeAfter.length, engineExecutions: 0, builtinProbes: 0, archiveReads: 0, policyImplementation: false, appendProof: false },
};
const bytes = Buffer.from(`${JSON.stringify(output, null, 2)}\n`);
assert.ok(bytes.length < 262144);
fs.writeFileSync(path.join(directory, 'FINAL-DATA-RESULTS.json'), bytes, { flag: 'wx' });
console.log(JSON.stringify({ ...output.summary, outputBytes: bytes.length }));
