import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const own = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(own, '../../..');
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const objectHash = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
export function inputs() {
  const seal = JSON.parse(fs.readFileSync(path.join(own, 'PRESEAL.json')));
  const rawBytes = fs.readFileSync(path.join(repo, 'tests/integration/coherent78-shell-independent-20260828/RAW-v2.json.gz.base64'));
  assert.equal(sha(rawBytes), seal.baseEvidenceSha256);
  const base = JSON.parse(gunzipSync(Buffer.from(rawBytes.toString().trim(), 'base64'), { maxOutputLength: 67108864 }));
  assert.equal(base.candidate, seal.base);
  const arrayPath = 'tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/SCOPE-BINDING-v2.json';
  const arrayBytes = fs.readFileSync(path.join(repo, arrayPath));
  const array = JSON.parse(arrayBytes);
  assert.equal(array.product, seal.arrayCandidate);
  assert.equal(array.selectedComposition, seal.arraySelected);
  const overrides = seal.overrides.map(name => {
    const row = array.selectedSource.find(entry => entry.path === name);
    assert.ok(row);
    return { ...row, revision: row.commit, role: 'accepted ARRAY overlay' };
  });
  const rows = new Map(base.source.inputs.map(row => [row.path, { ...row, role: 'accepted coherent78 unchanged' }]));
  for (const row of overrides) rows.set(row.path, row);
  assert.equal(rows.size, seal.expectedInputs);
  assert.equal(array.selectedSource.find(row => row.path === 'src/shell/shell.ts').blob, rows.get('src/shell/shell.ts').blob);
  const trees = new Map([...base.source.reachableTrees, ...base.source.reconstructedTrees].map(row => [row.oid, Buffer.from(row.base64, 'base64')]));
  for (const [oid, bytes] of trees) assert.equal(objectHash('tree', bytes), oid);
  const newTrees = [];
  const overlay = (tree, selected) => {
    const bytes = tree ? trees.get(tree) : Buffer.alloc(0);
    assert.ok(bytes, `Missing authenticated ancestor tree ${tree}`);
    const entries = new Map();
    let cursor = 0;
    while (cursor < bytes.length) {
      const space = bytes.indexOf(32, cursor), nul = bytes.indexOf(0, space);
      assert.ok(space > cursor && nul > space && nul + 21 <= bytes.length);
      const mode = bytes.subarray(cursor, space).toString('ascii');
      const nameBytes = bytes.subarray(space + 1, nul), name = nameBytes.toString('utf8');
      assert.ok(Buffer.from(name).equals(nameBytes));
      entries.set(name, { name, mode, oid: bytes.subarray(nul + 1, nul + 21).toString('hex') });
      cursor = nul + 21;
    }
    const groups = new Map();
    for (const row of selected) {
      const slash = row.path.indexOf('/');
      if (slash < 0) entries.set(row.path, { name: row.path, mode: Number.parseInt(row.mode, 8).toString(8), oid: row.blob });
      else {
        const first = row.path.slice(0, slash);
        if (!groups.has(first)) groups.set(first, []);
        groups.get(first).push({ ...row, path: row.path.slice(slash + 1) });
      }
    }
    for (const [name, descendants] of groups) {
      const previous = entries.get(name);
      assert.ok(!previous || previous.mode === '40000');
      entries.set(name, { name, mode: '40000', oid: overlay(previous?.oid, descendants) });
    }
    const sorted = [...entries.values()].sort((left, right) => Buffer.compare(Buffer.from(left.name + (left.mode === '40000' ? '/' : '')), Buffer.from(right.name + (right.mode === '40000' ? '/' : ''))));
    const body = Buffer.concat(sorted.map(row => Buffer.concat([Buffer.from(`${row.mode} ${row.name}\0`), Buffer.from(row.oid, 'hex')])));
    const oid = objectHash('tree', body);
    trees.set(oid, body);
    newTrees.push({ oid, base64: body.toString('base64') });
    return oid;
  };
  assert.equal(overlay(seal.base, []), seal.base);
  assert.equal(overlay('37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e', overrides), seal.arraySelected);
  const computedTree = overlay(seal.base, overrides);
  const helperNames = ['probe.mjs', 'loader.mjs', 'names.mjs', 'CASES.json', 'CASES-v2-overlay.json', 'TYPES.json'];
  const helpers = helperNames.map(name => {
    const filename = `tests/integration/coherent78-shell-author-20260828/${name}`;
    const bytes = fs.readFileSync(path.join(repo, filename));
    assert.equal(sha(bytes), base.authorSeal.artifacts[name]);
    return { path: filename, sha256: sha(bytes), bytes: bytes.length };
  });
  const manifest = {
    role: 'Derived-only coherent78 plus six accepted ARRAY paths; not stored Git tree assertion',
    base: seal.base, array: seal.arrayCandidate, arraySelected: seal.arraySelected, computedTree,
    baseEvidenceSha256: seal.baseEvidenceSha256, arrayBinding: { path: arrayPath, sha256: sha(arrayBytes) },
    inputs: [...rows.values()].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))),
    overrides, reconstructedTrees: newTrees, acceptedHelpers: helpers,
    toolBindings: Object.fromEntries(Object.entries(base.tools).map(([name, value]) => [name, { origin: value.origin, version: value.version, ...(value.originalRows ? { regularInventorySha256: sha(Buffer.from(JSON.stringify(value.originalRows))), regularFiles: value.originalRows.length } : { sha256: value.sha256 }) }])),
    productExecutions: 0,
  };
  return { manifest, base, seal };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ['--seal']);
  const { manifest } = inputs();
  fs.writeFileSync(path.join(own, 'SOURCE.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ computedTree: manifest.computedTree, inputs: manifest.inputs.length, changedPaths: manifest.overrides.map(row => row.path), sourceSha256: sha(fs.readFileSync(path.join(own, 'SOURCE.json'))), productExecutions: 0 }));
}
