import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Volume, createFsFromVolume } from 'memfs';
import { buildPackage } from './build.mjs';
import { renderNativeStorageSources } from './generate-native-storage-sources.mjs';

for (const defect of ['none', 'stale', 'canonical-change', 'missing-literal', 'missing-canonical']) test(`native storage literals are synchronized before guarded emission: ${defect}`, async () => {
  const canonical = 'export function collectStorageOrigin(): number { return 1; }\nexport function restoreStorageOrigin(): boolean { return true; }\n';
  const sources = renderNativeStorageSources(canonical);
  const extra = { '/owned/package/package.json': '{}' };
  if (defect !== 'missing-canonical') extra['/owned/package/src/playwright/native-storage-realm.ts'] = defect === 'canonical-change' ? canonical.replace('return 1', 'return 2') : canonical;
  if (defect !== 'missing-literal') extra['/owned/package/src/playwright/native-storage-sources.generated.ts'] = defect === 'stale' ? sources + '// stale\n' : sources;
  const fileSystem = createFsFromVolume(Volume.fromJSON(extra));
  const reads = []; const read = fileSystem.readFileSync.bind(fileSystem);
  fileSystem.readFileSync = path => { reads.push(path); return read(path, 'utf8'); };
  let writes = 0;
  const run = () => buildPackage({ root: '/owned/package', fileSystem, spawn() { writes++; return { status: 0, signal: null }; } });
  if (defect === 'none') assert.equal((await run()).status, 0);
  else {
    await assert.rejects(run(), defect.startsWith('missing') ? /sources are incomplete/ : /literals are stale/);
    assert.equal(writes, 0);
  }
  assert.ok(reads.every(path => path.startsWith('/owned/package/src/playwright/')));
});
