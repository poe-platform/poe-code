import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const expected = JSON.parse(readFileSync(process.env.REVIEW_HASHES, 'utf8'));
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.startsWith('file:')) {
    const path = fileURLToPath(url);
    if (Object.hasOwn(expected, path)) {
      const digest = createHash('sha256').update(result.source).digest('hex');
      if (digest !== expected[path]) throw new Error(`Loaded product bytes differ: ${path}`);
      appendFileSync(process.env.REVIEW_LOADED, JSON.stringify({ path, sha256: digest }) + '\n');
    }
  }
  return result;
}
