import path from "node:path";
import { createRequire } from "node:module";
import { createCredentialStoreBindings } from "./auth-store-runtime.js";
import { canonicalizeResourceIndicator } from "./resource.js";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
const { createSecretStore } = createCredentialStoreBindings(native);
export function assertPersistenceNamespace(namespace) {
  if (namespace !== undefined && (typeof namespace !== "string" || namespace.trim() === "" || Buffer.byteLength(namespace, "utf8") > 1024))
    throw new Error("OAuth persistence namespace must be a nonempty string within 1024 bytes");
}
function namedStore(key, options, client, namespace) {
  const defaults = native.oauthStorageDefaults(namespace === undefined ? key : JSON.stringify([namespace, key]), client);
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
    throw new Error(`Stored OAuth ${client ? "client" : "session"} must be valid JSON; reset the store explicitly to recover`);
  }
  if (Object.hasOwn(result, "error")) throw new Error(result.error);
  return result.value;
}
export function createAuthStoreSessionStore(options = {}, namespace) {
  assertPersistenceNamespace(namespace);
  return {
    async withLock(resource, operation, lockOptions) {
      const store = namedStore(canonicalizeResourceIndicator(resource), options, false, namespace);
      if (store.withLock === undefined) throw new Error("OAuth secret-store backend does not support transaction locks");
      return store.withLock(operation, lockOptions);
    },
    async load(resource) {
      const value = await namedStore(canonicalizeResourceIndicator(resource), options, false, namespace).get();
      return value === null ? null : decodeStored(value, false);
    },
    async save(resource, session) {
      await namedStore(canonicalizeResourceIndicator(resource), options, false, namespace).set(
        JSON.stringify(session)
      );
    },
    async clear(resource) {
      await namedStore(canonicalizeResourceIndicator(resource), options, false, namespace).delete();
    }
  };
}
export function createAuthStoreClientStore(options, namespace) {
  assertPersistenceNamespace(namespace);
  return {
    async load(issuer) {
      const value = await namedStore(issuer, options, true, namespace).get();
      return value === null ? null : decodeStored(value, true);
    },
    async save(issuer, client) {
      await namedStore(issuer, options, true, namespace).set(JSON.stringify(client));
    },
    async clear(issuer) {
      await namedStore(issuer, options, true, namespace).delete();
    }
  };
}
