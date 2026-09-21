import type { CreateSecretStoreInput } from "auth-store";
import { canonicalizeResourceIndicator } from "../resource-indicator.js";
import { assertPersistenceNamespace, createNamedSecretStore, isStoredOAuthSession, type OAuthClientStore } from "./auth-store-session-store.js";
import { normalizeStoredOAuthClient } from "./client-registration.js";
import type { OAuthSessionStore, StoredOAuthClient, StoredOAuthSession } from "./types.js";

interface ResourceCredentials {
  version: 1;
  resource: string;
  generation: number;
  session: StoredOAuthSession | null;
  clients: Record<string, StoredOAuthClient>;
}

export interface ResourceBoundOAuthStores {
  readonly sessionStore: OAuthSessionStore;
  readonly clientStore: OAuthClientStore;
  readonly initialGrantAllowed: boolean;
  /** Retire grants/clients even when their document cannot be decrypted or parsed. */
  reset(resource: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<void>;
}

/** One locked document owns a logical server's URL history, grant and clients. */
export function createResourceBoundOAuthStores(options: CreateSecretStoreInput, namespace: string | undefined, identity: string): ResourceBoundOAuthStores {
  assertPersistenceNamespace(identity);
  assertPersistenceNamespace(namespace);
  const store = createNamedSecretStore(identity, options, { salt: "poe-code:mcp-oauth:resources:v1",
    directory: ".poe-code/mcp-oauth/resources", service: "poe-code-mcp-oauth-resources", accountPrefix: "resource" }, namespace);
  const result = { initialGrantAllowed: true, sessionStore: {} as OAuthSessionStore, clientStore: {} as OAuthClientStore,
    async reset(resource: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<void> {
      options.signal?.throwIfAborted();
      let url: URL;
      try { url = new URL(resource); } catch { throw new Error("OAuth reset resource must be an absolute HTTP URL"); }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
        throw new Error("OAuth reset resource must be an HTTP URL without credentials or fragment");
      const timeoutMs = options.timeoutMs ?? 30_000;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
        throw new Error("OAuth reset timeoutMs must be a positive supported timer interval");
      if (store.withLock === undefined) throw new Error("OAuth resource identity backend must support transaction locks");
      // Acquire the raw backend lock: the session lock reconciles by strictly
      // reading the document, which must be bypassed for explicit corruption recovery.
      await store.withLock(async () => {
        options.signal?.throwIfAborted();
        const record: ResourceCredentials = { version: 1, resource: canonicalizeResourceIndicator(url), generation: 1, session: null, clients: {} };
        await store.set(JSON.stringify(record));
        result.initialGrantAllowed = false;
      }, { signal: options.signal, timeoutMs });
    }
  };
  async function read(): Promise<ResourceCredentials | null> {
    const raw = await store.get();
    if (raw === null) return null;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error("Stored OAuth resource identity must be valid JSON; reset explicitly to recover"); }
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid stored OAuth resource identity");
    const record = value as ResourceCredentials;
    if (!["version", "resource", "generation", "session", "clients"].every(key => Object.hasOwn(record, key)) || record.version !== 1 || typeof record.resource !== "string" || record.resource !== canonicalizeResourceIndicator(record.resource) ||
      !Number.isSafeInteger(record.generation) || record.generation < 0 ||
      (record.session !== null && (!isStoredOAuthSession(record.session) || record.session.resource !== record.resource)) ||
      typeof record.clients !== "object" || record.clients === null || Array.isArray(record.clients))
      throw new Error("Invalid stored OAuth resource identity; reset explicitly to recover");
    let resourceUrl: URL;
    try { resourceUrl = new URL(record.resource); } catch { throw new Error("Invalid stored OAuth resource identity URL"); }
    if (!["http:", "https:"].includes(resourceUrl.protocol) || resourceUrl.username || resourceUrl.password || resourceUrl.hash)
      throw new Error("Invalid stored OAuth resource identity URL");
    for (const [issuer, client] of Object.entries(record.clients)) {
      const normalized = normalizeStoredOAuthClient(client);
      let url: URL;
      try { url = new URL(issuer); } catch { throw new Error("Invalid stored OAuth resource client issuer"); }
      if (normalized === null || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
        throw new Error("Invalid stored OAuth resource client");
      Object.defineProperty(record.clients, issuer, { value: normalized, enumerable: true, configurable: true, writable: true });
    }
    return record;
  }
  async function reconcile(resource: string): Promise<ResourceCredentials> {
    resource = canonicalizeResourceIndicator(resource);
    const existing = await read();
    if (existing?.resource === resource) { result.initialGrantAllowed = existing.generation === 0; return existing; }
    const record: ResourceCredentials = { version: 1, resource, generation: existing === null ? 0 : existing.generation + 1, session: null, clients: {} };
    if (!Number.isSafeInteger(record.generation)) throw new Error("OAuth resource identity generation limit exceeded");
    await store.set(JSON.stringify(record));
    result.initialGrantAllowed = record.generation === 0;
    return record;
  }
  result.sessionStore = {
    async withLock(resource, operation, options) {
      if (store.withLock === undefined) throw new Error("OAuth resource identity backend must support transaction locks");
      return store.withLock(async () => {
        options.signal?.throwIfAborted();
        await reconcile(resource);
        options.signal?.throwIfAborted();
        return operation();
      }, options);
    },
    async load(resource) {
      // Unauthorized provenance may peek before acquiring the transaction lock.
      // Only the lock owner may adopt a URL or retire the previous credentials.
      const record = await read();
      return record?.resource === canonicalizeResourceIndicator(resource) ? record.session : null;
    },
    async save(resource, session) {
      const record = await reconcile(resource);
      if (canonicalizeResourceIndicator(session.resource) !== record.resource) throw new Error("OAuth session does not match its resource identity");
      record.session = session;
      await store.set(JSON.stringify(record));
    },
    async clear(resource) {
      const record = await reconcile(resource);
      record.session = null;
      // Preserve a tombstone so environment grants cannot revive a cleared family.
      record.generation = Math.max(1, record.generation);
      result.initialGrantAllowed = false;
      await store.set(JSON.stringify(record));
    }
  };
  result.clientStore = {
    async load(issuer) { const record = await read(); return record !== null && Object.hasOwn(record.clients, issuer) ? record.clients[issuer] : null; },
    async save(issuer, client) {
      const record = await read();
      if (record === null) throw new Error("OAuth resource identity must be bound before registering a client");
      Object.defineProperty(record.clients, issuer, { value: client, enumerable: true, configurable: true, writable: true });
      await store.set(JSON.stringify(record));
    },
    async clear(issuer) {
      const record = await read();
      if (record === null || !Object.hasOwn(record.clients, issuer)) return;
      delete record.clients[issuer];
      await store.set(JSON.stringify(record));
    }
  };
  return result;
}
