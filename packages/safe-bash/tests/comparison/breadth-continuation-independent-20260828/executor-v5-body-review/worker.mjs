import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installLoader } from '../../breadth-continuation-20260828/executor-v5/loader.mjs';
import { wrapperEntries, wrapperContent, scopeDefinition } from '../../breadth-continuation-20260828/executor-v5/consumer-scope.mjs';
import { installOffline } from '../../breadth-continuation-20260828/executor-v3/offline.mjs';
import { transport } from '../../breadth-continuation-20260828/executor-v3/transport.mjs';
import { hash, errorRecord } from '../../breadth-continuation-20260828/executor-v4/safety.mjs';
import { assessLoadedNoop } from '../../breadth-continuation-20260828/executor-v4/loaded-outcome.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
const id = process.argv[2];
const expectations = JSON.parse(fs.readFileSync(path.join(own, 'EXPECTATIONS.json')));
const original = JSON.parse(fs.readFileSync(path.join(own, '../executor-v5-review/EXPECTATIONS.json'))).cases.find(row => row.id === id);
const extra = expectations.supplementalImports.find(row => row.id === id);
assert(original || extra);
const fixtures = JSON.parse(fs.readFileSync(path.join(own, '../executor-v5-review/FIXTURES.json')));
const writer = transport();
const engine = original?.library ?? 'virtual-bash';
const capsule = path.join(own, 'capture-01', id);
fs.mkdirSync(capsule);
const put = (relative, text, mode = 0o644) => {
  const filename = path.join(capsule, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o755 });
  fs.writeFileSync(filename, text, { flag: 'wx', mode });
  fs.chmodSync(filename, mode);
};
put('package.json', fixtures.outer);
put('ambient.mjs', fixtures.ambientModule);
put('foreign/package.json', '{"name":"unrelated-cwd-decoy","type":"module"}\n');
const origin = path.join(capsule, 'view');
let viewRoot = origin;
const scope = scopeDefinition(engine);
let files = wrapperEntries(engine);
for (const entry of files) put(`view/${entry.path}`, wrapperContent(engine, entry.path));
const packageRoot = engine === 'just-bash' ? 'benchmarks/node_modules/just-bash' : 'node_modules/virtual-bash';
const packageText = engine === 'just-bash' ? fixtures.baselinePackage : fixtures.targetPackage;
const moduleText = engine === 'just-bash' ? fixtures.baselineModule : fixtures.targetModule;
const entryPath = `${packageRoot}/index.mjs`;
function append(relative, text) {
  put(`view/${relative}`, text);
  files.push({ path: relative, bytes: Buffer.byteLength(text), sha256: hash(text), mode: 0o644 });
}
append(`${packageRoot}/package.json`, packageText);
append(entryPath, moduleText);
let importPath = scope.consumerPath;
let viewEngine = engine;
const boundary = path.join(viewRoot, scope.packagePath);
if (original?.action === 'selfref') {
  fs.writeFileSync(boundary, fixtures.selfReferenceWrapper);
  put(`view/${path.dirname(scope.packagePath)}/trap.mjs`, fixtures.trapModule);
  viewEngine = undefined;
}
if (original?.action === 'missing') {
  fs.unlinkSync(boundary);
  if (original.diagnosticBoundaryBypass) {
    fs.renameSync(path.join(viewRoot, packageRoot), path.join(capsule, 'removed-local-package'));
    viewEngine = undefined;
  }
}
if (['wrong-target', 'wrong-baseline'].includes(original?.action)) {
  const wrong = JSON.stringify({ name: original.action === 'wrong-target' ? 'virtual-bash' : 'just-bash', private: true, type: 'module' });
  fs.writeFileSync(boundary, wrong.padEnd(fs.statSync(boundary).size - 1, ' ') + '\n');
}
if (original?.action === 'unbound') files = files.filter(entry => entry.path !== entryPath);
if (original?.action === 'hash') fs.writeFileSync(path.join(viewRoot, entryPath), moduleText.replace('target-stub', 'target-fail'));
if (original?.action === 'mode') fs.chmodSync(path.join(viewRoot, entryPath), 0o600);
if (original?.action === 'wrapper-hash') fs.writeFileSync(boundary, fs.readFileSync(boundary, 'utf8').replace('true', 'null'));
if (original?.action === 'wrapper-mode') fs.chmodSync(boundary, 0o600);
if (original?.action === 'entry-parent') {
  append('unauthorized-parent.mjs', `export { library } from './${scope.consumerPath}';\n`);
  importPath = 'unauthorized-parent.mjs';
}
if (id === 'bare-parent-denied') {
  append('alternate-consumer.mjs', fixtures.targetConsumer);
  importPath = 'alternate-consumer.mjs';
}
if (id === 'scope-binding-denied') files = files.map(entry => entry.path === scope.packagePath ? { ...entry, sha256: '0'.repeat(64) } : entry);
let c12Specimen;
if (id.startsWith('c12-')) {
  viewEngine = undefined;
  c12Specimen = JSON.parse(fs.readFileSync(path.join(own, '../../breadth-continuation-20260828/WORKFLOWS.json'))).rows.find(row => row.id === 'W02');
  const outcome = { exitCode: id === 'c12-status' ? 23 : 0, stdoutBase64: '', stderrBase64: '', files: id === 'c12-effects' ? { 'part-aa': { base64: 'YWxwaGEKYmV0YQo=' } } : {} };
  append('outcome.mjs', `export function execute() { return ${JSON.stringify(outcome)}; }\n`);
  importPath = 'outcome.mjs';
}
if (original?.action === 'move') {
  viewRoot = path.join(capsule, 'relocated');
  fs.renameSync(origin, viewRoot);
  assert.equal(fs.existsSync(origin), false);
}
const view = { root: viewRoot, engine: viewEngine, consumerPath: id === 'consumer-path-denied' ? 'consumer.mjs' : scope.consumerPath, files };
const tree = root => {
  const entries = [];
  const visit = relative => {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const member = path.join(relative, name);
      const info = fs.lstatSync(path.join(root, member));
      assert(!info.isSymbolicLink());
      entries.push({ path: member, mode: info.mode & 0o7777, bytes: info.isFile() ? info.size : null, sha256: info.isFile() ? hash(fs.readFileSync(path.join(root, member))) : null });
      if (info.isDirectory()) visit(member);
    }
  };
  visit(''); return entries;
};
const before = tree(capsule);
const cwd = original?.cwd === 'foreign' ? path.join(capsule, 'foreign') : capsule;
process.chdir(cwd);
globalThis.__syntheticEvaluations = [];
let loader;
let offline;
const events = [];
const report = { id, profile: original ? 'ORIGINAL_15_CANDIDATE_ADAPTER' : 'SUPPLEMENTAL', engine, view, cwd, before, expectedParentURL: pathToFileURL(path.join(viewRoot, scope.consumerPath)).href, caught: null, identity: null, cleanupErrors: [] };
try {
  loader = installLoader(view, event => events.push(event));
  offline = installOffline(view, event => events.push(event));
  const loaded = await import(pathToFileURL(path.join(viewRoot, importPath)).href);
  report.identity = loaded.library?.identity ?? null;
  if (c12Specimen) {
    const initial = [{ path: '/fixture', type: 'directory', mode: 0o777 }, { path: '/fixture/rows', type: 'file', ...c12Specimen.files.rows }];
    const observation = loaded.execute();
    report.assessment = assessLoadedNoop(c12Specimen, { complete: true, entries: initial }, { evaluated: true, observation, entrySha256: files.find(entry => entry.path === importPath).sha256 }, loader.loaded);
  }
} catch (error) { report.caught = errorRecord(error); }
finally {
  report.resources = offline?.receipt() ?? null;
  try { offline?.close(); } catch (error) { report.cleanupErrors.push(errorRecord(error)); }
  try { loader?.close(); } catch (error) { report.cleanupErrors.push(errorRecord(error)); }
}
report.loaded = loader?.loaded ?? [];
report.resolutions = loader?.consumerResolutions ?? [];
report.events = events;
report.evaluations = globalThis.__syntheticEvaluations;
report.after = tree(capsule);
report.namespaceStable = JSON.stringify(report.before) === JSON.stringify(report.after);
report.oldOriginAbsent = original?.action === 'move' ? !fs.existsSync(origin) : null;
const expectedCode = original ? expectations.codes[id] : extra.expectedCode;
report.pass = (report.caught?.code ?? null) === expectedCode && report.namespaceStable && report.cleanupErrors.length === 0 && (!report.resources || report.resources.pending === 0 && report.resources.violations.length === 0);
if (original) report.pass &&= report.identity === original.expectedIdentity && JSON.stringify(report.evaluations) === JSON.stringify(original.expectedEvaluations);
else if (id.startsWith('c12-')) report.pass &&= report.assessment?.pass === extra.assessmentPass;
else report.pass &&= report.evaluations.length === 0;
if (original?.action === 'move') report.pass &&= report.oldOriginAbsent;
if (original?.expectedCode === null) report.pass &&= report.resolutions.length === 1 && report.resolutions[0].accepted && report.resolutions[0].parentURL === report.expectedParentURL;
writer.emit({ kind: 'final', report });
