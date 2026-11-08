import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const binding = JSON.parse(await fs.readFile(process.env.PUBLIC_BINDING));
const admitted = new Map(binding.inputs.map(row => [path.join(binding.root, 'dist', row.path), row]));
const harness = new Map(binding.harness.map(row => [row.path, row]));
export async function load(url, context, next) {
  if (url.startsWith('node:')) return next(url, context);
  if (!url.startsWith('file:')) throw Error('Non-file module capability denied');
  const filename = fileURLToPath(url), metadata = await fs.lstat(filename);
  if (!metadata.isFile() || metadata.isSymbolicLink() || await fs.realpath(filename) !== filename || metadata.size > 8388608) throw Error('Module file admission failed');
  const row = harness.get(filename) ?? admitted.get(filename);
  if (!row) throw Error('package outside authenticated compiled root or package binding missing member');
  const data = await fs.readFile(filename), sha256 = createHash('sha256').update(data).digest('hex');
  if (sha256 !== row.sha256) throw Error('package hash mismatch');
  if (admitted.has(filename)) await fs.appendFile(binding.trace, JSON.stringify({ file: filename, sha256 }) + '\n');
  return { format: 'module', source: data, shortCircuit: true };
}
