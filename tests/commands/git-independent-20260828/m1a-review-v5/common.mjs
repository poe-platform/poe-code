import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../../..');
export const SOURCE = '9885390fb11454fa194a3e60fdbef198dbfdf633';
export const EVIDENCE = '887c9cbfe536c11c176cb083a2aac6adb971f1fb';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const objectHash = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
export const need = (value, message) => assert.ok(value, message);
export const now = () => Number(process.hrtime.bigint() / 1000000n);
export async function inventory(root) {
  const rows = [];
  async function walk(relative) {
    for (const name of (await fs.readdir(path.join(root, relative))).sort()) {
      need(name !== 'AGENTS.md', 'no instruction materialization');
      const member = path.join(relative, name), stat = await fs.lstat(path.join(root, member));
      need(!stat.isSymbolicLink(), `regular-only inventory: ${member}`);
      if (stat.isDirectory()) { rows.push({ path: member, directory: true }); await walk(member); }
      else { need(stat.isFile(), `regular file: ${member}`); const bytes = await fs.readFile(path.join(root, member)); rows.push({ path: member, bytes: bytes.length, mode: stat.mode & 0o777, sha256: sha(bytes) }); }
    }
  }
  await walk('');
  return rows;
}
export async function put(file, bytes) {
  need(file.startsWith(HERE + path.sep), 'owned writes only');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes, { flag: 'wx' });
}
export function untar(bytes) {
  const files = [];
  let offset = 0;
  while (offset + 512 <= bytes.length && bytes.subarray(offset, offset + 512).some(value => value !== 0)) {
    const header = bytes.subarray(offset, offset + 512);
    const text = (start, width) => header.subarray(start, start + width).toString().replace(/\0.*$/s, '');
    const name = text(0, 100), prefix = text(345, 155), size = parseInt(text(124, 12).trim(), 8), mode = parseInt(text(100, 8).trim(), 8);
    need(header[156] === 48 || header[156] === 0, 'tar regular files only');
    const member = (prefix ? prefix + '/' : '') + name;
    need(member.startsWith('package/') && !member.split('/').some(part => ['..', 'AGENTS.md'].includes(part)), 'safe package member');
    need(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= bytes.length, 'tar extent');
    const checksum = parseInt(text(148, 8).trim(), 8);
    need(header.reduce((total, value, index) => total + (index >= 148 && index < 156 ? 32 : value), 0) === checksum, 'tar header checksum');
    files.push({ path: member.slice(8), mode: mode & 0o777, data: Buffer.from(bytes.subarray(offset + 512, offset + 512 + size)) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  need(bytes.subarray(offset).every(value => value === 0), 'tar trailing padding');
  need(new Set(files.map(row => row.path)).size === files.length, 'unique package members');
  return files;
}
