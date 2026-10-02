import type { EncryptedFileStoreInput } from "./encrypted-file-store.js";
import type { KeychainStoreInput } from "./keychain-store.js";
import type { SecretStore } from "./secret-store.js";
export type { SecretStore } from "./secret-store.js";

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
