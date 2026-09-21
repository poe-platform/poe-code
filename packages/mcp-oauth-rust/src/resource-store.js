import { createRequire } from "node:module";
import { canonicalizeResourceIndicator } from "./resource.js";
import { assertPersistenceNamespace, createNamedSecretStore } from "./session-store.js";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
export function createResourceBoundOAuthStores(options, namespace, identity) {
  assertPersistenceNamespace(identity);
  assertPersistenceNamespace(namespace);
  const store = createNamedSecretStore(
    identity,
    options,
    {
      salt: "poe-code:mcp-oauth:resources:v1",
      directory: ".poe-code/mcp-oauth/resources",
      service: "poe-code-mcp-oauth-resources",
      accountPrefix: "resource"
    },
    namespace
  );
  const result = {
    initialGrantAllowed: true,
    sessionStore: {},
    clientStore: {},
    async reset(resource, options = {}) {
      options.signal?.throwIfAborted();
      let url;
      try {
        url = new URL(resource);
      } catch {
        throw new Error("OAuth reset resource must be an absolute HTTP URL");
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.href.includes("#")
      )
        throw new Error("OAuth reset resource must be an HTTP URL without credentials or fragment");
      const record = native.NativeResourceCredentials.reset(canonicalizeResourceIndicator(url));
      await replace(record, options);
    },
    async importSession(value, options = {}) {
      options.signal?.throwIfAborted();
      const record = native.NativeResourceCredentials.importSession(value);
      try {
        const facts = record.importBindings,
          resource = new URL(facts.resource),
          issuer = new URL(facts.issuer),
          advertised = new URL(facts.metadataResource);
        if (
          [resource, issuer, advertised].some(
            (url) =>
              !["http:", "https:"].includes(url.protocol) ||
              url.username ||
              url.password ||
              url.href.includes("#")
          ) ||
          issuer.href.includes("?") ||
          canonicalizeResourceIndicator(facts.metadataResource) !==
            canonicalizeResourceIndicator(resource)
        )
          throw new Error("Invalid binding");
        new Headers({ Authorization: `Bearer ${facts.accessToken}` });
        record.canonicalizeImport(canonicalizeResourceIndicator(resource));
      } catch {
        throw new Error("Invalid OAuth import session or resource binding");
      }
      await replace(record, options);
    }
  };
  async function replace(record, options) {
    options = { ...options };
    options.signal?.throwIfAborted();
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
      throw new Error("OAuth replacement timeoutMs must be a positive supported timer interval");
    if (store.withLock === undefined)
      throw new Error("OAuth resource identity backend must support transaction locks");
    await store.withLock(
      async () => {
        options.signal?.throwIfAborted();
        await store.set(record.serialize());
        result.initialGrantAllowed = false;
      },
      { signal: options.signal, timeoutMs }
    );
  }
  async function read() {
    const record = new native.NativeResourceCredentials(await store.get());
    if (record.resource == null) return record;
    if (record.resource !== canonicalizeResourceIndicator(record.resource))
      throw new Error("Invalid stored OAuth resource identity; reset explicitly to recover");
    let url;
    try {
      url = new URL(record.resource);
    } catch {
      throw new Error("Invalid stored OAuth resource identity URL");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.href.includes("#")
    )
      throw new Error("Invalid stored OAuth resource identity URL");
    for (const issuer of record.issuers) {
      try {
        url = new URL(issuer);
      } catch {
        throw new Error("Invalid stored OAuth resource client issuer");
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.href.includes("?") ||
        url.href.includes("#")
      )
        throw new Error("Invalid stored OAuth resource client");
    }
    return record;
  }
  async function reconcile(resource) {
    resource = canonicalizeResourceIndicator(resource);
    const record = await read();
    if (record.reconcile(resource)) await store.set(record.serialize());
    result.initialGrantAllowed = record.initialGrantAllowed;
    return record;
  }
  result.sessionStore = {
    async withLock(resource, operation, options) {
      options = { ...options };
      if (store.withLock === undefined)
        throw new Error("OAuth resource identity backend must support transaction locks");
      return store.withLock(async () => {
        options.signal?.throwIfAborted();
        await reconcile(resource);
        options.signal?.throwIfAborted();
        return operation();
      }, options);
    },
    async load(resource) {
      return (await read()).session(canonicalizeResourceIndicator(resource));
    },
    async save(resource, session) {
      const record = await reconcile(resource);
      if (canonicalizeResourceIndicator(session.resource) !== record.resource)
        throw new Error("OAuth session does not match its resource identity");
      record.setSession(JSON.stringify(session));
      await store.set(record.serialize());
    },
    async clear(resource) {
      const record = await reconcile(resource);
      record.clearSession();
      result.initialGrantAllowed = false;
      await store.set(record.serialize());
    }
  };
  result.clientStore = {
    async load(issuer) {
      return (await read()).client(issuer);
    },
    async save(issuer, client) {
      const record = await read();
      record.setClient(issuer, JSON.stringify(client));
      await store.set(record.serialize());
    },
    async clear(issuer) {
      const record = await read();
      if (record.clearClient(issuer)) await store.set(record.serialize());
    }
  };
  return result;
}
