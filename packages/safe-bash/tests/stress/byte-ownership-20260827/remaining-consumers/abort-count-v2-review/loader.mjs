import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const expected = JSON.parse(readFileSync(process.env.REVIEW_HASHES, 'utf8'));
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.startsWith('file:')) {
    const path = fileURLToPath(url);
    if (path.startsWith(process.env.REVIEW_PACKAGE + '/')) {
      if (!Object.hasOwn(expected, path)) throw new Error(`Unpinned package module: ${path}`);
      const sha256 = createHash('sha256').update(result.source).digest('hex');
      if (sha256 !== expected[path]) throw new Error(`Loaded package bytes differ: ${path}`);
      appendFileSync(process.env.REVIEW_LOADED, JSON.stringify({ path, sha256 }) + '\n');
    }
  }
  return result;
}
