import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const own = dirname(import.meta.filename);
const output = resolve(process.argv[2] ?? join(own, 'evidence-final'));
assert.ok(output.startsWith(own + '/') || output.startsWith('/tmp/'));
const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
assert.match(manifest.scratch, /^\/tmp\/safe-bash-fraction-independent-packed-[a-zA-Z0-9]+$/);
assert.equal(manifest.cleanedOwnedScratch, true);
const cacheRoot = `/tmp/tsx-${process.geteuid()}`;
const canonicalSourceRoot = `/private${manifest.scratch}/archive/src/`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const removed = [];
const candidates = [];
let inspectedWithinRunWindow = 0;
for (const name of await readdir(cacheRoot).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
  if (!/^\d+-[a-f0-9]+$/.test(name)) continue;
  const path = join(cacheRoot, name);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.size > 2 * 1024 * 1024 || metadata.mtimeMs < Date.parse(manifest.startedAt) || metadata.mtimeMs > Date.parse(manifest.finishedAt)) continue;
  inspectedWithinRunWindow++;
  const bytes = await readFile(path);
  if (!bytes.includes(manifest.scratch)) continue;
  const parsed = JSON.parse(bytes);
  assert.ok(Array.isArray(parsed.map.sources) && parsed.map.sources.length > 0);
  assert.ok(parsed.map.sources.every(source => source.startsWith(canonicalSourceRoot)), path);
  const item = { path, sha256: hash(bytes), bytes: bytes.length, inode: metadata.ino, mtimeMs: metadata.mtimeMs, sources: parsed.map.sources };
  candidates.push(item);
}
await writeFile(join(output, 'cache-cleanup-before.json'), JSON.stringify({ cacheRoot, canonicalSourceRoot, inspectedWithinRunWindow, candidates }, null, 2), { flag: 'wx' });
for (const item of candidates) {
  const metadata = await lstat(item.path);
  assert.equal(metadata.ino, item.inode); assert.equal(metadata.mtimeMs, item.mtimeMs);
  assert.equal(hash(await readFile(item.path)), item.sha256);
  await unlink(item.path);
  await assert.rejects(lstat(item.path), { code: 'ENOENT' });
  removed.push(item.path);
}
await writeFile(join(output, 'cache-cleanup.json'), JSON.stringify({
  reason: 'Unchanged original223 isolated-child fixture supplies its own minimal env, omitting inherited TSX_DISABLE_CACHE/TMPDIR. Only cache entries whose source maps name this exact owned frozen scratch are removed.',
  cacheRoot, canonicalSourceRoot, removed, foreignEntriesUntouched: true, cacheDirectoryPreserved: true,
  capturedAt: new Date().toISOString(),
}, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ removed: removed.length, foreignEntriesUntouched: true }));
