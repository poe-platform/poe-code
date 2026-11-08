import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.startsWith('file:')) appendFileSync(process.env.HOLDOUT_TRACE, JSON.stringify({ url, format: result.format, sha256: result.source == null ? null : createHash('sha256').update(result.source).digest('hex') }) + '\n');
  return result;
}
