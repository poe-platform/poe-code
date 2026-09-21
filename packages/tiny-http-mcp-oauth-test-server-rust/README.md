# tiny-http-mcp-oauth-test-server-rust

Exercise OAuth-protected MCP clients against two controllable local HTTP
listeners, with portable Rust policies and no npm runtime dependencies.

| Capability | API |
| --- | --- |
| Discover the resource and embedded issuer | `prmUrl`, `oauth.issuer` |
| Exercise DCR, consent, PKCE and refresh | Embedded OAuth endpoints |
| Issue and revoke direct test credentials | `oauth.issueTokenFor`, `oauth.revoke` |
| Require scopes and resource-bound audiences | `scopes`, `resource` |
| Call echo, reverse, uppercase and fixture tools | MCP endpoint |
| Start, close and reopen listeners | `listen`, `close` |

```typescript
import { createMcpOAuthTestServer } from 'tiny-http-mcp-oauth-test-server-rust';

const server = createMcpOAuthTestServer({
  autoApprove: true,
  scopes: ['mcp.read']
});
const handle = await server.listen();
const token = await handle.oauth.issueTokenFor({
  clientId: 'test-client',
  resource: handle.resource,
  scopes: ['mcp.read']
});
console.log(handle.mcpUrl, handle.prmUrl, token);
await handle.close();
```

Set `mcpPath`, `issuer`, `resource`, `ttlSeconds` or `staticClients` to cover
specific client configurations. The default route is `/mcp`, scope `mcp.read`
and credential lifetime 60 seconds. A configured issuer must use HTTP and a
non-root path such as `/oauth`, with no query or fragment. The embedded listeners
must use different host/port pairs. Listener startup rejects overlaps, retries
up to ten ephemeral-port collisions and reports failed rollback. Shutdown can
be retried after a listener close failure; stale handles leave later listeners
available.

The optional `tiny-http-mcp-oauth-test-server-rust` CLI supports `--port`,
`--hostname`, `--mcp-path`, `--issuer`, `--resource`, `--ttl-seconds`,
`--auto-approve`, `--scopes`, `--print-test-token` and `--help`. The `./cli`
subpath exposes `runCli` for captured output and shutdown.

Rust owns configuration, lifecycle admission/retry/cleanup priorities and the
embedded MCP/OAuth protocol, grants, replay and authorization policies. Builtin
Node HTTP, URL, entropy and crypto primitives supply transport and signatures.
Own Rust-family adapters are packaged with one napi-rs addon; no TypeScript
implementation or runtime SDK provides a fallback. Cores use std and own path
crates, retaining a portable boundary for eventual Python bindings.

This is an additive private package. Existing applications retain their imports.
SDK/client comparisons and real HTTP workers pass for the implemented surfaces;
malformed/getter, cross-platform and aggregate acceptance remain unfinished.
Performance measurements cover a bounded listener/token workload and do not
establish a general speed or memory improvement.
