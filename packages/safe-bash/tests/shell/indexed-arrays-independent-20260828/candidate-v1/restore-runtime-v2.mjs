import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { admit, census, digest, verifyTree, tarInventory } from './boundary-app.mjs';
import { supervise } from '../executor-v1/supervisor.mjs';
import { verifyTool } from './npm-tool.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(here, '../../../..');
const prefix = 'tests/shell/indexed-arrays-independent-20260828';
const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: repository, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
const preseal = git('log', '-1', '--format=%H', '--', `${prefix}/candidate-v1/OBSERVER-V2-REPLAY-PRESEAL.md`).toString().trim();
for (const name of ['restore-runtime-v2.mjs', 'OBSERVER-V2-REPLAY-PRESEAL.md']) assert.equal(digest(fs.readFileSync(path.join(here, name))), digest(git('show', `${preseal}:${prefix}/candidate-v1/${name}`)));
for (const name of ['observer-v2.mjs', 'terminal-adapter-v2.mjs', 'observer-v2-controls.mjs']) assert.equal(digest(fs.readFileSync(path.join(here, name))), digest(git('show', `7ef254d3:${prefix}/candidate-v1/${name}`)));
const syntheticBytes = fs.readFileSync(path.join(here, 'OBSERVER-V2-CONTROLS-01.json'));
assert.equal(digest(syntheticBytes), digest(git('show', `${preseal}:${prefix}/candidate-v1/OBSERVER-V2-CONTROLS-01.json`)));
const syntheticCapture = JSON.parse(syntheticBytes); assert.equal(syntheticCapture.code, 0);
const synthetic = JSON.parse(syntheticCapture.stdout); assert.equal(synthetic.passed, 19); assert.equal(synthetic.failed, 0);
function capsule(name, encodedHash, decodedHash) {
  const encoded = fs.readFileSync(path.join(here, name)); assert.equal(digest(encoded), encodedHash);
  const decoded = gunzipSync(Buffer.from(encoded.toString().trim(), 'base64'), { maxOutputLength: 32 * 1024 * 1024 }); assert.equal(digest(decoded), decodedHash); return JSON.parse(decoded);
}
const previous = capsule('FIRST-RUNTIME-01.json.gz.base64', 'c84e205b07dc5c472650bc468c278ab99877dec63cdc0c5c8040c4bfacc7f995', '0c2bbc09b0a291ba9b4a3eeb623857b12deae2b9691daa460fc52ea973908d08');
for (const record of Object.values(previous.records)) assert.equal(digest(Buffer.from(record.base64, 'base64')), record.sha256);
const typeBytes = Buffer.from(previous.records['TYPE-RESULT.json'].base64, 'base64'); assert.equal(digest(typeBytes), '046e4346bb6da263d99d34557d13f39845b4a1df61ff91890ac497d451f3e3e5');
const types = JSON.parse(typeBytes); assert.equal(types.accepted, true); assert.ok(types.types.every(row => row.accepted));
const packageCapsule = capsule('ADMISSION-02.json.gz.base64', '26f232de331bd326e018b2c152405777795c1ea982cd671bda8237c3ea2c8e5a', 'adfc29d7b8df6b8fd350e4cc39eeb00fde0301bb13eda2be87a1e41000972288');
const packed = Buffer.from(packageCapsule.packageBase64, 'base64'); assert.equal(digest(packed), types.packageSha256);
const members = tarInventory(packed); assert.equal(Object.keys(members).length, 862);
const node = types.node; assert.equal(node.path, fs.realpathSync(process.execPath)); assert.equal(node.version, process.version); assert.equal(digest(fs.readFileSync(node.path)), node.sha256);
const npm = verifyTool(JSON.parse(gunzipSync(Buffer.from(fs.readFileSync(path.join(here, 'NPM-TOOL-INVENTORY.json.gz.base64'), 'utf8').trim(), 'base64'))));
const work = fs.mkdtempSync(path.join(here, 'observer-v2-run-'));
const app = path.join(work, 'app'), source = path.join(work, 'selected-source'), artifacts = path.join(work, 'artifacts'), packageRoot = path.join(app, 'node_modules/virtual-bash');
const report = { kind: 'array-observer-v2-source-replay', preseal, candidate: types.candidate, product: types.product, selectedTree: types.selectedTree, packageSha256: digest(packed), work, app, source, artifacts, packageRoot, guards: [], runs: [], accepted: false, unsafeStop: false, buildRetries: 0, nativeCalls: 0, syntheticControls: 19 };
function put(filename, bytes, mode = 0o644) { assert.ok(filename.startsWith(work + '/')); assert.ok(!filename.split('/').includes('AGENTS.md')); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes, { flag: 'wx', mode }); }
function patchFile(filename, bytes) { assert.ok(!filename.split('/').includes('AGENTS.md')); const text = bytes.toString(); assert.equal(Buffer.from(text).compare(bytes), 0); assert.ok(text.endsWith('\n')); return `*** Add File: ${filename}\n${text.slice(0, -1).split('\n').map(line => '+' + line).join('\n')}`; }
try {
  const tar = gunzipSync(packed, { maxOutputLength: 64 * 1024 * 1024 });
  for (let offset = 0; offset + 512 <= tar.length && tar[offset];) {
    const name = tar.subarray(offset, offset + 100).toString().split('\0')[0].slice(8), entry = members[name]; assert.ok(entry);
    const bytes = tar.subarray(offset + 512, offset + 512 + entry.bytes); assert.equal(digest(bytes), entry.sha256); put(path.join(packageRoot, name), bytes, entry.mode); offset += 512 + Math.ceil(entry.bytes / 512) * 512;
  }
  const patches = [];
  for (const entry of types.sourceProjection) { const bytes = git('show', `${entry.commit}:${entry.path}`); assert.equal(digest(bytes), entry.sha256); patches.push(patchFile(path.join(source, entry.path), bytes)); }
  for (const name of ['worker.mjs', 'semantic.mjs', 'supervisor.mjs', 'run.mjs']) patches.push(patchFile(path.join(app, name), git('show', `0ae08742:${prefix}/executor-v1/${name}`)));
  patches.push(patchFile(path.join(app, 'boundary.mjs'), git('show', `f8f740f4:${prefix}/candidate-v1/boundary-app.mjs`)));
  for (const name of ['observer-v2.mjs', 'terminal-adapter-v2.mjs']) patches.push(patchFile(path.join(app, name), git('show', `7ef254d3:${prefix}/candidate-v1/${name}`)));
  execFileSync('apply_patch', [], { input: `*** Begin Patch\n${patches.join('\n')}\n*** End Patch\n`, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  put(path.join(app, 'package.json'), Buffer.from('{"private":true,"type":"module"}\n'));
  const data = { vectorsFile: ['VECTORS.json', 'review-v3/VECTORS.json'], controlsFile: ['CONTROLS.json', 'review-v3/CONTROLS.json'], holdoutsFile: ['HOLDOUTS.json', 'executor-v1/HOLDOUTS.json'], baselineFile: ['BASELINE.json', 'executor-v1/BASELINE.json'] };
  for (const [name, input] of Object.values(data)) put(path.join(app, name), git('show', `0ae08742:${prefix}/${input}`));
  const packageTar = path.join(artifacts, 'virtual-bash.tgz'), typePath = path.join(work, 'TYPE-RECEIPT.json'); put(packageTar, packed); put(typePath, typeBytes);
  const manifest = { kind: 'array-candidate-review-v1', candidate: types.candidate, repository, baseTree: '37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e', node, layout: 'source-build', defaultCount: 77, trees: [app, source, artifacts].map(root => ({ root, entries: census(root) })), sourceProjection: types.sourceProjection, sourceProjectionSha256: types.sourceProjectionSha256, sourceRoot: source, packageRoot, harnessRoot: app, packageTar, packageSha256: digest(packed), rootModule: path.join(packageRoot, 'dist/index.js'), runtimeModule: path.join(packageRoot, 'dist/shell/runtime.js'), rootDeclaration: path.join(packageRoot, 'dist/index.d.ts'), workerModule: path.join(app, 'worker.mjs'), adapter: { path: path.join(app, 'terminal-adapter-v2.mjs') }, astTypes: { candidate: types.candidate, accepted: true, receiptPath: typePath, receiptSha256: digest(typeBytes) }, ...Object.fromEntries(Object.entries(data).map(([key, [name]]) => [key, path.join(app, name)])) };
  manifest.requiredFiles = [manifest.rootModule, manifest.runtimeModule, manifest.rootDeclaration, manifest.workerModule, manifest.adapter.path, path.join(app, 'observer-v2.mjs'), manifest.vectorsFile, manifest.controlsFile, manifest.holdoutsFile, manifest.baselineFile, packageTar];
  const manifestPath = path.join(work, 'MANIFEST.json'), manifestBytes = Buffer.from(JSON.stringify(manifest)), manifestSha = digest(manifestBytes); put(manifestPath, manifestBytes);
  const go = { action: 'execute-array-candidate', rootReceipt: preseal, candidate: types.candidate, manifestSha256: manifestSha }, goPath = path.join(work, 'GO.json'), goBytes = Buffer.from(JSON.stringify(go)), goSha = digest(goBytes); put(goPath, goBytes);
  report.manifestPath = manifestPath; report.manifestSha256 = manifestSha; report.goPath = goPath; report.goSha256 = goSha;
  const admission = () => admit(manifestPath, manifestSha, goPath, goSha); admission(); report.guards.push({ id: 'positive', pass: true });
  const negative = (id, apply, restore, pattern) => { let error; try { apply(); try { admission(); } catch (reason) { error = reason; } } finally { restore(); } assert.ok(error); assert.match(String(error), pattern); admission(); report.guards.push({ id, pass: true, error: String(error) }); };
  const rootJS = manifest.rootModule, saved = path.join(work, 'saved-js'); negative('missing-root', () => fs.renameSync(rootJS, saved), () => fs.renameSync(saved, rootJS), /append-aware exact tree census/u);
  const mode = fs.statSync(rootJS).mode & 0o777; negative('changed-mode', () => fs.chmodSync(rootJS, mode ^ 0o100), () => fs.chmodSync(rootJS, mode), /append-aware exact tree census/u);
  const extra = path.join(app, 'unbound.data'); negative('extra-entry', () => put(extra, Buffer.from('new')), () => fs.unlinkSync(extra), /append-aware exact tree census/u);
  const link = path.join(app, 'unbound-link'); negative('symlink', () => fs.symlinkSync(rootJS, link), () => fs.unlinkSync(link), /no linked member/u);
  const badBytes = Buffer.from(JSON.stringify({ ...manifest, packageSha256: '0'.repeat(64) })), badPath = path.join(work, 'BAD.json'), badGoBytes = Buffer.from(JSON.stringify({ ...go, manifestSha256: digest(badBytes) })), badGoPath = path.join(work, 'BAD-GO.json'); put(badPath, badBytes); put(badGoPath, badGoBytes);
  assert.throws(() => admit(badPath, digest(badBytes), badGoPath, digest(badGoBytes)), /Expected values to be strictly equal/u); report.guards.push({ id: 'package-sha', pass: true }); admission();
  const holdouts = JSON.parse(fs.readFileSync(manifest.holdoutsFile));
  const batches = [['O11', 'semantic', ['O11']], ['remaining', 'semantic', ['S06', 'O12', 'O13', 'O14', 'O15', 'O16']], ['holdouts', 'holdouts', holdouts.semantic.filter(row => !row.status).map(row => row.id)], ['operations', 'operations', ['P01', 'P02', 'P06', 'P07']]];
  for (const [label, cohort, ids] of batches) {
    admission(); verifyTool(npm); const output = path.join(work, `${label}.json`);
    const outer = await supervise(node.path, [path.join(app, 'run.mjs'), manifestPath, manifestSha, goPath, goSha, output, cohort, JSON.stringify(ids)], { cwd: app, env: { PATH: path.dirname(node.path), LC_ALL: 'C', TZ: 'UTC' }, timeoutMs: 180000, maxBytes: 2 * 1024 * 1024 });
    const capture = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output)) : undefined;
    report.runs.push({ label, cohort, ids, output, outer, ...(capture ? { capture } : {}) });
    if (!outer.closeObserved || !outer.groupAbsent || outer.fault || outer.signal || !capture || capture.unsafeStop) { report.unsafeStop = true; break; }
    assert.ok([0, 1].includes(outer.code));
  }
  for (const tree of manifest.trees) verifyTree(tree); verifyTool(npm); assert.equal(digest(fs.readFileSync(node.path)), node.sha256);
  report.accepted = !report.unsafeStop && report.runs.length === 4 && report.runs.every(row => row.capture.verdict.accepted);
} catch (error) { report.unsafeStop = true; report.error = String(error?.stack ?? error); }
const result = Buffer.from(JSON.stringify(report)); put(path.join(work, 'RESULT.json'), result);
console.log(JSON.stringify({ work, accepted: report.accepted, unsafeStop: report.unsafeStop, guards: report.guards.length, runs: report.runs.map(row => ({ label: row.label, code: row.outer.code, passed: row.capture?.verdict.observations.filter(item => item.pass).length, failed: row.capture?.verdict.failed, errors: row.capture?.verdict.errors })), error: report.error, sha256: digest(result) }));
process.exitCode = report.unsafeStop ? 78 : report.accepted ? 0 : 1;
