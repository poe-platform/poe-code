import type {DatabaseProvider} from "./contracts.js";
import {createSqliteDatabaseProvider, type SQLiteRuntime, type SQLiteOptions} from "./sqlite.js";

let runtime: Promise<SQLiteRuntime> | undefined;
/** Lazy package infrastructure, with isolated in-memory connections and no file VFS. */
export function createDefaultSqliteDatabaseProvider(clock: {now(): number}, limits: SQLiteOptions["limits"] = {}): DatabaseProvider {
  const budget = Object.freeze({...limits});
  return Object.freeze({
    schemes: Object.freeze(["sqlite", "sqlite+pysqlite"]),
    profile: "sqlite-wasm-3.50.4-cpython-legacy",
    async connect(url, options, signal, invocation) {
      signal.throwIfAborted();
      runtime ??= import("@sqlite.org/sqlite-wasm").then(({default: initialize}) => initialize({print: () => {}, printErr: () => {}}));
      const sqlite = await runtime;
      signal.throwIfAborted();
      const provider = createSqliteDatabaseProvider({sqlite, limits: budget, cwd: invocation?.cwd ?? "/", clock, random: bytes => {globalThis.crypto.getRandomValues(bytes);}});
      try {
        const session = await provider.connect(url, options, signal, invocation);
        signal.throwIfAborted();
        return Object.freeze({...session, close: () => provider.dispose()});
      } catch (error) {
        await provider.dispose();
        throw error;
      }
    }
  } satisfies DatabaseProvider);
}
