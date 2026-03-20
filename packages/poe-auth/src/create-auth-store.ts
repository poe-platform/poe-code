import { promises as nodeFs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type {
  AuthBackend,
  AuthStoreWarningLogger,
  CreateAuthStoreInput,
  CreateAuthStoreResult,
  LegacyCredentialsMigrationFileSystem
} from "./types.js";
import { EncryptedFileAuthStore } from "./encrypted-file-auth-store.js";
import { KeychainAuthStore } from "./keychain-auth-store.js";

const AUTH_BACKEND_ENV_VAR = "POE_AUTH_BACKEND";
const MACOS_PLATFORM = "darwin";
const LEGACY_CREDENTIALS_RELATIVE_PATH = ".poe-code/credentials.json";

interface LegacyMigrationContext {
  fs: LegacyCredentialsMigrationFileSystem;
  filePath: string;
  logWarning: AuthStoreWarningLogger;
}

type LegacyCredentialsDocument = Record<string, unknown> & {
  apiKey?: unknown;
};

const authStoreFactories: Record<
  AuthBackend,
  (input: CreateAuthStoreInput) => CreateAuthStoreResult["store"]
> = {
  file: (input) => new EncryptedFileAuthStore(input.fileStore),
  keychain: (input) => new KeychainAuthStore(input.keychainStore)
};

export function createAuthStore(
  input: CreateAuthStoreInput = {}
): CreateAuthStoreResult {
  const backend = resolveBackend(input);
  const platform = input.platform ?? process.platform;

  if (backend === "keychain" && platform !== MACOS_PLATFORM) {
    throw new Error(
      `POE_AUTH_BACKEND=keychain is only supported on macOS. Current platform: ${platform}`
    );
  }

  const store = authStoreFactories[backend](input);

  return {
    backend,
    store: enableLegacyCredentialsMigration(store, input)
  };
}

function resolveBackend(input: CreateAuthStoreInput): AuthBackend {
  const configuredBackend =
    input.backend ?? input.env?.[AUTH_BACKEND_ENV_VAR] ?? process.env[AUTH_BACKEND_ENV_VAR];

  if (configuredBackend === "keychain") {
    return "keychain";
  }

  return "file";
}

function enableLegacyCredentialsMigration(
  store: CreateAuthStoreResult["store"],
  input: CreateAuthStoreInput
): CreateAuthStoreResult["store"] {
  const migrationContext = createLegacyMigrationContext(input);
  const readApiKeyFromStore = store.getApiKey.bind(store);
  let hasCheckedLegacyCredentials = false;
  let legacyMigrationPromise: Promise<string | null> | null = null;

  store.getApiKey = async (): Promise<string | null> => {
    const storedApiKey = await readApiKeyFromStore();
    if (isNonEmptyString(storedApiKey)) {
      return storedApiKey;
    }

    if (hasCheckedLegacyCredentials) {
      return null;
    }

    if (!legacyMigrationPromise) {
      legacyMigrationPromise = migrateLegacyApiKey(store, migrationContext)
        .finally(() => {
          hasCheckedLegacyCredentials = true;
          legacyMigrationPromise = null;
        });
    }

    return legacyMigrationPromise;
  };

  return store;
}

async function migrateLegacyApiKey(
  store: CreateAuthStoreResult["store"],
  migrationContext: LegacyMigrationContext
): Promise<string | null> {
  const legacyCredentials = await loadLegacyCredentials(
    migrationContext.fs,
    migrationContext.filePath
  );

  if (!legacyCredentials || !isNonEmptyString(legacyCredentials.apiKey)) {
    return null;
  }

  const plaintextApiKey = legacyCredentials.apiKey;

  try {
    await store.setApiKey(plaintextApiKey);
    delete legacyCredentials.apiKey;
    await saveLegacyCredentials(
      migrationContext.fs,
      migrationContext.filePath,
      legacyCredentials
    );
  } catch (error) {
    migrationContext.logWarning(
      `Failed to migrate plaintext API key from ${migrationContext.filePath}.`,
      error
    );
  }

  return plaintextApiKey;
}

function createLegacyMigrationContext(
  input: CreateAuthStoreInput
): LegacyMigrationContext {
  const legacyCredentialsInput = input.legacyCredentials;
  const getHomeDirectory = legacyCredentialsInput?.getHomeDirectory ?? homedir;

  return {
    fs: legacyCredentialsInput?.fs ?? input.fileStore?.fs ?? nodeFs,
    filePath: legacyCredentialsInput?.filePath ?? path.join(
      getHomeDirectory(),
      LEGACY_CREDENTIALS_RELATIVE_PATH
    ),
    logWarning: legacyCredentialsInput?.logWarning ?? defaultMigrationWarning
  };
}

async function loadLegacyCredentials(
  fs: LegacyCredentialsMigrationFileSystem,
  filePath: string
): Promise<LegacyCredentialsDocument | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function saveLegacyCredentials(
  fs: LegacyCredentialsMigrationFileSystem,
  filePath: string,
  document: Record<string, unknown>
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, {
    encoding: "utf8"
  });
}

function defaultMigrationWarning(message: string, error: unknown): void {
  const details = toErrorDetails(error);

  if (details.length > 0) {
    console.warn(`${message} ${details}`);
    return;
  }

  console.warn(message);
}

function toErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
