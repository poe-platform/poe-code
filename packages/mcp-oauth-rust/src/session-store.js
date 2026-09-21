import path from "node:path";
import { createRequire } from "node:module";
import { createCredentialStoreBindings } from "./auth-store-runtime.js";
import { canonicalizeResourceIndicator } from "./resource.js";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
const { createSecretStore, resolveSecretStoreBackend } = createCredentialStoreBindings(native);
export function snapshotPersistenceOptions(options) {
  const snapshot = {
    ...options,
    ...(options.fileStore === undefined ? {} : { fileStore: { ...options.fileStore } }),
    ...(options.keychainStore === undefined
      ? {}
      : {
          keychainStore: {
            ...options.keychainStore,
            ...(options.keychainStore.lock === undefined
              ? {}
              : { lock: { ...options.keychainStore.lock } })
          }
        })
  };
  snapshot.backend = resolveSecretStoreBackend(snapshot);
  return snapshot;
}
export function assertPersistenceNamespace(namespace) {
  if (
    namespace !== undefined &&
    (typeof namespace !== "string" ||
      namespace.trim() === "" ||
      Buffer.byteLength(namespace, "utf8") > 1024)
  )
    throw new Error("OAuth persistence namespace must be a nonempty string within 1024 bytes");
}
const SESSION_DEFAULTS = native.oauthStorageDefaults("", false);
const CLIENT_DEFAULTS = native.oauthStorageDefaults("", true);
export function createNamedSecretStore(key, options, defaults, namespace) {
  const { hash } = native.oauthStorageDefaults(
    namespace === undefined ? key : JSON.stringify([namespace, key]),
    false
  );
  const configured = options.fileStore?.filePath;
  const parsed = configured === undefined ? null : path.parse(configured);
  const filename =
    parsed === null ? `${hash}.enc` : `${parsed.name}-${hash}${parsed.ext || ".enc"}`;
  return createSecretStore({
    ...options,
    fileStore: {
      ...options.fileStore,
      throwOnInvalidDocument: true,
      filePath: parsed === null ? undefined : path.join(parsed.dir, filename),
      salt: options.fileStore?.salt ?? defaults.salt,
      defaultDirectory: options.fileStore?.defaultDirectory || defaults.directory,
      defaultFileName: filename
    },
    keychainStore: {
      ...options.keychainStore,
      ...(options.keychainStore?.lock === undefined
        ? {}
        : { lock: { ...options.keychainStore.lock } }),
      service: options.keychainStore?.service ?? defaults.service,
      account: `${options.keychainStore?.account ?? defaults.accountPrefix}:${hash}`
    }
  }).store;
}
function decodeStored(raw, client) {
  const result = native.readStoredOauthValue(raw, client);
  if (Object.hasOwn(result, "parseError")) {
    throw new Error(
      `Stored OAuth ${client ? "client" : "session"} must be valid JSON; reset the store explicitly to recover`
    );
  }
  if (Object.hasOwn(result, "error")) throw new Error(result.error);
  return result.value;
}
export function createAuthStoreSessionStore(options = {}, namespace) {
  assertPersistenceNamespace(namespace);
  options = snapshotPersistenceOptions(options);
  return {
    async withLock(resource, operation, lockOptions) {
      const store = createNamedSecretStore(
        canonicalizeResourceIndicator(resource),
        options,
        SESSION_DEFAULTS,
        namespace
      );
      if (store.withLock === undefined)
        throw new Error("OAuth secret-store backend does not support transaction locks");
      return store.withLock(operation, lockOptions);
    },
    async load(resource) {
      const value = await createNamedSecretStore(
        canonicalizeResourceIndicator(resource),
        options,
        SESSION_DEFAULTS,
        namespace
      ).get();
      return value === null ? null : decodeStored(value, false);
    },
    async save(resource, session) {
      await createNamedSecretStore(
        canonicalizeResourceIndicator(resource),
        options,
        SESSION_DEFAULTS,
        namespace
      ).set(JSON.stringify(session));
    },
    async clear(resource) {
      await createNamedSecretStore(
        canonicalizeResourceIndicator(resource),
        options,
        SESSION_DEFAULTS,
        namespace
      ).delete();
    }
  };
}
export function createAuthStoreClientStore(options, namespace) {
  assertPersistenceNamespace(namespace);
  options = snapshotPersistenceOptions(options);
  return {
    async load(issuer) {
      const value = await createNamedSecretStore(issuer, options, CLIENT_DEFAULTS, namespace).get();
      return value === null ? null : decodeStored(value, true);
    },
    async save(issuer, client) {
      await createNamedSecretStore(issuer, options, CLIENT_DEFAULTS, namespace).set(
        JSON.stringify(client)
      );
    },
    async clear(issuer) {
      await createNamedSecretStore(issuer, options, CLIENT_DEFAULTS, namespace).delete();
    }
  };
}
