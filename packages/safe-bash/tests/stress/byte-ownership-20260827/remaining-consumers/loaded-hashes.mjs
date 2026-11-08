import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const expected = JSON.parse(readFileSync(process.env.REMAINING_HASHES, 'utf8'));
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.startsWith('file:')) {
    const filename = fileURLToPath(url);
    if (Object.hasOwn(expected, filename)) {
      const sha256 = createHash('sha256').update(result.source).digest('hex');
      if (sha256 !== expected[filename]) throw new Error(`Loaded hash mismatch: ${filename}`);
      appendFileSync(process.env.REMAINING_LOADED, JSON.stringify({ filename, sha256 }) + '\n');
    }
  }
  return result;
}
