import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const [configurationPath, scratch] = process.argv.slice(2);
if (!configurationPath || !scratch) throw new Error('usage: node authenticate.mjs CONFIG SCRATCH');
const configuration = JSON.parse(await readFile(configurationPath));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { maxBuffer: 16 * 1024 * 1024 });
const authentication = { schema: 1, date: new Date().toISOString(), archives: [], receipts: [], guards: [], controls: [] };
for (const receiptPath of configuration.receipts) {
  const bytes = await readFile(receiptPath);
  authentication.receipts.push({ path: receiptPath, bytes: bytes.length, sha256: sha256(bytes), text: bytes.toString() });
}
for (const archive of configuration.archives) {
  const commit = git('rev-parse', `${archive.commit}^{commit}`).toString().trim();
  const paths = git('ls-tree', '-r', '--name-only', '-z', commit, '--', ...archive.paths).toString().split('\0').filter(Boolean);
  assert(paths.length > 0);
  const root = join(scratch, archive.label);
  await mkdir(root, { recursive: true });
  const inventory = [];
  for (const path of paths) {
    const mode = git('ls-tree', commit, '--', path).toString().slice(0, 6);
    assert(mode === '100644' || mode === '100755', `refuse nonregular committed input ${path}`);
    const bytes = git('show', `${commit}:${path}`);
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx' });
    assert.equal(sha256(await readFile(destination)), sha256(bytes));
    const liveBytes = await readFile(path);
    inventory.push({ path, mode, bytes: bytes.length, sha256: sha256(bytes), gitBlob: git('rev-parse', `${commit}:${path}`).toString().trim(), liveMatchesCommit: sha256(liveBytes) === sha256(bytes) });
  }
  const completeInventory = async (directory, prefix = '') => {
    const entries = [];
    for (const name of (await readdir(directory)).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      const path = join(directory, name);
      const stat = await lstat(path);
      if (stat.isDirectory()) {
        entries.push({ path: relative, type: 'directory' });
        entries.push(...await completeInventory(path, relative));
      } else if (stat.isFile()) entries.push({ path: relative, type: 'file', sha256: sha256(await readFile(path)), bytes: stat.size });
      else throw new Error(`unexpected archive entry ${relative}`);
    }
    return entries;
  };
  authentication.archives.push({ label: archive.label, commit, root, inventory, completeBefore: await completeInventory(root) });
}
for (const path of configuration.guards) {
  const bytes = await readFile(path);
  const guarded = git('show', `c3e40f8b:${path}`);
  authentication.guards.push({ path, bytes: bytes.length, sha256: sha256(bytes), c3Sha256: sha256(guarded), matchesC3: sha256(bytes) === sha256(guarded) });
}
for (const path of configuration.controls) {
  const bytes = await readFile(path);
  const frozen = git('show', `18104988:${path}`);
  assert.equal(sha256(bytes), sha256(frozen));
  authentication.controls.push({ path, sha256: sha256(bytes), commit: git('rev-parse', '18104988').toString().trim() });
}
console.log(JSON.stringify(authentication, null, 2));
