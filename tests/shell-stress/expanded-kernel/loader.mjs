import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
let audit;
export function initialize(data) { audit = data.audit; }
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.startsWith('file:')) {
    const path = fileURLToPath(url);
    appendFileSync(audit, JSON.stringify({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }) + '\n');
  }
  return result;
}
