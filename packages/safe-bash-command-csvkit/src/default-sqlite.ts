import type {DatabaseProvider} from "./contracts.js";
import {parseDatabaseUrl} from "./database-url.js";
import {CsvkitBlocked} from "./errors.js";
import {virtualPath} from "./io/index.js";
import {createSqliteDatabaseProvider, type SQLiteRuntime, type SQLiteOptions} from "./sqlite.js";
import type {SQLiteFile, SQLiteFileSystem} from "./sqlite-vfs.js";

export interface DefaultSqliteFileAdapter {
  readFile(path: string, settings: {readonly signal: AbortSignal}): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array, settings: {readonly signal: AbortSignal}): Promise<void>;
  readonly maxBytes?: number;
}

function createBufferSqliteFileSystem(
  targetPath: string,
  files: Map<string, Uint8Array>,
  maxBytes: number,
  onMutate: () => void
): SQLiteFileSystem {
  const admit = (path: string): void => {
    if (
      !path.startsWith("/") ||
      virtualPath("/", path) !== path ||
      !(path === targetPath || path.startsWith(targetPath + "-") || path.startsWith(targetPath + "."))
    ) {
      throw new CsvkitBlocked("SQLite host divergence: unauthorized memory VFS path");
    }
  };
  const checkBudget = (nextPath: string, nextByteLength: number): void => {
    let total = nextByteLength;
    for (const [k, v] of files) if (k !== nextPath) total += v.byteLength;
    if (total > maxBytes) throw new CsvkitBlocked("SQLite memory file byte budget exceeded");
  };
  return {
    open(path, flags): SQLiteFile {
      admit(path);
      const exists = files.has(path), create = !!(flags & 4), readonly = !!(flags & 1);
      if (!exists && !create) throw new Error("SQLite memory file does not exist");
      if (exists && create && (flags & 16)) throw new Error("SQLite exclusive creation failed");
      if (!exists) {
        checkBudget(path, 0);
        files.set(path, new Uint8Array(0));
      }
      let closed = false, lockLevel = 0;
      const writable = (): void => { if (readonly || closed) throw new Error("SQLite memory file not writable"); };
      return {
        read(target, offset) {
          const data = files.get(path) ?? new Uint8Array(0);
          if (offset >= data.byteLength) return 0;
          const slice = data.subarray(offset, Math.min(data.byteLength, offset + target.byteLength));
          target.set(slice, 0);
          return slice.byteLength;
        },
        write(source, offset) {
          writable();
          const current = files.get(path) ?? new Uint8Array(0);
          const nextLength = Math.max(current.byteLength, offset + source.byteLength);
          checkBudget(path, nextLength);
          const next = nextLength === current.byteLength ? current : (() => {
            const buf = new Uint8Array(nextLength);
            buf.set(current, 0);
            return buf;
          })();
          next.set(source, offset);
          files.set(path, next);
          if (path === targetPath) onMutate();
        },
        truncate(size) {
          writable();
          checkBudget(path, size);
          const current = files.get(path) ?? new Uint8Array(0);
          const next = new Uint8Array(size);
          next.set(current.subarray(0, Math.min(current.byteLength, size)), 0);
          files.set(path, next);
          if (path === targetPath) onMutate();
        },
        size: () => (files.get(path) ?? new Uint8Array(0)).byteLength,
        sync: () => {},
        lock(level) { lockLevel = Math.max(lockLevel, level); return true; },
        unlock(level) { lockLevel = level; },
        reserved: () => lockLevel >= 2,
        close() { closed = true; lockLevel = 0; }
      };
    },
    exists(path) { admit(path); return files.has(path); },
    delete(path) { admit(path); files.delete(path); }
  };
}

let runtime: Promise<SQLiteRuntime> | undefined;
/** Lazy package infrastructure, with isolated in-memory connections and optional VFS file persistence. */
export function createDefaultSqliteDatabaseProvider(
  clock: {now(): number},
  limits: SQLiteOptions["limits"] = {},
  fs?: DefaultSqliteFileAdapter
): DatabaseProvider {
  const budget = Object.freeze({...limits});
  return Object.freeze({
    schemes: Object.freeze(["sqlite", "sqlite+pysqlite"]),
    profile: "sqlite-wasm-3.50.4-cpython-legacy",
    async connect(url, options, signal, invocation) {
      signal.throwIfAborted();
      runtime ??= import("@sqlite.org/sqlite-wasm").then(({default: initialize}) => initialize({print: () => {}, printErr: () => {}}));
      const sqlite = await runtime;
      signal.throwIfAborted();
      let targetPath: string | undefined;
      let initialBytes: Uint8Array | undefined;
      let dirty = false;
      const files = new Map<string, Uint8Array>();
      let vfs: SQLiteFileSystem | undefined;
      if (fs !== undefined && !url.includes("?") && !url.includes("#") && !url.includes("\0")) {
        let parsed: ReturnType<typeof parseDatabaseUrl> | undefined;
        try { parsed = parseDatabaseUrl(url); } catch { parsed = undefined; }
        if (
          parsed &&
          ["sqlite", "sqlite+pysqlite"].includes(parsed.drivername) &&
          parsed.database &&
          parsed.database !== ":memory:" &&
          !parsed.database.startsWith("file:")
        ) {
          targetPath = virtualPath(invocation?.cwd ?? "/", parsed.database);
          try {
            const loaded = await fs.readFile(targetPath, {signal});
            initialBytes = new Uint8Array(loaded);
            files.set(targetPath, new Uint8Array(loaded));
          } catch (error) {
            if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
              throw error;
            }
          }
          vfs = createBufferSqliteFileSystem(targetPath, files, fs.maxBytes ?? Infinity, () => { dirty = true; });
        }
      }
      const provider = createSqliteDatabaseProvider({
        sqlite,
        limits: budget,
        cwd: invocation?.cwd ?? "/",
        clock,
        random: bytes => { globalThis.crypto.getRandomValues(bytes); },
        ...(vfs === undefined ? {} : {vfs})
      });
      try {
        const session = await provider.connect(url, options, signal, invocation);
        signal.throwIfAborted();
        let closed = false;
        return Object.freeze({
          ...session,
          async close() {
            await provider.dispose();
            if (!closed) {
              closed = true;
              if (targetPath !== undefined && fs !== undefined && dirty && files.has(targetPath)) {
                const current = files.get(targetPath)!;
                const unchanged =
                  initialBytes !== undefined &&
                  current.byteLength === initialBytes.byteLength &&
                  current.every((byte, idx) => byte === initialBytes[idx]);
                if (!unchanged && (initialBytes !== undefined || current.byteLength > 0)) {
                  await fs.writeFile(targetPath, current, {signal});
                }
              }
            }
          }
        });
      } catch (error) {
        await provider.dispose();
        throw error;
      }
    }
  } satisfies DatabaseProvider);
}
