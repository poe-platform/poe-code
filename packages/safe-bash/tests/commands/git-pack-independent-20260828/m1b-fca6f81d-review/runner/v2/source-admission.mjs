import { demand, objectHash, sha256, relative } from './primitives.mjs';

const oidPattern = /^[a-f0-9]{40}$/;
function treeEntries(bytes) {
  const entries = [];
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    const zero = bytes.indexOf(0, space + 1);
    demand(space > offset && zero > space && zero + 21 <= bytes.length, 'TREE_FRAME');
    const mode = bytes.subarray(offset, space).toString('ascii');
    const name = Buffer.from(bytes.subarray(space + 1, zero));
    demand(['40000', '100644', '100755', '120000'].includes(mode) && !name.includes(47), 'TREE_ENTRY');
    const oid = bytes.subarray(zero + 1, zero + 21).toString('hex');
    demand(!entries.some(entry => entry.name.equals(name)), 'TREE_DUPLICATE');
    entries.push({ mode, name, oid });
    offset = zero + 21;
  }
  return entries;
}
function treeBytes(entries) {
  const sorted = [...entries].sort((left, right) => Buffer.compare(Buffer.concat([left.name, Buffer.from(left.mode === '40000' ? '/' : '')]), Buffer.concat([right.name, Buffer.from(right.mode === '40000' ? '/' : '')])));
  return Buffer.concat(sorted.map(entry => Buffer.concat([Buffer.from(`${entry.mode} `), entry.name, Buffer.from([0]), Buffer.from(entry.oid, 'hex')])));
}
export function sourceRequests(map) {
  demand(map.schema === 'm1b-selected-source-v1' && map.inputs.length === 282, 'SOURCE_SCHEMA');
  const rows = [...map.commits, ...map.trees, ...map.inputs.map(row => ({ role: 'STORED_BLOB', kind: 'blob', oid: row.blob, bytes: row.bytes, sha256: row.sha256 }))];
  const unique = new Map();
  for (const row of rows) {
    demand(({ STORED_COMMIT: 'commit', STORED_TREE: 'tree', STORED_BLOB: 'blob' })[row.role] === row.kind && oidPattern.test(row.oid), 'STORED_ROLE_IDENTITY');
    demand(Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= 8388608 && /^[a-f0-9]{64}$/.test(row.sha256), 'STORED_BODY_BINDING');
    if (unique.has(row.oid)) demand(JSON.stringify(unique.get(row.oid)) === JSON.stringify({ kind: row.kind, bytes: row.bytes, sha256: row.sha256 }), 'OBJECT_CONFLICT');
    else unique.set(row.oid, { kind: row.kind, bytes: row.bytes, sha256: row.sha256 });
  }
  return [...unique].map(([oid, body]) => ({ oid, ...body }));
}
export function authenticateSources(map, requests, raw) {
  const objects = new Map();
  let offset = 0;
  for (const row of requests) {
    const newline = raw.indexOf(10, offset);
    demand(newline > offset, 'OBJECT_HEADER');
    demand(raw.subarray(offset, newline).toString('ascii') === `${row.oid} ${row.kind} ${row.bytes}`, 'OBJECT_STORED_TYPE');
    const body = raw.subarray(newline + 1, newline + 1 + row.bytes);
    demand(body.length === row.bytes && raw[newline + 1 + row.bytes] === 10, 'OBJECT_EXTENT');
    demand(objectHash(row.kind, body) === row.oid && sha256(body) === row.sha256, 'OBJECT_RAW_HASH');
    objects.set(row.oid, { kind: row.kind, body });
    offset = newline + row.bytes + 2;
  }
  demand(offset === raw.length, 'OBJECT_TRAILING');
  const trees = new Map(map.trees.map(row => [row.oid, treeEntries(objects.get(row.oid).body)]));
  const roots = new Map();
  for (const row of map.commits) {
    const first = objects.get(row.oid).body.toString('utf8').split('\n')[0];
    demand(/^tree [a-f0-9]{40}$/.test(first), 'COMMIT_ROOT');
    roots.set(row.oid, first.slice(5));
  }
  function lookup(root, name) {
    let oid = root;
    const parts = relative(name).split('/');
    for (let index = 0; index < parts.length; index++) {
      const entries = trees.get(oid);
      demand(entries, `MISSING_ANCESTOR:${name}`);
      const entry = entries.find(item => item.name.equals(Buffer.from(parts[index])));
      demand(entry, `MISSING_MEMBER:${name}`);
      if (index === parts.length - 1) return entry;
      demand(entry.mode === '40000', 'ANCESTOR_KIND');
      oid = entry.oid;
    }
  }
  const selected = new Map();
  for (const row of map.inputs) {
    demand(!selected.has(row.path) && roots.has(row.commit), 'SELECTED_ORIGIN');
    const entry = lookup(roots.get(row.commit), row.path);
    demand(entry.mode === row.mode && entry.oid === row.blob && ['100644', '100755'].includes(row.mode), 'SELECTED_MEMBERSHIP');
    selected.set(row.path, objects.get(row.blob).body);
  }
  function overlay(root, parts, row) {
    const entries = (trees.get(root) ?? []).map(entry => ({ ...entry }));
    demand(trees.has(root) || root === null, 'OVERLAY_ANCESTOR');
    const name = Buffer.from(parts[0]);
    const old = entries.find(entry => entry.name.equals(name));
    let replacement;
    if (parts.length === 1) replacement = { name, mode: row.mode, oid: row.blob };
    else {
      demand(!old || old.mode === '40000', 'OVERLAY_PATH_KIND');
      replacement = { name, mode: '40000', oid: overlay(old?.oid ?? null, parts.slice(1), row) };
    }
    const next = entries.filter(entry => !entry.name.equals(name));
    next.push(replacement);
    const bytes = treeBytes(next);
    const oid = objectHash('tree', bytes);
    trees.set(oid, treeEntries(bytes));
    return oid;
  }
  let root = roots.get(map.baseCommit);
  demand(root === map.baseTree, 'BASE_ROOT');
  for (const row of map.inputs.filter(row => row.commit !== map.baseCommit)) root = overlay(root, row.path.split('/'), row);
  demand(root === map.derivedTree, 'DERIVED_ROOT');
  for (const row of map.inputs) {
    const entry = lookup(root, row.path);
    demand(entry.mode === row.mode && entry.oid === row.blob, 'COMPOSED_SELECTED_MEMBER');
  }
  return { selected, proof: { selected: selected.size, derivedTree: root, storedObjects: objects.size, unselectedBranches: 'OID_ONLY_NOT_SELECTED_SOURCE', candidateImports: 0 } };
}
