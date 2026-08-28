import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { sha, object, regular, put, census, inventory, members, compose } from './common.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const author = path.join(repo, 'tests/integration/coherent78-arrays-author-20260828');
const sourceBytes = regular(path.join(author, 'SOURCE.json')); assert.equal(sha(sourceBytes), 'fe906972d6e0d34c99b45930e584b6177c5780e2ceddc83ea48418c64ee4f465');
assert.equal(object('blob', sourceBytes), 'fb0406337adfe6896376493c78288ec2d26cdb62');
const source = JSON.parse(sourceBytes), baseBytes = regular(path.join(repo, 'tests/integration/coherent78-shell-independent-20260828/RAW-v2.json.gz.base64'));
assert.equal(sha(baseBytes), source.baseEvidenceSha256); const base = JSON.parse(gunzipSync(Buffer.from(baseBytes.toString().trim(), 'base64'), { maxOutputLength: 64 * 1024 * 1024 }));
const arrayBytes = regular(path.join(repo, source.arrayBinding.path)); assert.equal(sha(arrayBytes), source.arrayBinding.sha256); const array = JSON.parse(arrayBytes);
const paths = ['src/shell/parser.ts','src/shell/runtime.ts',...['bindings','ledger','state','syntax'].map(name => `src/shell/arrays/${name}.ts`)];
assert.deepEqual([...source.overrides.map(row => row.path)].sort(), [...paths].sort());
const selected = new Map(base.source.inputs.map(row => [row.path, row])); for (const name of paths) selected.set(name, array.selectedSource.find(row => row.path === name));
assert.equal(selected.size, 272); for (const row of source.inputs) { const expected = selected.get(row.path); assert.ok(expected); for (const key of ['blob','mode','bytes','sha256']) assert.equal(row[key], expected[key]); }
const trees = new Map([...base.source.reachableTrees, ...base.source.reconstructedTrees].map(row => [row.oid, Buffer.from(row.base64, 'base64')]));
assert.equal(compose(trees, source.base, []), '8437e4eda904e1248c25eeef0d9d455b1d251495');
assert.equal(compose(trees, '37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e', source.overrides), '30f88590b66b88dc9694a56c85f1ee690f02218b');
assert.equal(compose(trees, source.base, source.overrides), 'd111e5bf1f53aff16c5d4112e9ead2e025d6464f');
const tarBytes = regular(path.join(author, 'PACKAGE.tgz.base64')); assert.equal(object('blob', tarBytes), 'bc3cd07cb7533045feb5f7e997f22dd04027e74c'); const tar = Buffer.from(tarBytes.toString().trim(), 'base64');
assert.equal(sha(tar), 'f5152eaeaaeb78aff350a86d55f67905c2caab900ba2f45b1869da6498e1e956'); assert.equal(tar.length, 795138);
const packageEntries = inventory(tar), baselineEntries = inventory(Buffer.from(base.pack.base64, 'base64')); assert.equal(Object.keys(packageEntries).length, 874);
const added = Object.keys(packageEntries).filter(name => !baselineEntries[name]), removed = Object.keys(baselineEntries).filter(name => !packageEntries[name]);
const changed = Object.keys(baselineEntries).filter(name => packageEntries[name] && JSON.stringify(packageEntries[name]) !== JSON.stringify(baselineEntries[name]));
assert.deepEqual(removed, []); assert.equal(added.length, 16); assert.ok(added.every(name => /^dist\/shell\/arrays\/(bindings|ledger|state|syntax)\.(js|js.map|d.ts|d.ts.map)$/u.test(name))); assert.equal(changed.length, 7); assert.ok(changed.every(name => /^dist\/shell\/(parser|runtime)\./u.test(name)));
for (const name of ['package.json','dist/index.js','dist/index.d.ts','dist/shell/shell.js','dist/shell/parser.d.ts','dist/plugins/index.js']) assert.deepEqual(packageEntries[name], baselineEntries[name]);
const metadata = JSON.parse(members(tar).get('package.json').bytes); for (const field of ['dependencies','optionalDependencies','peerDependencies']) assert.deepEqual(Object.keys(metadata[field] ?? {}), []);
const hashes = [...new Set([...source.inputs.map(row => row.blob), ...source.inputs.map(row => row.revision ?? row.commit)])]; assert.ok(hashes.every(hash => /^[a-f0-9]{40}$/u.test(hash)));
const git = '/Library/Developer/CommandLineTools/usr/bin/git';
const result = spawnSync(git, ['-C', repo, 'cat-file', '--batch'], { input: hashes.join('\n') + '\n', timeout: 30000, maxBuffer: 16 * 1024 * 1024, env: { PATH: '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' } });
assert.equal(result.status, 0); assert.equal(result.signal, null); const objects = new Map(); let offset = 0;
for (const hash of hashes) { const end = result.stdout.indexOf(10, offset), header = result.stdout.subarray(offset, end).toString().split(' '); assert.equal(header[0], hash); assert.ok(['blob','commit'].includes(header[1])); const length = Number(header[2]), bytes = result.stdout.subarray(end + 1, end + 1 + length); assert.equal(object(header[1], bytes), hash); assert.equal(result.stdout[end + 1 + length], 10); objects.set(hash, { type: header[1], bytes }); offset = end + 2 + length; } assert.equal(offset, result.stdout.length);
const dataRoot = path.join(here, 'PREPARED'); assert.ok(!fs.existsSync(dataRoot)); fs.mkdirSync(dataRoot);
for (const row of source.inputs) { assert.ok(row.path.split('/').every(part => part && part !== '..' && part !== '.' && part !== 'AGENTS.md')); const item = objects.get(row.blob); assert.equal(item.type, 'blob'); assert.equal(item.bytes.length, row.bytes); assert.equal(sha(item.bytes), row.sha256); assert.equal(objects.get(row.revision ?? row.commit).type, 'commit'); put(path.join(dataRoot, 'source', row.path), item.bytes, parseInt(row.mode, 8) & 0o777); }
put(path.join(dataRoot, 'candidate.tgz'), tar);
const tools = {};
for (const name of ['typescript','@types/node','undici-types','npm']) {
  const tool = base.tools[name], seen = []; const walk = directory => { for (const item of fs.readdirSync(directory)) { const filename = path.join(directory, item), stat = fs.lstatSync(filename); if (stat.isDirectory()) walk(filename); else seen.push(path.relative(tool.origin, filename)); } }; walk(tool.origin); assert.deepEqual(seen.sort(), tool.originalRows.map(row => row[0]).sort());
  const links = [];
  for (const [relative, mode, bytes, digest] of tool.originalRows) { const filename = path.join(tool.origin, relative), stat = fs.lstatSync(filename); if (mode === 'SYMLINK') { assert.ok(stat.isSymbolicLink()); assert.equal(fs.readlinkSync(filename), bytes); assert.ok(tool.omittedInternalBinLinks.some(row => row[0] === relative && row[1] === bytes)); const resolved = fs.realpathSync(filename); assert.ok(resolved.startsWith(fs.realpathSync(tool.origin) + '/')); const target = tool.originalRows.find(row => row[0] === path.relative(fs.realpathSync(tool.origin), resolved)); assert.ok(target && target[1] !== 'SYMLINK'); assert.equal(sha(regular(resolved)), target[3]); links.push({ path: relative, mode: stat.mode & 0o777, text: bytes, target: target[0], sha256: target[3], omittedNotFollowed: true }); } else { const content = regular(filename); assert.equal(stat.mode & 0o777, mode); assert.equal(content.length, bytes); assert.equal(sha(content), digest); put(path.join(dataRoot, 'tools', name, relative), content, mode); } }
  tools[name] = { origin: tool.origin, version: tool.version, originalRows: tool.originalRows, links, root: path.join(dataRoot, 'tools', name), entries: census(path.join(dataRoot, 'tools', name)) };
}
assert.equal(tools.npm.links.length, 12); assert.equal(sha(regular(base.tools.node.origin)), base.tools.node.sha256);
const prepared = { kind: 'independent immutable composition/package/tool DATA authentication; zero product executions', author: 'b9039b80ebf4c7f454a0614871d7b03b1aeaaf1d', base: source.base, array: source.array, derived: source.computedTree, selectedSource: source.inputs, sourceRoot: path.join(dataRoot, 'source'), sourceCensus: census(path.join(dataRoot, 'source')), packageSha256: sha(tar), packageBytes: tar.length, packageEntries, baselinePackageSha256: sha(Buffer.from(base.pack.base64,'base64')), added, changed, removed, tools, node: base.tools.node, gitMetadata: { executable: git, code: result.status, bytes: result.stdout.length, objects: hashes.length, paths: 'NUL-delimited canonical tree bytes, not line-based ls-tree parsing', noDerivedObjectLookup: true }, sourceManifestSha256: sha(sourceBytes) };
put(path.join(here, 'AUTHENTICATION.json'), JSON.stringify(prepared, null, 2) + '\n');
console.log(JSON.stringify({ derived: prepared.derived, inputs: source.inputs.length, members: Object.keys(packageEntries).length, added, changed, toolLinks: tools.npm.links.length, gitChildren: 1, productExecutions: 0 }));
