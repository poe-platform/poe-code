import type { FileSystem } from "@poe-code/safe-fs/core";
export interface SecretStoreLockOptions { signal?: AbortSignal; timeoutMs?: number; }
export interface SecretStore {
  withLock?<T>(operation: () => Promise<T>, options?: SecretStoreLockOptions): Promise<T>;
  get(options?: { readOnly?: boolean }): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
}
export interface SafeFsSecretStoreInput { fs: FileSystem; filePath: string; key: CryptoKey; }
export declare class SafeFsSecretStore implements SecretStore {
  private readonly fs;
  private readonly filePath;
  private readonly key;
  constructor(input: SafeFsSecretStoreInput);
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
  private assertSafePath;
}
export declare function key(providerId: string): string;
export declare class MigratingSecretStore implements SecretStore {
  private readonly store;
  private readonly legacyStore;
  private pendingMutation;
  constructor(store: SecretStore, legacyStore?: SecretStore | null);
  get(options?: { readOnly?: boolean }): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
  private mutate;
}
