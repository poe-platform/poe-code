import { register } from "node:module";

if (process.env.DISCOVERY_FIX_IMPORTS) register(`data:text/javascript,${encodeURIComponent(`
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.startsWith('file:') && url.endsWith('.ts')) {
    const path = fileURLToPath(url);
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
    appendFileSync(process.env.DISCOVERY_FIX_IMPORTS, JSON.stringify({ pid: process.pid, path, hash, format: result.format }) + '\\n');
  }
  return result;
}
`)}`);
