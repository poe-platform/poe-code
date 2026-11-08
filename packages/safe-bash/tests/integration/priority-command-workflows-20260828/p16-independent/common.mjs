import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const objectHash = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
export function regular(filename) { assert.equal(fs.realpathSync(filename), filename); const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink()); return fs.readFileSync(filename); }
export function put(filename, bytes) { assert.ok(!filename.split('/').includes('AGENTS.md')); fs.mkdirSync(path.dirname(filename), { recursive: true }); assert.equal(fs.realpathSync(path.dirname(filename)), path.dirname(filename)); fs.writeFileSync(filename, bytes, { flag: 'wx', mode: 0o644 }); }
export function census(root) {
  const result = {}; let count = 0;
  const visit = directory => { for (const name of fs.readdirSync(directory).sort()) { assert.ok(++count <= 10000); const filename = path.join(directory, name), stat = fs.lstatSync(filename), relative = path.relative(root, filename); assert.ok(!stat.isSymbolicLink()); if (stat.isDirectory()) { result[relative + '/'] = { directory: true, mode: stat.mode & 0o777 }; visit(filename); } else { const bytes = regular(filename); result[relative] = { bytes: bytes.length, sha256: sha(bytes), mode: stat.mode & 0o777 }; } } };
  visit(root); return result;
}
