import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const own = path.dirname(fileURLToPath(import.meta.url));
export const repository = path.resolve(own, '../../../..');
export const author = path.resolve(own, '../../breadth-continuation-20260828/executor-v4');
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const recipeCommit = 'b993d26cd6777567ab6de45c617f1b073dd0d1de';
export const evidenceCommit = 'e055968836d73e0eebfa175b56242547008af282';
export const recipeSha256 = 'fc1a0df0015ebd428810c8d86976f3507636eac1c308f366298511fca38cf0e8';
export const git = (...args) => execFileSync('/Applications/Xcode.app/Contents/Developer/usr/bin/git', args, { cwd: repository, timeout: 10000, maxBuffer: 16 * 1024 * 1024 }).toString();
export function fingerprint(filename) {
  assert(!filename.split(path.sep).some(part => part.toUpperCase() === 'AGENTS.MD'), 'Instruction member plaintext prohibited');
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink());
  const digest = createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  const descriptor = fs.openSync(filename, 'r');
  try { let count; while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null))) digest.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(descriptor); }
  return { bytes: stat.size, mode: stat.mode & 0o7777, sha256: digest.digest('hex') };
}
export function membership(base, relative = '') {
  return fs.readdirSync(path.join(base, relative)).sort().flatMap(name => {
    const member = path.join(relative, name);
    const stat = fs.lstatSync(path.join(base, member));
    const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file';
    return [{ path: member, type }, ...(type === 'directory' ? membership(base, member) : [])];
  });
}
export function verify(freeze) {
  for (const entry of freeze.files) assert.deepEqual(fingerprint(path.join(repository, entry.path)), { bytes: entry.bytes, mode: entry.mode, sha256: entry.sha256 }, entry.path);
  for (const entry of freeze.tools) assert.deepEqual(fingerprint(entry.path), { bytes: entry.bytes, mode: entry.mode, sha256: entry.sha256 }, entry.role);
  assert.deepEqual(membership(author), freeze.authorMembership);
  return { authorSeal: fingerprint(path.join(author, 'SEAL.json')).sha256, files: freeze.files.length, tools: freeze.tools.length, authorEntries: freeze.authorMembership.length, detectsNewAuthorEntries: true };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const initialStatus = git('status', '--porcelain=v1', '--untracked-files=all');
  const initialIndex = git('diff', '--cached', '--name-status');
  const entries = new Map();
  function bind(filename, commit = null) {
    const relative = path.relative(repository, filename);
    assert(!relative.startsWith('../'));
    const entry = { path: relative, ...fingerprint(filename), commit };
    if (commit) {
      const bytes = execFileSync('/Applications/Xcode.app/Contents/Developer/usr/bin/git', ['show', `${commit}:${relative}`], { cwd: repository, timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
      assert.equal(hash(bytes), entry.sha256, `live/archive mismatch ${relative}`);
      entry.archivedSha256 = hash(bytes);
    }
    entries.set(relative, entry);
  }
  const sealBytes = fs.readFileSync(path.join(author, 'SEAL.json'));
  assert.equal(hash(sealBytes), recipeSha256);
  for (const entry of JSON.parse(sealBytes).files) {
    const filename = path.resolve(author, entry.path);
    assert.deepEqual(fingerprint(filename), { bytes: entry.bytes, mode: entry.mode, sha256: entry.sha256 });
    bind(filename, recipeCommit);
  }
  const authorMembership = membership(author);
  for (const entry of authorMembership.filter(entry => entry.type === 'file')) bind(path.join(author, entry.path), entry.path.startsWith('runs/') ? evidenceCommit : recipeCommit);
  for (const entry of membership(own).filter(entry => entry.type === 'file')) bind(path.join(own, entry.path));
  const projection = JSON.parse(fs.readFileSync(path.join(author, '../executor-v3/PROJECTION.json')));
  for (const tool of projection.tools) assert.deepEqual(fingerprint(tool.path), { bytes: tool.bytes, mode: tool.mode, sha256: tool.sha256 });
  assert.equal(fs.realpathSync(process.execPath), fs.realpathSync(projection.tools.find(tool => tool.role === 'node').path));
  const result = { schema: 'independent-v4-preexecution-freeze', created: new Date().toISOString(), recipeCommit, evidenceCommit, recipeSha256, nodeVersion: process.version, authorMembership, tools: projection.tools, initialStatus, initialIndex, files: [...entries.values()].sort((left, right) => left.path.localeCompare(right.path)) };
  fs.writeFileSync(path.join(own, 'FREEZE.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ files: result.files.length, authorEntries: authorMembership.length, seal: recipeSha256 }));
}
