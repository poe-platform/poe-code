import { readFileSync, appendFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const state = JSON.parse(readFileSync(process.env.REVIEW_STATE));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function load(url, context, next) {
  if (url.startsWith('file:')) {
    const path = realpathSync(fileURLToPath(url));
    if (!path.startsWith(state.consumer + '/')) throw new Error('REVIEW_SOURCE_FALLBACK_DENIED ' + path);
    const prefix = state.consumer + '/node_modules/virtual-bash/';
    const bytes = readFileSync(path), digest = hash(bytes);
    if (path.startsWith(prefix) && state.installed[path.slice(prefix.length)] !== digest) throw new Error('REVIEW_PACKAGE_TAMPER ' + path);
    appendFileSync(process.env.REVIEW_TRACE, JSON.stringify({ path, sha256: digest }) + '\n');
  }
  return next(url, context);
}
