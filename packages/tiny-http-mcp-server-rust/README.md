# tiny-http-mcp-server-rust

An additive Rust rewrite of the HTTP MCP server with native Node bindings and zero
npm runtime dependencies. This private package is under construction: HTTP
listening, complete transport/session admission, SSE replay and Express adapters
are not yet available.

The current public APIs create protected-resource metadata and structured token
verification errors:

```ts
import {
  createProtectedResourceMetadataDocument,
  TokenVerificationError
} from "tiny-http-mcp-server-rust";

const metadata = createProtectedResourceMetadataDocument({
  resource: "https://api.example/mcp",
  authorizationServers: ["https://auth.example"],
  scopesSupported: ["read"]
});
throw new TokenVerificationError({ error: "insufficient_scope", scope: ["read"] });
```

The native foundations also implement JSON-RPC body classification, byte budgets,
modern header mirrors, bearer admission, SSE formatting and an ordered session
index. They are being connected to the full transport. Node built-ins supply
HTTP/URL objects and cryptographic primitives. Session objects retain JavaScript
identity and remain visible to its garbage collector; Rust retains index/slot
identities without hidden strong references to user objects.

Existing applications continue using the original packages. Native artifacts are
currently checked on the development platform; wider packaging and performance
measurements remain in progress.
