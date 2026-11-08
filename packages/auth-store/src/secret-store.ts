export interface SecretStoreLockOptions { signal?: AbortSignal; timeoutMs?: number }

export interface SecretStore {
  get(options?: { readOnly?: boolean }): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
  withLock?<T>(operation: () => Promise<T>, options?: SecretStoreLockOptions): Promise<T>;
}
