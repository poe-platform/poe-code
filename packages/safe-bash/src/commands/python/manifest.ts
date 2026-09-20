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

export function createPythonPackageManifestStore(options: { readonly maxBytes?: number } = {}): PythonPackageManifestStore & { dispose(): void } {
  const maxBytes = options.maxBytes ?? 1048576;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('Python manifest maxBytes must be a positive integer');
  const manifests = new Map<string, PythonPackageManifest>();
  let retainedBytes = 0;
  let revision = 0;
  let disposed = false;
  const check = (scope: string, signal: AbortSignal): void => {
    signal.throwIfAborted();
    if (disposed) throw new Error('Python manifest store is disposed');
    if (typeof scope !== 'string' || !scope || scope.length > 1024) throw new TypeError('Invalid Python manifest scope');
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
      if (nextBytes > maxBytes || (!current && manifests.size >= 1024) || revision >= Number.MAX_SAFE_INTEGER) {
        throw new RangeError('Python manifest store budget exhausted');
      }
      manifests.set(scope, { revision: String(++revision), bytes: Uint8Array.from(bytes) });
      retainedBytes = nextBytes;
      return true;
    },
    dispose() { disposed = true; manifests.clear(); retainedBytes = 0; },
  };
}
