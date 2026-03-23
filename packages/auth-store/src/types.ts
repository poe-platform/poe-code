import type { EncryptedFileStoreInput } from "./encrypted-file-store.js";
import type { KeychainStoreInput } from "./keychain-store.js";

export interface SecretStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
}

export type StoreBackend = "file" | "keychain";

export interface CreateSecretStoreInput {
  backend?: StoreBackend;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  backendEnvVar?: string;
  fileStore?: EncryptedFileStoreInput;
  keychainStore?: KeychainStoreInput;
}

export interface CreateSecretStoreResult {
  store: SecretStore;
  backend: StoreBackend;
}
