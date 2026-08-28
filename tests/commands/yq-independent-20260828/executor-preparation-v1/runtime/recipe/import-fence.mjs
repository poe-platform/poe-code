import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

let compiledRoot;
const allowedBuiltins = new Set(['node:path', 'node:util', 'node:buffer', 'node:stream', 'node:stream/web']);

export function initialize(data) {
  compiledRoot = data.compiledRoot;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('node:')) {
    if (!allowedBuiltins.has(specifier)) throw new Error(`Unbound candidate builtin: ${specifier}`);
    return nextResolve(specifier, context);
  }
  if (!specifier.startsWith('.') && !specifier.startsWith('file:') && !specifier.startsWith('/')) throw new Error(`Package/network import not bound: ${specifier}`);
  const result = await nextResolve(specifier, context);
  if (!result.url.startsWith('file:')) throw new Error('Non-file candidate import');
  const filename = fileURLToPath(result.url);
  const suffix = relative(compiledRoot, filename);
  if (suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix) || realpathSync(filename) !== filename) throw new Error('Candidate import escaped authenticated compiled tree');
  return result;
}
