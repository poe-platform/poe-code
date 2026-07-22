---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Optional hosted MCP OAuth

An opt-in Toolcraft capability for reusable, production-ready OAuth around hosted multi-user MCP servers.

## 1. What we're building

- Add an optional hosted-OAuth composition layer to Toolcraft so connector authors do not rebuild OAuth discovery, dynamic client registration, authorization interactions, callback completion, token issuance, revocation, proxy handling, and request-subject propagation.
- Provide one small happy-path API with safe defaults and progressively expose advanced protocol and storage controls.
- Add a durable authorization-server storage contract for shared multi-instance and restart-safe single-instance adapters.
- Keep the protected MCP path stateless and bind every authenticated request to the verified OAuth subject's provider account.
- Return the browser directly to the registered client callback without localhost copy/paste steps.
- Fail production misconfiguration at startup.
- Keep provider login, stable identity lookup, API translation, and credential contents in the connector.

Non-goals:

- Requiring OAuth, a database, signing keys, or encryption configuration for existing non-OAuth Toolcraft users.
- Changing stdio MCP, local HTTP, pre-shared bearer-token HTTP, or externally managed OAuth unless hosted OAuth is selected.
- Adding Redis, SQLite, or Postgres clients as mandatory dependencies.
- Requiring connector authors to configure OAuth protocol internals for the common case.
- Storing provider passwords or application data in OAuth infrastructure.
- Building provider-specific behavior into Toolcraft.

## 2. User-facing shape

Hosted OAuth extends `createHTTPMCPServer()`. The `hostedOAuth()` helper returns a discriminated `oauth` configuration and leaves the existing external-verifier shape unchanged.

```ts
import { createHTTPMCPServer } from "toolcraft/http";
import { hostedOAuth } from "toolcraft/http/hosted-oauth";

const server = await createHTTPMCPServer(root, {
  name: "skylight-calendar-agent",
  version: "1.0.0",
  oauth: hostedOAuth({
    publicUrl: "https://calendar.example/mcp",
    storage,
    provider: {
      name: "Skylight",
      login: { fields: ["email", "password"] },
      async connect({ email, password, signal }) {
        const credential = await loginWithPassword({ email, password, signal });
        return {
          accountId: await credential.accountId(),
          credential: credential.serialize()
        };
      },
      async services({ credentials }) {
        return {
          skylight: createSkylightService({ authorizationStore: credentials })
        };
      }
    }
  })
});

await server.listenHttp({ hostname: "::", port: 8080 });
```

`accountId` is the provider's stable identifier. Toolcraft derives an opaque OAuth subject. `credential` is an opaque provider session that storage encrypts before persistence. `credentials` is scoped to the verified subject and supports safe read, update, delete, and coordinated refresh.

The built-in form recognizes `email`, `password`, and `apiKey`; custom fields use a descriptor. Redirect-based upstream identity can be added as an advanced interaction adapter.

### Storage choices

`hostedOAuth()` receives one application-supplied `HostedOAuthStorage`. Connector authors do not separately wire OAuth records, provider sessions, signing keys, interactions, locks, or cleanup.

- Redis-style storage is appropriate for shared multi-instance deployments.
- SQLite-style storage is appropriate for restart-safe single-instance deployments on a mounted volume.
- In-memory storage is allowed only with explicit development mode.

Toolcraft defines the contract. Concrete database clients and adapters remain application-owned or separately distributed and are not mandatory Toolcraft dependencies.

### Defaults

The happy path provides:

- protected-resource and authorization-server discovery derived from `publicUrl`;
- dynamic client registration and authorization code with PKCE;
- required `mcp` scope and default `mcp offline_access` scopes;
- stateless JSON MCP requests;
- CSRF protection, callback-safe CSP, and an exact 303 return with `code`, `state`, and `iss`;
- stable signing keys, refresh rotation, revocation, and storage-managed encrypted credentials;
- fail-closed subject-to-service resolution; and
- `/healthz`, OAuth endpoints, protected-resource metadata, and MCP on one listener.

`offline_access` enables refresh tokens but is not required for MCP tool calls.

### End-user flow

1. The user adds the MCP URL to an OAuth-capable client.
2. The client discovers OAuth, registers, and opens the provider login page.
3. Transient form secrets go directly to `provider.connect` and are never persisted.
4. Toolcraft stores only the provider credential and redirects to the exact client callback.
5. Every tool request resolves only the provider credential for its verified subject.
6. Revoking a grant affects only that grant; invalid provider sessions require that user to reconnect.

### Errors and compatibility

- Safe retryable login errors render on the same form without retaining secrets; unknown failures render a generic message.
- Expired or consumed interactions require restarting the connection.
- Missing subject credentials fail closed with no process-global fallback.
- Production requires HTTPS, durable storage, encrypted credentials, stable keys, and valid scope relationships.
- Existing unauthenticated, pre-shared-token, external OAuth, stdio, and local HTTP APIs remain unchanged and do not initialize hosted OAuth.

Advanced controls remain grouped under `hostedOAuth({ advanced: ... })`, including scopes and protocol TTLs. Existing HTTP limits and proxy controls remain beside `oauth` in `createHTTPMCPServer()` options.
