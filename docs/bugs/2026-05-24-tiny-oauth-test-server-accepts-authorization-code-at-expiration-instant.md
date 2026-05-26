# Tiny OAuth test server accepts authorization code at expiration instant

## Summary

`tiny-oauth-test-server` permits an authorization code to be exchanged at the exact second recorded as its expiration time. Authorization codes are created with a five-minute expiry, but the expiry predicate rejects only times strictly later than that boundary, extending every code lifetime through the expiration instant.

## Reproduction

From the repository root, run a disposable Vitest probe that freezes time, auto-approves an authorization request, advances exactly 300 seconds, and exchanges the resulting code:

```sh
cat > /tmp/tiny-oauth-code-expiry-boundary-probe.test.ts <<'PROBE'
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

describe("tiny OAuth authorization code expiry boundary", () => {
  afterEach(() => vi.restoreAllMocks());
  it("exchanges a code at its exact expiry instant", async () => {
    let now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const server = createOAuthTestServer({ signingKeySeed: "probe", requireDcr: false, defaultAuthorization: { autoApprove: true } });
    const handle = await server.listen({ port: 0, hostname: "127.0.0.1" });
    try {
      const authorizationUrl = new URL("/authorize", server.issuer);
      for (const [key, value] of Object.entries({ response_type: "code", client_id: "client", redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", resource })) authorizationUrl.searchParams.set(key, value);
      const authorization = await request(authorizationUrl.toString());
      const code = new URL(String(authorization.headers.location)).searchParams.get("code")!;
      now += 300_000;
      const response = await request(new URL("/token", server.issuer).toString(), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: "client", redirect_uri: redirectUri, code_verifier: verifier, resource }).toString() });
      const body = JSON.parse(response.body);
      console.log(JSON.stringify({ status: response.status, hasAccessToken: typeof body.access_token === "string" }));
      expect(response.status).toBe(200);
      expect(typeof body.access_token).toBe("string");
    } finally { await handle.close(); }
  });
});
PROBE
cp /tmp/tiny-oauth-code-expiry-boundary-probe.test.ts packages/tiny-oauth-test-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-oauth-test-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-oauth-test-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

At the exact expiration second, the token endpoint still accepts the authorization code and issues an access token:

```text
{"status":200,"hasAccessToken":true}
✓ packages/tiny-oauth-test-server/src/__probe__.test.ts > tiny OAuth authorization code expiry boundary > exchanges a code at its exact expiry instant
```

`packages/tiny-oauth-test-server/src/index.ts:1076` through `packages/tiny-oauth-test-server/src/index.ts:1085` store authorization code expiration as `nowInSeconds() + 300`. `packages/tiny-oauth-test-server/src/index.ts:1245` through `packages/tiny-oauth-test-server/src/index.ts:1248` rely on `isExpired()`, whose comparison at `packages/tiny-oauth-test-server/src/index.ts:1331` through `packages/tiny-oauth-test-server/src/index.ts:1333` uses `now > expiresAt + clockSkewSeconds` rather than treating equality as expired.

## Expected Behavior

An authorization code should cease being redeemable once the current time reaches its expiration timestamp, subject only to explicitly configured clock skew. With zero skew, an exchange at exactly `expiresAt` should fail with `invalid_grant`.

## Impact

The test authorization server grants access tokens from codes that should already be expired, weakening time-bound authorization test coverage and potentially causing consumers tested against it to accept or depend on off-by-one expiration behavior.
