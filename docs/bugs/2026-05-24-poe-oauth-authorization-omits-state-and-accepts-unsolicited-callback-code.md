# Poe OAuth authorization omits state and accepts an unsolicited callback code

## Summary

The exported `poe-oauth` client opens a loopback OAuth authorization flow without adding a `state` parameter to its authorization URL. Because callback validation only enforces state matching when a state was present in the initiating URL, a request to the local callback endpoint containing only an arbitrary authorization code is accepted and exchanged for a stored API key.

## Reproduction

From the repository root, start a public Poe OAuth authorization flow with a stub token endpoint, inspect its authorization URL, and submit a callback carrying an unsolicited code but no state:

```sh
probe=$(mktemp -d /tmp/poe-oauth-state-probe.XXXXXX)

cat > "$probe/repro.mts" <<EOF
import http from "node:http";
import { createOAuthClient } from "file://$PWD/packages/poe-oauth/src/oauth-client.ts";

let exchangedCode = "";
const client = createOAuthClient({
  clientId: "probe-client",
  fetch: async (_url, init) => {
    exchangedCode = new URLSearchParams(String(init?.body)).get("code") ?? "";
    return new Response(JSON.stringify({ access_token: "stored-key" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
});

const authorization = await client.authorize();
const authorizationUrl = new URL(authorization.authorizationUrl);
console.log("state=" + String(authorizationUrl.searchParams.get("state")));
const redirect = new URL(authorizationUrl.searchParams.get("redirect_uri")!);
const resultPromise = authorization.waitForResult();
await new Promise<void>((resolve, reject) => {
  http.get(`${redirect.toString()}?code=attacker-code`, (response) => {
    response.resume();
    response.on("end", resolve);
  }).on("error", reject);
});
const result = await resultPromise;
console.log("apiKey=" + result.apiKey);
console.log("exchangedCode=" + exchangedCode);
EOF

./node_modules/.bin/tsx "$probe/repro.mts"

nl -ba packages/poe-oauth/src/oauth-client.ts | sed -n '49,110p'
nl -ba packages/poe-oauth/src/loopback-authorization.ts | sed -n '58,121p;160,217p'
nl -ba packages/mcp-oauth/src/client/default-oauth-client-provider.ts | sed -n '533,556p'
```

## Observed Behavior

The client emits no state parameter and successfully exchanges the unsolicited callback code:

```text
state=null
apiKey=stored-key
exchangedCode=attacker-code
```

`buildAuthorizationUrl()` in `packages/poe-oauth/src/oauth-client.ts:97` through `packages/poe-oauth/src/oauth-client.ts:110` adds PKCE and redirect parameters but no state. The callback validator in `packages/poe-oauth/src/loopback-authorization.ts:160` through `packages/poe-oauth/src/loopback-authorization.ts:217` checks state only when `expected.state !== null`, so an unbound callback code reaches token exchange. By contrast, the MCP OAuth provider generates and includes authorization state in `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:533` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:556`.

## Expected Behavior

Every Poe OAuth authorization attempt should generate an unpredictable state value, include it in the authorization request, and require an exact match in the loopback callback before exchanging any code. Callback requests not bound to the active authorization attempt must be rejected.

## Impact

An attacker able to cause a request to the local loopback callback during login can inject an authorization code that the client exchanges and stores. This enables OAuth login-CSRF or account-swapping behavior where a user intending to authenticate their own account can instead finish logged into an attacker-controlled account.
