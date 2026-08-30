import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, '../../../..');
const author = path.resolve(own, '../../breadth-continuation-20260828/executor-v3');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const recipeCommit = 'e7f0981b9abfddb27d946c991e5860e30365166c';
const handoffCommit = '8666174d2e2fc6a16a2f7d8696d21f56531ccf98';
const priorCommit = 'a66683b5bf9b0274705f5f6e61ff1e35aee1db46';
const sealBytes = fs.readFileSync(path.join(author, 'SEAL.json'));
const seal = JSON.parse(sealBytes);
const entries = new Map();
function bind(filename, commit) {
  const relative = path.relative(repository, filename);
  if (relative.split('/').some(name => name.toUpperCase() === 'AGENTS.MD')) throw new Error('instruction content forbidden');
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`not regular: ${relative}`);
  const bytes = fs.readFileSync(filename);
  const archived = commit ? execFileSync('git', ['show', `${commit}:${relative}`], { cwd: repository, maxBuffer: 4 * 1024 * 1024 }) : bytes;
  entries.set(relative, { path: relative, bytes: bytes.length, mode: stat.mode & 0o7777, sha256: digest(bytes), commit: commit ?? null, gitSha256: digest(archived) });
}
function membership(base, relative = '') {
  return fs.readdirSync(path.join(base, relative)).sort().flatMap(name => {
    const member = path.join(relative, name);
    const stat = fs.lstatSync(path.join(base, member));
    const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file';
    return [{ path: member, type }, ...(type === 'directory' ? membership(base, member) : [])];
  });
}
for (const entry of seal.files) bind(path.resolve(author, entry.path), recipeCommit);
bind(path.join(author, 'SEAL.json'), recipeCommit);
const tree = membership(author);
for (const entry of tree.filter(entry => entry.type === 'file')) bind(path.join(author, entry.path), entry.path.startsWith('runs/') ? handoffCommit : recipeCommit);
for (const name of ['README.md', 'SEAL.json']) bind(path.resolve(own, '../overlay-v2-review', name), priorCommit);
const ownTree = membership(own);
for (const entry of ownTree.filter(entry => entry.type === 'file')) bind(path.join(own, entry.path));
const result = { schema: 'independent-v3-preseal', date: new Date().toISOString(), recipeCommit, handoffCommit, priorCommit, recipeSha256: digest(sealBytes), authorMembership: tree, files: [...entries.values()].sort((left, right) => left.path.localeCompare(right.path)), ownSourceFiles: ownTree.filter(entry => entry.type === 'file').map(entry => entry.path) };
fs.writeFileSync(path.join(own, 'FREEZE.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ frozenFiles: result.files.length, recipeSha256: result.recipeSha256, authorEntries: tree.length }));
