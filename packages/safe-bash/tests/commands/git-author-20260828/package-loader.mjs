import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const binding = JSON.parse(await fs.readFile(process.env.GIT_AUTHOR_BINDING));
const rows = new Map(binding.inputs.map(row => [path.join(binding.root, 'dist', row.path), row]));
export async function load(url, context, next) {
  if (url.startsWith('file:')) {
    const file = fileURLToPath(url);
    if (!file.startsWith(binding.harness + path.sep)) {
      if (!file.startsWith(binding.root + path.sep)) throw new Error('package outside authenticated root');
      const row = rows.get(file); if (!row) throw new Error('package binding missing member');
      const bytes = await fs.readFile(file);
      if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error('package hash mismatch');
      await fs.appendFile(binding.trace, JSON.stringify({ file, sha256: row.sha256 }) + '\n');
    }
  }
  return next(url, context);
}
