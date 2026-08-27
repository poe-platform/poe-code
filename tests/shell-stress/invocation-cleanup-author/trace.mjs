import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.startsWith('file:')) appendFileSync(process.env.INVOCATION_CLEANUP_TRACE, JSON.stringify({ url, format: result.format, sourceSha256: result.source == null ? null : createHash('sha256').update(result.source).digest('hex') }) + '\n');
  return result;
}
