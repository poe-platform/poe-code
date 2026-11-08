import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = '/Users/kjopek/Workspace/safe-bash';
const base = 'tests/comparison/breadth-continuation-20260828';
const diagnosis = `${base}/builtin-bootstrap-diagnosis-v1`;
const admission = `${base}/executor-v6/runs/grant-admission-v6-01`;
const run = `${base}/executor-v6/runs/admission-v6-01`;
const diagnosisCommit = '096c204c38fd7f1b6c096b9cb09e0ea877737fec';
const admissionCommit = 'becd1647a1572995750585b5c60d2be7d5fb77d4';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const authenticated = [];
const sourceBuffers = new Map();
const checkResults = [];
const check = (name, operation) => {
  try { const detail = operation(); checkResults.push({ name, pass: true, detail }); }
  catch (error) { checkResults.push({ name, pass: false, error: error.message }); }
};
const read = relative => fs.readFileSync(path.join(root, relative));
const authenticateGit = (relative, commit) => {
  const bytes = read(relative);
  const immutable = execFileSync('git', ['show', `${commit}:${relative}`], { cwd: root, maxBuffer: 2097152 });
  assert.deepEqual(bytes, immutable, `Git mismatch: ${relative}`);
  authenticated.push({ path: relative, authority: commit, bytes: bytes.length, sha256Before: digest(bytes) });
  return bytes;
};
const json = bytes => JSON.parse(bytes.toString('utf8'));
const location = (text, start, end) => ({
  byteStart: Buffer.byteLength(text.slice(0, start)),
  byteEndExclusive: Buffer.byteLength(text.slice(0, end)),
  lineStart: text.slice(0, start).split('\n').length,
  lineEnd: text.slice(0, end).split('\n').length,
});

for (const name of ['README.md', 'REFERENCES.json', 'inspect.mjs', 'OBSERVATIONS.json']) authenticateGit(`${diagnosis}/${name}`, diagnosisCommit);
const observation = json(read(`${diagnosis}/OBSERVATIONS.json`));
const manifest = json(authenticateGit(`${admission}/EVIDENCE-MANIFEST.json`, admissionCommit));
authenticateGit(`${admission}/HANDOFF.md`, admissionCommit);
const guards = [
  `${base}/executor-v6/worker.mjs`, `${base}/executor-v6/loader.mjs`,
  `${base}/executor-v6/projection.mjs`, `${base}/executor-v6/authorization.mjs`,
  `${base}/executor-v3/offline.mjs`, `${base}/executor-v3/projection.mjs`,
  `${base}/executor-v3/regular-read.mjs`,
];
for (const relative of guards) authenticateGit(relative, admissionCommit);
const authenticateMember = name => {
  const relative = `${run}/${name}`;
  const entry = manifest.archive.members.find(member => member.path === relative);
  assert.ok(entry, `Missing immutable member metadata: ${relative}`);
  const bytes = read(relative);
  const info = fs.lstatSync(path.join(root, relative));
  assert.ok(info.isFile() && !info.isSymbolicLink());
  assert.equal(bytes.length, entry.bytes);
  assert.equal(info.mode & 0o7777, entry.mode);
  assert.equal(digest(bytes), entry.sha256);
  authenticated.push({ path: relative, authority: `${admissionCommit}:EVIDENCE-MANIFEST.json member metadata`, bytes: bytes.length, sha256Before: digest(bytes) });
  return json(bytes);
};
const config = authenticateMember('child-003.json');
const receipt = authenticateMember('child-003.receipt.json');
assert.equal(digest(read(`${run}/child-003.receipt.json`)), '78bbe43ff593aebc98e603b69c14ac0fc51e330a1863d95761aa90285a1d0dd6');
assert.equal(config.view.root, path.join(root, run, 'views/baseline-installed'));
const loads = receipt.records.filter(record => record.kind === 'nextLoad');
assert.equal(loads.length, 21);
assert.equal(new Set(loads.map(load => load.path)).size, 21);
assert.equal(observation.sources.length, 21);
const sources = [];
for (const load of loads) {
  const entry = config.view.files.find(file => file.path === load.path);
  const prior = observation.sources.find(file => file.path === load.path);
  assert.ok(entry && prior);
  assert.ok(!/(^|\/)(agents\.md|claude\.md|gemini\.md)$/i.test(entry.path));
  const absolute = path.resolve(config.view.root, entry.path);
  assert.ok(absolute.startsWith(`${config.view.root}/`));
  let component = config.view.root;
  for (const part of entry.path.split('/')) {
    component = path.join(component, part);
    assert.ok(!fs.lstatSync(component).isSymbolicLink());
  }
  const info = fs.lstatSync(absolute);
  assert.ok(info.isFile());
  const bytes = fs.readFileSync(absolute);
  for (const [key, actual] of Object.entries({ bytes: bytes.length, mode: info.mode & 0o7777, sha256: digest(bytes) })) {
    assert.equal(actual, entry[key], `Config ${key}: ${entry.path}`);
    assert.equal(actual, prior[key], `Diagnosis ${key}: ${entry.path}`);
  }
  const text = bytes.toString('utf8');
  assert.deepEqual(Buffer.from(text), bytes);
  sourceBuffers.set(entry.path, bytes);
  const tokens = [...text.matchAll(/getBuiltinModule/g)].map(match => location(text, match.index, match.index + match[0].length));
  sources.push({ ...entry, sha256Before: digest(bytes), getBuiltinModuleTokens: tokens });
}
const mainPath = 'benchmarks/node_modules/just-bash/dist/bundle/index.js';
const shimPath = 'benchmarks/node_modules/just-bash/dist/bundle/chunks/chunk-NCUTH6QL.js';
assert.equal(digest(sourceBuffers.get(mainPath)), '70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c');
assert.equal(digest(sourceBuffers.get(shimPath)), 'fae9347ddabceda17cfed0562a36d8dd570134e42a0d631122a6f85d7c6975f0');
check('one token, expected exact location', () => {
  const tokens = sources.flatMap(source => source.getBuiltinModuleTokens);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].byteStart, 503554);
  assert.equal(tokens[0].lineStart, 808);
  return tokens[0];
});

