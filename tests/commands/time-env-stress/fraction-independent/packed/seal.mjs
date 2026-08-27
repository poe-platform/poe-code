import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const own = dirname(import.meta.filename);
async function entries(prefix = '') {
  const result = {};
  for (const entry of (await readdir(join(own, prefix), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(prefix, entry.name);
    if (path === 'PROOF_MANIFEST.json') continue;
    if (entry.isDirectory()) Object.assign(result, await entries(path));
    else {
      assert.ok(entry.isFile(), path);
      const bytes = await readFile(join(own, path));
      result[path] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    }
  }
  return result;
}
const observed = await entries();
const path = join(own, 'PROOF_MANIFEST.json');
if (process.argv.includes('--check')) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(observed, manifest.files);
  console.log(`Verified ${Object.keys(observed).length} owned proof files.`);
} else {
  await writeFile(path, JSON.stringify({ source: 'c7823633ee99f711f1319ace59d4cf2b7f622ecc',
    identity: '01a0426e-f309-7682-bfbf-2cd25393acf3 NEW independent packed/cohort verifier',
    scope: 'Only this new packed subtree; includes initial harness failure, frozen replay, unchanged historical captures and runnable verification tools.',
    files: observed }, null, 2) + '\n', { flag: 'wx' });
  console.log(`Sealed ${Object.keys(observed).length} owned proof files.`);
}
