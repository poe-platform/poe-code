import type { PlaywrightStorageState } from './adapter.js';

export interface NativeStorageRequest<Result> {
  result: Result;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
  onblocked?: (() => void) | null;
}

interface NativeStorageIndex { name: string; keyPath: string | string[]; multiEntry: boolean; unique: boolean }
interface NativeStorageStore {
  name: string; autoIncrement: boolean; keyPath: string | string[] | null; indexNames: Iterable<string>;
  createIndex(name: string, keyPath: string | string[], options: { unique: boolean; multiEntry: boolean }): unknown;
  index(name: string): NativeStorageIndex;
  add(value: unknown, key?: unknown): unknown;
  openCursor(): NativeStorageRequest<{ key: unknown; value: unknown; continue(): void } | null>;
}
interface NativeStorageTransaction {
  objectStore(name: string): NativeStorageStore;
  oncomplete: (() => void) | null; onabort: (() => void) | null; error: Error | null;
  abort(): void;
}
interface NativeStorageDatabase {
  name: string; version: number; objectStoreNames: Iterable<string> & { length: number };
  createObjectStore(name: string, options: { autoIncrement: boolean; keyPath: string | string[] | undefined }): NativeStorageStore;
  transaction(names: Iterable<string>, mode: 'readonly' | 'readwrite'): NativeStorageTransaction;
  close(): void;
}
export interface NativeStorageGlobals {
  location: { origin: string };
  navigator: { serviceWorker?: { getRegistrations(): Promise<{ unregister(): Promise<boolean> }[]> } };
  localStorage: { length: number; key(index: number): string | null; getItem(name: string): string | null; clear(): void; setItem(name: string, value: string): void };
  indexedDB: {
    databases(): Promise<{ name?: string; version?: number }[]>;
    open(name: string, version?: number): NativeStorageRequest<NativeStorageDatabase>;
    deleteDatabase(name: string): NativeStorageRequest<undefined>;
  };
}

export async function collectStorageOrigin(input: { origin: string; indexedDB: boolean; maxBytes: number }): Promise<string | false> {
  const { location, localStorage, indexedDB } = globalThis as unknown as NativeStorageGlobals;
  if (location.origin !== input.origin) throw new Error('Native storage origin changed');
  let size = 0;
  let nodes = 0;
  const limit = new Error('Native storage read limit');
  const charge = (value: string) => {
    if (value.length > input.maxBytes || (size += new TextEncoder().encode(value).length + 8) > input.maxBytes) throw limit;
  };
  const helpers = {
    request<Result>(request: NativeStorageRequest<Result>): Promise<Result> {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Native IndexedDB request blocked by an open connection'));
      });
    },
    encode(value: unknown, refs = new Map<object, number>(), depth = 0): unknown {
      if (++nodes > input.maxBytes || depth > 100) throw limit;
      if (value === undefined) return { v: 'undefined' };
      if (value === null) return { v: 'null' };
      if (typeof value === 'string') { charge(value); return value; }
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return !Number.isFinite(value) || Object.is(value, -0) ? { v: Object.is(value, -0) ? '-0' : String(value) } : value;
      if (typeof value === 'bigint') { charge(String(value)); return { bi: String(value) }; }
      if (typeof value !== 'object') return { v: 'undefined' };
      if (value instanceof Date) return { d: value.toJSON() };
      if (value instanceof URL) return { u: value.href };
      if (value instanceof RegExp) return { r: { p: value.source, f: value.flags } };
      if (value instanceof Error) return { e: { n: value.name, m: value.message, s: value.stack } };
      const constructors: Record<string, new (buffer: ArrayBuffer) => ArrayBufferView> = { i8: Int8Array, ui8: Uint8Array, ui8c: Uint8ClampedArray, i16: Int16Array, ui16: Uint16Array, i32: Int32Array, ui32: Uint32Array, f32: Float32Array, f64: Float64Array, bi64: BigInt64Array, bui64: BigUint64Array };
      for (const [kind, Constructor] of Object.entries(constructors)) if (value instanceof Constructor) {
        if (value.byteLength > input.maxBytes) throw limit;
        let binary = '';
        for (const byte of new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) binary += String.fromCharCode(byte);
        const encoded = btoa(binary); charge(encoded);
        return { ta: { k: kind, b: encoded } };
      }
      if (refs.has(value)) return { ref: refs.get(value) };
      const id = refs.size + 1; refs.set(value, id);
      if (Array.isArray(value)) {
        if (value.length > input.maxBytes - nodes) throw limit;
        return { a: value.map(child => this.encode(child, refs, depth + 1)), id };
      }
      const entries: { k: string; v: unknown }[] = [];
      for (const key of Object.keys(value)) {
        charge(key);
        if (key !== '__proto__') entries.push({ k: key, v: this.encode((value as Record<string, unknown>)[key], refs, depth + 1) });
      }
      return { o: entries, id };
    },
  };
  const result: PlaywrightStorageState['origins'][number] = { origin: input.origin, localStorage: [] };
  try {
    charge(input.origin);
    for (let index = 0; index < localStorage.length; index++) {
      const name = localStorage.key(index);
      if (name === null) continue;
      const value = localStorage.getItem(name) ?? '';
      charge(name); charge(value);
      result.localStorage.push({ name, value });
    }
    if (input.indexedDB) {
      result.indexedDB = [];
      for (const info of await indexedDB.databases()) {
        if (info.name === undefined || info.version === undefined) throw new Error('Invalid native database metadata');
        charge(info.name);
        const database = await helpers.request(indexedDB.open(info.name));
        try {
          const saved: NonNullable<typeof result.indexedDB>[number] = { name: info.name, version: info.version, stores: [] };
          for (const name of database.objectStoreNames) {
            charge(name);
            const transaction = database.transaction([name], 'readonly');
            const store = transaction.objectStore(name);
            const savedStore: typeof saved.stores[number] = { name, autoIncrement: store.autoIncrement, records: [], indexes: [] };
            if (typeof store.keyPath === 'string') savedStore.keyPath = store.keyPath;
            else if (Array.isArray(store.keyPath)) savedStore.keyPathArray = store.keyPath;
            for (const indexName of store.indexNames) {
              charge(indexName);
              const index = store.index(indexName);
              savedStore.indexes.push({ name: index.name, ...(typeof index.keyPath === 'string' ? { keyPath: index.keyPath } : { keyPathArray: index.keyPath }), multiEntry: index.multiEntry, unique: index.unique });
            }
            const cursor = store.openCursor();
            await new Promise<void>((resolve, reject) => {
              cursor.onerror = () => reject(cursor.error);
              cursor.onsuccess = () => {
                if (!cursor.result) { resolve(); return; }
                try {
                  const record: typeof savedStore.records[number] = { valueEncoded: helpers.encode(cursor.result.value) };
                  if (store.keyPath === null) record.keyEncoded = helpers.encode(cursor.result.key);
                  charge(JSON.stringify(record));
                  savedStore.records.push(record);
                  cursor.result.continue();
                } catch (error) { transaction.abort(); reject(error); }
              };
            });
            saved.stores.push(savedStore);
          }
          result.indexedDB.push(saved);
        } finally { database.close(); }
      }
    }
    const serialized = JSON.stringify(result);
    if (new TextEncoder().encode(serialized).length > input.maxBytes) return false;
    return serialized;
  } catch (error) { if (error === limit) return false; throw error; }
}
