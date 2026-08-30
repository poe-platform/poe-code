import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { canonicalData, requireFact, sha256 } from './own-data.mjs';

export function readSelectedSources(root, manifest) {
  requireFact(typeof root === 'string' && resolve(root) === root && realpathSync(root) === root, 'SOURCE_ROOT');
  const files = Object.create(null);
  const directories = Object.create(null);
  const bytesByPath = new Map();
  let totalBytes = 0;
  let count = 0;
  const walk = relative => {
    requireFact(++count <= 4096, 'SOURCE_ENTRY_BOUND');
    const absolute = join(root, relative);
    const before = lstatSync(absolute);
    requireFact(!before.isSymbolicLink(), 'SOURCE_LINK');
    if (before.isDirectory()) {
      directories[relative] = before.mode & 4095;
      for (const name of readdirSync(absolute).sort()) walk(relative ? `${relative}/${name}` : name);
      return;
    }
    requireFact(before.isFile() && before.nlink === 1 && before.size <= 16777216 && (totalBytes += before.size) <= 67108864, 'SOURCE_FILE_BOUND');
    const bytes = readFileSync(absolute);
    const after = lstatSync(absolute);
    requireFact(before.dev === after.dev && before.ino === after.ino && before.mode === after.mode && before.size === after.size && bytes.length === before.size, 'SOURCE_READ_CHANGED');
    files[relative] = { sha256: sha256(bytes), bytes: bytes.length, mode: before.mode & 4095 };
    bytesByPath.set(relative, bytes);
  };
  walk('');
  const observed = { files, directories };
  requireFact(canonicalData(observed) === canonicalData(manifest), 'SOURCE_TREE_INTEGRITY');
  return { observed, totalBytes, readSource(relative) { requireFact(bytesByPath.has(relative), 'SOURCE_READER_PATH'); return bytesByPath.get(relative); } };
}
