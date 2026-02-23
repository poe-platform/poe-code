import type { EncryptedFileAuthStoreInput } from "./encrypted-file-auth-store.js";
import type { KeychainAuthStoreInput } from "./keychain-auth-store.js";

export interface AuthStore {
  getApiKey(): Promise<string | null>;
  setApiKey(apiKey: string): Promise<void>;
  deleteApiKey(): Promise<void>;
}

export type AuthBackend = "file" | "keychain";

export interface LegacyCredentialsMigrationFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(
    path: string,
    data: string | NodeJS.ArrayBufferView,
    options?: { encoding?: BufferEncoding }
  ): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void | string | undefined>;
}

export type AuthStoreWarningLogger = (message: string, error: unknown) => void;

export interface LegacyCredentialsMigrationInput {
  fs?: LegacyCredentialsMigrationFileSystem;
  filePath?: string;
  getHomeDirectory?: () => string;
  logWarning?: AuthStoreWarningLogger;
}

export interface CreateAuthStoreInput {
  backend?: AuthBackend;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  fileStore?: EncryptedFileAuthStoreInput;
  keychainStore?: KeychainAuthStoreInput;
  legacyCredentials?: LegacyCredentialsMigrationInput;
}

export interface CreateAuthStoreResult {
  store: AuthStore;
  backend: AuthBackend;
}
