import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { census, digest, tarInventory, verifyProjection, verifyTree } from '../executor-v1/boundary.mjs';
import { supervise } from '../executor-v1/supervisor.mjs';
import { runTypes, typeCases } from '../executor-v1/types.mjs';
import { verifyTool } from './npm-tool.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const own = path.dirname(here);
const candidate = '50117fc54fdfd650e8f57e84b82ba21297ab8a0f';
const product = 'c7dae6e884d1a144266dfc1bb80785bf007a667f';
const evidence = '38b2318d052e6db344a02bce3b637e8642114b29';
const rootReceipt = 'bf556110';
const node = { path: fs.realpathSync(process.execPath), version: process.version, sha256: digest(fs.readFileSync(process.execPath)) };
assert.equal(node.version, 'v22.22.2');
assert.equal(node.sha256, '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: root, timeout: 10000, maxBuffer: 32 * 1024 * 1024 });
const readGit = (revision, filename) => git('show', `${revision}:${filename}`);
const baselinePath = path.join(own, 'executor-v1/BASELINE.json');
assert.equal(digest(fs.readFileSync(baselinePath)), 'c154ccc9f221080d3b19f0a3dc3eff38529ef9e16c464317fa3635f8789ad21d');
const baseline = JSON.parse(fs.readFileSync(baselinePath));
const sourceFiles = new Map();
const sourceProjection = baseline.source.map(entry => {
  const original = readGit(entry.commit, entry.path); assert.equal(digest(original), entry.sha256);
  const changed = ['src/shell/runtime.ts', 'src/shell/parser.ts'].includes(entry.path);
  const bytes = changed ? readGit(product, entry.path) : original;
  const next = changed ? { ...entry, commit: product, bytes: bytes.length, blob: git('rev-parse', `${product}:${entry.path}`).toString().trim(), sha256: digest(bytes) } : entry;
  sourceFiles.set(entry.path, bytes); return next;
});
for (const name of ['ledger', 'bindings', 'state', 'syntax']) {
  const filename = `src/shell/arrays/${name}.ts`, bytes = readGit(product, filename);
  sourceProjection.push({ path: filename, commit: product, mode: '100644', blob: git('rev-parse', `${product}:${filename}`).toString().trim(), bytes: bytes.length, sha256: digest(bytes) });
  sourceFiles.set(filename, bytes);
}
assert.equal(sourceProjection.length, 269);
const projection = verifyProjection(baseline.source, sourceProjection); assert.deepEqual(projection.unapprovedChanges, []);
const authorRoot = 'tests/shell/indexed-arrays-author-20260828';
const seal = JSON.parse(readGit(evidence, `${authorRoot}/FOUNDATION-SEAL.json`));
const last = seal.captures.at(-1);
const encoded = readGit(evidence, `${authorRoot}/${last.filename}`); assert.equal(digest(encoded), last.capsuleSha256);
const decoded = gunzipSync(Buffer.from(encoded.toString().trim(), 'base64'), { maxOutputLength: 64 * 1024 * 1024 });
assert.equal(digest(decoded), last.decodedSha256);
const capsule = JSON.parse(decoded);
assert.equal(capsule.revision, candidate);
for (const [filename, item] of Object.entries(capsule.overlays).filter(([name]) => name.startsWith('src/'))) assert.equal(digest(sourceFiles.get(filename)), item.sha256);
const authorTar = Buffer.from(capsule.package.base64, 'base64');
assert.equal(digest(authorTar), '0fadca03da4e100c7dd5b7df0a25d321467f9f1f9fbd288ebcc4456746945d26');
const authorInventory = tarInventory(authorTar); assert.equal(Object.keys(authorInventory).length, 862);
const toolBinding = JSON.parse(readGit('8fa48028', 'tests/shell/dotglob-independent-20260828/stack-binding-v1/BINDING.json'));
for (const tool of toolBinding.typeTools) {
  const actual = census(tool.root);
  assert.deepEqual(Object.fromEntries(Object.entries(actual).filter(([, item]) => !item.directory)), tool.inventory.files);
}
const npmRoot = path.resolve(path.dirname(node.path), '../lib/node_modules/npm');
const npmInventory = fs.readFileSync(path.join(here, 'NPM-TOOL-INVENTORY.json.gz.base64'));
assert.equal(digest(npmInventory), '5623653d01886efdbb55e5a4c6b387ba8af00e4b4673740caf23a482ce473af4');
const npmDecoded = gunzipSync(Buffer.from(npmInventory.toString().trim(), 'base64'), { maxOutputLength: 2 * 1024 * 1024 });
assert.equal(digest(npmDecoded), '1a09d4358a33e162bcc6fc260258d70089a0acdc463d0b0dac56f3f232dcf4ce');
const npmTree = verifyTool(JSON.parse(npmDecoded));
assert.equal(npmTree.root, npmRoot);
const npmCLI = path.join(npmRoot, 'bin/npm-cli.js');
assert.equal(npmTree.entries.find(entry => entry.path === 'bin/npm-cli.js').sha256, '8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7');
const work = fs.mkdtempSync(path.join(here, 'admission-'));
const report = { kind: 'array-independent-candidate-admission-v1', candidate, product, evidence, reviewerScriptSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))), rootReceipt: git('rev-parse', rootReceipt).toString().trim(), node, work, sourceProjection, sourceProjectionSha256: projection.projectionSha256, commands: [], types: [], accepted: false, productRuntimeImports: 0, nativeCalls: 0 };
report.npmTool = { root: npmRoot, version: '10.9.7', inventorySha256: digest(npmDecoded), linkCount: npmTree.links.length, validatorSha256: digest(fs.readFileSync(path.join(here, 'npm-tool.mjs'))) };
const sourceRoot = path.join(work, 'source');
const buildRoot = path.join(work, 'build');
const artifacts = path.join(work, 'artifacts');
const tools = path.join(work, 'tools');
const app = path.join(work, 'source-app');
const harness = path.join(app, 'harness');
const packageRoot = path.join(app, 'node_modules/virtual-bash');
for (const directory of [sourceRoot, buildRoot, artifacts, tools, harness, path.join(work, 'home')]) fs.mkdirSync(directory, { recursive: true });
function put(filename, bytes, mode = 0o644) {
  assert.ok(filename.startsWith(work + '/')); assert.ok(!filename.split('/').includes('AGENTS.md'));
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, bytes, { flag: 'wx', mode });
}
function copyTool(tool, destination) {
  for (const [filename, expected] of Object.entries(tool.inventory.files)) {
    const bytes = fs.readFileSync(path.join(tool.root, filename)); assert.equal(digest(bytes), expected.sha256);
    put(path.join(destination, filename), bytes, expected.mode);
  }
}
async function command(label, args, cwd, timeoutMs = 120000) {
  verifyTool(npmTree); assert.equal(digest(fs.readFileSync(node.path)), node.sha256);
  const run = await supervise(node.path, args, { cwd, env: { PATH: path.dirname(node.path), HOME: path.join(work, 'home'), TMPDIR: work, LC_ALL: 'C', TZ: 'UTC', npm_config_cache: path.join(work, 'cache') }, timeoutMs, maxBytes: 2 * 1024 * 1024 });
  report.commands.push({ label, args, cwd, run });
  verifyTool(npmTree); assert.equal(digest(fs.readFileSync(node.path)), node.sha256);
  assert.ok(run.closeObserved && run.groupAbsent && !run.fault && !run.signal && !run.spawnError, `${label}: unsafe child`);
  assert.equal(run.code, 0, `${label}: ${run.stderr}`); return run;
}
try {
  const patches = [];
  for (const [filename, bytes] of sourceFiles) {
    assert.equal(Buffer.from(bytes.toString()).compare(bytes), 0, 'selected regular UTF8 source');
    for (const directory of [sourceRoot, buildRoot]) {
      const destination = path.join(directory, filename);
      assert.ok(!destination.split('/').includes('AGENTS.md'));
      const text = bytes.toString();
      assert.ok(text.endsWith('\n'), 'apply_patch preserves selected final newline');
      patches.push(`*** Add File: ${destination}\n${text.slice(0, -1).split('\n').map(line => '+' + line).join('\n')}`);
    }
  }
  execFileSync('apply_patch', [], { input: `*** Begin Patch\n${patches.join('\n')}\n*** End Patch\n`, maxBuffer: 2 * 1024 * 1024, timeout: 30000 });
  for (const [filename, bytes] of sourceFiles) for (const directory of [sourceRoot, buildRoot]) assert.equal(digest(fs.readFileSync(path.join(directory, filename))), digest(bytes));
  const sourceTree = { root: sourceRoot, entries: census(sourceRoot) };
  for (const tool of toolBinding.typeTools) {
    copyTool(tool, path.join(tools, 'node_modules', tool.name));
    if (tool.name !== 'typescript') {
      copyTool(tool, path.join(buildRoot, 'node_modules', tool.name));
      copyTool(tool, path.join(app, 'node_modules', tool.name));
    }
  }
  const compiler = path.join(tools, 'node_modules/typescript/bin/tsc');
  await command('selected-production-build', [compiler, '-p', 'tsconfig.build.json'], buildRoot);
  verifyTree(sourceTree);
  const pack = await command('fresh-full-package', [npmCLI, 'pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', artifacts], buildRoot);
  verifyTool(npmTree);
  const packageTar = path.join(artifacts, JSON.parse(pack.stdout)[0].filename);
  const packed = fs.readFileSync(packageTar); report.package = { path: packageTar, sha256: digest(packed), files: Object.keys(tarInventory(packed)).length };
  assert.equal(report.package.sha256, digest(authorTar), 'fresh full package exactly root-selected author artifact');
  const tar = gunzipSync(packed, { maxOutputLength: 64 * 1024 * 1024 });
  for (let offset = 0; offset + 512 <= tar.length && tar[offset] !== 0;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().split('\0')[0].slice(8);
    const item = authorInventory[name]; assert.ok(item);
    const bytes = tar.subarray(offset + 512, offset + 512 + item.bytes); assert.equal(digest(bytes), item.sha256);
    put(path.join(packageRoot, name), bytes, item.mode);
    offset += 512 + Math.ceil(item.bytes / 512) * 512;
  }
  put(path.join(harness, 'package.json'), '{"private":true,"type":"module"}\n');
  const consumers = {};
  for (const expected of typeCases) {
    const bytes = fs.readFileSync(path.join(own, 'executor-v1', expected.fixture));
    const filename = path.join(harness, `${expected.id}.mts`); put(filename, bytes);
    consumers[expected.id] = { path: filename, sha256: digest(bytes) };
  }
  const typeTrees = [packageRoot, harness, tools, path.join(app, 'node_modules/@types/node'), path.join(app, 'node_modules/undici-types')].map(directory => ({ root: directory, entries: census(directory) }));
  const binding = { action: 'root-authorized-array-types', candidate, rootReceipt: report.rootReceipt, node, compiler: { path: compiler, sha256: digest(fs.readFileSync(compiler)) }, trees: typeTrees, consumers, consumerRoot: harness, rootDeclaration: path.join(packageRoot, 'dist/index.d.ts'), parserDeclaration: path.join(packageRoot, 'dist/shell/parser.d.ts') };
  report.types = await runTypes(binding);
  report.accepted = report.types.length === 9 && report.types.every(row => row.accepted);
  report.sourceTree = sourceTree; report.typeTrees = typeTrees; report.packageRoot = packageRoot; report.harnessRoot = harness; report.tools = tools;
  report.unapprovedAstChanges = [];
  verifyTree(sourceTree); verifyTool(npmTree);
} catch (error) { report.error = String(error?.stack ?? error); }
const output = Buffer.from(JSON.stringify(report));
assert.ok(output.length <= 24 * 1024 * 1024);
fs.writeFileSync(path.join(work, 'ADMISSION.json'), output, { flag: 'wx' });
console.log(JSON.stringify({ work, accepted: report.accepted, commands: report.commands.map(item => ({ label: item.label, code: item.run.code })), types: report.types.map(item => ({ id: item.id, accepted: item.accepted, error: item.error })), error: report.error, sha256: digest(output) }));
if (!report.accepted) process.exitCode = 1;
