import { isDeepStrictEqual } from "node:util";
import type { HostedOAuthStorage } from "../http-hosted-oauth.js";

export interface HostedOAuthStorageConformanceOptions<TCredential> {
  createStorage(): HostedOAuthStorage<TCredential> | Promise<HostedOAuthStorage<TCredential>>;
  credentials: readonly [TCredential, TCredential];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Hosted OAuth storage conformance failed: ${message}`);
}

export async function verifyHostedOAuthStorage<TCredential>(
  options: HostedOAuthStorageConformanceOptions<TCredential>
): Promise<void> {
  const storage = await options.createStorage();
  const [firstCredential, secondCredential] = options.credentials;
  const firstSubject = await storage.resolveSubject("provider", "account-a");
  const repeatedSubject = await storage.resolveSubject("provider", "account-a");
  const secondSubject = await storage.resolveSubject("provider", "account-b");
  const otherProviderSubject = await storage.resolveSubject("other-provider", "account-a");
  assert(firstSubject === repeatedSubject, "subject resolution must be stable");
  assert(firstSubject !== secondSubject, "different provider accounts must resolve independently");
  assert(firstSubject !== otherProviderSubject, "provider namespaces must resolve independently");

  await storage.credentials.set(firstSubject, firstCredential);
  assert(
    isDeepStrictEqual(await storage.credentials.get(firstSubject), firstCredential),
    "credentials must round-trip"
  );
  await storage.credentials.update(firstSubject, () => secondCredential);
  assert(
    isDeepStrictEqual(await storage.credentials.get(firstSubject), secondCredential),
    "credential updates must persist"
  );
  let releaseFirstUpdate: (() => void) | undefined;
  let markFirstUpdateStarted: (() => void) | undefined;
  const firstUpdateStarted = new Promise<void>((resolve) => {
    markFirstUpdateStarted = resolve;
  });
  const releaseFirst = new Promise<void>((resolve) => {
    releaseFirstUpdate = resolve;
  });
  const firstUpdate = storage.credentials.update(firstSubject, async (current) => {
    assert(isDeepStrictEqual(current, secondCredential), "credential updates must read current data");
    markFirstUpdateStarted?.();
    await releaseFirst;
    return firstCredential;
  });
  await firstUpdateStarted;
  let secondUpdateStarted = false;
  const secondUpdate = storage.credentials.update(firstSubject, (current) => {
    secondUpdateStarted = true;
    assert(
      isDeepStrictEqual(current, firstCredential),
      "credential updates must execute atomically"
    );
    return secondCredential;
  });
  const updates = Promise.all([firstUpdate, secondUpdate]);
  await Promise.resolve();
  assert(!secondUpdateStarted, "credential updates must be serialized");
  releaseFirstUpdate?.();
  await updates;
  assert(
    isDeepStrictEqual(await storage.credentials.get(firstSubject), secondCredential),
    "serialized credential updates must persist"
  );
  await storage.credentials.delete(firstSubject);
  assert(
    (await storage.credentials.get(firstSubject)) === undefined,
    "credential deletion must persist"
  );

  const transaction = {
    id: "interaction-1",
    clientId: "client-1",
    redirectUri: "https://client.example/callback",
    codeChallenge: "challenge",
    resource: "https://resource.example/mcp",
    scopes: ["mcp"],
    createdAt: 1,
    expiresAt: 2
  };
  await storage.interactions.set(transaction);
  assert(
    isDeepStrictEqual(await storage.interactions.get(transaction.id), transaction),
    "interactions must round-trip"
  );
  await storage.interactions.delete(transaction.id);
  assert(
    (await storage.interactions.get(transaction.id)) === undefined,
    "interaction deletion must persist"
  );

  const firstKey = await storage.signingKey();
  const secondKey = await storage.signingKey();
  assert(
    firstKey.keyId === secondKey.keyId && isDeepStrictEqual(firstKey.publicJwk, secondKey.publicJwk),
    "signing keys must remain stable"
  );
  const restartedStorage = await options.createStorage();
  if (storage.capabilities.stableKeys) {
    const restartedKey = await restartedStorage.signingKey();
    assert(
      firstKey.keyId === restartedKey.keyId &&
        isDeepStrictEqual(firstKey.publicJwk, restartedKey.publicJwk),
      "stable signing keys must survive adapter restart"
    );
  }
  if (storage.capabilities.durable) {
    assert(
      (await restartedStorage.resolveSubject("provider", "account-a")) === firstSubject,
      "durable subject resolution must survive adapter restart"
    );
  }

  const store = storage.authorizationServer;
  const client = { id: "client-1", redirectUris: ["https://client.example/callback"], createdAt: 1 };
  await store.putClient(client);
  assert(isDeepStrictEqual(await store.getClient(client.id), client), "clients must round-trip");
  await store.putAuthorizationTransaction(transaction);
  assert(
    isDeepStrictEqual(await store.takeAuthorizationTransaction(transaction.id), transaction) &&
      (await store.takeAuthorizationTransaction(transaction.id)) === undefined,
    "authorization transactions must be consumed atomically"
  );

  const grant = {
    id: "grant-1",
    clientId: client.id,
    subject: firstSubject,
    resource: transaction.resource,
    scopes: ["mcp", "offline_access"],
    createdAt: 1
  };
  const code = {
    tokenHash: "code-1",
    grantId: grant.id,
    clientId: client.id,
    subject: firstSubject,
    redirectUri: transaction.redirectUri,
    codeChallenge: transaction.codeChallenge,
    resource: transaction.resource,
    scopes: grant.scopes,
    expiresAt: 10
  };
  await store.putAuthorizationCode(code);
  assert(
    isDeepStrictEqual(await store.takeAuthorizationCode(code.tokenHash), code) &&
      (await store.takeAuthorizationCode(code.tokenHash)) === undefined,
    "authorization codes must be consumed atomically"
  );
  await store.putGrant(grant);
  assert(isDeepStrictEqual(await store.getGrant(grant.id), grant), "grants must round-trip");

  const accessToken = {
    tokenHash: "access-1",
    tokenId: "token-1",
    grantId: grant.id,
    subject: firstSubject,
    clientId: client.id,
    resource: transaction.resource,
    expiresAt: 10
  };
  await store.putAccessToken(accessToken);
  assert(
    isDeepStrictEqual(await store.getAccessToken(accessToken.tokenHash), accessToken),
    "access tokens must round-trip"
  );
  await store.revokeToken(accessToken.tokenHash, 5);
  assert(
    (await store.getAccessToken(accessToken.tokenHash))?.revokedAt === 5,
    "access-token revocation must persist"
  );

  const refreshToken = {
    tokenHash: "refresh-1",
    familyId: "family-1",
    grantId: grant.id,
    clientId: client.id,
    subject: firstSubject,
    resource: transaction.resource,
    scopes: grant.scopes,
    createdAt: 1,
    expiresAt: 10,
    status: "active" as const
  };
  await store.putRefreshToken(refreshToken);
  const rotation = await store.rotateRefreshToken(refreshToken.tokenHash, "refresh-2", 2, 20);
  assert(
    rotation.status === "rotated" && isDeepStrictEqual(rotation.previous, refreshToken),
    "refresh tokens must rotate atomically"
  );
  assert(
    (await store.rotateRefreshToken(refreshToken.tokenHash, "refresh-3", 3, 20)).status ===
      "replay",
    "refresh-token replay must be detected"
  );
  await store.revokeGrant(grant.id, 6);
  assert((await store.getGrant(grant.id))?.revokedAt === 6, "grant revocation must persist");

  await storage.healthCheck?.();
  await storage.cleanup?.(Date.now());
}
