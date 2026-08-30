import { lstat, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('./VERIFY-GAP-01/', import.meta.url));
const started = performance.now();
await mkdir(root, { mode: 0o700 });
const save = (name, bytes) => writeFile(root + name, bytes, { flag: 'wx', mode: 0o600 });
await save('STARTUP.json', JSON.stringify({ startedAt: new Date().toISOString(), children: 0, network: false, verifierExecution: false }) + '\n');
const results = [];
try {
  for (const path of ['/opt/homebrew/Cellar/gnupg/2.5.21/INSTALL_RECEIPT.json', '/opt/homebrew/Cellar/gnupg/2.5.21/.brew/gnupg.rb']) {
    assert(performance.now() - started < 20000);
    let before;
    try { before = await lstat(path, { bigint: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; results.push({ path, disposition: 'ABSENT' }); continue; }
    assert(before.isFile() && !before.isSymbolicLink() && before.size <= 131072n);
    const bytes = await readFile(path);
    const after = await lstat(path, { bigint: true });
    assert(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs);
    const name = path.split('/').at(-1) + '.data';
    await save(name, bytes);
    results.push({ path, captured: name, bytes: bytes.length, mode: Number(before.mode & 0o777n).toString(8), sha256: createHash('sha256').update(bytes).digest('hex'), disposition: 'DECLARED_PACKAGE_METADATA_NOT_LOADED_CLOSURE' });
  }
  await save('RESULT.json', JSON.stringify({ results, elapsedMs: performance.now() - started, verifierExecutions: 0, children: 0 }, null, 2) + '\n');
} catch (error) {
  process.exitCode = 1;
  await save('FAILURE.json', JSON.stringify({ name: error.name, message: error.message, results }, null, 2) + '\n');
}
