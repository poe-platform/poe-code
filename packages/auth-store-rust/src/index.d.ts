export interface SecretStore {
  get(options?: { readOnly?: boolean }): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
}
export type StoreBackend = "file" | "keychain";
export interface MachineIdentity { hostname: string; username: string; }
export interface EncryptedFileStoreFileSystem {
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
  defaultDirectory?: string;
  defaultFileName?: string;
  getMachineIdentity?: () => MachineIdentity | Promise<MachineIdentity>;
  getHomeDirectory?: () => string;
  getRandomBytes?: (size: number) => Buffer;
}
export interface KeychainCommandResult { stdout: string; stderr: string; exitCode: number; }
export interface KeychainCommandOptions { stdin?: string; }
export type KeychainCommandRunner = (command: string, args: string[], options?: KeychainCommandOptions) => Promise<KeychainCommandResult>;
export interface KeychainStoreInput { runCommand?: KeychainCommandRunner; service: string; account: string; }
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
export declare function key(providerId: string): string;
export declare class EncryptedFileStore implements SecretStore {
  constructor(input: EncryptedFileStoreInput);
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
}
export declare class KeychainStore implements SecretStore {
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
