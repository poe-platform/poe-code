import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { regular, put, sha, oid, census } from '../common.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../../../..'), parent = path.resolve(here, '../..');
const started = performance.now();
const git = '/Library/Developer/CommandLineTools/usr/bin/git', metadata = [];
const call = (args, input) => {
  const result = spawnSync(git, args, { cwd: repo, input, timeout: 30000, maxBuffer: 32 * 1024 * 1024, env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  metadata.push({ args, status: result.status, signal: result.signal, bytes: result.stdout?.length, sha256: sha(result.stdout ?? Buffer.alloc(0)) });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.stderr.length, 0); return result.stdout;
};
const requests = [];
for (const [revision, paths] of [
  ['9e5a5ad16e62a09b9dffa1e11484f78d9fa00482', ['tests/commands/git-independent-20260828/adapter-v9']],
  ['8165ba691311594e87f32f4475a33c57fda65f0d', ['tests/commands/git-independent-20260828/adapter-pilot-v10']],
  ['655cb37b97521558c4c90581b5b23fc6c3ad9bf2', ['tests/commands/git-independent-20260828/m1a-review-v5/INPUTS.json', 'tests/commands/git-independent-20260828/m1a-review-v5/cases.mjs', 'tests/commands/git-independent-20260828/m1a-review-v5/PRESEAL.json', 'tests/commands/git-author-20260828/results-v1/PACKAGE.tgz.base64']],
]) {
  const bytes = call(['ls-tree', '-r', '-z', revision, '--', ...paths]); let cursor = 0;
  while (cursor < bytes.length) {
    const end = bytes.indexOf(0, cursor); assert.ok(end > cursor);
    const row = bytes.subarray(cursor, end), tab = row.indexOf(9), header = /^(100644|100755) blob ([a-f0-9]{40})$/.exec(row.subarray(0, tab).toString()); assert.ok(header);
    const filename = row.subarray(tab + 1).toString(); assert.ok(!filename.includes('\n') && !filename.split('/').includes('AGENTS.md'));
    requests.push({ revision, path: filename, blob: header[2], mode: header[1] === '100755' ? 0o755 : 0o644 }); cursor = end + 1;
  }
}
const blobs = call(['cat-file', '--batch'], requests.map(row => row.blob + '\n').join(''));
let cursor = 0;
for (const row of requests) {
  const end = blobs.indexOf(10, cursor), header = /^([a-f0-9]{40}) blob ([0-9]+)$/.exec(blobs.subarray(cursor, end).toString()); assert.ok(header); assert.equal(header[1], row.blob);
  const size = Number(header[2]), bytes = blobs.subarray(end + 1, end + 1 + size); assert.equal(bytes.length, size); assert.equal(oid(bytes), row.blob); assert.equal(blobs[end + 1 + size], 10); cursor = end + 2 + size;
  assert.deepEqual(regular(path.join(repo, row.path)), bytes); assert.equal(fs.lstatSync(path.join(repo, row.path)).mode & 0o777, row.mode); row.bytes = size; row.sha256 = sha(bytes);
}
assert.equal(cursor, blobs.length);
const pilot = path.join(parent, 'adapter-pilot-v10'), v9 = path.join(parent, 'adapter-v9');
const json = filename => JSON.parse(regular(filename));
const pilotSeal = json(path.join(pilot, 'PRESEAL.json')), v9Seal = json(path.join(v9, 'PRESEAL.json'));
assert.equal(sha(regular(path.join(pilot, 'PRESEAL.json'))), 'beb3d156a1dff4730ea156ca6ba8e2b888619d428a8db5673bf194201511d24c');
assert.equal(sha(regular(path.join(v9, 'adapter.mjs'))), 'c789e86bea280a3b76a56d9721b4ce262306fdfdcb5677e71c67348af3374628');
for (const [root, seal] of [[pilot, pilotSeal], [v9, v9Seal]]) for (const row of seal.files) assert.equal(sha(regular(path.join(root, row.path))), row.sha256);
const packageData = json(path.join(pilot, 'PACKAGE-DATA.json'));
const oldSeal = json(path.join(parent, 'm1a-review-v5/PRESEAL.json'));
const compressed = Buffer.from(regular(oldSeal.packagePath).toString(), 'base64'); assert.equal(sha(compressed), oldSeal.packageSha256); assert.equal(sha(compressed), packageData.packageSha256); assert.equal(compressed.length, packageData.packageBytes);
const tar = gunzipSync(compressed, { maxOutputLength: 16 * 1024 * 1024 }), members = new Map();
for (let offset = 0; offset < tar.length;) {
  const header = tar.subarray(offset, offset + 512); assert.equal(header.length, 512);
  if (header.every(value => value === 0)) { assert.ok(tar.subarray(offset).every(value => value === 0)); break; }
  const text = (start, length) => header.subarray(start, start + length).toString().split('\0')[0];
  assert.ok(header[156] === 0 || header[156] === 48, 'regular tar only'); assert.equal(text(345, 155), '');
  const name = text(0, 100); assert.ok(name.startsWith('package/')); const filename = name.slice(8); assert.ok(filename && !filename.startsWith('/') && !filename.split('/').some(part => ['..', '.', 'AGENTS.md'].includes(part)) && !members.has(filename));
  const size = Number.parseInt(text(124, 12).trim(), 8), mode = Number.parseInt(text(100, 8).trim(), 8) & 0o777; assert.ok(Number.isSafeInteger(size) && size >= 0);
  const checksum = [...header].reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0); assert.equal(checksum, Number.parseInt(text(148, 8).trim(), 8));
  const bytes = tar.subarray(offset + 512, offset + 512 + size); assert.equal(bytes.length, size); members.set(filename, { bytes: size, sha256: sha(bytes), mode }); offset += 512 + Math.ceil(size / 512) * 512;
}
assert.equal(members.size, 898); assert.equal(packageData.members.length, members.size);
for (const member of packageData.members) { const actual = members.get(member.path); assert.ok(actual); assert.equal(actual.sha256, member.sha256); assert.equal(actual.bytes, member.bytes); }
for (const member of packageData.modules) { const bytes = Buffer.from(member.base64, 'base64'); assert.equal(sha(bytes), member.sha256); assert.equal(bytes.length, member.bytes); assert.equal(members.get(member.path).sha256, member.sha256); }
const transforms = json(path.join(pilot, 'TRANSFORMS.json')), inputs = json(path.join(parent, 'm1a-review-v5/INPUTS.json'));
const transformProofs = [];
for (const item of [...transforms.moduleTransforms, transforms.caseOverlay]) {
  const original = Buffer.from(item.originalBase64 ?? item.sourceBase64, 'base64'), expected = item.originalSha256 ?? item.sha256;
  assert.equal(sha(original), expected);
  if (item.path.startsWith('src/')) { const input = inputs.find(row => row.path === item.path); assert.equal(input.sha256, expected); assert.equal(sha(Buffer.from(input.base64, 'base64')), expected); }
  else assert.deepEqual(original, regular(path.join(repo, item.path)));
  let changed = original.toString(); for (const change of item.changes) { assert.equal(changed.split(change.before).length, 2); changed = changed.replace(change.before, change.after); }
  changed = item.prefix + changed; assert.equal(sha(changed), item.transformedSha256); assert.equal(changed, Buffer.from(item.transformedBase64, 'base64').toString());
  let restored = changed.slice(item.prefix.length); for (const change of [...item.changes].reverse()) { assert.equal(restored.split(change.after).length, 2); restored = restored.replace(change.after, change.before); } assert.equal(restored, original.toString());
  for (const expression of [/\bawait\b/g, /\.then\s*\(/g, /\.catch\s*\(/g]) assert.equal((changed.match(expression) ?? []).length, (restored.match(expression) ?? []).length);
  transformProofs.push({ path: item.path, originalSha256: expected, transformedSha256: item.transformedSha256, reversed: true, sameContinuationSyntaxCounts: true });
}
const modules = json(path.join(pilot, 'RUN-01/MODULES.json')); assert.equal(modules.files.length, 228);
for (const row of modules.files) { assert.equal(sha(regular(row.path)), row.sha256); assert.equal(fs.statSync(row.path).size, row.bytes); if (row.role === 'authenticated-original-emit') assert.equal(members.get(path.relative(path.join(pilot, 'RUN-01/app'), row.path)).sha256, row.sha256); }
const prior = json(path.join(here, '../SEAL.json'));
const role = filename => ({ path: path.relative(repo, filename), bytes: fs.statSync(filename).size, mode: fs.statSync(filename).mode & 0o777, sha256: sha(regular(filename)) });
const helperRoles = prior.roles.filter(row => row.path.startsWith('tests/shell/')).concat(role(path.join(here, '../common.mjs')));
for (const row of helperRoles) assert.deepEqual(role(path.join(repo, row.path)), row);
const names = ['PRESEAL.md', 'bootstrap.mjs', 'counter.mjs', 'prepare.mjs', 'run.mjs'];
const protectedTrees = ['m1a-review-v5', 'observer-qualification-v6', 'observer-qualification-v7', 'observer-qualification-v8', 'adapter-v9', 'adapter-pilot-v10'].map(name => ({ root: path.join(parent, name), entries: census(path.join(parent, name)) }));
const oldIndependent = path.resolve(here, '..');
const priorFiles = Object.entries(census(oldIndependent)).filter(([name]) => !name.startsWith('adapter-v10-review/'));
const node = pilotSeal.node; assert.equal(sha(regular(node.path)), node.sha256);
const policy = { ...prior.policy, maxRuntimeWorkerMs: 120000, maxRuntimeWorkerCaptureBytes: 16 * 1024 * 1024, maxRecordBytes: 12 * 1024 * 1024, maxPersistedEvidenceBytes: 32 * 1024 * 1024 };
const seal = { schema: 'independent-adapter-v10-no-build', label: 'GIT-ADAPTER-V10-INDEPENDENT-01', node, policy, metadata, bindings: requests, roles: [...helperRoles, ...names.map(name => role(path.join(here, name)))], protectedTrees, priorIndependent: { root: oldIndependent, entries: Object.fromEntries(priorFiles), excludedNewOwnedDirectory: 'adapter-v10-review/' }, package: { sha256: sha(compressed), bytes: compressed.length, members: members.size, fullTarMemberDigest: sha(JSON.stringify([...members])) }, transforms: transformProofs, v9Names: ['PRESEAL.json', ...v9Seal.files.map(row => row.path)], pilotNames: ['PRESEAL.json', 'records.json', 'worker.mjs', 'adapter.mjs', 'cases.mjs', 'fixtures.mjs'], expected: { originalControls: 12, independentSynthetic: 4, pilot: ['A57', 'A60', 'H09'], streams: [6, 6, 3], sourceEmits: 224, originalEmits: 219, instrumentedEmits: 5, unmodifiedSemanticCredit: 0, children: 3 }, preparationMs: performance.now() - started };
put(path.join(here, 'SEAL.json'), Buffer.from(JSON.stringify(seal, null, 2) + '\n'));
console.log(JSON.stringify({ sealSha256: sha(regular(path.join(here, 'SEAL.json'))), bindings: requests.length, packageMembers: members.size, transforms: transformProofs.length, metadataChildren: metadata.length, preparationMs: performance.now() - started, candidateExecutions: 0 }));
