import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const own = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(own, '../../../..');
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const objectHash = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
export function inputs() {
  const seal = JSON.parse(fs.readFileSync(path.join(own, 'PRESEAL.json')));
  const candidate = 'fca6f81d2d96db2bbceabf3247cd57ffe240bde6';
  const encoded = fs.readFileSync(path.join(repo, 'tests/integration/coherent78-shell-independent-20260828/RAW-v2.json.gz.base64'));
  assert.equal(sha(encoded), seal.baseEvidence);
  const base = JSON.parse(gunzipSync(Buffer.from(encoded.toString().trim(), 'base64'), { maxOutputLength: 67108864 }));
  assert.equal(base.candidate, seal.base);
  const result = spawnSync('/usr/bin/git', ['ls-tree', '-rz', candidate, '--', 'src/commands/git'], { cwd: repo, env: { PATH: '/usr/bin', GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 1048576, timeout: 5000 });
  assert.equal(result.status, 0);
  const module = result.stdout.toString('utf8').split('\0').filter(Boolean).map(record => {
    const tab = record.indexOf('\t'), [mode, type, blob] = record.slice(0, tab).split(' '), name = record.slice(tab + 1);
    assert.equal(type, 'blob'); assert.ok(/^src\/commands\/git\/[A-Za-z.-]+$/.test(name));
    const bytes = fs.readFileSync(path.join(repo, name));
    assert.equal(objectHash('blob', bytes), blob, `committed module required: ${name}`);
    return { path: name, mode, blob, bytes: bytes.length, sha256: sha(bytes), commit: candidate };
  });
  assert.equal(module.length, 14);
  const priorBytes = fs.readFileSync(path.join(repo, 'tests/commands/git-pack-author-20260828/SOURCE-v2.json'));
  assert.equal(sha(priorBytes), '6a6a713eb155aa9b271664b85d67688a20f5f7d4e95ea48e41ad43d60d6ecdb5');
  const prior = JSON.parse(priorBytes); assert.equal(prior.computedTree, seal.previousDerivedTree);
  const changed = module.filter(row => row.sha256 !== prior.module.find(old => old.path === row.path)?.sha256).map(row => row.path);
  assert.deepEqual(changed, ['src/commands/git/pack.ts']);
  const rows = new Map(base.source.inputs.map(row => [row.path, row]));
  for (const row of module) { assert.ok(!rows.has(row.path)); rows.set(row.path, row); }
  const trees = new Map([...base.source.reachableTrees, ...base.source.reconstructedTrees].map(row => [row.oid, Buffer.from(row.base64, 'base64')]));
  for (const [oid, bytes] of trees) assert.equal(objectHash('tree', bytes), oid);
  const reconstructed = [];
  const overlay = (tree, selected) => {
    const bytes = tree ? trees.get(tree) : Buffer.alloc(0); assert.ok(bytes);
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
  const manifest = { role: 'DERIVED_ONLY_S01_ON_COHERENT78', base: seal.base, moduleCommit: candidate, computedTree: overlay(seal.base, module), inputs: [...rows.values()], module, reconstructedTrees: reconstructed, toolBindings: Object.fromEntries(Object.entries(base.tools).map(([name, tool]) => [name, { origin: tool.origin, version: tool.version, ...(tool.originalRows ? { inventorySha256: sha(Buffer.from(JSON.stringify(tool.originalRows))) } : { sha256: tool.sha256 }) }])) };
  return { seal, base, manifest };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ['--seal']);
  const { manifest } = inputs();
  fs.writeFileSync(path.join(own, 'SOURCE.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  const files = ['PRESEAL.json', 'SOURCE.json', 'prepare.mjs', 'run.mjs', 'faults.mjs', 'RECIPE.md'];
  const external = ['tests/commands/git-pack-author-20260828/packs.mjs', 'tests/commands/git-pack-author-20260828/results-v2/PACKAGE.tgz.base64', 'tests/commands/git-author-20260828/cases.mjs', 'tests/commands/git-author-20260828/package-loader.mjs', 'tests/commands/git-author-20260828/consumer.ts.fixture', 'tests/commands/git-design-20260828/NEUTRAL-FIXTURE.json', 'tests/commands/git-pack-design-20260828/NEUTRAL-PACKS.json', 'tests/commands/git-pack-independent-20260828/format/CASE-COVERAGE.json', 'tests/commands/git-pack-independent-20260828/resources/CASE-MATRIX.json'];
  const rows = [...files.map(name => path.relative(repo, path.join(own, name))), ...external].map(name => { const bytes = fs.readFileSync(path.join(repo, name)); return { path: name, bytes: bytes.length, sha256: sha(bytes) }; });
  fs.writeFileSync(path.join(own, 'EXECUTOR.json'), JSON.stringify({ role: 'AUTHOR_S01_PREEXECUTION_BINDING', files: rows, source: sha(fs.readFileSync(path.join(own, 'SOURCE.json'))), productRunsThisRevision: 0, nativeRuns: 0 }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ candidate: manifest.computedTree, module: manifest.moduleCommit, inputs: manifest.inputs.length, source: sha(fs.readFileSync(path.join(own, 'SOURCE.json'))) }));
}
