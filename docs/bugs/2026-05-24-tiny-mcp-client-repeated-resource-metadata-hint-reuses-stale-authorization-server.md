# Tiny MCP client repeated resource_metadata hint reuses a stale authorization server

## Summary

The exported `OAuthMetadataDiscovery` cache in `tiny-mcp-client` treats a challenge-provided `resource_metadata` URI as fresh only when its URI differs from the location cached earlier. If the metadata document is updated in place to rotate authorization servers, a later `401` challenge that explicitly repeats the same metadata URI still reuses the obsolete cached authorization server without refetching the hinted document.

## Reproduction

From the repository root, resolve a protected-resource metadata document once, mutate the contents served at that same URI to point to a replacement authorization server, and perform discovery again with the challenge-provided `resourceMetadataUrl` hint:

```sh
probe=$(mktemp -d /tmp/tiny-mcp-same-metadata-rotation-probe.XXXXXX)

cat > "$probe/repro.mjs" <<'EOF'
import { OAuthMetadataDiscovery } from "/Users/kjopek/Workspace/poe-code/packages/tiny-mcp-client/dist/oauth-discovery.js";

const resource = "https://resource.example.test/mcp";
const metadataUrl = "https://resource.example.test/.well-known/oauth-protected-resource/mcp";
const issuerA = "https://auth-a.example.test";
const issuerB = "https://auth-b.example.test";
let rotated = false;
const fetched = [];

const discovery = new OAuthMetadataDiscovery({
  fetch: async (input) => {
    const url = String(input);
    fetched.push(url);
    if (url === metadataUrl) {
      return Response.json({ resource, authorization_servers: [rotated ? issuerB : issuerA] });
    }
    if (url.includes("auth-a.example.test")) {
      return Response.json({
        issuer: issuerA,
        authorization_endpoint: `${issuerA}/authorize`,
        token_endpoint: `${issuerA}/token`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"]
      });
    }
    if (url.includes("auth-b.example.test")) {
      return Response.json({
        issuer: issuerB,
        authorization_endpoint: `${issuerB}/authorize`,
        token_endpoint: `${issuerB}/token`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"]
      });
    }
    throw new Error(`unexpected ${url}`);
  }
});

const first = await discovery.discover(resource);
rotated = true;
const second = await discovery.discover(resource, { resourceMetadataUrl: metadataUrl });
console.log(`first=${first.authorizationServer}`);
console.log(`after_rotation=${second.authorizationServer}`);
console.log(`fetches=${fetched.join(",")}`);
EOF

node "$probe/repro.mjs"

nl -ba packages/tiny-mcp-client/src/oauth-discovery.ts | sed -n '230,305p'
```

## Observed Behavior

Although the second discovery request supplies a fresh challenge hint and the resource metadata at that URI now identifies `auth-b`, the cached `auth-a` result is returned without any second metadata fetch:

```text
first=https://auth-a.example.test
after_rotation=https://auth-a.example.test
fetches=https://resource.example.test/.well-known/oauth-protected-resource/mcp,https://auth-a.example.test/.well-known/oauth-authorization-server
```

`packages/tiny-mcp-client/src/oauth-discovery.ts:239` through `packages/tiny-mcp-client/src/oauth-discovery.ts:256` return a cached result whenever the supplied `resourceMetadataUrl` resolves to the same string as the cached location. This bypasses `packages/tiny-mcp-client/src/oauth-discovery.ts:259` through `packages/tiny-mcp-client/src/oauth-discovery.ts:305`, even when a new unauthorized response explicitly directs the client back to that metadata location after its content has changed.

## Expected Behavior

A `resource_metadata` URI included in a current unauthorized challenge should permit current metadata to be loaded even when its URI matches a previously cached document. Rotating the authorization server in place should not leave the client permanently bound to an obsolete cached issuer.

## Impact

MCP resources cannot reliably rotate or fail over authorization servers while keeping a stable protected-resource metadata URI. Running clients may continue attempting registration, authorization, and token refresh against a decommissioned or invalid issuer despite receiving a current challenge pointing them to updated metadata.
