---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: research-mcp-spec
    title: Investigate MCP OAuth spec
    prompt: |
      Research the MCP authorization specification and produce a concise written
      summary so subsequent implementation tasks can work without re-reading the
      spec. Output goes to docs/plans/research/mcp-oauth-spec.md (create the
      directory if needed).

      Sources to read:
      - https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
      - https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization
      - RFC 6749 (OAuth 2.0), RFC 7591 (Dynamic Client Registration),
        RFC 8414 (AS Metadata), RFC 8707 (Resource Indicators),
        RFC 9728 (Protected Resource Metadata), RFC 9700 (OAuth 2.0 Best Current Practice)

      The summary must enumerate, with spec citations, exactly what the MCP
      client and MCP server must, should, and may do. Cover at minimum:
        - Transport scope: which transports require OAuth (Streamable HTTP) and
          which are out of scope (stdio).
        - Required request header on protected MCP HTTP calls.
        - Server discovery: /.well-known/oauth-protected-resource shape
          (RFC 9728) and the WWW-Authenticate challenge format.
        - Authorization server discovery: /.well-known/oauth-authorization-server
          (RFC 8414) and how the client follows it from PRM.
        - Client registration: Dynamic Client Registration (RFC 7591) flow and
          when clients fall back to a pre-configured client_id.
        - Authorization code flow with PKCE (S256), including required and
          forbidden parameters.
        - Resource indicator (`resource` param) requirements on /authorize and
          /token, and audience binding.
        - Token type, refresh token handling, expiry.
        - 401 handling and re-authentication triggers on the client side.
        - Token validation requirements on the server (signature, issuer,
          audience, expiry, scopes).
        - Security boundaries: no token passthrough, confused deputy mitigation,
          loopback redirect URIs only, exact-match redirect URIs.

      Do not write code in this task. The output is the markdown summary file
      only. End the file with a "Conformance checklist" section listing every
      MUST/SHOULD as a bullet that later tasks can reference by heading text.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: research-sdk-and-clients
    title: Investigate official SDK and other MCP clients
    prompt: |
      Research how OAuth is actually implemented today and produce a written
      survey at docs/plans/research/mcp-oauth-implementations.md.

      Sources to read (clone or browse on GitHub via the gh CLI when possible):
        - github.com/modelcontextprotocol/typescript-sdk — both client (auth.ts,
          OAuthClientProvider, StreamableHTTPClientTransport auth handling) and
          server (mcpAuthRouter, BearerAuthMiddleware, ProxyOAuthServerProvider).
        - github.com/modelcontextprotocol/python-sdk — equivalent modules under
          mcp/client/auth and mcp/server/auth.
        - github.com/modelcontextprotocol/inspector — how the reference client
          drives discovery + DCR + token cache.
        - The Anthropic-maintained Claude Code MCP integration in this repo if
          present, plus a quick look at how Cursor/Cline document MCP HTTP
          server connections (web docs only — link, do not paste).

      Capture for the typescript-sdk specifically:
        - The exact `OAuthClientProvider` interface: every method signature, who
          provides redirect URI, how state is persisted, how the SDK calls back
          when authorization is required.
        - How the SDK handles the 401 -> discover PRM -> discover AS -> register
          -> authorize -> token chain inside StreamableHTTPClientTransport.
        - How the SDK validates and caches metadata documents.
        - Server-side: how `mcpAuthRouter` mounts /.well-known endpoints and
          /register, and how `requireBearerAuth` validates tokens (audience,
          scopes, expiry) before the MCP handler runs.

      Also list every place this repo would need to plug in: `tiny-mcp-client`'s
      `HttpTransport` (packages/tiny-mcp-client/src/internal.ts:2301) and
      `tiny-http-mcp-server`'s request pipeline
      (packages/tiny-http-mcp-server/src/http-server.ts and http-transport.ts).

      Do not modify any source files in this task. Output is the survey file.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: design-mcp-oauth-package
    title: Design mcp-oauth package shape
    prompt: |
      Decide the package layout for MCP OAuth and document it at
      docs/plans/research/mcp-oauth-design.md. Do not write production code in
      this task.

      Constraints to honor (from CLAUDE.md and prior memory):
        - Extend existing shared packages instead of duplicating. The current
          `poe-oauth` package implements a Poe-specific PKCE flow that mints a
          long-lived API key, not RFC 6749 access tokens. It is not MCP-spec
          compliant. Decide explicitly whether to:
            (a) generalize `poe-oauth` so the standard authorization-code +
                PKCE flow lives there and Poe-specific behavior is a thin
                preset, or
            (b) keep `poe-oauth` as the Poe preset and add a sibling
                `mcp-oauth` package for the spec-compliant primitives.
          Pick one; justify with a paragraph that names the concrete code that
          would need to move in each option.
        - Providers must be declarative and minimal — same rule applies if
          `mcp-oauth` ends up exposing IdP presets.
        - Plain TS type guards for runtime validation; no zod.
        - Token storage must reuse `packages/auth-store` rather than rolling a
          new persistence layer.
        - `tiny-mcp-client` and `tiny-http-mcp-server` must stay usable without
          OAuth (opt-in only); existing stdio/HTTP tests must keep passing.

      Output sections required:
        1. Decision: which option above, with the trade-off.
        2. Public API surface for the new module(s):
             - Client side: an `OAuthClientProvider`-style interface that
               `HttpTransport` can call into, plus a default implementation that
               composes discovery, DCR, PKCE authorization, token exchange, and
               refresh.
             - Server side: a metadata router (PRM + AS metadata + register
               proxy if desired), a token verifier interface, and a guard that
               returns 401 with the correct WWW-Authenticate challenge.
        2. Concrete file paths in each affected package.
        3. Wiring: how `HttpTransport` learns it must trigger auth (401 -> PRM),
           where tokens are cached, how refresh interleaves with in-flight
           requests, and how the server middleware composes with the existing
           Express adapter.
        4. CLI/config surface for `tiny-http-mcp-server`: which flags enable
           OAuth, how the canonical resource URI is supplied, and how the token
           verifier is plugged in (function reference for programmatic API,
           module path or URL for CLI). State the actual flag names; do not
           rely on naming conventions.
        5. Test strategy summary for each layer (unit with memfs + mocked fetch;
           integration pairing a test AS, the HTTP server, and `tiny-mcp-client`).

      Produce a short open-questions list at the end if anything is still
      ambiguous; do not block on them.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: prm-discovery-server
    title: Serve protected-resource metadata
    prompt: |
      Add RFC 9728 protected-resource metadata to `tiny-http-mcp-server` per
      the design at docs/plans/research/mcp-oauth-design.md.

      Implementation requirements:
        - Add a function (in the package and module the design names — read it
          first; do not invent paths) that takes the resource metadata config
          (`resource` URI, list of `authorization_servers`, supported
          `bearer_methods_supported`, `scopes_supported`) and returns an Express
          handler that responds to GET /.well-known/oauth-protected-resource
          with `application/json` and the document body.
        - Wire the handler into both `createHttpServer().listenHttp()` and the
          Express middleware adapter so any deployment style serves it. Keep
          OAuth opt-in: when no resource metadata config is supplied, the
          server behaves exactly as today.
        - On unauthenticated requests to the MCP endpoint when OAuth is
          enabled, respond 401 with
          `WWW-Authenticate: Bearer realm="...", resource_metadata="<absolute URL to /.well-known/oauth-protected-resource>"`.
          The challenge string format must match what the survey produced in
          docs/plans/research/mcp-oauth-implementations.md captured from the
          official typescript-sdk.
        - Do not implement the bearer-token verifier yet. This task only owns
          discovery + the 401 challenge. A pluggable `verifyToken` hook can be
          declared in the public types but its real implementation lands in
          a later task.

      Update `packages/tiny-http-mcp-server/README.md` with a new "OAuth
      protected resource" section that documents the new options and shows the
      response shape. Do not add anything outside what this task introduces.

      Tests must run against an in-memory HTTP server (use the existing test
      helpers) and assert: GET PRM returns the exact JSON document; an
      unauthenticated POST /mcp returns 401 with the correct WWW-Authenticate
      header pointing at the absolute PRM URL; existing non-OAuth tests still
      pass unchanged.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: token-verification-server
    title: Verify bearer tokens on the server
    prompt: |
      Add bearer-token verification to `tiny-http-mcp-server` so that when
      OAuth is enabled, MCP requests must carry an `Authorization: Bearer ...`
      header that the configured verifier accepts.

      Requirements:
        - Define the `TokenVerifier` interface declared in the design doc
          (docs/plans/research/mcp-oauth-design.md) and accept it as a
          configuration option on the HTTP server. Do not bundle a default
          verifier; the package stays declarative and IdP-agnostic.
        - Verifier contract must include audience (`aud` equals the canonical
          resource URI configured for PRM), expiry, issuer match against the
          configured authorization server, and scope intersection with any
          `requiredScopes` the server declares for the MCP endpoint.
          Implementations are responsible for signature/JWKS fetching; the
          server core only orchestrates the calls.
        - On verification failure return 401 with a WWW-Authenticate challenge
          whose `error` and `error_description` parameters match the spec
          (e.g., `error="invalid_token"`). Reuse the PRM URL from the previous
          task.
        - Pass the verified token claims through to the MCP request context so
          tools can read `request.auth` (mirror the typescript-sdk shape
          captured in the implementation survey).
        - Provide a small in-memory verifier in the test helpers
          (packages/tiny-http-mcp-server/src/testing.ts) so integration tests
          can supply scoped tokens without a real IdP. Do not export it from
          the main package entry point.

      Tests must cover: valid token allows MCP traffic; missing header returns
      401 with PRM challenge; expired/wrong-audience/wrong-issuer/insufficient-
      scope tokens each return 401 with the correct error code; tools observe
      the verified claims through the request context.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: discovery-client
    title: Implement client-side OAuth discovery
    prompt: |
      Add OAuth metadata discovery to `tiny-mcp-client` per the design at
      docs/plans/research/mcp-oauth-design.md.

      Requirements:
        - Add a discovery module that, given a resource URL, fetches
          /.well-known/oauth-protected-resource (RFC 9728) and then
          /.well-known/oauth-authorization-server (RFC 8414) for each listed
          authorization server, picking the first one whose metadata loads
          successfully. Honor the path-based well-known location resolution
          rules captured in the spec summary.
        - Validate metadata documents with plain TS type guards. Reject
          documents missing `issuer`, `authorization_endpoint`, `token_endpoint`,
          or `code_challenge_methods_supported` containing `S256`.
        - Cache successful discovery results per resource URL in memory for the
          lifetime of the client; expose a hook so callers can inject a
          longer-lived cache (e.g., the `cached-resource` package). Do not
          introduce a new persistence layer here.
        - Trigger discovery from `HttpTransport` when a request returns 401
          with a `WWW-Authenticate: Bearer ... resource_metadata="..."` header.
          The transport hands the discovered metadata to the
          `OAuthClientProvider` interface so the next task can complete the
          flow. If the 401 does not carry a resource_metadata hint, fall back
          to the path-based location.

      No real authorization or token exchange happens in this task — that
      lands next. This task owns discovery, parsing, caching, and the 401
      trigger only. Stub the `OAuthClientProvider` to throw so tests can
      assert the trigger fires with the right metadata.

      Tests use mocked `fetch` against the in-memory test pair. Cover: PRM +
      AS resolution; missing/invalid metadata is rejected with a clear error;
      challenge parsing handles quoted parameters and the no-hint fallback.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: pkce-flow-client
    title: Implement client-side authorization code + PKCE flow
    prompt: |
      Implement the authorization-code-with-PKCE flow that turns the metadata
      from the previous task into access tokens, and wire it into
      `HttpTransport` so unauthenticated requests transparently authorize and
      retry.

      Requirements:
        - Implement the `OAuthClientProvider` interface from the design doc.
          The default implementation must:
            * Generate PKCE verifier + S256 challenge (reuse helpers from
              `poe-oauth` if the design selected the "generalize poe-oauth"
              option; otherwise import from the new shared module — do not
              copy/paste).
            * Use Dynamic Client Registration (RFC 7591) when the AS metadata
              advertises a `registration_endpoint` and no static `client_id`
              was supplied. Persist the registered client via the storage
              hook (the `auth-store` integration).
            * Run the authorization code flow with a loopback redirect on
              127.0.0.1 and a random ephemeral port. Honor the resource
              indicator (RFC 8707) on both /authorize and /token.
            * Exchange the code for an access token; persist token + refresh
              token through the storage hook keyed by canonical resource URI.
            * Refresh tokens silently when expired, queuing concurrent
              requests so only one refresh runs at a time.
        - Wire it into `HttpTransport`:
            * On 401 + resource_metadata: trigger discovery, then ask the
              provider for a token, attach `Authorization: Bearer ...`, retry
              the original request once.
            * On all subsequent requests, attach the cached token without
              re-discovery.
            * Surface a single `oauth?: OAuthClientProviderOptions` option on
              `HttpTransportOptions` so callers opt in explicitly. When omitted,
              the transport behaves exactly as today.
        - The browser open + readline plumbing already in `poe-oauth` is the
          right shape for this flow — reuse it through whichever package the
          design selected; do not reimplement.

      Tests must cover, against a mocked authorization server pair:
        - Full happy path: discovery -> DCR -> authorize -> token -> retry
          succeeds with the bearer attached.
        - Refresh path: expired access token triggers refresh exactly once
          even with concurrent in-flight calls.
        - Static client_id path skips DCR.
        - Token persistence round-trips through the storage hook.
        - Resource indicator is sent on both /authorize and /token requests.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: cli-and-config-surface
    title: Expose OAuth options in CLI and configuration
    prompt: |
      Surface the new server-side OAuth options through the
      `tiny-http-mcp-server` CLI and the relevant poe-code configure paths.

      Requirements:
        - Add CLI flags to `packages/tiny-http-mcp-server/src/cli.ts` matching
          the names declared in docs/plans/research/mcp-oauth-design.md (read
          it; do not invent flag names). At minimum: enable OAuth, canonical
          resource URI, list of authorization server issuer URLs, supported
          scopes, path/URL to the token verifier module, optional required
          scopes for the MCP endpoint.
        - Update README.md OAuth section with every flag (each environment
          variable and option must be documented per the package rule).
        - Mirror the same options on the programmatic `createHttpServer` API
          if not already done in the prior server tasks. Keep parity between
          CLI flags and library options — no flag-only or option-only
          settings.
        - Wire the configure command (run `npm run dev -- configure --help`
          first to confirm the current shape) so an operator can scaffold an
          OAuth-protected MCP server. Use existing configure infrastructure
          (no regexes; deep-merge via the existing parsers). Provide an
          interactive flow that prompts for missing values and a non-
          interactive `--yes` path that accepts defaults.
        - Do not add OAuth client configuration to configure in this task;
          client OAuth is currently per-call wiring on `HttpTransport` and
          out of scope for the configure command.

      Tests:
        - CLI argument parsing tests for every new flag.
        - Snapshot or text test that `--help` includes the new flags.
        - Configure command unit tests using memfs for any file writes.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: tiny-oauth-test-server-package
    title: Add tiny-oauth-test-server package
    prompt: |
      Create a new package `packages/tiny-oauth-test-server` that runs a
      spec-compliant authorization server suitable for tests, demos, and
      manual smoke runs against any MCP client. It is NOT a production AS.
      Follow the existing `tiny-stdio-mcp-test-server` package layout
      (package.json shape, tsconfig, src/cli.ts, src/index.ts, README.md).

      Behavior requirements:
        - Implement the minimum endpoint set the MCP spec requires of an
          authorization server:
            * GET /.well-known/oauth-authorization-server (RFC 8414).
            * POST /register (RFC 7591) — accepts any client metadata and
              returns a new `client_id`. Persist registrations in memory.
            * GET /authorize — renders a tiny HTML consent page OR
              auto-approves when `?auto_approve=1` is set; redirects to the
              loopback `redirect_uri` with a one-shot authorization code.
              Validate PKCE `code_challenge` + `S256`, the `resource`
              parameter (RFC 8707), and the redirect URI exact match.
            * POST /token — supports `authorization_code` and `refresh_token`
              grants. Validates PKCE verifier, single-use codes, and the
              `resource` parameter. Issues short-lived access tokens (default
              60s) and refresh tokens. Returns RFC 6749-shaped JSON
              (`access_token`, `token_type=Bearer`, `expires_in`,
              `refresh_token`).
            * GET /.well-known/jwks.json — the public key for verifiers.
        - Tokens are real JWTs signed with an ES256 or RS256 key generated at
          startup (deterministic seed accepted via option for reproducible
          tests). `aud` is set to whatever the `resource` parameter requested,
          `iss` is the server's issuer URL, `scope` echoes the granted scopes.
          Do not invent a custom token format — the whole point is to exercise
          real spec behavior.
        - Public API:
            * `createOAuthTestServer(options)` returning a handle with
              `listen({ port?, hostname? })` -> `{ url, port, close() }`,
              plus convenience accessors:
                - `issuer` (the server's URL).
                - `issueTokenFor({ clientId, resource, scopes, ttlSeconds? })`
                  for tests that want to skip the browser dance and grab a
                  token directly.
                - `setNextAuthorization({ autoApprove, scopes })` for tests
                  that drive the consent flow.
                - `revoke(token)` to force expiry mid-test.
            * Options: `issuer?`, `signingKey?` (PEM/JWK), `clockSkewSeconds?`,
              `defaultTokenTtlSeconds?`, `requireDcr?`, `staticClients?: Array<{ clientId, redirectUris, scopes }>`.
            * Default behavior with zero options: random key, ephemeral port,
              60s token TTL, DCR enabled, no static clients.
        - CLI (`tiny-oauth-test-server`): `--port`, `--hostname`, `--issuer`,
          `--ttl-seconds`, `--auto-approve`, `--static-client client_id:redirect_uri[,redirect_uri...]`
          (repeatable). Prints the issuer URL, the PRM-friendly metadata URL,
          and a sample `issueTokenFor` curl invocation on startup.
        - README documents every option, every env var (none, unless required;
          if added, document them), and includes a quick-start showing both
          programmatic and CLI use.

      Constraints:
        - This is its own package; do not roll the AS into
          `tiny-http-mcp-server` or `poe-oauth`. Other test fixtures and
          downstream consumers must be able to depend on it independently.
        - No regexes for parsing config files (project rule); use URL/HTTP
          parsing primitives.
        - Plain TS type guards for runtime validation; no zod.
        - Use `node:crypto` for key generation and signing — no extra
          dependency unless absolutely necessary. If a JWT helper is needed,
          add `jose` (already widely used) and document it in the README.
        - `@modelcontextprotocol/sdk` MUST NOT appear in this package's
          dependencies. The AS does not import the SDK at all; if a test
          helper here ever needs it, place it under `devDependencies` only.

      Tests (in this package's own `src/*.test.ts`):
        - Metadata document shape conforms to RFC 8414.
        - Register -> authorize (auto-approve) -> token round trip yields a
          JWT with the expected `iss`, `aud`, `scope`, `exp`.
        - PKCE verifier mismatch is rejected.
        - Resource indicator mismatch between /authorize and /token is
          rejected.
        - Refresh token grant returns a new access token and the refresh
          token rotates.
        - Authorization codes are single-use (second exchange is rejected).
        - `issueTokenFor` produces tokens that pass JWKS verification.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: tiny-http-mcp-oauth-test-server-package
    title: Add tiny-http-mcp-oauth-test-server package
    prompt: |
      Create a new package `packages/tiny-http-mcp-oauth-test-server` that
      bundles `tiny-http-mcp-server` and `tiny-oauth-test-server` into a
      single ready-to-run OAuth-protected MCP HTTP server. This package is
      the canonical fixture every conformance test (and any manual smoke
      run against a real MCP client) targets.

      Layout: same shape as `tiny-stdio-mcp-test-server` and
      `tiny-oauth-test-server` (package.json with `bin`, README.md, src/cli.ts,
      src/index.ts, tests).

      Behavior requirements:
        - Programmatic API: `createMcpOAuthTestServer(options)` -> handle with
          `listen({ port?, hostname? })` -> `{ url, mcpUrl, oauth, close() }`.
            * `oauth` is the underlying `tiny-oauth-test-server` handle, so
              tests can call `issueTokenFor` directly.
            * `mcpUrl` is the protected MCP endpoint URL.
            * The handle exposes the configured `resource` URI (the canonical
              audience) so verifiers and clients can read it directly without
              hard-coding.
        - The bundled MCP server reuses the same toolset as
          `createTestMcpServer()` from
          `tiny-http-mcp-server/testing` so existing test assertions transfer
          without rewriting.
        - Wires the OAuth pieces together end-to-end:
            * Configures `tiny-http-mcp-server` with PRM pointing at the
              embedded AS's issuer URL.
            * Plugs in a JWKS-backed `TokenVerifier` (the one from the
              token-verification task) using the AS's JWKS endpoint and the
              configured resource URI.
            * Hosts the AS and the MCP server in the same Node process by
              default, on either one shared HTTP server (separate paths) or
              two listeners on the same hostname — whichever the design doc
              chose. State the actual choice in the README.
        - CLI (`tiny-http-mcp-oauth-test-server`): `--port`, `--hostname`,
          `--mcp-path`, `--issuer`, `--resource`, `--ttl-seconds`,
          `--auto-approve`, `--scopes scope1,scope2`. Prints the MCP URL, the
          PRM URL, the AS issuer URL, and a sample bearer token at startup
          when `--print-test-token` is passed (off by default).
        - README documents every option and shows three flows:
            1. Programmatic test usage with `issueTokenFor`.
            2. Programmatic test usage with the full discovery + DCR + PKCE
               flow via `tiny-mcp-client`.
            3. Manual CLI usage for ad-hoc smoke testing with `mcp-inspector`
               or Claude Code, including the exact configuration block users
               drop into their client.

      Constraints:
        - Test fixtures only; document explicitly in the README that this
          package is not safe to expose on a public network.
        - Reuse, don't reimplement: every primitive must come from
          `tiny-http-mcp-server`, `tiny-oauth-test-server`, and the new
          `mcp-oauth` module from earlier tasks.
        - No regexes for config parsing; plain TS guards for validation.
        - `@modelcontextprotocol/sdk` MUST NOT appear in `dependencies`. The
          MCP server piece comes from `tiny-http-mcp-server`. If a test in
          this package wants to drive the bundled server with the official
          SDK, the SDK lives in `devDependencies` only.

      Tests (in this package's own `src/*.test.ts`):
        - `createMcpOAuthTestServer().listen()` boots, serves PRM with the
          embedded AS as the advertised authorization server, and returns
          a handle whose `mcpUrl` rejects unauthenticated requests.
        - `oauth.issueTokenFor({ resource, scopes })` returns a token that
          unlocks the MCP endpoint and yields the expected tool result.
        - The bundled CLI starts up, prints the documented URLs, and exits
          cleanly on SIGTERM.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: e2e-tiny-mcp-client
    title: E2E conformance — tiny-mcp-client
    prompt: |
      Drive `tiny-mcp-client`'s `HttpTransport` (with the new
      `OAuthClientProvider` from the pkce-flow-client task) against a running
      `tiny-http-mcp-oauth-test-server`. This is the primary regression test
      for our own client.

      Requirements:
        - Test file lives in `packages/tiny-mcp-client/src/`. Use the new
          `tiny-http-mcp-oauth-test-server` programmatic API; do not
          reimplement an in-process AS or MCP server here.
        - Cover at minimum:
            * Full first-call flow: PRM discovery, AS metadata discovery, DCR,
              authorize (auto-approve), token exchange, retried tool call
              succeeds with the bearer attached.
            * Static `client_id` flow: when the AS is configured with a
              `staticClients` entry and the client is given the same id, DCR
              is skipped and the rest of the flow still succeeds.
            * Token reuse: the second tool call sends only the MCP request
              with the cached bearer (no /authorize, no /token traffic).
            * Refresh: revoke the access token via the AS handle, the next
              call triggers exactly one /token refresh (assert request count
              on the AS) and succeeds.
            * Concurrent refresh deduplication: while a token is expired,
              fire N tool calls in parallel; assert exactly one /token
              request is made.
            * Resource indicator: assert /authorize and /token requests
              carry `resource=<mcpUrl>`.
            * Error mapping: misconfigure the audience to force the verifier
              to reject tokens; the client surfaces a typed OAuth error
              rather than a generic transport failure.

      Use the existing `vitest` setup. No real browsers, no sleeps; the
      auto-approve path on the AS handles the consent step.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: e2e-typescript-sdk-client
    title: E2E conformance — @modelcontextprotocol/sdk client
    prompt: |
      Verify the OAuth-protected `tiny-http-mcp-oauth-test-server` interops
      with the official TypeScript SDK client, not just our own. This is what
      catches us drifting from the spec.

      Requirements:
        - Test file lives in a package that already lists
          `@modelcontextprotocol/sdk` under `devDependencies`
          (`packages/tiny-http-mcp-server` qualifies). It is a hard rule
          that the SDK NEVER appears under `dependencies` in any package —
          the test must live alongside the existing devDependency entry,
          not introduce a new one. If the chosen package does not yet have
          the devDependency, add it to `devDependencies` only and verify
          `dependencies` is untouched before committing.
        - Use the SDK's `StreamableHTTPClientTransport` plus the SDK's
          `OAuthClientProvider` interface (read the survey at
          docs/plans/research/mcp-oauth-implementations.md for the exact
          contract). Provide a minimal in-test implementation of
          `OAuthClientProvider` that:
            * Returns a fixed `redirect_uri` on a loopback ephemeral port
              the test owns.
            * Persists tokens in a Map.
            * Auto-completes the consent step by hitting the AS
              `/authorize?auto_approve=1` path and capturing the redirect.
        - Cover:
            * Full discovery -> DCR -> authorize -> token -> tool call.
            * Cached token reuse on the second call.
            * 401 on tampered token round-trips a typed SDK error.
        - Do not modify the SDK. The point is to confirm the spec-compliant
          server works against an unmodified spec-compliant client.

      If the SDK's `OAuthClientProvider` shape changes between minor
      versions, pin the version that the survey was written against and
      document the pinned version in the test file's leading comment.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: e2e-mcp-inspector
    title: E2E conformance — mcp-inspector smoke
    prompt: |
      Add an automated smoke test that runs `mcp-inspector` (the official
      CLI/web debugger) against `tiny-http-mcp-oauth-test-server` in headless
      mode. Inspector is the canonical reference client; if it can connect
      and list tools, our OAuth wiring matches user expectations.

      Requirements:
        - Use `npx --yes @modelcontextprotocol/inspector` (or the package's
          equivalent CLI entry) in headless / non-interactive mode if it
          supports one. If it does not, drive its programmatic API directly
          — investigate before writing the test, and document the chosen
          approach in the test file's leading comment.
        - Boot `tiny-http-mcp-oauth-test-server` programmatically, then
          launch inspector pointed at the protected MCP URL with a token
          obtained via `issueTokenFor`. Assert that inspector successfully
          completes the MCP `initialize` handshake and lists the bundled
          tools.
        - If inspector cannot be driven without a browser, downgrade this
          task to a markdown QA document in `docs/plans/qa/` describing the
          manual steps and remove the automated test. State that decision
          explicitly in the commit message and update the plan's Acceptance
          Criteria section accordingly.

      Keep the test fast — under 10s. Cache `npx`'d packages via the
      existing CI npm cache. Skip the test on platforms where inspector
      cannot run headlessly rather than failing.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: audit-discovery-and-www-authenticate
    title: Spec audit — PRM + AS metadata + WWW-Authenticate
    prompt: |
      Audit every place this codebase emits or consumes OAuth discovery
      surfaces against the spec, fix any deviation, and back the audit with
      regression tests. Read docs/plans/research/mcp-oauth-spec.md and
      docs/plans/research/mcp-oauth-implementations.md before starting; cite
      the heading text from the conformance checklist for each finding.

      Surfaces in scope:
        - Server PRM document at /.well-known/oauth-protected-resource (RFC
          9728): fields `resource`, `authorization_servers`,
          `bearer_methods_supported`, `scopes_supported`, `resource_name`,
          `resource_documentation` if applicable. Content-Type, caching
          headers, absolute URLs, no trailing slash inconsistencies.
        - Server WWW-Authenticate challenge on 401 responses: `Bearer`
          scheme, `realm` (optional but consistent), `resource_metadata` URL
          must be absolute and match the PRM endpoint, `error` and
          `error_description` parameters when token validation failed
          (`invalid_token`, `insufficient_scope`, no `error` on plain
          missing-token).
        - Client PRM parsing in `tiny-mcp-client`: handles all RFC 7235
          challenge forms (quoted, token68, multiple challenges in one
          header), follows the resource_metadata hint when present, and
          falls back to path-based well-known location only when the hint is
          absent (per spec, not the older draft behavior).
        - AS metadata fetch (RFC 8414): well-known location resolution
          rules (path-based vs host-based), HTTPS-only requirement (with
          loopback exception for tests), required field set checked, all
          unknown fields preserved for forward compatibility.

      Deliverables:
        - A short audit report at docs/plans/research/audit-discovery.md
          listing each finding (path:line, spec citation, severity,
          remediation taken or proposed).
        - Code changes for any MUST/SHOULD violation found.
        - New unit tests pinning every concrete behavior the audit
          confirmed correct (so a future refactor cannot silently regress
          it). Existing tests must still pass.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: audit-pkce-and-redirect-uri
    title: Spec audit — PKCE and loopback redirect URIs
    prompt: |
      Audit PKCE generation, PKCE verification, and the loopback redirect
      URI handling against the spec. Cite the conformance checklist headings
      from docs/plans/research/mcp-oauth-spec.md for every finding.

      PKCE checks:
        - Verifier length and alphabet (43–128 unreserved chars per RFC 7636).
          Confirm both the new client implementation and the test AS pass.
        - `code_challenge_method=S256` is the only method accepted; `plain`
          must be rejected by both the client (when picking a method) and
          the test AS (when validating the request).
        - Verifier is single-use: re-using a verifier across two token
          requests must be rejected by the test AS.
        - Verifier never appears in logs, telemetry, or error messages.
        - The client computes the challenge with base64url(no padding) of
          SHA-256(verifier), exactly. Add a known-vector test (RFC 7636
          Appendix B vector).

      Redirect URI checks (RFC 8252 + RFC 9700 BCP):
        - Client uses an `http://127.0.0.1:<random>/<path>` redirect URI.
          Reject `localhost` (DNS) per BCP. The test AS must enforce the
          same: a `localhost` redirect URI in /authorize must be rejected.
        - Exact-match comparison on /token: any deviation (port, path,
          trailing slash) between /authorize and /token is rejected by the
          test AS.
        - Path on the loopback URI is fixed per registered client; the
          ephemeral port is the only varying component permitted at runtime
          per BCP §8.4.
        - No https redirect URIs allowed in the public-client flow used by
          MCP clients today. Document the decision in the audit report.

      Deliverables:
        - Audit report at docs/plans/research/audit-pkce-redirect.md.
        - Code fixes for any deviation, including in the test AS so it
          actually exercises the rules.
        - Unit tests covering: valid verifier, too-short verifier, wrong
          alphabet, plain method rejection, wrong-challenge token request,
          re-used verifier, mismatched redirect URI, `localhost` redirect
          URI, path mismatch, port-only mismatch.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: audit-resource-indicator
    title: Spec audit — RFC 8707 resource indicator binding
    prompt: |
      Audit RFC 8707 resource indicator handling end to end. Audience
      confusion is one of the most common MCP OAuth bugs in the wild; this
      task exists to make sure every relevant request, response, and
      verification step honors `resource`.

      Checks:
        - Client sends `resource=<canonical mcpUrl>` on every /authorize
          request and on every /token request (initial code grant AND
          refresh). Multiple resource values are not used; pick one.
        - Canonical resource URI computation matches the spec: lowercase
          scheme/host, default port stripped, no fragment, query string
          omitted unless the resource explicitly includes one. Add a
          known-vector test set covering common forms.
        - Test AS rejects /token when /authorize and /token disagree on
          `resource`.
        - Test AS issues tokens with `aud` exactly equal to the requested
          `resource`. Multi-audience tokens are out of scope; reject AS
          configurations that would issue them.
        - Server token verifier (`tiny-http-mcp-server`) compares `aud`
          against its configured canonical resource URI using the same
          normalization rules as the client. Mismatch returns 401
          `invalid_token` with `error_description="audience mismatch"`.
        - When the protected resource sits behind a proxy or alternate
          origin, the verifier still uses the configured canonical URI
          (the deployment-declared one), not the request's `Host` header,
          to avoid header-injection audience downgrade.

      Deliverables:
        - Audit report at docs/plans/research/audit-resource-indicator.md
          with a table of every code path that touches `resource`/`aud`.
        - Code fixes for any drift.
        - Unit tests including the canonical-URI vector set and an end-
          to-end test where a token with the wrong audience is rejected.
    status:
      implement: done
      refactor: done
      test: done
      commit: open

  - id: audit-token-validation-and-storage
    title: Spec audit — token validation, storage, refresh, rotation
    prompt: |
      Audit token validation on the server side and token lifecycle on the
      client side. The goal is to prove every claim the spec requires gets
      checked, every storage write is safe, and refresh dedup is correct.

      Server-side validation checks (token verifier interface from the
      token-verification task):
        - Signature validation against JWKS keys; multiple keys with
          matching `kid` are tried; unsupported `alg` values are rejected
          (no `none`, no symmetric `HS*` unless explicitly configured with
          a shared secret).
        - `iss` exact-match against the configured authorization server
          URL.
        - `aud` covered by the resource-indicator audit; verify the call
          path here too.
        - `exp` enforced with bounded clock skew (configurable, default
          ≤30s). `nbf` enforced when present. Expired tokens return 401
          `invalid_token` with `error_description="token expired"`.
        - `scope` (or `scopes`) intersection with the endpoint's required
          scopes; missing scopes return 401 `insufficient_scope` with the
          required scope set in the WWW-Authenticate challenge.
        - Tokens with unknown critical claims (`crit` or future spec
          claims marked critical) are rejected.

      Client-side lifecycle checks:
        - Tokens persisted via `auth-store` keyed by canonical resource
          URI; never logged, never echoed in error messages.
        - Refresh tokens rotate on every refresh per RFC 6749 §10.4 and
          BCP — the old refresh token must be invalidated on the AS, and
          a refresh-token reuse attempt should fail (test AS enforces).
        - Concurrent refresh deduplication: N parallel calls during an
          expired-token window result in exactly one /token request;
          additional calls await the in-flight promise.
        - Refresh error handling: `invalid_grant` clears the cached token
          and triggers a fresh authorization flow (one retry only; no
          infinite loops).
        - Token storage round-trips through memfs in unit tests; no real
          filesystem writes.

      Deliverables:
        - Audit report at docs/plans/research/audit-token-lifecycle.md.
        - Code fixes for any gap.
        - Tests covering each bullet, including the `none`/`HS*` rejection,
          a clock-skew window test, and a refresh-rotation reuse rejection
          driven through the test AS.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: audit-dcr-and-error-responses
    title: Spec audit — Dynamic Client Registration and error mapping
    prompt: |
      Audit Dynamic Client Registration (RFC 7591) and OAuth error response
      handling. Both are common spots for clients to drift off-spec
      silently because errors are rare in the happy path.

      DCR checks:
        - Client posts `application/json` to the AS `registration_endpoint`
          with the required and recommended metadata: `client_name`,
          `redirect_uris`, `grant_types: ["authorization_code","refresh_token"]`,
          `response_types: ["code"]`, `token_endpoint_auth_method: "none"`
          (public client), `scope`, optional `software_id`, `software_version`.
        - Test AS validates the registration request, rejects unsupported
          `token_endpoint_auth_method` values, returns the canonical
          response (RFC 7591 §3.2.1) with `client_id`, optional
          `client_id_issued_at`, optional `client_secret` (omitted for
          public clients).
        - Client persists the registered `client_id` keyed by AS issuer
          via `auth-store`, and reuses it on subsequent runs instead of
          re-registering.
        - Client falls back to a configured static `client_id` when the
          AS metadata lacks `registration_endpoint`.
        - Re-registration on demand: when a stored `client_id` is rejected
          by the AS as `invalid_client`, the client deletes the stored
          record and re-registers exactly once before failing.

      Error response checks:
        - Every OAuth error response from the test AS conforms to RFC 6749
          §5.2: JSON body with `error` (one of the spec-defined codes) and
          optional `error_description`, `error_uri`. The client surfaces
          these as a typed `OAuthError` with the same fields.
        - 401 challenges from the resource server use the WWW-Authenticate
          codes from the discovery audit; mapped to the same typed
          `OAuthError` shape on the client.
        - The client distinguishes terminal errors (no retry: e.g.,
          `invalid_client`, `invalid_scope`, `unauthorized_client`,
          `unsupported_grant_type`) from transient errors that warrant
          one retry (e.g., 5xx from the AS).

      Deliverables:
        - Audit report at docs/plans/research/audit-dcr-errors.md with a
          table of every spec-defined error code and how the codebase
          reaches/handles it.
        - Code fixes for any gap.
        - Tests covering: successful DCR + reuse, DCR fallback to static
          client_id, re-registration on `invalid_client`, every error
          code surfaced as `OAuthError`, terminal vs retriable mapping.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: audit-no-mcp-sdk-in-production
    title: Spec audit — @modelcontextprotocol/sdk stays in devDependencies
    prompt: |
      Verify the hard rule: `@modelcontextprotocol/sdk` MUST NEVER appear in
      `dependencies` (or `peerDependencies`) of any package this monorepo
      ships. Every appearance must be in `devDependencies`. This task
      enforces that constraint with both a one-time audit and a permanent
      regression test.

      Audit steps:
        - Walk every `package.json` under `packages/`. For each, parse the
          file (do not regex — read the project rule on regexes), and
          assert that if `@modelcontextprotocol/sdk` is listed at all, it
          is only under `devDependencies`. Treat `peerDependencies` and
          `optionalDependencies` as forbidden too.
        - Cross-check the lockfile (`package-lock.json` at repo root) for
          any non-dev path resolving to the SDK. The lockfile is generated
          but should reflect that the SDK is only present via dev paths;
          if a non-dev path appears, find the offending package.json and
          fix it.
        - Read every new package introduced by this plan
          (`tiny-oauth-test-server`, `tiny-http-mcp-oauth-test-server`, any
          new `mcp-oauth` module) and confirm none of them imports the
          SDK from a runtime entry point. Static analysis: any
          `import .* from "@modelcontextprotocol/sdk"` must resolve from a
          `*.test.ts`, `testing.ts`, or sibling test fixture file — never
          from `src/index.ts` or any module reachable from it.
        - Document findings at docs/plans/research/audit-no-mcp-sdk.md.
          For each package list: SDK present? if so, under which key?
          imported from which source files? Final verdict pass/fail.

      Permanent guardrail:
        - Add a unit test in `packages/github-workflows`
          (or wherever the existing repo-wide invariants live; check first
          and reuse — do not create a new package) that scans every
          `package.json` under `packages/` and asserts the SDK is only
          ever a devDependency. The test reads files via the existing
          memfs-friendly fs abstraction so it stays fast. Failing this
          test must block merge.
        - Add a CI lint step that runs the same assertion in workflow
          form (per the project rule, no unit tests for github workflows
          themselves; the assertion is a regular package test that the
          CI happens to run). Update README.md of the chosen package to
          document the rule.

      Acceptance:
        - Audit report in place with explicit pass verdict.
        - Regression test fails when a hand-edited package.json moves the
          SDK to `dependencies`, and passes once reverted (demonstrate
          this in the test commit message).
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: audit-rfc9700-bcp-and-passthrough
    title: Spec audit — RFC 9700 BCP, token passthrough, confused deputy
    prompt: |
      Final spec audit covering the OAuth 2.0 Best Current Practice (RFC
      9700) guardrails plus the MCP-specific anti-patterns the spec
      explicitly forbids. Read the security section of
      docs/plans/research/mcp-oauth-spec.md before starting.

      BCP checks (RFC 9700):
        - Implicit grant is never used; the client never sends
          `response_type=token`.
        - Resource Owner Password Credentials grant is never used.
        - `state` parameter is sent on /authorize and verified on the
          callback; mismatch aborts the flow with no fallback.
        - PKCE is used even when a client secret is present (BCP §2.1.1).
        - Mix-up attack mitigation: the client verifies the `iss` in the
          callback (per the AS metadata it dereferenced) before exchanging
          the code, when the AS supports `iss` parameter; otherwise pins
          the AS issuer in the authorization request state.
        - Authorization request must use `application/x-www-form-urlencoded`
          via GET parameters only on /authorize; /token uses POST form
          encoding (never JSON, per RFC 6749 §4.1.3 / RFC 9700).
        - HTTPS for every endpoint except loopback redirect URIs.
        - No bearer tokens in URIs; only `Authorization: Bearer` header.
          Audit every request the client builds.

      MCP-specific anti-patterns:
        - Token passthrough: a token issued for resource A is never
          forwarded to resource B. The client keys the token cache by
          canonical resource URI and refuses to attach a token to a
          request whose URL would not match the canonical URI it was
          issued for.
        - Confused deputy: when the MCP server itself acts as a client
          to a downstream service (sampling, delegated tool calls), it
          must mint a fresh token via its own credentials, never reuse
          the inbound token. Audit any code path that does outbound
          OAuth from the server.
        - Redirect URI registration enforcement on the test AS so a
          client registered with one redirect_uri cannot use another at
          runtime — verifies the BCP rule end-to-end.
        - Authorization code is single-use even if the redirect handler
          fires twice (e.g., a duplicate browser navigation).

      Deliverables:
        - Audit report at docs/plans/research/audit-bcp-passthrough.md
          enumerating every BCP requirement and where the codebase
          satisfies it (file:line + test reference).
        - Code fixes for any gap, including the token cache keying rule
          and the confused-deputy assertion in any outbound path.
        - Tests covering: implicit/ROPC absence (compile-time impossible
          via the public API), state mismatch rejection, iss mismatch
          rejection, https enforcement on non-loopback URLs, token-in-URI
          rejection, cross-resource token reuse rejection, duplicate code
          exchange rejection.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: qa-real-clients
    title: Manual QA — real MCP clients
    prompt: |
      Per the project rule that QA is a markdown plan and not a script,
      author `docs/plans/qa/qa-mcp-oauth-clients.md` describing how to verify
      the OAuth-protected MCP server against real clients an end user
      actually runs. This is executed by an agent or human, not by CI.

      The QA plan must walk through, with explicit copy-pasteable
      configuration blocks, the smoke flow for each of:
        - Claude Code (the CLI tool this assistant runs under). Show the
          exact `mcpServers` entry that points at
          `tiny-http-mcp-oauth-test-server` and the expected discovery +
          authorization UX. Note any client-side gaps observed.
        - Cursor (refer the operator to Cursor's MCP docs for the current
          location of the MCP config; do not paste docs).
        - Cline (same).
        - The official `mcp-inspector` web UI in interactive mode (covers
          the case where the automated headless e2e was skipped).

      For each client, the plan must list:
        1. How to start the test server (one command).
        2. The exact configuration block to drop into the client.
        3. The expected outcome on first connection (browser opens, consent
           page appears, tool list populates).
        4. The expected outcome on second connection (no browser open, tools
           load immediately from cache).
        5. The expected error UX when the server is misconfigured (e.g.,
           wrong audience) — the client should surface a meaningful auth
           error, not a generic transport failure.
        6. A pass/fail checkbox.

      Do not write a script that runs the QA. The output is the markdown
      file only, plus a one-line entry pointing to it from the existing QA
      index if one exists in `docs/plans/qa/`.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
---

## Goal

Bring the `tiny-mcp-client` and `tiny-http-mcp-server` packages into full
compliance with the MCP authorization spec (latest revision 2025-06-18, with
the 2025-03-26 transition behavior considered). After this plan ships, an
operator can run an MCP HTTP server that requires OAuth, and any MCP client
built on `tiny-mcp-client` can connect to it by triggering the standard
discovery + authorization-code + PKCE flow with no bespoke per-server code.

## Why investigation comes first

The MCP spec layers seven different RFCs (6749, 7591, 8252, 8414, 8707, 9700, 9728) and the official typescript-sdk has settled on a specific division of
labor between transport, OAuth provider, and metadata router. The first three
tasks are deliberately research-only so the implementation tasks can cite the
exact MUSTs and reuse the SDK's vocabulary instead of re-deriving it.

## Hard constraint — @modelcontextprotocol/sdk is devDependency only

`@modelcontextprotocol/sdk` MUST NEVER appear under `dependencies` (or
`peerDependencies`) of any package in this repo. It is allowed only under
`devDependencies` for tests and integration fixtures. Production code paths
must route through `tiny-mcp-client`, `tiny-stdio-mcp-server`, or
`tiny-http-mcp-server`. Every task that touches a `package.json`,
authors a new package, or writes test code must respect this rule. When a
runtime code path appears to need the SDK, treat that as a design bug and
fix the routing through the tiny-\* packages instead.

Today the SDK is correctly scoped to devDependencies in
`packages/tiny-http-mcp-server`, `packages/tiny-mcp-client`,
`packages/tiny-stdio-mcp-server`, and `packages/tiny-stdio-mcp-test-server`.
No new task may regress that.

## New packages

This plan introduces two test-only packages so every conformance test (and
manual smoke run) targets the same fixture:

- `tiny-oauth-test-server` — a real RFC 8414 / 7591 / 8707 authorization
  server with JWKS-signed tokens and an auto-approve flag for headless tests.
- `tiny-http-mcp-oauth-test-server` — bundles the OAuth-enabled
  `tiny-http-mcp-server` and the test AS into one ready-to-run MCP endpoint.

Neither is shipped as a production component; the READMEs say so explicitly.

## Current state of the repo (as of this plan)

- `packages/poe-oauth` runs a Poe-specific PKCE flow that exchanges an
  authorization code for an opaque `api_key` via `https://api.poe.com/token`.
  It is not RFC 6749 compliant: the response shape uses `api_key` /
  `api_key_expires_in` instead of `access_token` / `expires_in`, there is no
  refresh token, no resource indicator, no DCR, and the loopback callback only
  matches `/callback`. Decision in `design-mcp-oauth-package` determines
  whether to generalize this package or add a sibling.
- `packages/tiny-mcp-client/src/internal.ts:2301` defines `HttpTransport` with
  static `headers` and a `fetch` hook but no auth callback, no 401 retry, and
  no token cache.
- `packages/tiny-http-mcp-server/src/http-server.ts` and
  `src/http-transport.ts` have no auth surface area at all. The Express
  adapter does let callers stack their own auth middleware in front, but the
  package itself does not serve `/.well-known/oauth-protected-resource` and
  has no opt-in for bearer verification.
- `packages/auth-store` already exists and is the persistence layer this plan
  reuses for tokens and DCR client records.

## Out of scope

- Stdio transport authentication (the spec leaves this to the launching
  process).
- Building a production authorization server. The plan only adds the test AS
  package for conformance and ad-hoc smoke runs.
- Migrating Poe's existing API-key issuer to RFC 6749 token shape — the
  decision in `design-mcp-oauth-package` may keep `poe-oauth` as a Poe-flavored
  preset.
- Configure-command flows for client-side OAuth (out of scope per the
  `cli-and-config-surface` task description).

## Acceptance criteria

The four E2E tasks (`e2e-tiny-mcp-client`, `e2e-typescript-sdk-client`,
`e2e-mcp-inspector`, `qa-real-clients`) plus the seven spec-audit tasks
(`audit-discovery-and-www-authenticate`, `audit-pkce-and-redirect-uri`,
`audit-resource-indicator`, `audit-token-validation-and-storage`,
`audit-dcr-and-error-responses`, `audit-no-mcp-sdk-in-production`,
`audit-rfc9700-bcp-and-passthrough`) are the gate. Each audit task
produces a report under `docs/plans/research/audit-*.md` enumerating every
spec requirement and the file:line that satisfies it. When all of them
pass alongside the existing suites:

- `tiny-http-mcp-server` configured with the new OAuth options advertises
  PRM, rejects unauthenticated calls with the correct WWW-Authenticate
  challenge, and verifies tokens for audience, issuer, expiry, and scope.
- `tiny-mcp-client` `HttpTransport` configured with the default
  `OAuthClientProvider` walks discovery, DCR, authorize, token, and retry
  against any spec-compliant server, persisting tokens through `auth-store`
  and refreshing silently.
- The official `@modelcontextprotocol/sdk` client connects to
  `tiny-http-mcp-oauth-test-server` without modification, proving spec
  conformance against an unmodified third-party client.
- `mcp-inspector` lists tools through the OAuth-protected endpoint (or the
  manual QA doc covers it explicitly when headless inspector is unavailable).
- The QA markdown for Claude Code, Cursor, and Cline has been executed and
  every checkbox is ticked.
- Both packages remain usable without OAuth — every existing test still
  passes unchanged.
