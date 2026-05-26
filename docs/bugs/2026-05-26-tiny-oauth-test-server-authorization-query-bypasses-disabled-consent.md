# Tiny OAuth test server authorization query bypasses disabled consent

## Summary

`tiny-oauth-test-server` documents `defaultAuthorization: { autoApprove: false }` as its default consent behavior, but any authorization requester can add `auto_approve=1` to its own `/authorize` URL and receive an authorization code without the consent page. This makes the fixture's disabled-auto-approval mode ineffective for tests that expect user approval to gate code issuance.

## Reproduction

From the repository root, create and run a disposable probe, then delete it:

```sh
cat > packages/tiny-oauth-test-server/src/__probe__.test.ts <<'EOF'
import http from "node:http";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createOAuthTestServer, type OAuthTestServerListeningHandle } from "./index.js";

const handles: OAuthTestServerListeningHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
});

async function request(input: URL): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const req = http.request(
      {
        hostname: input.hostname,
        port: Number(input.port),
        path: `${input.pathname}${input.search}`,
      },
      (response) => resolve(new Response(null, {
        status: response.statusCode ?? 0,
        headers: response.headers as HeadersInit,
      }))
    );
    req.on("error", reject);
    req.end();
  });
}

describe("tiny OAuth authorization approval", () => {
  it("lets the requester bypass disabled auto approval", async () => {
    const redirectUri = "http://127.0.0.1:43123/callback";
    const server = createOAuthTestServer({
      staticClients: [{ clientId: "client", redirectUris: [redirectUri] }],
      defaultAuthorization: { autoApprove: false },
    });
    handles.push(await server.listen({ port: 0, hostname: "127.0.0.1" }));

    const authorize = new URL("/authorize", server.issuer);
    for (const [key, value] of Object.entries({
      client_id: "client",
      redirect_uri: redirectUri,
      response_type: "code",
      code_challenge: createHash("sha256").update("consent-bypass-verifier-ABCDEFGHIJKLMNOPQRSTUVWXYZ").digest("base64url"),
      code_challenge_method: "S256",
      resource: "https://resource.example.test/mcp",
      auto_approve: "1",
    })) authorize.searchParams.set(key, value);

    const response = await request(authorize);
    const location = response.headers.get("location") ?? "";
    console.log(JSON.stringify({ status: response.status, redirected: location.startsWith(redirectUri), location }));
    expect(response.status).toBe(302);
    expect(location).toContain("code=");
  });
});
EOF
npm exec -- vitest run packages/tiny-oauth-test-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-oauth-test-server/src/__probe__.test.ts
```

The probe prints a redirect carrying an authorization code even though the server was configured not to auto-approve:

```text
{"status":302,"redirected":true,"location":"http://127.0.0.1:43123/callback?code=...&iss=http%3A%2F%2F127.0.0.1%3A54316"}
✓ packages/tiny-oauth-test-server/src/__probe__.test.ts > tiny OAuth authorization approval > lets the requester bypass disabled auto approval
```

## Observed Behavior

`packages/tiny-oauth-test-server/src/index.ts:1063` through `packages/tiny-oauth-test-server/src/index.ts:1066` set `autoApprove` when either the server-side decision permits it **or** the incoming query contains `auto_approve=1`. Because the requester controls that query parameter, the branch at `packages/tiny-oauth-test-server/src/index.ts:1069` through `packages/tiny-oauth-test-server/src/index.ts:1071` that renders consent is skipped. The server instead creates a code and redirects immediately at `packages/tiny-oauth-test-server/src/index.ts:1074` through `packages/tiny-oauth-test-server/src/index.ts:1094`.

The public README describes `defaultAuthorization` as controlling default consent behavior and documents server-side `setNextAuthorization({ autoApprove })`, but does not document an authorization-request parameter that unconditionally overrides a disabled consent decision (`packages/tiny-oauth-test-server/README.md:103` through `packages/tiny-oauth-test-server/README.md:125`).

## Expected Behavior

When consent auto-approval is disabled, a client-supplied authorization request should not be able to turn approval on. Any approval continuation mechanism needed by the rendered consent page should be bound to server-side state or otherwise unavailable as a requester-controlled bypass of the configured authorization decision.

## Impact

Tests or demos that use the fixture to exercise consent-gated OAuth flows can silently accept authorization codes from requests that should require an approval step. This masks missing user-interaction checks in clients and makes negative or pending-consent scenarios unreliable whenever a requester can add one query parameter.
