import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

export const CAP = 16 * 1024 * 1024;
export const SCHEMA = 'AP753-catalogs-v3';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
function fields(value, names) {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  const keys = Reflect.ownKeys(value);
  assert.deepEqual([...keys].sort(), [...names].sort(), 'exact own fields');
  for (const key of keys) assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'), 'own data');
}
function stringSize(value) {
  let size = 2;
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit === 34 || unit === 92 || [8, 9, 10, 12, 13].includes(unit)) size += 2;
    else if (unit < 32) size += 6;
    else if (unit < 128) size++;
    else if (unit < 2048) size += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { size += 4; index++; }
    else size += unit >= 0xd800 && unit <= 0xdfff ? 6 : 3;
  }
  return size;
}
function walk(value, output, state, depth = 0) {
  assert.ok(depth <= 64 && ++state.nodes <= 2000000, 'JSON structure bound');
  function token(text, size = Buffer.byteLength(text)) { state.bytes += size; assert.ok(state.bytes <= state.limit, 'JSON byte cap'); if (output) output.push(text); }
  if (value === null) return token('null');
  if (typeof value === 'string') { const size = stringSize(value); state.bytes += size; assert.ok(state.bytes <= state.limit, 'JSON byte cap'); if (output) output.push(JSON.stringify(value)); return; }
  if (typeof value === 'boolean') return token(value ? 'true' : 'false');
  if (typeof value === 'number') { assert.ok(Number.isFinite(value) && !Object.is(value, -0), 'finite JSON number'); return token(String(value)); }
  assert.ok(typeof value === 'object' && value !== null && !state.active.has(value), 'JSON data/cycle');
  state.active.add(value);
  const array = Array.isArray(value), keys = Reflect.ownKeys(value);
  if (array) assert.deepEqual(keys, [...Array(value.length).keys()].map(String).concat('length'), 'dense own array');
  else assert.ok(keys.every(key => typeof key === 'string'), 'string keys');
  const members = array ? keys.slice(0, -1) : keys.sort(compare);
  token(array ? '[' : '{');
  members.forEach((key, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert.ok(Object.hasOwn(descriptor, 'value'), 'own data only');
    if (index) token(',');
    if (!array) { walk(key, output, state, depth + 1); token(':'); }
    walk(descriptor.value, output, state, depth + 1);
  });
  token(array ? ']' : '}'); state.active.delete(value);
}
export function measure(value, limit = CAP) {
  const state = { bytes: 1, nodes: 0, active: new Set(), limit };
  walk(value, null, state); assert.ok(state.bytes <= limit); return state.bytes;
}
export function serialize(value, limit = CAP) {
  const length = measure(value, limit);
  const chunks = []; walk(value, chunks, { bytes: 1, nodes: 0, active: new Set(), limit });
  const bytes = Buffer.from(chunks.join('') + '\n'); assert.equal(bytes.length, length); return bytes;
}
export function parse(bytes, limit = CAP) {
  assert.ok(bytes instanceof Uint8Array && bytes.byteLength <= limit, 'input byte cap');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  assert.ok(serialize(value, limit).equals(Buffer.from(bytes)), 'canonical bytes; no duplicate keys or aliases');
  return value;
}
export function readPacket(filename, authority) {
  assert.ok(filename.endsWith('.json'), 'recognized text');
  const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= CAP, 'regular bounded packet');
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { const opened = fs.fstatSync(descriptor); assert.equal(opened.ino, stat.ino); assert.equal(opened.dev, stat.dev); const bytes = fs.readFileSync(descriptor); assert.equal(bytes.length, stat.size); return decode(parse(bytes), authority); }
  finally { fs.closeSync(descriptor); }
}
export function frameSize(records, captureRemaining = CAP) {
  assert.ok(Array.isArray(records) && records.length > 0 && records.length <= 1024);
  const seen = new Set(); let bytes = 0;
  for (const record of records) {
    fields(record, ['oid', 'kind', 'bytes']);
    assert.match(record.oid, /^[a-f0-9]{40}$/); assert.ok(!seen.has(record.oid), 'duplicate object'); seen.add(record.oid);
    assert.ok(['blob', 'tree', 'commit'].includes(record.kind)); assert.ok(Number.isSafeInteger(record.bytes) && record.bytes >= 0);
    bytes += 40 + 1 + record.kind.length + 1 + String(record.bytes).length + 1 + record.bytes + 1;
    assert.ok(Number.isSafeInteger(bytes) && bytes <= CAP && bytes <= captureRemaining, 'whole framed batch cap');
  }
  return bytes;
}
function pathname(name) {
  assert.ok(typeof name === 'string' && name.length > 0 && Buffer.byteLength(name) <= 4096 && !name.includes('\0'));
  assert.equal(new TextDecoder('utf8', { fatal: true }).decode(Buffer.from(name)), name, 'exact UTF8 path');
  const parts = (name.endsWith('/') ? name.slice(0, -1) : name).split('/');
  assert.ok(parts.every(part => part !== '' && part !== '.' && part !== '..'), 'relative exact path');
}
function rows(inventory) {
  assert.ok(inventory !== null && typeof inventory === 'object' && !Array.isArray(inventory));
  const names = Reflect.ownKeys(inventory); assert.ok(names.length <= 60000);
  return names.sort(compare).map(name => {
    pathname(name); const descriptor = Object.getOwnPropertyDescriptor(inventory, name); assert.ok(Object.hasOwn(descriptor, 'value'));
    const entry = descriptor.value;
    fields(entry, entry.kind === 'directory' ? ['kind', 'mode'] : ['kind', 'mode', 'bytes', 'sha256']);
    assert.ok(entry.kind === 'file' || entry.kind === 'directory'); assert.equal(name.endsWith('/'), entry.kind === 'directory');
    assert.ok(Number.isSafeInteger(entry.mode) && entry.mode >= 0 && entry.mode <= 511);
    if (entry.kind === 'file') { assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0); assert.match(entry.sha256, /^[a-f0-9]{64}$/); }
    return [name, entry];
  });
}
function inventoryFromRows(entries) {
  assert.ok(Array.isArray(entries)); const result = {}; let previous;
  for (const pair of entries) {
    assert.ok(Array.isArray(pair) && pair.length === 2); const [name, entry] = pair; pathname(name);
    assert.ok(previous === undefined || compare(previous, name) < 0, 'strict unique row order'); previous = name; Object.defineProperty(result, name, { value: entry, enumerable: true, writable: true, configurable: true });
  }
  rows(result); return result;
}
const catalogId = body => hash(serialize(body));
function inputRows(inputs) {
  assert.ok(Array.isArray(inputs) && inputs.length === 274); const seen = new Set();
  for (const entry of inputs) {
    fields(entry, ['path', 'revision', 'blob', 'mode', 'bytes', 'sha256', 'role', 'pathBase64']); pathname(entry.path);
    assert.ok(!seen.has(entry.path)); seen.add(entry.path); assert.equal(Buffer.from(entry.path).toString('base64'), entry.pathBase64);
    assert.match(entry.revision, /^[a-f0-9]{40}$/); assert.match(entry.blob, /^[a-f0-9]{40}$/); assert.equal(entry.mode, '100644');
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0); assert.match(entry.sha256, /^[a-f0-9]{64}$/); assert.equal(typeof entry.role, 'string');
  }
  return inputs;
}
export function makeAuthority(packageInventory, inputs, candidate, variants = []) {
  measure(packageInventory); measure(inputs); measure(variants);
  const entries = rows(packageInventory);
  assert.equal(entries.filter(([, entry]) => entry.kind === 'file').length, 882); assert.equal(entries.length, 926);
  const packageId = catalogId({ kind: 'inventory', rows: entries });
  const graphs = { base: packageId };
  assert.ok(Array.isArray(variants) && variants.length <= 30);
  for (const variant of variants) {
    assert.match(variant.id, /^[A-Za-z0-9-]+$/); assert.ok(!Object.hasOwn(graphs, variant.id), 'unique approved graph');
    const changed = { ...packageInventory };
    assert.ok(Object.keys(variant.bindings).length > 0 && Object.keys(variant.bindings).length <= 6);
    for (const [name, entry] of Object.entries(variant.bindings)) {
      assert.match(name, /^dist\/commands\/apply-patch\/(apply|index|parser|matcher|shared|options)\.js$/);
      assert.ok(Object.hasOwn(changed, name)); fields(entry, ['mode', 'bytes', 'sha256']); assert.equal(entry.mode, changed[name].mode);
      changed[name] = { kind: 'file', ...entry };
    }
    const modified = rows(changed), replacements = modified.filter((pair, index) => !serialize(pair).equals(serialize(entries[index])));
    assert.ok(replacements.length > 0 && replacements.length <= 6);
    graphs[variant.id] = catalogId({ kind: 'overlay', base: packageId, replacements, result: catalogId({ kind: 'inventory', rows: modified }) });
  }
  return { schema: SCHEMA, candidate, packageId, inputsId: catalogId({ kind: 'inputs', rows: inputRows(inputs) }), graphs };
}
function transform(value, catalog, authority, decoding, key = '', parent) {
  if (['manifest', 'packageInventory', 'sourceBefore', 'sourceAfter'].includes(key)) {
    if (key === 'manifest') {
      assert.ok(parent && typeof parent.id === 'string' && Object.hasOwn(authority.graphs, parent.id), 'approved graph ID');
      if (decoding) { fields(value, ['$catalog']); assert.equal(value.$catalog, authority.graphs[parent.id], 'approved graph catalog identity'); }
    }
    const result = catalog(value);
    if (key === 'manifest' && !decoding) assert.equal(result.$catalog, authority.graphs[parent.id], 'approved graph catalog identity');
    return result;
  }
  if (key === 'consumerInventories') return Object.fromEntries(Object.entries(value).map(([layout, inventory]) => [layout, catalog(inventory)]));
  if (Array.isArray(value)) return value.map(item => transform(item, catalog, authority, decoding));
  if (value !== null && typeof value === 'object') {
    assert.ok(!Object.hasOwn(value, '$catalog'), 'reserved reference outside inventory');
    return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, transform(entry, catalog, authority, decoding, name, value)]));
  }
  return value;
}
export function publishRuntimePair(build, runtime, captureRemaining, publish) {
  assert.equal(typeof publish, 'function');
  const buildBytes = measure(build), runtimeBytes = measure(runtime);
  const framedBytes = frameSize([{ oid: '0'.repeat(40), kind: 'blob', bytes: buildBytes }, { oid: '1'.repeat(40), kind: 'blob', bytes: runtimeBytes }, { oid: '2'.repeat(40), kind: 'commit', bytes: 65536 }], captureRemaining);
  assert.ok(buildBytes + runtimeBytes + framedBytes <= captureRemaining, 'publication plus framed capture reservation');
  const buildBuffer = serialize(build), runtimeBuffer = serialize(runtime);
  publish('BUILD-RECEIPT.json', buildBuffer); publish('RUNTIME-SEAL.json', runtimeBuffer);
  return { buildBytes, runtimeBytes, framedBytes, commitPayloadReservation: 65536 };
}
export function encode(payload, packageInventory, inputs, authority) {
  measure(payload, 32 * 1024 * 1024);
  measure(authority); fields(authority, ['schema', 'candidate', 'packageId', 'inputsId', 'graphs']);
  const expected = makeAuthority(packageInventory, inputs, authority.candidate);
  for (const key of ['schema', 'candidate', 'packageId', 'inputsId']) assert.equal(authority[key], expected[key]);
  assert.equal(authority.graphs.base, expected.packageId);
  const catalogs = new Map();
  function add(body) { const id = catalogId(body); if (catalogs.has(id)) assert.deepEqual(catalogs.get(id), body); else catalogs.set(id, body); return { $catalog: id }; }
  const baseRows = rows(packageInventory), base = add({ kind: 'inventory', rows: baseRows });
  const input = add({ kind: 'inputs', rows: inputRows(inputs) });
  function inventory(value) {
    const entries = rows(value);
    if (entries.length === baseRows.length && entries.every(([name], index) => name === baseRows[index][0])) {
      const replacements = entries.filter((pair, index) => !serialize(pair).equals(serialize(baseRows[index])));
      if (!replacements.length) return base;
      assert.ok(replacements.length <= 6, 'finite variant overlay');
      for (const [name, entry] of replacements) {
        assert.match(name, /^dist\/commands\/apply-patch\/(apply|index|parser|matcher|shared|options)\.js$/);
        assert.equal(entry.kind, 'file'); assert.equal(entry.mode, packageInventory[name].mode);
      }
      return add({ kind: 'overlay', base: base.$catalog, replacements, result: catalogId({ kind: 'inventory', rows: entries }) });
    }
    return add({ kind: 'inventory', rows: entries });
  }
  const data = transform(payload, inventory, authority, false);
  const packet = { schema: SCHEMA, authority, package: base, inputs: input, catalogs: [...catalogs].sort(([left], [right]) => compare(left, right)).map(([id, body]) => ({ id, body })), payload: data };
  decode(packet, authority); return packet;
}
export function decode(packet, authority) {
  measure(packet);
  fields(packet, ['schema', 'authority', 'package', 'inputs', 'catalogs', 'payload']); assert.equal(packet.schema, SCHEMA); assert.ok(serialize(packet.authority).equals(serialize(authority)), 'exact authority');
  assert.ok(Array.isArray(packet.catalogs) && packet.catalogs.length <= 128);
  const catalogs = new Map(), used = new Set(); let previous;
  for (const record of packet.catalogs) {
    fields(record, ['id', 'body']); assert.match(record.id, /^[a-f0-9]{64}$/);
    assert.ok(previous === undefined || previous < record.id, 'unique ordered catalog'); previous = record.id;
    assert.equal(catalogId(record.body), record.id, 'catalog content hash'); catalogs.set(record.id, record.body);
  }
  function reference(ref) { fields(ref, ['$catalog']); assert.match(ref.$catalog, /^[a-f0-9]{64}$/); assert.ok(catalogs.has(ref.$catalog), 'internal catalog membership'); used.add(ref.$catalog); return catalogs.get(ref.$catalog); }
  assert.equal(packet.package.$catalog, authority.packageId); assert.equal(packet.inputs.$catalog, authority.inputsId);
  const base = reference(packet.package); fields(base, ['kind', 'rows']); assert.equal(base.kind, 'inventory'); const baseInventory = inventoryFromRows(base.rows);
  assert.equal(base.rows.length, 926); assert.equal(base.rows.filter(([, entry]) => entry.kind === 'file').length, 882);
  const inputs = reference(packet.inputs); fields(inputs, ['kind', 'rows']); assert.equal(inputs.kind, 'inputs'); inputRows(inputs.rows);
  function resolve(ref) {
    const body = reference(ref);
    if (body.kind === 'inventory') { fields(body, ['kind', 'rows']); return inventoryFromRows(body.rows); }
    fields(body, ['kind', 'base', 'replacements', 'result']); assert.equal(body.kind, 'overlay'); assert.equal(body.base, authority.packageId, 'only base overlay; no cycles or external refs');
    assert.ok(Array.isArray(body.replacements) && body.replacements.length > 0 && body.replacements.length <= 6);
    const replacements = inventoryFromRows(body.replacements), result = { ...baseInventory };
    for (const [name, entry] of Object.entries(replacements)) {
      assert.match(name, /^dist\/commands\/apply-patch\/(apply|index|parser|matcher|shared|options)\.js$/);
      assert.ok(Object.hasOwn(result, name)); assert.equal(entry.kind, 'file'); assert.equal(entry.mode, result[name].mode);
      assert.notEqual(catalogId(entry), catalogId(result[name]), 'no-op overlay'); result[name] = entry;
    }
    assert.equal(catalogId({ kind: 'inventory', rows: rows(result) }), body.result, 'overlay result hash'); return result;
  }
  const result = transform(packet.payload, resolve, authority, true); assert.equal(used.size, catalogs.size, 'no unreferenced catalogs'); return result;
}
