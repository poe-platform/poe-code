import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.startsWith('file:')) {
    const file = fileURLToPath(url);
    appendFileSync(process.env.DISPOSE_REVIEW_TRACE, JSON.stringify({ url, fileSha256: hash(readFileSync(file)), loadedSourceSha256: result.source == null ? null : hash(result.source) }) + '\n');
  }
  return result;
}
