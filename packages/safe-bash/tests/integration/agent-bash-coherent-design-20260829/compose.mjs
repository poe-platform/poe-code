import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const own = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(own, '../../..');
const capture = '/tmp/agent-bash-coherent-design-WooVtu';
const descriptor = fs.openSync(path.join(capture, 'composition.jsonl'), 'wx');
const note = value => fs.writeSync(descriptor, JSON.stringify(value) + '\n');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const objectHash = (type, bytes) => crypto.createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
function read(file, expected) {
  assert.ok(!file.split('/').includes('AGENTS.md'));
  const stat = fs.lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 16 * 1024 * 1024);
  const bytes = fs.readFileSync(file); if (expected) assert.equal(sha(bytes), expected); return bytes;
}
function batch(oids, name) {
  assert.ok(oids.length <= 400);
  const result = spawnSync('/usr/bin/git', ['cat-file', '--batch'], { cwd: repo, input: oids.join('\n') + '\n', maxBuffer: 16 * 1024 * 1024, timeout: 15000 });
  fs.writeFileSync(path.join(capture, name + '.stdout'), result.stdout, { flag: 'wx' }); fs.writeFileSync(path.join(capture, name + '.stderr'), result.stderr, { flag: 'wx' });
  note({ command: '/usr/bin/git cat-file --batch', role: 'DEVELOPMENT_METADATA_NOT_ORACLE', pid: result.pid, status: result.status, signal: result.signal, objects: oids.length });
  assert.equal(result.status, 0); assert.equal(result.signal, null);
  const objects = new Map(); let cursor = 0;
  for (const oid of oids) {
    const end = result.stdout.indexOf(10, cursor); assert.ok(end >= cursor);
    const [actual, type, sizeText] = result.stdout.subarray(cursor, end).toString().split(' '), size = Number(sizeText);
    assert.equal(actual, oid); assert.ok(type === 'tree' || type === 'blob'); assert.ok(Number.isSafeInteger(size) && size >= 0 && size <= 1048576);
    const bytes = result.stdout.subarray(end + 1, end + 1 + size); assert.equal(bytes.length, size); assert.equal(objectHash(type, bytes), oid); assert.equal(result.stdout[end + 1 + size], 10);
    objects.set(oid, { type, bytes }); cursor = end + size + 2;
  }
  assert.equal(cursor, result.stdout.length); return objects;
}
function entries(bytes) {
  const rows = []; let cursor = 0;
  while (cursor < bytes.length) {
    const space = bytes.indexOf(32, cursor), nul = bytes.indexOf(0, space); assert.ok(space > cursor && nul > space && nul + 21 <= bytes.length);
    const rawName = bytes.subarray(space + 1, nul), name = rawName.toString(); assert.ok(Buffer.from(name).equals(rawName)); assert.ok(!name.includes('/'));
    rows.push({ mode: bytes.subarray(cursor, space).toString(), name, oid: bytes.subarray(nul + 1, nul + 21).toString('hex') }); cursor = nul + 21;
  }
  return rows;
}
try {
  note({ role: 'COMPOSITION_DESIGN_DATA_ONLY', started: new Date().toISOString(), pid: process.pid, ppid: process.ppid, productExecutions: 0 });
  assert.deepEqual(process.argv.slice(2), ['--design-only']);
  const nodeBytes = read(path.join(capture, 'metadata-1.data'), '8371452bb024f99763c9240b42cb891cabe1311afafb32766e0ea24da09c6949');
  const conditionalBytes = read(path.join(repo, 'tests/compatibility/bash-conditional-author-20260829/SOURCE-v4.json'), '4f196057df98c3aed05519b78eaa725fc9d7eb3c73634613662ac6b927715d32');
  const strictBytes = read(path.join(repo, 'tests/compatibility/bash-strict-extension-author-20260829/SOURCE.json'), '9924773241f116d4cd5008fa7cd7f7fc3d95521f5e57b33299dbf2ed7cc2bf69');
  const node = JSON.parse(nodeBytes), conditional = JSON.parse(conditionalBytes), strict = JSON.parse(strictBytes);
  assert.equal(node.computedTree, 'a6d20781d3c099fb7b3d36c10696beb06615af1b'); assert.equal(conditional.computedTree, '74dfe69135a3fc5ba89396b20dd32d9c9daae131'); assert.equal(strict.computedTree, '37e793ce6dce48a958030e7cc86fa8315d0b112e');
  const replacements = ['src/shell/parser.ts', 'src/shell/display.ts', 'src/shell/conditional.ts', 'src/shell/runtime.ts'].map(name => {
    const provider = name.endsWith('/runtime.ts') ? strict : conditional;
    const row = provider.inputs.find(item => item.path === name); assert.ok(row);
    return { ...row, origin: name.endsWith('/runtime.ts') ? 'UNIT4_9bb91c37_PENDING_INDEPENDENT' : 'UNIT3_7a5c6200_ROOT_QUALIFIED_ACCEPTED', replacedBlob: node.inputs.find(item => item.path === name)?.blob ?? null };
  });
  const inputs = new Map(node.inputs.map(row => [row.path, { ...row, origin: 'ACCEPTED_PUBLIC_NODE_a6' }]));
  for (const row of replacements) inputs.set(row.path, row);
  const selected = [...inputs.values()].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  assert.equal(selected.length, 309);
  assert.ok(selected.every(row => !row.path.split('/').includes('AGENTS.md') && !row.path.startsWith('tests/') && !/^src\/commands\/(yq|xan)\//.test(row.path)));
  const trees = new Map();
  for (const source of [node, conditional, strict]) for (const key of ['reconstructedTrees', 'ancestorTrees', 'fetchedTrees']) for (const row of source[key] ?? []) {
    const bytes = Buffer.from(row.base64, 'base64'); assert.equal(objectHash('tree', bytes), row.oid); if (trees.has(row.oid)) assert.ok(trees.get(row.oid).equals(bytes)); trees.set(row.oid, bytes);
  }
  const witness = [];
  function compose(oid, changes) {
    const body = trees.get(oid); assert.ok(body, oid); const rows = new Map(entries(body).map(row => [row.name, row])); const grouped = new Map();
    for (const row of changes) { const slash = row.path.indexOf('/'); if (slash < 0) rows.set(row.path, { mode: Number.parseInt(row.mode, 8).toString(8), name: row.path, oid: row.blob }); else { const parent = row.path.slice(0, slash); if (!grouped.has(parent)) grouped.set(parent, []); grouped.get(parent).push({ ...row, path: row.path.slice(slash + 1) }); } }
    for (const [name, changes] of grouped) { assert.equal(rows.get(name).mode, '40000'); rows.set(name, { name, mode: '40000', oid: compose(rows.get(name).oid, changes) }); }
    const ordered = [...rows.values()].sort((left, right) => Buffer.compare(Buffer.from(left.name + (left.mode === '40000' ? '/' : '')), Buffer.from(right.name + (right.mode === '40000' ? '/' : ''))));
    const bytes = Buffer.concat(ordered.map(row => Buffer.concat([Buffer.from(`${row.mode} ${row.name}\0`), Buffer.from(row.oid, 'hex')]))), result = objectHash('tree', bytes); trees.set(result, bytes); witness.push({ oid: result, base64: bytes.toString('base64') }); return result;
  }
  const computedTree = compose(node.computedTree, replacements);
  const src = entries(trees.get(computedTree)).find(row => row.name === 'src'); assert.equal(src.mode, '40000');
  let frontier = [{ path: 'src', oid: src.oid }], rounds = 0; const sourceInventory = [];
  while (frontier.length) {
    const missing = [...new Set(frontier.map(row => row.oid).filter(oid => !trees.has(oid)))];
    if (missing.length) { assert.ok(++rounds <= 6); for (const [oid, row] of batch(missing, 'trees-' + rounds)) { assert.equal(row.type, 'tree'); trees.set(oid, row.bytes); } }
    const next = [];
    for (const row of frontier) for (const entry of entries(trees.get(row.oid))) {
      const name = row.path + '/' + entry.name;
      if (entry.mode === '40000') next.push({ path: name, oid: entry.oid }); else sourceInventory.push({ path: name, mode: entry.mode, blob: entry.oid });
    }
    frontier = next;
  }
  const ts = sourceInventory.filter(row => row.path.endsWith('.ts'));
  const declaredTs = selected.filter(row => row.path.startsWith('src/') && row.path.endsWith('.ts'));
  assert.deepEqual(ts.map(row => row.path).sort(), declaredTs.map(row => row.path).sort());
  for (const row of sourceInventory) if (inputs.has(row.path)) { assert.equal(inputs.get(row.path).blob, row.blob); assert.equal(Number.parseInt(inputs.get(row.path).mode, 8), Number.parseInt(row.mode, 8)); }
  const blobs = batch([...new Set(selected.map(row => row.blob))], 'selected-inputs');
  for (const row of selected) { const object = blobs.get(row.blob); assert.equal(object.type, 'blob'); assert.equal(object.bytes.length, row.bytes); assert.equal(sha(object.bytes), row.sha256); }
  const pkg = JSON.parse(blobs.get(inputs.get('package.json').blob).bytes); assert.deepEqual(pkg.dependencies ?? {}, {}); assert.deepEqual(pkg.files, ['dist']);
  const worktreeDifferences = [];
  for (const row of selected) { const file = path.join(repo, row.path); try { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) worktreeDifferences.push({ path: row.path, reason: 'not regular' }); else if (sha(fs.readFileSync(file)) !== row.sha256) worktreeDifferences.push({ path: row.path, reason: 'different bytes' }); } catch (error) { if (error.code === 'ENOENT') worktreeDifferences.push({ path: row.path, reason: 'absent' }); else throw error; } }
  const recipe = {
    role: 'PROPOSED_COMPOSITION_NOT_BUILT_NOT_ACCEPTED', date: '2026-08-29',
    base: { source: 'bb4dd0571a0335b20e29448bf88126ca02c1a32d', tree: node.computedTree, manifestSha256: sha(nodeBytes), acceptance: '6f449bf49d33e7e35b3882bb3396143efa346747', priorPackageSha256: '274839729aa916767d1664e0ec7a84579eb1c6e7eba677535dfe6273f5f079a9' },
    dependencies: { unit3: 'ROOT_QUALIFIED_ACCEPTED_d7ec5e26_cccd876f', unit4: 'HOLD_N14_cd06468eb1a067d8324e1d0e873cccbc2ede14c2', combined: 'UNACCEPTED_UNEXECUTED' }, replacements, computedTree, derivedOnly: true, inputCount: selected.length, sourceTsCount: declaredTs.length,
    shippingInputPaths: selected, shippingInputBytes: selected.reduce((total, row) => total + row.bytes, 0),
    completeSrcTreeFiles: sourceInventory.length, srcNonInputFiles: sourceInventory.filter(row => !inputs.has(row.path)),
    build: { rootDir: 'src', outDir: 'dist', include: ['src/**/*.ts'], declaration: true, declarationMap: true, sourceMap: true, productExecutions: 0 },
    package: { exports: pkg.exports, files: pkg.files, runtimeDependencies: pkg.dependencies ?? {}, predictedMembers: 1014, predictionOnly: '253 TypeScript modules times4 outputs + README.md/package.json; actual pack verification REQUIRED', newPackageSha256: null, defaultCommands: 80, optional: ['curl', 'node', 'safejs'], nodeAggregateOption: false },
    worktreeComparison: { role: 'READONLY_METADATA_NOT_BUILD_AUTHORITY', differences: worktreeDifferences },
    treeQualification: 'All selected build blobs authenticated; complete src tree inventory compared. Unchanged nonshipping subtree OIDs retained opaquely; not a full repository archive/materialization proof. No AGENTS body fetched.',
    reconstructedTrees: witness,
  };
  const sourceRows = sourceInventory.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const witnesses = [...trees].map(([oid, bytes]) => ({ oid, base64: bytes.toString('base64') }));
  for (const [name, value] of [['COMPOSITION.json', recipe], ['SOURCE-TREE-INVENTORY.json', sourceRows], ['TREE-WITNESSES.json', witnesses]]) fs.writeFileSync(path.join(own, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(own, 'SHIPPING-INPUT-PATHS.nul'), Buffer.concat(selected.map(row => Buffer.from(row.path + '\0'))), { flag: 'wx' });
  note({ finished: new Date().toISOString(), computedTree, inputs: selected.length, ts: declaredTs.length, srcTreeFiles: sourceInventory.length, differences: worktreeDifferences, productExecutions: 0 });
  console.log(JSON.stringify({ computedTree, inputs: selected.length, ts: declaredTs.length, sourceInventory: sourceInventory.length, predictedPackageMembers: 1014, worktreeDifferences, productExecutions: 0 }));
} catch (error) { note({ failure: String(error), stack: error?.stack }); throw error; }
finally { fs.closeSync(descriptor); }
