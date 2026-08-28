import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const object = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
export function regular(filename) { assert.equal(fs.realpathSync(filename), filename); const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink()); return fs.readFileSync(filename); }
export function put(filename, bytes, mode = 0o644) { assert.ok(path.isAbsolute(filename) && !filename.split('/').includes('AGENTS.md')); fs.mkdirSync(path.dirname(filename), { recursive: true }); assert.equal(fs.realpathSync(path.dirname(filename)), path.dirname(filename)); fs.writeFileSync(filename, bytes, { flag: 'wx', mode }); fs.chmodSync(filename, mode); }
export function census(root) {
  assert.equal(fs.realpathSync(root), root); const result = {}; let count = 0;
  const visit = directory => { for (const name of fs.readdirSync(directory).sort()) { assert.ok(++count <= 20000); assert.notEqual(name, 'AGENTS.md'); const filename = path.join(directory, name), stat = fs.lstatSync(filename), relative = path.relative(root, filename); assert.ok(!stat.isSymbolicLink()); if (stat.isDirectory()) { result[relative + '/'] = { directory: true, mode: stat.mode & 0o777 }; visit(filename); } else { assert.ok(stat.isFile()); result[relative] = { bytes: stat.size, mode: stat.mode & 0o777, sha256: sha(regular(filename)) }; } } };
  visit(root); return result;
}
export function verify(tree) { assert.deepEqual(census(tree.root), tree.entries, `tree drift: ${tree.root}`); }
export function copy(source, target) { const entries = census(source); assert.ok(!fs.existsSync(target)); fs.mkdirSync(target, { recursive: true }); for (const [name, row] of Object.entries(entries)) { if (row.directory) fs.mkdirSync(path.join(target, name), { recursive: true, mode: row.mode }); else put(path.join(target, name), regular(path.join(source, name)), row.mode); } assert.deepEqual(census(target), entries); }
export function members(compressed) {
  const tar = gunzipSync(compressed, { maxOutputLength: 32 * 1024 * 1024 }), result = new Map(); let offset = 0;
  while (offset + 512 <= tar.length && tar[offset] !== 0) {
    const header = tar.subarray(offset, offset + 512), field = (start, length) => header.subarray(start, start + length).toString().split('\0')[0];
    const stored = parseInt(field(148, 8).trim(), 8), checked = Buffer.from(header); checked.fill(32, 148, 156); assert.equal(checked.reduce((sum, value) => sum + value, 0), stored);
    assert.ok(header[156] === 0 || header[156] === 48); assert.equal(field(345, 155), '');
    const name = field(0, 100); assert.ok(name.startsWith('package/')); const relative = name.slice(8); assert.ok(relative.split('/').every(part => part && part !== '.' && part !== '..' && part !== 'AGENTS.md'));
    assert.ok(!result.has(relative)); const bytes = parseInt(field(124, 12).trim(), 8), mode = parseInt(field(100, 8).trim(), 8) & 0o777; assert.ok(Number.isSafeInteger(bytes) && bytes >= 0 && offset + 512 + bytes <= tar.length);
    result.set(relative, { bytes: Buffer.from(tar.subarray(offset + 512, offset + 512 + bytes)), mode }); offset += 512 + Math.ceil(bytes / 512) * 512;
  }
  assert.ok(tar.subarray(offset).every(byte => byte === 0)); return result;
}
export function inventory(tar) { return Object.fromEntries([...members(tar)].map(([name, row]) => [name, { bytes: row.bytes.length, mode: row.mode, sha256: sha(row.bytes) }])); }
export function extract(tar, root) { for (const [name, row] of members(tar)) put(path.join(root, name), row.bytes, row.mode); }
export function treeEntries(bytes) {
  const entries = []; let cursor = 0;
  while (cursor < bytes.length) { const space = bytes.indexOf(32, cursor), nul = bytes.indexOf(0, space); assert.ok(space > cursor && nul > space && nul + 21 <= bytes.length); const nameBytes = bytes.subarray(space + 1, nul), name = nameBytes.toString(); assert.deepEqual(Buffer.from(name), nameBytes); assert.ok(!name.includes('/')); entries.push({ name, mode: bytes.subarray(cursor, space).toString(), oid: bytes.subarray(nul + 1, nul + 21).toString('hex') }); cursor = nul + 21; }
  return entries;
}
export function compose(trees, base, overrides) {
  const flat = new Map();
  const walk = (oid, prefix) => { const data = trees.get(oid); assert.ok(data, `missing ancestor ${oid}`); assert.equal(object('tree', data), oid); for (const entry of treeEntries(data)) { const name = prefix + entry.name; if (entry.mode === '40000') { if (overrides.some(row => row.path.startsWith(name + '/'))) walk(entry.oid, name + '/'); else flat.set(name + '/', entry); } else flat.set(name, entry); } };
  walk(base, ''); for (const row of overrides) flat.set(row.path, { mode: row.mode, oid: row.blob });
  const encode = prefix => { const immediate = new Map(); for (const [name, entry] of flat) if (name.startsWith(prefix)) { const rest = name.slice(prefix.length), slash = rest.indexOf('/'); if (slash < 0) immediate.set(rest, { ...entry, name: rest }); else { const child = rest.slice(0, slash); if (rest === child + '/' && entry.mode === '40000') immediate.set(child, { ...entry, name: child }); else immediate.set(child, { name: child, mode: '40000', oid: null }); } } for (const entry of immediate.values()) if (entry.oid === null) entry.oid = encode(prefix + entry.name + '/'); const sorted = [...immediate.values()].sort((left, right) => Buffer.compare(Buffer.from(left.name + (left.mode === '40000' ? '/' : '')), Buffer.from(right.name + (right.mode === '40000' ? '/' : '')))); const body = Buffer.concat(sorted.map(entry => Buffer.concat([Buffer.from(`${entry.mode} ${entry.name}\0`), Buffer.from(entry.oid, 'hex')]))); const oid = object('tree', body); trees.set(oid, body); return oid; };
  return encode('');
}
