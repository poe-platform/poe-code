import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const own = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(own, '../../..');
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const objectHash = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
export function inputs() {
  const seal = JSON.parse(fs.readFileSync(path.join(own, 'PRESEAL.json')));
  const encoded = fs.readFileSync(path.join(repo, 'tests/integration/coherent78-shell-independent-20260828/RAW-v2.json.gz.base64')); assert.equal(sha(encoded), seal.baseEvidence);
  const base = JSON.parse(gunzipSync(Buffer.from(encoded.toString().trim(), 'base64'), { maxOutputLength: 67108864 }));
  const arrayBytes = fs.readFileSync(path.join(repo, 'tests/integration/apply-patch-public-20260829/SOURCE-v2.json')); assert.equal(sha(arrayBytes), seal.baseSourceSha256);
  const array = JSON.parse(arrayBytes); assert.equal(array.computedTree, seal.base);
  const readRows = (revision, paths) => {
    const result = spawnSync('/usr/bin/git', ['ls-tree', '-rz', revision, '--', ...paths], { cwd: repo, env: { PATH: '/usr/bin', GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 1048576, timeout: 5000 }); assert.equal(result.status, 0);
    return result.stdout.toString().split('\0').filter(Boolean).map(record => {
      const tab = record.indexOf('\t'), [mode, type, blob] = record.slice(0, tab).split(' '), name = record.slice(tab + 1); assert.equal(type, 'blob');
      const bytes = fs.readFileSync(path.join(repo, name)); assert.equal(objectHash('blob', bytes), blob, 'committed overlay changed: ' + name);
      return { path: name, mode, blob, bytes: bytes.length, sha256: sha(bytes), revision };
    });
  };
  const module = readRows(seal.moduleCommit, ['src/commands/git']); assert.equal(module.length, 14);
  const publicRows = readRows(seal.integrationCommit, seal.rootOverrides); assert.equal(publicRows.length, 4);
  const fixturePlan = JSON.parse(fs.readFileSync(path.join(own, 'FIXTURE-PLAN.json')));
  const fixtures = readRows(seal.fixtureCommit, fixturePlan.files.map(row => row.path)); assert.equal(fixtures.length, 5);
  const documentation = readRows(seal.integrationCommit, seal.metadataOverrides);
  const rows = new Map(array.inputs.map(row => [row.path, row])); for (const row of [...module, ...publicRows]) rows.set(row.path, row); assert.equal(rows.size, seal.expectedInputs);
  const trees = new Map([...array.ancestorTrees, ...array.fetchedTrees, ...array.reconstructedTrees].map(row => [row.oid, Buffer.from(row.base64, 'base64')]));
  for (const [oid, bytes] of trees) assert.equal(objectHash('tree', bytes), oid);
  const fetched = [];
  const treeBytes = oid => { if (!trees.has(oid)) { const result = spawnSync('/usr/bin/git', ['cat-file', 'tree', oid], { cwd: repo, env: { PATH: '/usr/bin', GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 4194304, timeout: 5000 }); assert.equal(result.status, 0); assert.equal(objectHash('tree', result.stdout), oid); trees.set(oid, result.stdout); fetched.push({ oid, base64: result.stdout.toString('base64') }); } return trees.get(oid); };
  const reconstructed = [];
  const overlay = (tree, selected) => {
    const bytes = tree ? treeBytes(tree) : Buffer.alloc(0); assert.ok(bytes);
    const entries = new Map();
    for (let cursor = 0; cursor < bytes.length;) {
      const space = bytes.indexOf(32, cursor), nul = bytes.indexOf(0, space);
      assert.ok(space > cursor && nul > space && nul + 21 <= bytes.length);
      const mode = bytes.subarray(cursor, space).toString(), nameBytes = bytes.subarray(space + 1, nul), name = nameBytes.toString();
      assert.ok(Buffer.from(name).equals(nameBytes));
      entries.set(name, { name, mode, oid: bytes.subarray(nul + 1, nul + 21).toString('hex') }); cursor = nul + 21;
    }
    const groups = new Map();
    for (const row of selected) {
      const slash = row.path.indexOf('/');
      if (slash < 0) entries.set(row.path, { name: row.path, mode: Number.parseInt(row.mode, 8).toString(8), oid: row.blob });
      else { const name = row.path.slice(0, slash); if (!groups.has(name)) groups.set(name, []); groups.get(name).push({ ...row, path: row.path.slice(slash + 1) }); }
    }
    for (const [name, children] of groups) entries.set(name, { name, mode: '40000', oid: overlay(entries.get(name)?.oid, children) });
    const ordered = [...entries.values()].sort((left, right) => Buffer.compare(Buffer.from(left.name + (left.mode === '40000' ? '/' : '')), Buffer.from(right.name + (right.mode === '40000' ? '/' : ''))));
    const body = Buffer.concat(ordered.map(row => Buffer.concat([Buffer.from(`${row.mode} ${row.name}\0`), Buffer.from(row.oid, 'hex')])));
    const oid = objectHash('tree', body); trees.set(oid, body); reconstructed.push({ oid, base64: body.toString('base64') }); return oid;
  };
  assert.equal(overlay(seal.base, []), seal.base);
  const manifest = { role: 'DERIVED_ONLY_GIT80_ON_PUBLIC79_PENDING_REVIEW', base: seal.base, moduleCommit: seal.moduleCommit, integrationCommit: seal.integrationCommit, computedTree: overlay(seal.base, [...module, ...publicRows, ...fixtures, ...documentation]), inputs: [...rows.values()], module, publicRows, fixtures, documentation, reconstructedTrees: reconstructed, fetchedTrees: fetched, ancestorTrees: [...array.ancestorTrees, ...array.fetchedTrees, ...array.reconstructedTrees], toolBindings: Object.fromEntries(Object.entries(base.tools).map(([name, tool]) => [name, { origin: tool.origin, version: tool.version, ...(tool.originalRows ? { inventorySha256: sha(Buffer.from(JSON.stringify(tool.originalRows))) } : { sha256: tool.sha256 }) }])) };
  return { seal, base, manifest };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ['--seal']);
  const { manifest } = inputs();
  fs.writeFileSync(path.join(own, 'SOURCE.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  const files = ['PRESEAL.json', 'SOURCE.json', 'FIXTURE-PLAN.json', 'FIXTURE-VERSIONS.json', 'prepare.mjs', 'run.mjs', 'public.mjs', 'resources.mjs', 'names.mjs', 'loader.mjs', 'consumer.ts.fixture', 'apply-public.mjs', 'm1a.mjs', 'packs.mjs', 'RECIPE.md'];
  const external = ['tests/commands/git-design-20260828/NEUTRAL-FIXTURE.json', 'tests/commands/git-pack-design-20260828/NEUTRAL-PACKS.json', 'tests/integration/coherent78-arrays-author-20260828/arrays.mjs', 'tests/integration/coherent78-arrays-author-20260828/ARRAY-CASES.json', ...['probe.mjs', 'names.mjs', 'CASES.json', 'CASES-v2-overlay.json'].map(name => 'tests/integration/coherent78-shell-author-20260828/' + name), 'tests/commands/stream-format/helpers.ts', 'tests/commands/split/helpers.ts', ...manifest.fixtures.map(row => row.path)];
  const rows = [...files.map(name => path.relative(repo, path.join(own, name))), ...external].map(name => { const bytes = fs.readFileSync(path.join(repo, name)); return { path: name, bytes: bytes.length, sha256: sha(bytes) }; });
  fs.writeFileSync(path.join(own, 'EXECUTOR.json'), JSON.stringify({ role: 'AUTHOR_PUBLIC_GIT80_PREEXECUTION_BINDING', files: rows, source: sha(fs.readFileSync(path.join(own, 'SOURCE.json'))), productRunsThisRevision: 0, nativeRuns: 0 }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ candidate: manifest.computedTree, module: manifest.moduleCommit, inputs: manifest.inputs.length, source: sha(fs.readFileSync(path.join(own, 'SOURCE.json'))) }));
}
