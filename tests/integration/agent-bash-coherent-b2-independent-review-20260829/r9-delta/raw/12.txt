import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const binding = JSON.parse(await fs.readFile(process.env.PUBLIC_BINDING));
const admitted = new Map(binding.inputs.map(row => [path.join(binding.root, 'dist', row.path), row]));
const harness = new Map(binding.harness.map(row => [row.path, row]));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function load(url, context, next) {
  if (!url.startsWith('file:')) return next(url, context);
  const file = fileURLToPath(url), data = await fs.readFile(file);
  if (harness.has(file)) {
    if (digest(data) !== harness.get(file).sha256) throw Error('harness hash mismatch');
  } else {
    if (!file.startsWith(binding.root + '/dist/')) throw Error('package outside authenticated compiled root');
    const row = admitted.get(file); if (!row) throw Error('package binding missing member');
    if (digest(data) !== row.sha256) throw Error('package hash mismatch');
    await fs.appendFile(binding.trace, JSON.stringify({ file, sha256: row.sha256 }) + '\n');
  }
  return next(url, context);
}
