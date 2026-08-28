import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { assertTree, git, hash, json, packInventory, save } from '../execution-prep-v1/artifacts.mjs';
import { classify, supervise } from '../execution-prep-v1/protocol.mjs';

const scope = dirname(fileURLToPath(import.meta.url)), owned = dirname(scope), repository = resolve(owned, '../../..');
const [preseal, label] = process.argv.slice(2); assert.match(preseal, /^[a-f0-9]{40}$/u); assert.match(label, /^[a-z0-9-]+$/u);
for (const [name, digest] of Object.entries(json(join(scope, 'SEAL.json')))) {
  assert.equal(hash(readFileSync(join(scope, name))), digest);
  assert.equal(hash(git(repository, ['show', `${preseal}:tests/shell/let-independent-20260828/settlement-v2/${name}`])), digest);
}
const tools = json(join(owned, 'execution-prep-v1/TOOLS.json'));
assert.equal(realpathSync(process.execPath), tools.node.path); assert.equal(hash(readFileSync(process.execPath)), tools.node.sha256);
const packPath = 'tests/shell/let-independent-20260828/actual-frozen-02/virtual-bash-0.0.0.tgz';
const pack = readFileSync(join(repository, packPath)); assert.deepEqual(pack, git(repository, ['show', `b3457383dffdcc66a72c36fadbea679bcf045131:${packPath}`]));
assert.equal(hash(pack), '21c4858e6e4b857cd5e0d526159667621bcd206b4f1fd1ce1f84b54ad7abbace');
const members = packInventory(pack); assert.equal(Object.keys(members).length, 846);
const output = join(owned, `settlement-results-${label}`); assert.equal(existsSync(output), false); mkdirSync(output);
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'let-settlement-'))), consumer = join(scratch, 'moved'), product = join(consumer, 'node_modules/virtual-bash'), harness = join(consumer, 'harness');
const report = { preseal, packageSha256: hash(pack), node: tools.node, runs: [], completed: false };
try {
  mkdirSync(harness, { recursive: true }); writeFileSync(join(consumer, 'package.json'), '{"type":"module","private":true}');
  const raw = gunzipSync(pack), text = bytes => bytes.toString().split('\0')[0];
  for (let offset = 0; offset + 512 <= raw.length && raw[offset] !== 0;) {
    const header = raw.subarray(offset, offset + 512), name = text(header.subarray(0, 100)).slice(8), size = parseInt(text(header.subarray(124, 136)).trim(), 8);
    assert.ok(Object.hasOwn(members, name)); const target = join(product, name); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, raw.subarray(offset + 512, offset + 512 + size), { flag: 'wx' }); chmodSync(target, members[name].mode);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assertTree(product, members);
  const frozen = { ...json(join(owned, 'SEAL.json')), ...Object.fromEntries(Object.entries(json(join(owned, 'execution-prep-v1/SEAL.json'))).map(([name, digest]) => [`execution-prep-v1/${name}`, digest])), 'settlement-v1/late-exit.mjs': hash(readFileSync(join(owned, 'settlement-v1/late-exit.mjs'))) };
  for (const [name, digest] of Object.entries(frozen)) {
    const source = join(owned, name); assert.equal(hash(readFileSync(source)), digest);
    const revision = name.startsWith('settlement-v1/') ? preseal : '7a4ccb782cfbeca21ca710aa6f8f8839e491dc41';
    assert.equal(hash(git(repository, ['show', `${revision}:tests/shell/let-independent-20260828/${name}`])), digest);
    const destination = join(harness, name); mkdirSync(dirname(destination), { recursive: true }); copyFileSync(source, destination);
  }
  const manifest = { kind: 'let-independent-loaded-candidate-v1', baseline: '5137a74ec855a32d8a8860eb66b62eb44d11e290', holdouts: json(join(owned, 'SEAL.json')), candidate: 'c26892c3a1a419311c9cf46a6c2976e696e00624', layout: 'moved', packageRoot: product, harnessRoot: harness, nodeSha256: tools.node.sha256, files: Object.fromEntries(Object.entries(members).map(([name, entry]) => [name, entry.sha256])), harnessFiles: frozen, caseIds: ['P21'] };
  const admission = join(consumer, 'manifest.json'); save(admission, manifest); const digest = hash(readFileSync(admission));
  for (const mode of ['normal', 'late-exit']) {
    const entry = mode === 'normal' ? 'execution-prep-v1/literal-entry.mjs' : 'settlement-v1/late-exit.mjs';
    const args = ['--permission', ...[consumer, process.execPath].map(path => `--allow-fs-read=${path}`), '--import', join(harness, 'execution-prep-v1/load-guard.mjs'), join(harness, entry), admission, digest];
    const run = await supervise(process.execPath, args, { cwd: consumer, env: { PATH: dirname(process.execPath), HOME: scratch, TMPDIR: scratch, LC_ALL: 'C', TZ: 'UTC', LET_MANIFEST: admission, LET_MANIFEST_SHA256: digest } });
    const result = classify(run, ['P21'], { modulePath: join(product, 'dist/shell/runtime.js'), moduleSha256: members['dist/shell/runtime.js'].sha256 });
    save(join(output, `${mode}.json`), { run, result }); report.runs.push({ mode, result, sha256: hash(readFileSync(join(output, `${mode}.json`))) });
    assert.equal(run.code, mode === 'normal' ? 0 : 7); assert.equal(run.failure, null); assert.equal(run.signal, null); assert.equal(run.spawnError, null); assert.equal(run.groupAbsent, true);
    assert.equal(result.passed, 1); assert.deepEqual(result.failed, []); assert.equal(result.accepted, mode === 'normal');
    assert.deepEqual(result.errors, mode === 'normal' ? [] : ['exit status contradicts body outcomes']);
  }
  assertTree(product, members); report.completed = true;
} catch (error) { report.failure = { name: error.name, message: error.message, stack: error.stack }; }
finally { rmSync(scratch, { recursive: true, force: true }); report.scratchRemoved = !existsSync(scratch); save(join(output, 'REPORT.json'), report); }
process.stdout.write(JSON.stringify({ completed: report.completed, children: report.runs.length, failure: report.failure?.message, output }) + '\n');
if (!report.completed) process.exitCode = 1;
