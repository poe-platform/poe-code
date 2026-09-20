# tiny-http-mcp-server-rust

Build an MCP service over HTTP with a native Rust protocol core and zero npm
runtime dependencies. This private additive rewrite supports legacy stateful
sessions and modern requests, JSON or SSE responses, resource/prompt/tool
registration, bearer authentication and Express-compatible middleware.

```ts
import { createHttpServer, defineSchema } from "tiny-http-mcp-server-rust";

const server = createHttpServer({ name: "echo", version: "1", enableJsonResponse: true });
server.tool(
  "echo", "Repeat a message", defineSchema({ message: { type: "string" } }),
  (args, context) => {
    context.signal.throwIfAborted();
    return args.message;
  }
);
const handle = await server.listenHttp({ hostname: "127.0.0.1", port: 0 });
console.log(handle.url);
// When the application shuts down:
await handle.close();
```

| Capability | API |
| --- | --- |
| Node HTTP listener or existing request handler | `listenHttp`, `handleRequest` |
| Tools, resources, prompts and subscriptions | `createHttpServer` registration methods |
| JSON or SSE responses and bounded replay | `enableJsonResponse`, stream/history limits |
| OAuth bearer admission | `oauth.verifier`, `requiredScopes` |
| Public JWT verification keys | `createJwksTokenVerifier` |
| Express adapters without an Express runtime dependency | `createExpressMiddleware`, `createExpressOAuthHandlers` |
| Protected-resource metadata | `createProtectedResourceMetadataDocument`, `createProtectedResourceMetadataRouter` |
| HTTP admission, observability and storage | `allowedHosts`, `allowedOrigins`, `observability`, `sessionStore` |
| Isolated test bearer tokens | `./testing`: `createInMemoryTokenVerifier` |

Rust owns protocol/schema dispatch, HTTP admission, configuration limits, JWT
policy and bounded replay retention. Node built-ins supply HTTP/URL objects,
cryptographic primitives and application callback execution. Sessions preserve
JavaScript identity and stay visible to its garbage collector; Rust retains their
index and slot identities without hidden strong references to user objects.

Request, response, session, stream, buffer and replay limits are configurable.
Closing the transport aborts active modern requests, closes session handlers and
streams, clears timers and releases replay records. `getRequestContext()` exposes
the authenticated request to HTTP tool handlers. `./server` provides the Node APIs
without loading Express adapters.

`createInMemoryTokenVerifier` lets tests issue opaque bearer tokens with explicit
issuer, audience, scope and expiry rules. An optional clock makes expiry
deterministic. Verification returns isolated claims through structured cloning;
custom claims cannot override the verified issuer, audience, expiry or scopes.

The remaining testing helpers and CLI are still being ported. Broader platform artifacts,
performance measurements and inherited schema/URI corner cases remain in progress.
Existing applications continue using the original packages.
