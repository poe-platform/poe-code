import path from "node:path";
import { createRequire } from "node:module";
import { createCredentialStoreBindings } from "./auth-store-runtime.js";
import { canonicalizeResourceIndicator } from "./resource.js";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
const { createSecretStore } = createCredentialStoreBindings(native);
function namedStore(key, options, client) {
  const defaults = native.oauthStorageDefaults(key, client);
  const configured = options.fileStore?.filePath;
  const parsed = configured === undefined ? null : path.parse(configured);
  const filename =
    parsed === null
      ? `${defaults.hash}.enc`
      : `${parsed.name}-${defaults.hash}${parsed.ext || ".enc"}`;
  return createSecretStore({
    ...options,
    fileStore: {
      ...options.fileStore,
      filePath: parsed === null ? undefined : path.join(parsed.dir, filename),
      salt: options.fileStore?.salt ?? defaults.salt,
      defaultDirectory: options.fileStore?.defaultDirectory || defaults.directory,
      defaultFileName: filename
    },
    keychainStore: {
      ...options.keychainStore,
      service: options.keychainStore?.service ?? defaults.service,
      account: `${options.keychainStore?.account ?? defaults.accountPrefix}:${defaults.hash}`
    }
  }).store;
}
function decodeStored(raw, client) {
  const result = native.readStoredOauthValue(raw, client);
  if (Object.hasOwn(result, "parseError")) {
    JSON.parse(raw); // Preserve platform SyntaxError diagnostics for malformed JSON.
    throw new Error(
      client
        ? "Stored OAuth client must be a JSON object with clientId"
        : "Stored OAuth session must match the expected shape"
    );
  }
  if (Object.hasOwn(result, "error")) throw new Error(result.error);
  return result.value;
}
export function createAuthStoreSessionStore(options = {}) {
  return {
    async load(resource) {
      const value = await namedStore(canonicalizeResourceIndicator(resource), options, false).get();
      return value === null ? null : decodeStored(value, false);
    },
    async save(resource, session) {
      await namedStore(canonicalizeResourceIndicator(resource), options, false).set(
        JSON.stringify(session)
      );
    },
    async clear(resource) {
      await namedStore(canonicalizeResourceIndicator(resource), options, false).delete();
    }
  };
}
export function createAuthStoreClientStore(options) {
  return {
    async load(issuer) {
      const value = await namedStore(issuer, options, true).get();
      return value === null ? null : decodeStored(value, true);
    },
    async save(issuer, client) {
      await namedStore(issuer, options, true).set(JSON.stringify(client));
    },
    async clear(issuer) {
      await namedStore(issuer, options, true).delete();
    }
  };
}
