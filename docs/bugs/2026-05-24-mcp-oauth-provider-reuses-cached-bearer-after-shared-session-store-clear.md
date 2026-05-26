# MCP OAuth provider reuses a cached bearer after the shared session store is cleared

## Summary

The exported `mcp-oauth` client provider reads each stored OAuth session only once per provider instance and thereafter serves its private in-memory copy. If another client, logout action, or credential cleanup clears the shared session store, an already-running provider continues attaching the removed bearer token to protected-resource requests.

## Reproduction

From the repository root, construct a provider over a shared session store, perform one authenticated request to prime its cache, clear the backing session externally, and authorize another request through the same provider instance:

```sh
probe=$(mktemp -d /tmp/mcp-oauth-shared-session-clear-probe.XXXXXX)

cat > "$probe/repro.mjs" <<'EOF'
import { createDefaultOAuthClientProvider } from "/Users/kjopek/Workspace/poe-code/packages/mcp-oauth/dist/index.js";

const resource = "https://resource.example.test/mcp";
let externalSession = {
  resource,
  authorizationServer: "https://auth.example.test",
  client: { clientId: "client-id" },
  tokens: { accessToken: "stored-access", tokenType: "Bearer", expiresAt: null },
  discovery: {
    resourceMetadataUrl: "https://resource.example.test/meta",
    resourceMetadata: {},
    authorizationServerMetadata: {}
  }
};
let loads = 0;

const provider = createDefaultOAuthClientProvider({
  client: { mode: "static", clientId: "client-id" },
  browser: { async openBrowser() {} },
  sessionStore: {
    async load() { loads += 1; return externalSession; },
    async save(_resource, session) { externalSession = session; },
    async clear() { externalSession = null; }
  }
});

const firstHeaders = new Headers();
await provider.authorizeRequest({ requestUrl: new URL(resource), headers: firstHeaders, fetch });
externalSession = null;
const secondHeaders = new Headers();
await provider.authorizeRequest({ requestUrl: new URL(resource), headers: secondHeaders, fetch });

console.log(`first=${firstHeaders.get("Authorization")}`);
console.log(`after_external_clear=${secondHeaders.get("Authorization")}`);
console.log(`store_loads=${loads}`);
EOF

node "$probe/repro.mjs"

nl -ba packages/mcp-oauth/src/client/default-oauth-client-provider.ts | sed -n '415,433p'
```

## Observed Behavior

The second request still uses the cached bearer after the backing session has been removed, and the shared store is never consulted again:

```text
first=Bearer stored-access
after_external_clear=Bearer stored-access
store_loads=1
```

`packages/mcp-oauth/src/client/default-oauth-client-provider.ts:415` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:423` return the `sessions` map entry whenever one has been loaded previously. Only the same provider instance's private `clearSession()` helper at `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:430` through `packages/mcp-oauth/src/client/default-oauth-client-provider.ts:433` invalidates that map, so clearing the exported shared persistence layer elsewhere is not observed.

## Expected Behavior

Clearing a shared stored OAuth session should prevent subsequent protected-resource requests from attaching the removed access token, including requests made by an already-running provider instance. The provider should either reload persisted credential state, expose coordinated cache invalidation, or otherwise honor external session revocation.

## Impact

Logout and credential-cleanup workflows cannot reliably revoke MCP access credentials for long-running clients. A process that previously read a bearer token may continue transmitting and using it after the user's shared session store reports that authorization has been cleared.