const compilerPath = path.join(root, 'node_modules/typescript/lib/typescript.js');
const compilerBytes = fs.readFileSync(compilerPath);
const requireTool = createRequire(import.meta.url);
const ts = requireTool(compilerPath);
const parsed = new Map();
for (const [relative, bytes] of sourceBuffers) {
  const source = ts.createSourceFile(relative, bytes.toString('utf8'), ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  parsed.set(relative, source);
  check(`parser diagnostics: ${relative}`, () => { assert.equal(source.parseDiagnostics.length, 0); return 0; });
}
const main = parsed.get(mainPath);
const host = {
  getSourceFile: filename => parsed.get(filename),
  getDefaultLibFileName: () => '', writeFile: () => { throw new Error('No compilation output allowed'); },
  getCurrentDirectory: () => '', getDirectories: () => [],
  fileExists: filename => parsed.has(filename), readFile: filename => parsed.get(filename)?.text,
  getCanonicalFileName: filename => filename, useCaseSensitiveFileNames: () => true,
  getNewLine: () => '\n',
};
const program = ts.createProgram([mainPath], { allowJs: true, noResolve: true, noLib: true, target: ts.ScriptTarget.ESNext }, host);
const checker = program.getTypeChecker();
const allNodes = [];
const visit = node => { allNodes.push(node); ts.forEachChild(node, visit); };
visit(main);
const describe = node => ({
  kind: ts.SyntaxKind[node.kind], parentKind: ts.SyntaxKind[node.parent.kind],
  ...location(main.text, node.getStart(main), node.end),
  text: node.getText(main).slice(0, 1500),
});
const query = allNodes.find(node => ts.isPropertyAccessExpression(node) && node.name.text === 'getBuiltinModule');
assert.ok(query);
let bootstrap = query;
while (bootstrap && !ts.isTryStatement(bootstrap)) bootstrap = bootstrap.parent;
assert.ok(bootstrap);
const declarations = bootstrap.tryBlock.statements[0].declarationList.declarations;
const getReferences = identifier => {
  const symbol = checker.getSymbolAtLocation(identifier);
  assert.ok(symbol, `Missing binding ${identifier.text}`);
  return allNodes.filter(node => ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === symbol);
};
const moduleIdentifiers = allNodes.filter(node => ts.isIdentifier(node) && node.text === 'Mf');
const bindings = {};
for (const identifier of [moduleIdentifiers[0], ...declarations.map(declaration => declaration.name)]) {
  bindings[identifier.text] = getReferences(identifier).map(describe);
}
const shimImport = allNodes.find(node => ts.isImportSpecifier(node) && node.name.text === 'Ks');
assert.ok(shimImport);
bindings.Ks = getReferences(shimImport.name).map(describe);
check('Mf entire AST single binding, declaration and two writes only', () => {
  assert.equal(moduleIdentifiers.length, 3);
  assert.equal(new Set(moduleIdentifiers.map(node => checker.getSymbolAtLocation(node))).size, 1);
  assert.ok(ts.isVariableDeclaration(moduleIdentifiers[0].parent) && moduleIdentifiers[0].parent.name === moduleIdentifiers[0]);
  for (const identifier of moduleIdentifiers.slice(1)) {
    assert.ok(ts.isBinaryExpression(identifier.parent));
    assert.equal(identifier.parent.left, identifier);
    assert.equal(identifier.parent.operatorToken.kind, ts.SyntaxKind.EqualsToken);
  }
  return bindings.Mf;
});
check('unshadowed global process receiver', () => {
  assert.equal(query.expression.getText(main), 'process');
  assert.equal(checker.getSymbolAtLocation(query.expression), undefined);
  return describe(query);
});
const bootstrapNodes = [];
const visitBootstrap = node => { bootstrapNodes.push(node); ts.forEachChild(node, visitBootstrap); };
visitBootstrap(bootstrap);
const calls = bootstrapNodes.filter(ts.isCallExpression).map(node => ({ ...describe(node), receiver: node.expression.getText(main), arguments: node.arguments.map(argument => argument.getText(main)), optionalCall: Boolean(node.questionDotToken) }));
check('ordered exact lexical query callsites', () => {
  const requests = calls.filter(call => call.receiver === 'e');
  assert.deepEqual(requests.map(call => call.arguments), [['"module"'], ['"worker_threads"'], ['"crypto"']]);
  assert.ok(requests.every(call => !call.optionalCall));
  return requests;
});
check('bootstrap exact source shape', () => {
  assert.equal(bootstrap.getText(main), 'try{let e=process.getBuiltinModule,t=typeof e=="function"?e("module"):typeof Ks=="function"?Ks("node:module"):null;Mf=t?.Module??t?.default??null,typeof e=="function"&&e("worker_threads")?.isMainThread===!1&&e("crypto")?.randomUUID?.()}catch{Mf=null}');
  return describe(bootstrap);
});
const excerpts = [
  { path: mainPath, purpose: 'complete bootstrap and preceding binding declaration', ...location(main.text, moduleIdentifiers[0].parent.parent.parent.getStart(main), bootstrap.end), text: main.text.slice(moduleIdentifiers[0].parent.parent.parent.getStart(main), bootstrap.end) },
  { path: mainPath, purpose: 'Ks import declaration', ...location(main.text, shimImport.parent.parent.parent.getStart(main), shimImport.parent.parent.parent.end), text: shimImport.parent.parent.parent.getText(main) },
];
for (const relative of [mainPath, shimPath]) {
  const source = parsed.get(relative);
  for (const statement of source.statements) {
    const text = statement.getText(source);
    if (/createRequire|Dynamic require|as __require/.test(text)) {
      assert.ok(Buffer.byteLength(text) < 6000, `Unbounded excerpt: ${relative}`);
      excerpts.push({ path: relative, purpose: 'require prelude/shim statement', ...location(source.text, statement.getStart(source), statement.end), text });
    }
  }
}
for (const source of sources) {
  source.sha256After = digest(fs.readFileSync(path.join(config.view.root, source.path)));
  assert.equal(source.sha256Before, source.sha256After);
}
for (const entry of authenticated) {
  entry.sha256After = digest(read(entry.path));
  assert.equal(entry.sha256Before, entry.sha256After);
}
assert.equal(digest(fs.readFileSync(compilerPath)), digest(compilerBytes));
const output = {
  schema: 'INDEPENDENT_SOURCE_DATA_REVIEW_V1', date: '2026-08-28',
  presealSha256: digest(fs.readFileSync(path.join(directory, 'PRESEAL.md'))),
  checkerSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))),
  scope: { engineImports: 0, engineExecutions: 0, deniedBuiltinCalls: 0, archiveReads: 0, policyImplementation: false, appendProof: false },
  tooling: { path: path.relative(root, compilerPath), version: ts.version, sha256Before: digest(compilerBytes), sha256After: digest(fs.readFileSync(compilerPath)), node: process.version },
  authenticated, sources, bindings, calls, excerpts, checkResults,
  summary: { checks: checkResults.length, passed: checkResults.filter(check => check.pass).length, failed: checkResults.filter(check => !check.pass).length, authenticatedSources: sources.length },
};
const outputBytes = Buffer.from(`${JSON.stringify(output, null, 2)}\n`);
assert.ok(outputBytes.length < 262144);
fs.writeFileSync(path.join(directory, 'CHECK-RESULTS.json'), outputBytes, { flag: 'wx' });
console.log(JSON.stringify({ ...output.summary, outputBytes: outputBytes.length, engineExecutions: 0 }));
if (output.summary.failed) process.exitCode = 1;
