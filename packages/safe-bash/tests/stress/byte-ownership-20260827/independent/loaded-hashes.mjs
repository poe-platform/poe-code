import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const expected = JSON.parse(readFileSync(process.env.OWNERSHIP_PACKAGE_HASHES, 'utf8'));

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.startsWith('file:')) {
    const filename = fileURLToPath(url);
    if (Object.hasOwn(expected, filename)) {
      const digest = createHash('sha256').update(result.source).digest('hex');
      if (digest !== expected[filename]) throw new Error(`Loaded package hash mismatch: ${filename}`);
      appendFileSync(process.env.OWNERSHIP_LOADED_LOG, JSON.stringify({ filename, sha256: digest }) + '\n');
    }
  }
  return result;
}
