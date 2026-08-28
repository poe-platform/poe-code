import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { census, digest, tarInventory, regular } from '../../candidate-v1/boundary-app.mjs';

export function put(filename, bytes, mode = 0o644) {
  assert.ok(Buffer.isBuffer(bytes) || typeof bytes === 'string');
  assert.equal(path.resolve(filename), filename);
  assert.ok(!filename.split('/').includes('AGENTS.md'));
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o755 });
  assert.equal(fs.realpathSync(path.dirname(filename)), path.dirname(filename));
  fs.writeFileSync(filename, bytes, { flag: 'wx', mode });
  assert.equal(fs.lstatSync(filename).mode & 0o777, mode);
}
export function unpack(bytes) {
  const inventory = tarInventory(bytes), tar = gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }), result = new Map();
  for (let offset = 0; offset + 512 <= tar.length && tar[offset] !== 0;) {
    const name = tar.subarray(offset, offset + 100).toString().split('\0')[0].slice(8), entry = inventory[name];
    assert.ok(entry);
    const content = Buffer.from(tar.subarray(offset + 512, offset + 512 + entry.bytes));
    assert.equal(digest(content), entry.sha256); result.set(name, { bytes: content, mode: entry.mode });
    offset += 512 + Math.ceil(entry.bytes / 512) * 512;
  }
  assert.equal(result.size, Object.keys(inventory).length); return result;
}
export function extract(bytes, destination) {
  assert.ok(!fs.existsSync(destination)); fs.mkdirSync(destination, { recursive: true });
  for (const [name, item] of unpack(bytes)) put(path.join(destination, name), item.bytes, item.mode);
  assert.deepEqual(Object.fromEntries(Object.entries(census(destination)).filter(([, entry]) => !entry.directory)), tarInventory(bytes));
}
export function variantTar(original, changedName, changedBytes) {
  const originalInventory = tarInventory(original), data = gunzipSync(original, { maxOutputLength: 64 * 1024 * 1024 });
  const parts = []; let changes = 0;
  const octal = (header, start, length, number) => header.write(number.toString(8).padStart(length - 1, '0') + '\0', start, length, 'ascii');
  for (let offset = 0; offset + 512 <= data.length && data[offset] !== 0;) {
    const header = Buffer.from(data.subarray(offset, offset + 512)), name = header.subarray(0, 100).toString().split('\0')[0].slice(8), entry = originalInventory[name];
    const content = name === changedName ? changedBytes : data.subarray(offset + 512, offset + 512 + entry.bytes);
    if (name === changedName) { changes++; octal(header, 124, 12, content.length); header.fill(32, 148, 156); octal(header, 148, 8, header.reduce((sum, byte) => sum + byte, 0)); }
    parts.push(header, content, Buffer.alloc((512 - content.length % 512) % 512));
    offset += 512 + Math.ceil(entry.bytes / 512) * 512;
  }
  assert.equal(changes, 1); parts.push(Buffer.alloc(1024));
  const variant = gzipSync(Buffer.concat(parts), { level: 9 }), expected = { ...originalInventory, [changedName]: { ...originalInventory[changedName], bytes: changedBytes.length, sha256: digest(changedBytes) } };
  assert.deepEqual(tarInventory(variant), expected); return variant;
}
export function copyRegularTree(source, target) {
  const entries = census(source); assert.ok(!fs.existsSync(target)); fs.mkdirSync(target, { recursive: true });
  for (const [name, entry] of Object.entries(entries)) {
    if (entry.directory) fs.mkdirSync(path.join(target, name), { recursive: true, mode: entry.mode });
    else put(path.join(target, name), regular(path.join(source, name)), entry.mode);
  }
  assert.deepEqual(census(target), entries); return entries;
}
export function verifyTypeTool(tool) {
  const entries = census(tool.root);
  assert.deepEqual(Object.keys(entries).filter(name => entries[name].directory).map(name => name.slice(0, -1)).sort(), [...tool.inventory.directories].sort());
  assert.deepEqual(Object.fromEntries(Object.entries(entries).filter(([, entry]) => !entry.directory)), tool.inventory.files);
}
export function codePatch(root, members) {
  const patches = [];
  for (const [name, item] of members) {
    const bytes = item.bytes ?? item, text = bytes.toString();
    assert.equal(Buffer.from(text).compare(bytes), 0); assert.equal(bytes.at(-1), 10, 'exact final LF, never trim');
    assert.ok(name.split('/').every(part => part && part !== '.' && part !== '..' && part !== 'AGENTS.md'));
    patches.push(`*** Add File: ${path.join(root, name)}\n${text.slice(0, -1).split('\n').map(line => '+' + line).join('\n')}`);
  }
  return `*** Begin Patch\n${patches.join('\n')}\n*** End Patch\n`;
}
