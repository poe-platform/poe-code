import crypto from "node:crypto";
import path from "node:path";
import {
  createSecretStore,
  type CreateSecretStoreInput,
  type SecretStore,
} from "auth-store";
import type {
  OAuthSessionStore,
  StoredOAuthSession,
} from "./types.js";
import { canonicalizeResourceIndicator } from "../resource-indicator.js";

const DEFAULT_FILE_SALT = "poe-code:mcp-oauth:v1";
const DEFAULT_FILE_DIRECTORY = ".poe-code/mcp-oauth";
const DEFAULT_KEYCHAIN_SERVICE = "poe-code-mcp-oauth";

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
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as StoredOAuthSession;
      }

      throw new Error("Stored OAuth session must be a JSON object");
    },
    async save(resource: string, session: StoredOAuthSession): Promise<void> {
      const store = createResourceSecretStore(resource, options);
      await store.set(JSON.stringify(session));
    },
    async clear(resource: string): Promise<void> {
      const store = createResourceSecretStore(resource, options);
      await store.delete();
    },
  };
}

function createResourceSecretStore(resource: string, options: CreateSecretStoreInput): SecretStore {
  const canonicalResource = canonicalizeResourceIndicator(resource);
  const hash = crypto.createHash("sha256").update(canonicalResource).digest("hex");
  const parsedFilePath =
    options.fileStore?.filePath === undefined ? null : path.parse(options.fileStore.filePath);

  const fileStore = {
    ...options.fileStore,
    salt: options.fileStore?.salt ?? DEFAULT_FILE_SALT,
    defaultDirectory:
      parsedFilePath?.dir ||
      options.fileStore?.defaultDirectory ||
      DEFAULT_FILE_DIRECTORY,
    defaultFileName:
      parsedFilePath === null
        ? `${hash}.enc`
        : `${parsedFilePath.name}-${hash}${parsedFilePath.ext || ".enc"}`,
  };
  const keychainStore = {
    ...options.keychainStore,
    service: options.keychainStore?.service ?? DEFAULT_KEYCHAIN_SERVICE,
    account: `${options.keychainStore?.account ?? "provider"}:${hash}`,
  };

  return createSecretStore({
    ...options,
    fileStore,
    keychainStore,
  }).store;
}
