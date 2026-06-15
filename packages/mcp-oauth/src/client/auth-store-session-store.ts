import crypto from "node:crypto";
import path from "node:path";
import { createSecretStore, type CreateSecretStoreInput, type SecretStore } from "auth-store";
import type { OAuthSessionStore, StoredOAuthSession } from "./types.js";
import { canonicalizeResourceIndicator } from "../resource-indicator.js";

const DEFAULT_FILE_SALT = "poe-code:mcp-oauth:v1";
const DEFAULT_FILE_DIRECTORY = ".poe-code/mcp-oauth";
const DEFAULT_KEYCHAIN_SERVICE = "poe-code-mcp-oauth";
const DEFAULT_CLIENT_FILE_SALT = "poe-code:mcp-oauth:clients:v1";
const DEFAULT_CLIENT_FILE_DIRECTORY = ".poe-code/mcp-oauth/clients";
const DEFAULT_CLIENT_KEYCHAIN_SERVICE = "poe-code-mcp-oauth-clients";
const MAX_JS_DATE_MS = 8_640_000_000_000_000;

interface StoredOAuthClient {
  clientId: string;
  clientSecret?: string;
}

export interface OAuthClientStore {
  load(issuer: string): Promise<StoredOAuthClient | null>;
  save(issuer: string, client: StoredOAuthClient): Promise<void>;
  clear(issuer: string): Promise<void>;
}

export function createAuthStoreSessionStore(
  options: CreateSecretStoreInput = {}
): OAuthSessionStore {
  return {
    async load(resource: string): Promise<StoredOAuthSession | null> {
      const store = createResourceSecretStore(resource, options);
      const value = await store.get();
      if (value === null) {
        return null;
      }

      const parsed = JSON.parse(value);
      if (isStoredOAuthSession(parsed)) {
        return parsed;
      }

      throw new Error("Stored OAuth session must match the expected shape");
    },
    async save(resource: string, session: StoredOAuthSession): Promise<void> {
      const store = createResourceSecretStore(resource, options);
      await store.set(JSON.stringify(session));
    },
    async clear(resource: string): Promise<void> {
      const store = createResourceSecretStore(resource, options);
      await store.delete();
    }
  };
}

export function createAuthStoreClientStore(options: CreateSecretStoreInput): OAuthClientStore {
  return {
    async load(issuer: string): Promise<StoredOAuthClient | null> {
      const store = createIssuerSecretStore(issuer, options);
      const value = await store.get();
      if (value === null) {
        return null;
      }

      const parsed = JSON.parse(value);
      const clientId = isObjectRecord(parsed) ? getOwnString(parsed, "clientId") : undefined;
      if (clientId !== undefined) {
        const client: Record<string, unknown> = { clientId };
        if (
          isObjectRecord(parsed) &&
          Object.prototype.hasOwnProperty.call(parsed, "clientSecret")
        ) {
          client.clientSecret = getOwnEntry(parsed, "clientSecret");
        }

        return client as unknown as StoredOAuthClient;
      }

      throw new Error("Stored OAuth client must be a JSON object with clientId");
    },
    async save(issuer: string, client: StoredOAuthClient): Promise<void> {
      const store = createIssuerSecretStore(issuer, options);
      await store.set(JSON.stringify(client));
    },
    async clear(issuer: string): Promise<void> {
      const store = createIssuerSecretStore(issuer, options);
      await store.delete();
    }
  };
}

