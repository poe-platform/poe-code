import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { census, digest, tarInventory, verifyTree } from '../executor-v1/boundary.mjs';
import { runTypes, typeCases } from '../executor-v1/types.mjs';
import { verifyTool } from './npm-tool.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../../../..');
const prefix = 'tests/shell/indexed-arrays-independent-20260828';
const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: repository, timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
const rootReceipt = git('log', '-1', '--format=%H', '--', `${prefix}/candidate-v1/APP-CLOSURE-PRESEAL.md`).toString().trim();
assert.match(rootReceipt, /^[a-f0-9]{40}$/u);
for (const filename of ['continue-types.mjs', 'APP-CLOSURE-PRESEAL.md']) assert.equal(digest(fs.readFileSync(path.join(here, filename))), digest(git('show', `${rootReceipt}:${prefix}/candidate-v1/${filename}`)));
for (const filename of ['types.mjs', ...typeCases.map(row => row.fixture)]) assert.equal(digest(fs.readFileSync(path.join(here, '../executor-v1', filename))), digest(git('show', `c290e6f1:${prefix}/executor-v1/${filename}`)));
const encoded = fs.readFileSync(path.join(here, 'ADMISSION-02.json.gz.base64'));
assert.equal(digest(encoded), '26f232de331bd326e018b2c152405777795c1ea982cd671bda8237c3ea2c8e5a');
const decoded = gunzipSync(Buffer.from(encoded.toString().trim(), 'base64'), { maxOutputLength: 16 * 1024 * 1024 });
assert.equal(digest(decoded), 'adfc29d7b8df6b8fd350e4cc39eeb00fde0301bb13eda2be87a1e41000972288');
const capsule = JSON.parse(decoded), originalBytes = Buffer.from(capsule.reportBase64, 'base64');
assert.equal(digest(originalBytes), 'dbfd2b0bbc628635fb78d87c754c0798f2662f546dc844cc05ed5d7ba1c0cd54');
const original = JSON.parse(originalBytes);
assert.equal(original.node.path, fs.realpathSync(process.execPath)); assert.equal(original.node.version, process.version);
assert.equal(digest(fs.readFileSync(process.execPath)), original.node.sha256);
const packed = Buffer.from(capsule.packageBase64, 'base64');
assert.equal(digest(packed), '0fadca03da4e100c7dd5b7df0a25d321467f9f1f9fbd288ebcc4456746945d26');
const packageInventory = tarInventory(packed); assert.equal(Object.keys(packageInventory).length, 862);
const npmEncoded = fs.readFileSync(path.join(here, 'NPM-TOOL-INVENTORY.json.gz.base64'));
assert.equal(digest(npmEncoded), '5623653d01886efdbb55e5a4c6b387ba8af00e4b4673740caf23a482ce473af4');
const npm = verifyTool(JSON.parse(gunzipSync(Buffer.from(npmEncoded.toString().trim(), 'base64'))));
const toolBinding = JSON.parse(git('show', '8fa48028:tests/shell/dotglob-independent-20260828/stack-binding-v1/BINDING.json'));
for (const tool of toolBinding.typeTools) assert.deepEqual(Object.fromEntries(Object.entries(census(tool.root)).filter(([, item]) => !item.directory)), tool.inventory.files);
const work = fs.mkdtempSync(path.join(here, 'complete-app-'));
const app = path.join(work, 'app'), tools = path.join(work, 'tools'), packageRoot = path.join(app, 'node_modules/virtual-bash');
const report = { kind: 'array-complete-app-type-continuation', rootReceipt, candidate: original.candidate, product: original.product, selectedTree: capsule.selectedTree, sourceProjection: original.sourceProjection, sourceProjectionSha256: original.sourceProjectionSha256, packageSha256: digest(packed), node: original.node, work, app, tools, packageRoot, types: [], accepted: false, buildExecutions: 0, npmExecutions: 0, productRuntimeImports: 0, nativeCalls: 0 };
function put(filename, bytes, mode = 0o644) {
  assert.ok(filename.startsWith(work + '/')); assert.ok(!filename.split('/').includes('AGENTS.md'));
  fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes, { flag: 'wx', mode });
  assert.equal(digest(fs.readFileSync(filename)), digest(bytes));
}
try {
  const tar = gunzipSync(packed, { maxOutputLength: 64 * 1024 * 1024 });
  for (let offset = 0; offset + 512 <= tar.length && tar[offset];) {
    const name = tar.subarray(offset, offset + 100).toString().split('\0')[0].slice(8), entry = packageInventory[name];
    assert.ok(entry); const bytes = tar.subarray(offset + 512, offset + 512 + entry.bytes); assert.equal(digest(bytes), entry.sha256);
    put(path.join(packageRoot, name), bytes, entry.mode); offset += 512 + Math.ceil(entry.bytes / 512) * 512;
  }
  for (const tool of toolBinding.typeTools) {
    const destinations = [path.join(tools, 'node_modules', tool.name), ...(tool.name === 'typescript' ? [] : [path.join(app, 'node_modules', tool.name)])];
    for (const [filename, entry] of Object.entries(tool.inventory.files)) {
      const bytes = fs.readFileSync(path.join(tool.root, filename)); assert.equal(digest(bytes), entry.sha256);
      for (const destination of destinations) put(path.join(destination, filename), bytes, entry.mode);
    }
  }
  put(path.join(app, 'package.json'), Buffer.from('{"private":true,"type":"module"}\n'));
  const consumers = {};
  for (const row of typeCases) {
    const bytes = git('show', `c290e6f1:${prefix}/executor-v1/${row.fixture}`), filename = path.join(app, `${row.id}.mts`);
    put(filename, bytes); consumers[row.id] = { path: filename, sha256: digest(bytes) };
  }
  const trees = [app, tools].map(root => ({ root, entries: census(root) }));
  assert.deepEqual(Object.fromEntries(Object.entries(census(packageRoot)).filter(([, item]) => !item.directory)), packageInventory);
  const compiler = path.join(tools, 'node_modules/typescript/bin/tsc');
  const binding = { action: 'root-authorized-array-types', candidate: original.candidate, rootReceipt, node: original.node, compiler: { path: compiler, sha256: digest(fs.readFileSync(compiler)) }, trees, consumers, consumerRoot: app, rootDeclaration: path.join(packageRoot, 'dist/index.d.ts'), parserDeclaration: path.join(packageRoot, 'dist/shell/parser.d.ts') };
  const bindingBytes = Buffer.from(JSON.stringify(binding)); put(path.join(work, 'TYPE-BINDING.json'), bindingBytes);
  report.bindingPath = path.join(work, 'TYPE-BINDING.json'); report.bindingSha256 = digest(bindingBytes);
  put(path.join(work, 'TYPE-PRELAUNCH.json'), Buffer.from(JSON.stringify({ kind: 'complete-finite-app-bound-before-dispatch', bindingSha256: report.bindingSha256, packageSha256: digest(packed), rootReceipt, node: original.node, roots: trees.map(tree => ({ root: tree.root, entries: Object.keys(tree.entries).length, sha256: digest(Buffer.from(JSON.stringify(tree.entries))) })), genericParentRead: false, sourceFallback: false })));
  verifyTool(npm); for (const tree of trees) verifyTree(tree);
  assert.equal(digest(packed), original.package.sha256);
  report.types = await runTypes(binding);
  for (const tree of trees) verifyTree(tree); verifyTool(npm);
  assert.equal(digest(fs.readFileSync(original.node.path)), original.node.sha256);
  assert.equal(digest(fs.readFileSync(report.bindingPath)), report.bindingSha256);
  report.accepted = report.types.length === 9 && report.types.every(row => row.accepted);
  report.unapprovedAstChanges = []; report.packageInventory = packageInventory;
} catch (error) { report.error = String(error?.stack ?? error); report.accepted = false; }
const output = Buffer.from(JSON.stringify(report));
assert.ok(output.length <= 24 * 1024 * 1024); put(path.join(work, 'TYPE-RESULT.json'), output);
console.log(JSON.stringify({ work, accepted: report.accepted, types: report.types.map(row => ({ id: row.id, accepted: row.accepted, code: row.run.code, error: row.error, closed: row.run.closeObserved, groupAbsent: row.run.groupAbsent })), error: report.error, sha256: digest(output) }));
if (!report.accepted) process.exitCode = 1;
