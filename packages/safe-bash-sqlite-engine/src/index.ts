import type { SqliteRuntime } from './types.js';
export type { NativeSqliteModule, SqliteRuntime } from './types.js';
import initialize from './native/native.mjs';
export {FacadeVFS} from './native/vfs.mjs';
/** One isolated native module and one reusable callback slot per owner. */
export async function createSqliteRuntime({signal}: {signal?: AbortSignal} = {}): Promise<SqliteRuntime> {
  signal?.throwIfAborted();
  const {modules: [native, callbackModule]} = await import('#sqlite-assets');
  signal?.throwIfAborted();
  let table: WebAssembly.Table | undefined;
  const module = await initialize({instantiateWasm(imports, ready) {
    const instance = new WebAssembly.Instance(native, imports);
    const tables = Object.values(instance.exports).filter(value => value instanceof WebAssembly.Table);
    if (tables.length !== 1) throw new TypeError('Expected one native SQLite callback table');
    [table] = tables;
    ready(instance, native);
    return instance.exports;
  }});
  signal?.throwIfAborted();
  if (!table) throw new TypeError('Missing native SQLite callback table');
  const slot = table.grow(1);
  return {module, table, slot, callbackModule};
}
