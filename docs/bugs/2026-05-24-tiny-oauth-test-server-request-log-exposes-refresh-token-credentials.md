# Tiny OAuth test server request log exposes refresh token credentials

## Summary

`tiny-oauth-test-server` exposes recorded OAuth requests through its public `requestLog` API and explicitly redacts PKCE verifier secrets from token requests, but it leaves refresh-token values intact. Any caller inspecting test traffic after a refresh can recover the full reusable refresh credential from the recorded request body.

## Reproduction

From the repository root, run a disposable Vitest probe that performs an authorization-code exchange, refreshes the issued credentials, and reads the logged refresh request body:

```sh
cat > /tmp/tiny-oauth-request-log-refresh-token-probe.test.ts <<'PROBE'
import http from "node:http";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createOAuthTestServer } from "./index.js";
function request(urlString: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) { const url = new URL(urlString); return new Promise<{ headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => { const req = http.request({ hostname: url.hostname, port: Number(url.port), path: `${url.pathname}${url.search}`, method: init.method ?? "GET", headers: init.headers }, (res) => { const chunks: Buffer[] = []; res.on("data", (chunk) => chunks.push(Buffer.from(chunk))); res.on("end", () => resolve({ headers: res.headers, body: Buffer.concat(chunks).toString("utf8") })); }); req.on("error", reject); if (init.body) req.write(init.body); req.end(); }); }
describe("tiny OAuth request log refresh token", () => { it("records the complete refresh credential in requestLog", async () => { const server = createOAuthTestServer({ signingKeySeed: "probe", requireDcr: false, defaultAuthorization: { autoApprove: true } }); const handle = await server.listen({ port: 0, hostname: "127.0.0.1" }); try { const verifier = "a".repeat(43); const resource = "https://resource.example.test/mcp"; const redirect = "http://127.0.0.1:43123/callback"; const auth = new URL("/authorize", server.issuer); for (const [k, v] of Object.entries({ response_type: "code", client_id: "client", redirect_uri: redirect, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", resource })) auth.searchParams.set(k, v); const authorization = await request(auth.toString()); const code = new URL(String(authorization.headers.location)).searchParams.get("code")!; const exchange = await request(new URL("/token", server.issuer).toString(), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: "client", redirect_uri: redirect, code_verifier: verifier, resource }).toString() }); const refreshToken = JSON.parse(exchange.body).refresh_token as string; await request(new URL("/token", server.issuer).toString(), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: "client", resource }).toString() }); const logged = server.requestLog.find((entry) => entry.body?.includes("grant_type=refresh_token"))?.body ?? ""; console.log(JSON.stringify({ refreshToken, logged, exposed: logged.includes(refreshToken) })); expect(logged).toContain(refreshToken); } finally { await handle.close(); } }); });
PROBE
cp /tmp/tiny-oauth-request-log-refresh-token-probe.test.ts packages/tiny-oauth-test-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-oauth-test-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-oauth-test-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The public request log retains the reusable refresh credential verbatim in the recorded form body:

```text
{"refreshToken":"3H5oRVfvXEuC71W5UQIQaf_OqKhIqHnV","logged":"grant_type=refresh_token&refresh_token=3H5oRVfvXEuC71W5UQIQaf_OqKhIqHnV&client_id=client&resource=https%3A%2F%2Fresource.example.test%2Fmcp","exposed":true}
✓ packages/tiny-oauth-test-server/src/__probe__.test.ts > tiny OAuth request log refresh token > records the complete refresh credential in requestLog
```

`packages/tiny-oauth-test-server/src/index.ts:511` through `packages/tiny-oauth-test-server/src/index.ts:527` sanitize logged form bodies only when they contain `code_verifier`, replacing that parameter while leaving `refresh_token` untouched. `packages/tiny-oauth-test-server/src/index.ts:486` through `packages/tiny-oauth-test-server/src/index.ts:493` expose those recorded bodies through the public request-log snapshot.

## Expected Behavior

The request log should redact reusable bearer credentials such as `refresh_token` in addition to PKCE verifiers, while retaining enough structure for assertions about grant type and request flow.

## Impact

Test logs, debugging output, snapshots, or assertion failures that print `requestLog` can disclose live refresh credentials capable of minting replacement access tokens. This undermines the package's existing redaction intent and increases secret exposure in test environments.
