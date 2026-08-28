import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const oid = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
export function regular(filename) { assert.equal(fs.realpathSync(filename), filename); assert.ok(fs.lstatSync(filename).isFile()); return fs.readFileSync(filename); }
export function put(filename, bytes) { assert.ok(path.isAbsolute(filename) && !filename.split('/').includes('AGENTS.md')); fs.mkdirSync(path.dirname(filename), { recursive: true }); assert.equal(fs.realpathSync(path.dirname(filename)), path.dirname(filename)); fs.writeFileSync(filename, bytes, { flag: 'wx', mode: 0o644 }); }
export function census(root) {
  assert.equal(fs.realpathSync(root), root); const rows = {}; let count = 0;
  const walk = directory => { for (const name of fs.readdirSync(directory).sort()) { assert.ok(++count < 20000); assert.notEqual(name, 'AGENTS.md'); const filename = path.join(directory, name), stat = fs.lstatSync(filename), relative = path.relative(root, filename); assert.equal(stat.isSymbolicLink(), false); if (stat.isDirectory()) { rows[relative + '/'] = { directory: true, mode: stat.mode & 0o777 }; walk(filename); } else { assert.ok(stat.isFile()); rows[relative] = { bytes: stat.size, mode: stat.mode & 0o777, sha256: sha(regular(filename)) }; } } };
  walk(root); return rows;
}
export function verify(tree) { assert.deepEqual(census(tree.root), tree.entries); }