function createNamedSecretStore(
  key: string,
  options: CreateSecretStoreInput,
  defaults: { salt: string; directory: string; service: string; accountPrefix: string }
): SecretStore {
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  const configuredFilePath = options.fileStore?.filePath;
  const parsedFilePath = configuredFilePath === undefined ? null : path.parse(configuredFilePath);

  const fileStore = {
    ...options.fileStore,
    filePath:
      parsedFilePath === null
        ? undefined
        : path.join(
            parsedFilePath.dir,
            `${parsedFilePath.name}-${hash}${parsedFilePath.ext || ".enc"}`
          ),
    salt: options.fileStore?.salt ?? defaults.salt,
    defaultDirectory: options.fileStore?.defaultDirectory || defaults.directory,
    defaultFileName:
      parsedFilePath === null
        ? `${hash}.enc`
        : `${parsedFilePath.name}-${hash}${parsedFilePath.ext || ".enc"}`
  };
  const keychainStore = {
    ...options.keychainStore,
    service: options.keychainStore?.service ?? defaults.service,
    account: `${options.keychainStore?.account ?? defaults.accountPrefix}:${hash}`
  };

  return createSecretStore({ ...options, fileStore, keychainStore }).store;
}

function createResourceSecretStore(resource: string, options: CreateSecretStoreInput): SecretStore {
  return createNamedSecretStore(canonicalizeResourceIndicator(resource), options, {
    salt: DEFAULT_FILE_SALT,
    directory: DEFAULT_FILE_DIRECTORY,
    service: DEFAULT_KEYCHAIN_SERVICE,
    accountPrefix: "provider"
  });
}

function createIssuerSecretStore(issuer: string, options: CreateSecretStoreInput): SecretStore {
  return createNamedSecretStore(issuer, options, {
    salt: DEFAULT_CLIENT_FILE_SALT,
    directory: DEFAULT_CLIENT_FILE_DIRECTORY,
    service: DEFAULT_CLIENT_KEYCHAIN_SERVICE,
    accountPrefix: "issuer"
  });
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function getOwnString(record: Record<string, unknown>, key: string): string | undefined {
  const value = getOwnEntry(record, key);
  return typeof value === "string" ? value : undefined;
}

function isStoredOAuthSession(value: unknown): value is StoredOAuthSession {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    isNonBlankOwnString(value, "resource") &&
    isNonBlankOwnString(value, "authorizationServer") &&
    isStoredOAuthClient(getOwnEntry(value, "client")) &&
    isStoredOAuthDiscovery(getOwnEntry(value, "discovery")) &&
    isStoredOAuthTokensOrMissing(getOwnEntry(value, "tokens"))
  );
}

function isStoredOAuthClient(value: unknown): value is StoredOAuthClient {
  if (!isObjectRecord(value) || !isNonBlankOwnString(value, "clientId")) {
    return false;
  }

  const clientSecret = getOwnEntry(value, "clientSecret");
  return (
    clientSecret === undefined ||
    (typeof clientSecret === "string" && clientSecret.trim().length > 0)
  );
}

function isStoredOAuthDiscovery(value: unknown): value is StoredOAuthSession["discovery"] {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    isNonBlankOwnString(value, "resourceMetadataUrl") &&
    isObjectRecord(getOwnEntry(value, "resourceMetadata")) &&
    isObjectRecord(getOwnEntry(value, "authorizationServerMetadata"))
  );
}

function isStoredOAuthTokensOrMissing(value: unknown): value is StoredOAuthSession["tokens"] {
  if (value === undefined) {
    return true;
  }

  if (!isObjectRecord(value)) {
    return false;
  }

  if (!isNonBlankOwnString(value, "accessToken") || getOwnString(value, "tokenType") !== "Bearer") {
    return false;
  }

  const expiresAt = getOwnEntry(value, "expiresAt");
  if (
    expiresAt !== null &&
    (typeof expiresAt !== "number" ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt > MAX_JS_DATE_MS ||
      !Number.isFinite(new Date(expiresAt).getTime()))
  ) {
    return false;
  }

  const refreshToken = getOwnEntry(value, "refreshToken");
  if (
    refreshToken !== undefined &&
    (typeof refreshToken !== "string" || refreshToken.trim().length === 0)
  ) {
    return false;
  }

  const scope = getOwnEntry(value, "scope");
  return scope === undefined || (typeof scope === "string" && scope.trim().length > 0);
}

function isNonBlankOwnString(record: Record<string, unknown>, key: string): boolean {
  const value = getOwnString(record, key);
  return value !== undefined && value.trim().length > 0;
}
