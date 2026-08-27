import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

let configuration;
export function initialize(data) { configuration = data; }
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:')) {
    const path = fileURLToPath(url), actual = realpathSync(path);
    if (!actual.startsWith(configuration.freeze + '/')) throw new Error(`IMPORT OUTSIDE FREEZE: ${url} -> ${actual}`);
    const sourceSha256 = createHash('sha256').update(readFileSync(actual)).digest('hex');
    appendFileSync(configuration.log, JSON.stringify({ event: 'module-load', pid: process.pid, url, actual, sourceSha256 }) + '\n');
  }
  return nextLoad(url, context);
}
