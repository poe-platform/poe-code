import { builtinModules } from 'node:module';
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const approval = JSON.parse(readFileSync(process.env.SAFETY_AUTH, 'utf8'));
const snapshot = realpathSync(approval.snapshot);
const files = new Map(approval.files.map(entry => [resolve(snapshot, entry.path), entry.sha256]));
const forbidden = new Set(['fs', 'fs/promises', 'child_process', 'worker_threads', 'http', 'https', 'http2', 'net', 'tls', 'dgram']);
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/u, '')));

export async function resolveModule(specifier, context, nextResolve) {
  const product = context.parentURL?.startsWith('file:') && fileURLToPath(context.parentURL).startsWith(snapshot + sep);
  const plain = specifier.replace(/^node:/u, '');
  if (product && forbidden.has(plain)) throw new Error(`Forbidden product host/worker dependency ${specifier}`);
  if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('file:') && !builtins.has(plain)) throw new Error(`No package/dependency resolution: ${specifier}`);
  const result = await nextResolve(specifier, context);
  if (result.url.startsWith('file:')) {
    const path = fileURLToPath(result.url);
    if (!path.startsWith(root + sep) && !files.has(path)) throw new Error(`Unfrozen import ${path}`);
  } else if (!result.url.startsWith('node:')) throw new Error(`Unsupported module URL ${result.url}`);
  return result;
}
export { resolveModule as resolve };

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:')) {
    const path = fileURLToPath(url);
    if (files.has(path)) {
      const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
      if (hash !== files.get(path)) throw new Error(`Frozen module changed: ${path}`);
      appendFileSync(process.env.SAFETY_MODULE_LOG, `${JSON.stringify({ path, sha256: hash })}\n`);
    }
  }
  return nextLoad(url, context);
}
