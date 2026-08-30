import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
if (process.argv.length !== 3 || process.argv[2] !== '--pack-new') throw new Error('explicit --pack-new required; existing output refused');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const mappings = [];
for (const capture of ['capture-third', 'capture-final']) {
  for (const variant of ['candidate', 'unguarded', 'exactMandatoryOnly', 'repeatFrames']) {
    const original = `${capture}/${variant}.json`;
    const archived = original + '.gz';
    const bytes = await readFile(new URL(original, import.meta.url));
    const gzip = gzipSync(bytes, { level: 9 });
    assert.deepEqual(gunzipSync(gzip), bytes);
    await writeFile(new URL(archived, import.meta.url), gzip, { flag: 'wx' });
    mappings.push({ original, archived, originalBytes: bytes.length, originalSha256: digest(bytes), archiveBytes: gzip.length, archiveSha256: digest(gzip) });
  }
}
await writeFile(new URL('./PREPACK-MANIFEST.json', import.meta.url), await readFile(new URL('./manifest.json', import.meta.url)), { flag: 'wx' });
await writeFile(new URL('./PACKING.json', import.meta.url), JSON.stringify({ classification: 'Lossless compression of owned verbose diagnostic traces, byte-exact recovery verified. No row, event, failed attempt, tuple, or source byte discarded. PREPACK-MANIFEST is the prior seal, not the current inventory.', mappings }, null, 2) + '\n', { flag: 'wx' });
