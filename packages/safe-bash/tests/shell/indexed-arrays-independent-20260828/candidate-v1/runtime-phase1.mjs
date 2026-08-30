import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { admit, census, digest, verifyTree } from './boundary-app.mjs';
import { supervise } from '../executor-v1/supervisor.mjs';
import { verifyTool } from './npm-tool.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(here, '../../../..');
const prefix = 'tests/shell/indexed-arrays-independent-20260828';
const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: repository, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
const preseal = git('log', '-1', '--format=%H', '--', `${prefix}/candidate-v1/RUNTIME-PHASE1-PRESEAL.md`).toString().trim();
for (const name of ['runtime-phase1.mjs', 'boundary-app.mjs', 'terminal-adapter.mjs', 'RUNTIME-PHASE1-PRESEAL.md']) assert.equal(digest(fs.readFileSync(path.join(here, name))), digest(git('show', `${preseal}:${prefix}/candidate-v1/${name}`)));
const work = path.join(here, 'public-v2-app-5xarxw');
const typePath = path.join(work, 'TYPE-RESULT.json'), typeBytes = fs.readFileSync(typePath);
assert.equal(digest(typeBytes), '046e4346bb6da263d99d34557d13f39845b4a1df61ff91890ac497d451f3e3e5');
const types = JSON.parse(typeBytes); assert.equal(types.accepted, true); assert.equal(types.types.length, 10);
const oldBinding = JSON.parse(fs.readFileSync(types.bindingPath));
assert.equal(digest(fs.readFileSync(types.bindingPath)), types.bindingSha256);
for (const tree of oldBinding.trees) verifyTree(tree);
const node = types.node; assert.equal(node.path, fs.realpathSync(process.execPath)); assert.equal(node.version, process.version); assert.equal(digest(fs.readFileSync(node.path)), node.sha256);
const npm = verifyTool(JSON.parse(gunzipSync(Buffer.from(fs.readFileSync(path.join(here, 'NPM-TOOL-INVENTORY.json.gz.base64'), 'utf8').trim(), 'base64'))));
const report = { kind: 'array-independent-first-runtime-phase', preseal, work, candidate: types.candidate, product: types.product, selectedTree: types.selectedTree, packageSha256: types.packageSha256, guards: [], runs: [], accepted: false, unsafeStop: false, productRuntimeAttempted: false, nativeCalls: 0 };
const app = types.app, source = path.join(work, 'selected-source'), artifacts = path.join(work, 'artifacts');
function put(filename, bytes) { assert.ok(filename.startsWith(work + '/')); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes, { flag: 'wx' }); }
const manifestPath = path.join(work, 'RUNTIME-MANIFEST.json'), goPath = path.join(work, 'RUNTIME-GO.json');
function frozenText(filename, bytes) {
  assert.ok(!fs.existsSync(filename)); assert.ok(!filename.split('/').includes('AGENTS.md'));
  const text = bytes.toString(); assert.ok(text.endsWith('\n')); assert.equal(Buffer.from(text).compare(bytes), 0);
  return `*** Add File: ${filename}\n${text.slice(0, -1).split('\n').map(line => '+' + line).join('\n')}`;
}
try {
  const patches = [];
  for (const entry of types.sourceProjection) {
    const bytes = git('show', `${entry.commit}:${entry.path}`); assert.equal(digest(bytes), entry.sha256);
    patches.push(frozenText(path.join(source, entry.path), bytes));
  }
  for (const name of ['worker.mjs', 'semantic.mjs', 'supervisor.mjs', 'run.mjs']) patches.push(frozenText(path.join(app, name), git('show', `187c7c51:${prefix}/executor-v1/${name}`)));
  for (const [name, sourceName] of [['boundary.mjs', 'boundary-app.mjs'], ['terminal-adapter.mjs', 'terminal-adapter.mjs']]) patches.push(frozenText(path.join(app, name), git('show', `${preseal}:${prefix}/candidate-v1/${sourceName}`)));
  execFileSync('apply_patch', [], { input: `*** Begin Patch\n${patches.join('\n')}\n*** End Patch\n`, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  const data = { vectorsFile: ['VECTORS.json', 'review-v3/VECTORS.json'], controlsFile: ['CONTROLS.json', 'review-v3/CONTROLS.json'], holdoutsFile: ['HOLDOUTS.json', 'executor-v1/HOLDOUTS.json'], baselineFile: ['BASELINE.json', 'executor-v1/BASELINE.json'] };
  for (const [name, sourceName] of Object.values(data)) put(path.join(app, name), git('show', `187c7c51:${prefix}/${sourceName}`));
  const capsuleEncoded = fs.readFileSync(path.join(here, 'ADMISSION-02.json.gz.base64')); assert.equal(digest(capsuleEncoded), '26f232de331bd326e018b2c152405777795c1ea982cd671bda8237c3ea2c8e5a');
  const capsule = JSON.parse(gunzipSync(Buffer.from(capsuleEncoded.toString().trim(), 'base64')));
  const packed = Buffer.from(capsule.packageBase64, 'base64'); assert.equal(digest(packed), types.packageSha256);
  const packageTar = path.join(artifacts, 'virtual-bash.tgz'); put(packageTar, packed);
  const manifest = { kind: 'array-candidate-review-v1', candidate: types.candidate, repository, baseTree: '37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e', node, layout: 'source-build', defaultCount: 77, trees: [app, source, artifacts].map(root => ({ root, entries: census(root) })), sourceProjection: types.sourceProjection, sourceProjectionSha256: types.sourceProjectionSha256, sourceRoot: source, packageRoot: types.packageRoot, harnessRoot: app, packageTar, packageSha256: digest(packed), rootModule: path.join(types.packageRoot, 'dist/index.js'), runtimeModule: path.join(types.packageRoot, 'dist/shell/runtime.js'), rootDeclaration: path.join(types.packageRoot, 'dist/index.d.ts'), workerModule: path.join(app, 'worker.mjs'), adapter: { path: path.join(app, 'terminal-adapter.mjs') }, astTypes: { candidate: types.candidate, accepted: true, receiptPath: typePath, receiptSha256: digest(typeBytes) }, ...Object.fromEntries(Object.entries(data).map(([key, [name]]) => [key, path.join(app, name)])) };
  manifest.requiredFiles = [manifest.rootModule, manifest.runtimeModule, manifest.rootDeclaration, manifest.workerModule, manifest.adapter.path, manifest.vectorsFile, manifest.controlsFile, manifest.holdoutsFile, manifest.baselineFile, manifest.packageTar];
  const manifestBytes = Buffer.from(JSON.stringify(manifest)), manifestSha = digest(manifestBytes);
  const go = { action: 'execute-array-candidate', rootReceipt: preseal, candidate: manifest.candidate, manifestSha256: manifestSha };
  const goBytes = Buffer.from(JSON.stringify(go)), goSha = digest(goBytes);
  put(manifestPath, manifestBytes); put(goPath, goBytes);
  report.manifestSha256 = manifestSha; report.goSha256 = goSha;
  const admission = () => admit(manifestPath, manifestSha, goPath, goSha);
  admission(); report.guards.push({ id: 'positive', accepted: true });
  const reject = (id, apply, restore, pattern) => {
    let error;
    try { apply(); try { admission(); } catch (reason) { error = reason; } }
    finally { restore(); }
    assert.ok(error, `${id}: admission incorrectly accepted`); assert.match(String(error), pattern);
    admission(); report.guards.push({ id, accepted: true, diagnostic: String(error) });
  };
  const rootModule = manifest.rootModule, saved = path.join(work, 'root-js-saved');
  reject('missing-root-js', () => fs.renameSync(rootModule, saved), () => fs.renameSync(saved, rootModule), /append-aware exact tree census/u);
  const mode = fs.statSync(rootModule).mode & 0o777;
  reject('changed-root-js-mode', () => fs.chmodSync(rootModule, mode ^ 0o100), () => fs.chmodSync(rootModule, mode), /append-aware exact tree census/u);
  const extra = path.join(app, 'unexpected-entry.data');
  reject('extra-app-entry', () => put(extra, Buffer.from('unapproved')), () => fs.unlinkSync(extra), /append-aware exact tree census/u);
  const link = path.join(app, 'unapproved-link');
  reject('symlink-app-entry', () => fs.symlinkSync(rootModule, link), () => fs.unlinkSync(link), /no linked member/u);
  const badManifest = path.join(work, 'BAD-MANIFEST.json'), badGo = path.join(work, 'BAD-GO.json');
  const badBytes = Buffer.from(JSON.stringify({ ...manifest, packageSha256: '0'.repeat(64) }));
  const badGoBytes = Buffer.from(JSON.stringify({ ...go, manifestSha256: digest(badBytes) }));
  put(badManifest, badBytes); put(badGo, badGoBytes);
  assert.throws(() => admit(badManifest, digest(badBytes), badGo, digest(badGoBytes)), /Expected values to be strictly equal/u);
  report.guards.push({ id: 'wrong-package-sha', accepted: true }); admission();
  put(path.join(work, 'RUNTIME-GUARDS.json'), Buffer.from(JSON.stringify(report.guards)));
  const vectors = JSON.parse(fs.readFileSync(manifest.vectorsFile)), holdouts = JSON.parse(fs.readFileSync(manifest.holdoutsFile));
  const batches = [['semantic', [...vectors.splice, ...vectors.zeroView].map(row => row.id)], ['holdouts', holdouts.semantic.filter(row => !row.status).map(row => row.id)], ['operations', ['P01', 'P02', 'P06', 'P07']]];
  for (const [cohort, ids] of batches) {
    verifyTool(npm); admission();
    const output = path.join(work, `RUNTIME-${cohort}.json`);
    report.productRuntimeAttempted = true;
    const outer = await supervise(node.path, [path.join(app, 'run.mjs'), manifestPath, manifestSha, goPath, goSha, output, cohort, JSON.stringify(ids)], { cwd: app, env: { PATH: path.dirname(node.path), LC_ALL: 'C', TZ: 'UTC' }, timeoutMs: 180000, maxBytes: 2 * 1024 * 1024 });
    const capture = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output)) : undefined;
    report.runs.push({ cohort, ids, output, outer, ...(capture ? { capture } : {}) });
    if (!outer.closeObserved || !outer.groupAbsent || outer.fault || outer.signal || !capture || capture.unsafeStop) { report.unsafeStop = true; break; }
    assert.ok([0, 1].includes(outer.code));
  }
  for (const tree of manifest.trees) verifyTree(tree); verifyTool(npm);
  assert.equal(digest(fs.readFileSync(node.path)), node.sha256);
  report.accepted = !report.unsafeStop && report.runs.length === 3 && report.runs.every(row => row.capture.verdict.accepted);
} catch (error) { report.error = String(error?.stack ?? error); report.unsafeStop = true; }
const output = Buffer.from(JSON.stringify(report)); put(path.join(work, 'RUNTIME-PHASE1-RESULT.json'), output);
console.log(JSON.stringify({ work, accepted: report.accepted, unsafeStop: report.unsafeStop, guards: report.guards.map(row => ({ id: row.id, accepted: row.accepted })), runs: report.runs.map(row => ({ cohort: row.cohort, code: row.outer.code, passed: row.capture?.verdict.observations.filter(item => item.pass).length, failed: row.capture?.verdict.failed, errors: row.capture?.verdict.errors })), error: report.error, sha256: digest(output) }));
process.exitCode = report.unsafeStop ? 78 : report.accepted ? 0 : 1;
