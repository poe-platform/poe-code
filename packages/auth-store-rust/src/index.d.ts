export interface SecretStoreLockOptions { signal?: AbortSignal; timeoutMs?: number; }
export interface SecretStoreLockFileSystem {
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<unknown>;
  readdir(path: string): Promise<string[]>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, value: string, options: { encoding: BufferEncoding; flag: string; mode: number }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
}
export interface SecretStore {
  withLock?<T>(operation: () => Promise<T>, options?: SecretStoreLockOptions): Promise<T>;
  get(options?: { readOnly?: boolean }): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
}
export type StoreBackend = "file" | "keychain";
export interface MachineIdentity { hostname: string; username: string; }
export interface EncryptedFileStoreFileSystem {
  readdir?(path: string): Promise<string[]>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, data: string | NodeJS.ArrayBufferView, options?: { encoding?: BufferEncoding; flag?: string; mode?: number }): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void | string | undefined>;
  rename(oldPath: string, newPath: string): Promise<void>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  unlink(path: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
}
export interface EncryptedFileStoreInput {
  fs?: EncryptedFileStoreFileSystem;
  filePath?: string;
  salt: string;
  throwOnInvalidDocument?: boolean;
  defaultDirectory?: string;
  defaultFileName?: string;
  getMachineIdentity?: () => MachineIdentity | Promise<MachineIdentity>;
  getHomeDirectory?: () => string;
  getRandomBytes?: (size: number) => Buffer;
}
export interface KeychainCommandResult { stdout: string; stderr: string; exitCode: number; }
export interface KeychainCommandOptions { stdin?: string; }
export type KeychainCommandRunner = (command: string, args: string[], options?: KeychainCommandOptions) => Promise<KeychainCommandResult>;
export interface KeychainStoreInput { runCommand?: KeychainCommandRunner; service: string; account: string; lock?: { fs?: SecretStoreLockFileSystem; directory?: string }; }
export interface CreateSecretStoreInput {
  backend?: StoreBackend;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  backendEnvVar?: string;
  fileStore?: EncryptedFileStoreInput;
  keychainStore?: KeychainStoreInput;
}
export interface CreateSecretStoreResult { store: SecretStore; backend: StoreBackend; }
export declare function createSecretStore(input: CreateSecretStoreInput): CreateSecretStoreResult;
export declare function resolveSecretStoreBackend(input: CreateSecretStoreInput): StoreBackend;
export declare function key(providerId: string): string;
export declare class EncryptedFileStore implements SecretStore {
  withLock<T>(operation: () => Promise<T>, options?: SecretStoreLockOptions): Promise<T>;
  constructor(input: EncryptedFileStoreInput);
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
}
export declare class KeychainStore implements SecretStore {
  withLock<T>(operation: () => Promise<T>, options?: SecretStoreLockOptions): Promise<T>;
  constructor(input: KeychainStoreInput);
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
}
export declare class MigratingSecretStore implements SecretStore {
  constructor(store: SecretStore, legacyStore?: SecretStore | null);
  get(options?: { readOnly?: boolean }): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
}
