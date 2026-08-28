import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const own = path.dirname(fileURLToPath(import.meta.url));
export const repository = path.resolve(own, '../../../../..');
export const author = path.join(repository, 'tests/comparison/breadth-continuation-20260828/coordinator-report-v1');
export const inherited = path.join(author, '../executor-v4');
export const url = filename => pathToFileURL(filename).href;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function metadata(filename) {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), filename);
  const descriptor = fs.openSync(filename, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(65536);
  try {
    let count;
    while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count));
  } finally { fs.closeSync(descriptor); }
  return { bytes: stat.size, mode: stat.mode & 0o7777, sha256: hash.digest('hex') };
}
export function members(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix + entry.name;
    assert.ok(!entry.isSymbolicLink());
    return entry.isDirectory() ? members(path.join(directory, entry.name), `${relative}/`) : [relative];
  }).sort();
}
export function authenticate(includeNode = false) {
  const seal = JSON.parse(fs.readFileSync(path.join(own, 'PRESEAL.json')));
  for (const row of seal.inputs) assert.deepEqual(metadata(path.resolve(repository, row.path)), row.metadata, row.path);
  assert.deepEqual(members(author), seal.authorMembers, 'author membership including new entries');
  for (const row of seal.harness) assert.deepEqual(metadata(path.join(own, row.path)), row.metadata, row.path);
  if (includeNode) {
    assert.equal(process.execPath, seal.node.path);
    assert.deepEqual(metadata(process.execPath), seal.node.metadata);
    assert.ok(process.execArgv.includes('--max-old-space-size=128'));
    assert.ok(process.execArgv.includes('--unhandled-rejections=strict'));
  }
  return { inputs: seal.inputs.length, harness: seal.harness.length, authorMembers: seal.authorMembers.length, nodeChecked: includeNode, passed: true };
}
export function writeJson(filename, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  assert.ok(bytes.length <= 262144, 'independent evidence record bound');
  fs.writeFileSync(filename, bytes, { flag: 'wx', mode: 0o644 });
  return { bytes: bytes.length, sha256: sha256(bytes) };
}
export function absent(identifier) {
  try { process.kill(identifier, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}
