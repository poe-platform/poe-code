export interface PythonPackageManifest {
  readonly revision: string;
  readonly bytes: Uint8Array;
}

export interface PythonPackageManifestStore {
  get(scope: string, options: { readonly signal: AbortSignal }): Promise<PythonPackageManifest | undefined>;
  compareAndSet(scope: string, revision: string | undefined, bytes: Uint8Array, options: { readonly signal: AbortSignal }): Promise<boolean>;
}

export class PythonPackageConflictError extends Error {
  readonly code = 'EPACKAGECONFLICT';
  readonly retryable = true;
  constructor() {
    super('Python package environment changed during installation; retry the command');
    this.name = 'PythonPackageConflictError';
  }
}

export function createPythonPackageManifestStore(options: { readonly maxBytes?: number; readonly maxEntries?: number; readonly maxScopeLength?: number } = {}): PythonPackageManifestStore & { dispose(): void } {
  const maxBytes = options.maxBytes ?? Infinity;
  const maxEntries = options.maxEntries ?? Infinity;
  const maxScopeLength = options.maxScopeLength ?? Infinity;
  for (const [name, value] of Object.entries({ maxBytes, maxEntries, maxScopeLength })) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`Python manifest ${name} must be a positive safe integer or Infinity`);
    }
  }
  const manifests = new Map<string, PythonPackageManifest>();
  let retainedBytes = 0;
  let revision = 0n;
  let disposed = false;
  const check = (scope: string, signal: AbortSignal): void => {
    signal.throwIfAborted();
    if (disposed) throw new Error('Python manifest store is disposed');
    if (typeof scope !== 'string' || !scope) throw new TypeError('Invalid Python manifest scope');
    if (scope.length > maxScopeLength) throw new RangeError('Python manifest scope budget exhausted');
  };
  return {
    async get(scope, { signal }) {
      check(scope, signal);
      const value = manifests.get(scope);
      return value ? { revision: value.revision, bytes: value.bytes.slice() } : undefined;
    },
    async compareAndSet(scope, expected, bytes, { signal }) {
      check(scope, signal);
      const current = manifests.get(scope);
      if (current?.revision !== expected) return false;
      if (!(bytes instanceof Uint8Array)) throw new TypeError('Python manifest must contain bytes');
      const nextBytes = retainedBytes - (current?.bytes.length ?? 0) + bytes.length;
      if (nextBytes > maxBytes || (!current && manifests.size >= maxEntries)) {
        throw new RangeError('Python manifest store budget exhausted');
      }
      manifests.set(scope, { revision: String(++revision), bytes: Uint8Array.from(bytes) });
      retainedBytes = nextBytes;
      return true;
    },
    dispose() { disposed = true; manifests.clear(); retainedBytes = 0; },
  };
}
