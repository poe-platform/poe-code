export const pythonPackageRuntimeKey = 'pyodide-314.0.6-cp314-emscripten-wasm32-v1';

export interface PythonPackageCache {
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, bytes: Uint8Array): Promise<void>;
}

export function createPythonPackageCache(options: { readonly maxBytes?: number } = {}): PythonPackageCache & { dispose(): void } {
  const maxBytes = options.maxBytes ?? 128 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('Python cache maxBytes must be a positive integer');
  const values = new Map<string, Uint8Array>();
  const manifestKey = pythonPackageRuntimeKey + '-environment';
  let retainedBytes = 0;
  let disposed = false;
  return {
    async get(key) {
      if (disposed) throw new Error('Python package cache is disposed');
      return values.get(key)?.slice();
    },
    async set(key, bytes) {
      if (disposed) throw new Error('Python package cache is disposed');
      if (key === manifestKey && bytes.length > maxBytes) throw new RangeError('Python package manifest exceeds maxCacheBytes');
      const previous = values.get(key);
      if (previous) { retainedBytes -= previous.length; values.delete(key); }
      if (bytes.length > maxBytes) return;
      while (values.size && (retainedBytes + bytes.length > maxBytes || values.size >= 1024)) {
        const oldest = [...values.keys()].find(entry => entry !== manifestKey);
        if (oldest === undefined) return;
        retainedBytes -= values.get(oldest)!.length;
        values.delete(oldest);
      }
      values.set(key, Uint8Array.from(bytes));
      retainedBytes += bytes.length;
    },
    dispose() { disposed = true; values.clear(); retainedBytes = 0; },
  };
}
