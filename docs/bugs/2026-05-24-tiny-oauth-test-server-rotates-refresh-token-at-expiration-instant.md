# Tiny OAuth test server rotates refresh token at expiration instant

## Summary

`tiny-oauth-test-server` permits a refresh token to be exchanged and rotated at the exact second recorded as its expiration time. The refresh credential is stored with a one-hour expiry, but the common expiry predicate rejects only timestamps after the boundary rather than at the boundary.

## Reproduction

From the repository root, run a disposable Vitest probe that completes an authorization-code exchange, advances exactly 3,600 seconds from refresh-token issuance, and uses that refresh token:

```sh
cat > /tmp/tiny-oauth-refresh-expiry-boundary-probe.test.ts <<'PROBE'
import http from "node:http";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOAuthTestServer } from "./index.js";

function request(urlString: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const url = new URL(urlString);
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: Number(url.port), path: `${url.pathname}${url.search}`, method: init.method ?? "GET", headers: init.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

const redirectUri = "http://127.0.0.1:43123/callback";
const resource = "https://resource.example.test/mcp";
const verifier = "a".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");

describe("tiny OAuth refresh token expiry boundary", () => {
  afterEach(() => vi.restoreAllMocks());
  it("rotates a refresh token at its exact expiry instant", async () => {
    let now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const server = createOAuthTestServer({ signingKeySeed: "probe", requireDcr: false, defaultAuthorization: { autoApprove: true } });
    const handle = await server.listen({ port: 0, hostname: "127.0.0.1" });
    try {
      const authorizeUrl = new URL("/authorize", server.issuer);
      for (const [key, value] of Object.entries({ response_type: "code", client_id: "client", redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", resource })) authorizeUrl.searchParams.set(key, value);
      const authorization = await request(authorizeUrl.toString());
      const code = new URL(String(authorization.headers.location)).searchParams.get("code")!;
      const exchange = await request(new URL("/token", server.issuer).toString(), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: "client", redirect_uri: redirectUri, code_verifier: verifier, resource }).toString() });
      const refreshToken = JSON.parse(exchange.body).refresh_token as string;
      now += 3_600_000;
      const refresh = await request(new URL("/token", server.issuer).toString(), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: "client", resource }).toString() });
      const body = JSON.parse(refresh.body);
      console.log(JSON.stringify({ status: refresh.status, hasAccessToken: typeof body.access_token === "string", hasRefreshToken: typeof body.refresh_token === "string" }));
      expect(refresh.status).toBe(200);
      expect(typeof body.refresh_token).toBe("string");
    } finally { await handle.close(); }
  });
});
PROBE
cp /tmp/tiny-oauth-refresh-expiry-boundary-probe.test.ts packages/tiny-oauth-test-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-oauth-test-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-oauth-test-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

At the exact expiry timestamp, the refresh endpoint still accepts the old credential and issues replacement access and refresh tokens:

```text
{"status":200,"hasAccessToken":true,"hasRefreshToken":true}
✓ packages/tiny-oauth-test-server/src/__probe__.test.ts > tiny OAuth refresh token expiry boundary > rotates a refresh token at its exact expiry instant
```

`packages/tiny-oauth-test-server/src/index.ts:1348` through `packages/tiny-oauth-test-server/src/index.ts:1356` assign refresh-token expiration as `nowInSeconds() + 3_600`. `packages/tiny-oauth-test-server/src/index.ts:1303` through `packages/tiny-oauth-test-server/src/index.ts:1310` authorize refresh exchange using `isExpired()`, which compares with `>` at `packages/tiny-oauth-test-server/src/index.ts:1331` through `packages/tiny-oauth-test-server/src/index.ts:1333` and therefore allows equality.

## Expected Behavior

With zero configured clock skew, a refresh token should be invalid once the current time reaches its expiration timestamp. An exchange exactly at `expiresAt` should fail with `invalid_grant` rather than rotate the expired credential.

## Impact

Expired refresh credentials remain redeemable for an extra boundary instant in the test server. Consumers relying on it for authentication behavior tests may miss exact-expiration defects and inadvertently model credential rotation rules more permissively than intended.
