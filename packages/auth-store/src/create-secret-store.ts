import type {
  CreateSecretStoreInput,
  CreateSecretStoreResult,
  StoreBackend
} from "./types.js";
import { EncryptedFileStore } from "./encrypted-file-store.js";
import { KeychainStore } from "./keychain-store.js";

const DEFAULT_BACKEND_ENV_VAR = "AUTH_BACKEND";
const MACOS_PLATFORM = "darwin";

const storeFactories: Record<
  StoreBackend,
  (input: CreateSecretStoreInput) => CreateSecretStoreResult["store"]
> = {
  file: (input) => {
    if (!input.fileStore) {
      throw new Error("fileStore configuration is required for file backend");
    }
    return new EncryptedFileStore(input.fileStore);
  },
  keychain: (input) => {
    if (!input.keychainStore) {
      throw new Error("keychainStore configuration is required for keychain backend");
    }
    return new KeychainStore(input.keychainStore);
  }
};

export function createSecretStore(
  input: CreateSecretStoreInput
): CreateSecretStoreResult {
  const backend = resolveBackend(input);
  const platform = input.platform ?? process.platform;

  if (backend === "keychain" && platform !== MACOS_PLATFORM) {
    throw new Error(
      `Keychain backend is only supported on macOS. Current platform: ${platform}`
    );
  }

  const store = storeFactories[backend](input);

  return { backend, store };
}

function resolveBackend(input: CreateSecretStoreInput): StoreBackend {
  const envVar = input.backendEnvVar ?? DEFAULT_BACKEND_ENV_VAR;
  const configuredBackend =
    input.backend ?? input.env?.[envVar] ?? process.env[envVar];

  if (configuredBackend === "keychain") {
    return "keychain";
  }

  if (configuredBackend === undefined || configuredBackend === "file") {
    return "file";
  }

  throw new Error(`Unsupported auth store backend: ${configuredBackend}`);
}
