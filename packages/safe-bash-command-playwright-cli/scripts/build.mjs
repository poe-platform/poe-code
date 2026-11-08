import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeOutputDirectory } from '../../../scripts/guard-package-dist.mjs';
import { renderNativeStorageSources } from './generate-native-storage-sources.mjs';

export async function buildPackage({ root = process.cwd(), fileSystem = fs, spawn = spawnSync } = {}) {
  await assertSafeOutputDirectory(root, join(root, 'dist'), {
    lstat: async path => fileSystem.lstatSync(path), realpath: async path => fileSystem.realpathSync(path),
  });
  const sources = ['native-storage-realm.ts', 'native-storage-sources.generated.ts'].map(name => {
    const path = join(root, 'src/playwright', name);
    assert.ok(fileSystem.existsSync(path), 'native storage realm sources are incomplete; regenerate literals');
    assert.ok(fileSystem.lstatSync(path).isFile() && !fileSystem.lstatSync(path).isSymbolicLink(), 'native storage realm source must be a regular file');
    return fileSystem.readFileSync(path, 'utf8');
  });
  assert.equal(sources[1], renderNativeStorageSources(sources[0]), 'native storage realm literals are stale');
  const result = spawn('tsc', [], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, 'compiler interrupted');
  return { status: result.status ?? 1 };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = (await buildPackage()).status;
}
