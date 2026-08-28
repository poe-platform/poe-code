import { registerHooks } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { check, Hold } from './core.mjs';

export function installGuard(root, entries, builtins = []) {
  const allowed = new Set(entries.map(entry => pathToFileURL(path.join(root, entry.path)).href));
  const safeBuiltins = new Set(['node:buffer', 'node:util', 'node:path', 'node:stream', 'node:stream/web', 'node:crypto', 'node:events', 'node:timers', 'node:timers/promises']);
  for (const builtin of builtins) check(safeBuiltins.has(builtin), 'BUILTIN_NOT_REVIEWED', builtin);
  const builtinSet = new Set(builtins);
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('node:')) { check(builtinSet.has(specifier), 'DENY_BUILTIN', specifier); return nextResolve(specifier, context); }
      check(specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('file:'), 'DENY_SPECIFIER', specifier);
      const result = nextResolve(specifier, context);
      check(allowed.has(result.url), 'DENY_LOAD', result.url);
      const filename = fileURLToPath(result.url);
      check(!lstatSync(filename).isSymbolicLink() && realpathSync(filename) === filename, 'DENY_SYMLINK');
      return result;
    },
    load(url, context, nextLoad) { check(allowed.has(url) || builtinSet.has(url), 'DENY_LOAD', url); return nextLoad(url, context); },
  });
  for (const key of ['getBuiltinModule', 'binding', '_linkedBinding', 'dlopen']) Object.defineProperty(process, key, { value() { throw new Hold('DENY_AMBIENT'); }, configurable: false, writable: false });
  for (const key of ['fetch', 'WebSocket']) Object.defineProperty(globalThis, key, { value: undefined, configurable: false, writable: false });
}
