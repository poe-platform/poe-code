---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: http-protocol-version-leniency
    title: Accept requests missing MCP-Protocol-Version
    prompt: |
      In packages/tiny-http-mcp-server/src/http-transport.ts, hasProtocolVersion
      requires the MCP-Protocol-Version header to strictly equal the session's
      negotiated version. The header only exists since protocol 2025-06-18, so
      clients that negotiated 2025-03-26 never send it and get 400 on every
      post-initialize request. Per spec, an absent header must be accepted
      (assume 2025-03-26). Replace with acceptsProtocolVersion(req, negotiated):
      header absent -> accept; header present -> must equal the negotiated
      version. Update the three call sites (POST ~line 372, GET ~line 553,
      DELETE ~line 626). TDD: initialize at 2025-03-26, then POST tools/list,
      GET stream, and DELETE all without the header must succeed; a present but
      mismatched header still returns 400 (keep the existing 2099-99-99 test
      green).
    status:
      implement: done
      refactor: done
      test: done
      commit: done
      release: done

  - id: http-single-stream-sse
    title: Single-stream SSE delivery and 409 for excess streams
    prompt: |
      MCP spec: a server MUST NOT broadcast the same message across multiple
      SSE streams. In packages/tiny-http-mcp-server/src/http-transport.ts,
      sendNotificationToSession writes every notification to all open GET
      streams of a session, and the maxStreamsPerSession limit rejects with
      429. Fix: (1) default maxStreamsPerSession to 1 when the option is
      omitted (an explicit larger integer still opts in); (2) reject excess GET
      streams with 409 Conflict instead of 429 (SDK convention) — update
      production-readiness.test.ts which asserts 429; (3) when more than one
      stream is open, write each live event to the most recently opened stream
      only. History recording and Last-Event-ID replay stay unchanged. TDD:
      second GET on defaults -> 409; with maxStreamsPerSession: 2 a
      notification arrives on exactly one stream. Update the README option
      table default.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
      release: done

  - id: http-cors-and-status-hygiene
    title: CORS expose headers, Vary Origin, 415 for wrong content type
    prompt: |
      Three response-hygiene fixes in
      packages/tiny-http-mcp-server/src/http-transport.ts, all TDD:
      (1) Whenever Access-Control-Allow-Origin is emitted (withSessionHeader,
      ~line 1061), also emit
      "Access-Control-Expose-Headers: Mcp-Session-Id, X-Request-Id" — without
      it cross-origin JS cannot read the session id from the initialize
      response and the handshake dead-ends.
      (2) Send "Vary: Origin" on all MCP endpoint responses (move into
      baseHeaders unconditionally), not only when the origin is allowed.
      (3) handlePost returns 400 for a non-JSON Content-Type (~line 293);
      return 415 Unsupported Media Type instead (SDK parity) — update existing
      tests asserting 400 for that case.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
      release: done

  - id: stdio-crash-proof-dispatch
    title: Crash-proof stdio dispatch and strict params
    prompt: |
      In packages/tiny-stdio-mcp-server:
      (1) server.ts connect()'s line handler runs processLine and ignores
      rejections (void message.finally(...)), so any throw escaping message
      handling becomes an unhandled rejection that kills the stdio process;
      connectSDK.onmessage has the same exposure. Wrap the messageHandler await
      in processLine with try/catch: write a -32603 internal-error response for
      requests, drop silently for notifications; add the equivalent guard in
      connectSDK.onmessage.
      (2) jsonrpc.ts parseMessage accepts "params": [] because arrays pass the
      typeof === "object" check; MCP requires object params. Reject array
      params as Invalid Request, preserving the request id.
      TDD: force handleMessage to reject (stub) over an in-memory connect()
      transport -> -32603 response and the connection keeps serving subsequent
      requests; params: [] -> Invalid Request on both stdio and HTTP (HTTP
      flows through packages/tiny-http-mcp-server/src/parse-body.ts
      automatically).
    status:
      implement: done
      refactor: done
      test: done
      commit: done
      release: open

  - id: output-schemas-first-class
    title: First-class spec-compliant tool output schemas
    prompt: |
      Make tool output schemas first-class per MCP 2025-06-18 structuredContent
      semantics in packages/tiny-stdio-mcp-server/src/server.ts:
      (1) Delete the keyword whitelist (assertSupportedJsonSchema) — anyOf,
      allOf, not, if/then/else, nullable unions, $defs/$ref are spec-legal.
      Keep the root type "object" requirement (structuredContent is an object).
      Validity = "Ajv compiles it": compile input AND output schemas eagerly at
      .tool()/.registerTool() registration, throwing the Ajv error immediately,
      and cache the compiled validators on the tool definition (this removes
      the lazy-compile crash path at call time — Ajv currently throws on a
      malformed schema at first tools/call, outside any try/catch).
      (2) A handler returning an explicit CallToolResult with isError: true
      from a tool with outputSchema currently throws "Structured tool result
      must be an object" and surfaces as protocol -32603; the spec exempts
      error results — pass them through untouched (no structured requirement,
      no schema validation).
      (3) normalizeToolResult always replaces content with the JSON-text
      backstop when outputSchema is set, discarding handler-supplied content
      blocks. Preserve handler content verbatim; add the
      JSON.stringify(structuredContent) text block only when the handler
      supplied no content.
      (4) Include Ajv errorsText() in validation error messages and the raw
      validator.errors array in error.data for both input (-32602) and output
      (-32603) failures.
      TDD including SDK-client interop over HTTP (tiny-http-mcp-server testing
      helpers): tools/list advertises outputSchema; union/enum/nullable
      property schemas register and validate; explicit isError results
      round-trip without protocol errors; content + structuredContent both
      arrive intact; registering {type: "not-a-type"} throws synchronously
      with the Ajv message. Update the stdio README outputSchema section.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
      release: open

  - id: stdio-tool-call-timeout
    title: toolCallTimeoutMs core option
    prompt: |
      Add ServerOptions.toolCallTimeoutMs (optional positive integer) to
      packages/tiny-stdio-mcp-server. In tools/call, race the handler against
      a timer cleared on settle; on timeout return
      ToolError(-32603, "Tool call timed out: <name>"). No cancellation — the
      handler keeps running, but the response is released. The option flows
      into createHttpServer automatically (HttpTransportOptions includes
      ServerOptions). TDD with fake timers: never-resolving handler -> timeout
      error and no open handles; fast handler unaffected, timer cleared. Add
      an HTTP passthrough test in packages/tiny-http-mcp-server: with
      maxConcurrentToolCalls: 1, a timed-out call releases the concurrency
      slot (a second call succeeds) and tool.end is emitted with ok: false.
      Document the option in both package READMEs.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
      release: open

  - id: http-sse-keepalive
    title: SSE keepalive for GET streams
    prompt: |
      Idle SSE GET streams emit nothing between notifications, so proxies
      (nginx proxy_read_timeout 60s default, ALB) kill them. In
      packages/tiny-http-mcp-server/src/http-transport.ts add sseKeepAliveMs
      (default 30000; 0 disables), validated like the other integer options.
      One unref'd setInterval per transport, started when the first GET stream
      opens, stopped when the last closes and in close(). Each tick writes the
      SSE comment ": keepalive" plus blank line to every open GET stream. POST
      SSE responses are short-lived and excluded. Add --sse-keep-alive-ms to
      src/cli.ts for parity. TDD with fake timers: open GET stream, advance
      30s, comment arrives; interval is unref'd and cleared by close(). Update
      README option and CLI tables.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
      release: open

  - id: http-sse-backpressure
    title: SSE backpressure cap
    prompt: |
      SSE writes in packages/tiny-http-mcp-server/src/http-transport.ts ignore
      backpressure — a stalled client buffers unboundedly in Node memory. Add
      maxStreamBufferBytes (default 1 MiB): before each live GET-stream write
      (notifications and keepalives), if (res.writableLength ?? 0) exceeds the
      cap, res.end() the stream instead of writing — the existing cleanup
      emits stream.closed and the client resumes via Last-Event-ID replay, so
      the event must still be recorded in history. The in-memory test response
      mock lacks writableLength, hence the ?? 0. Add
      --max-stream-buffer-bytes to src/cli.ts. TDD: stub ServerResponse with
      inflated writableLength -> stream ended, no write, event still in
      history. Update README option and CLI tables.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
      release: open

  - id: http-session-auth-binding
    title: Bind sessions to the authenticated identity
    prompt: |
      With OAuth enabled, any valid bearer token can drive any session id
      (session hijacking). In packages/tiny-http-mcp-server: add
      authSubject?: string to Session (src/session.ts). On session creation in
      src/http-transport.ts, when the request carries auth (set by
      authorizeBearerRequest on AuthenticatedIncomingMessage), record
      auth.subject ?? auth.clientId if non-empty. On every session lookup in
      the POST/GET/DELETE handlers, when session.authSubject is set and the
      current request's auth identity differs -> 404 (indistinguishable from
      an unknown session). Tokens with neither subject nor clientId create
      unbound sessions. TDD: verifier returning subject "a" creates the
      session; a request with subject "b" -> 404; subject "a" still works;
      no-oauth behavior unchanged. Document the binding in the README.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
      release: open

  - id: http-transport-robustness
    title: Forwarded-host validation, TTL sweep timer, post-close 503
    prompt: |
      Three robustness fixes in
      packages/tiny-http-mcp-server/src/http-transport.ts, TDD each:
      (1) acceptsHost always validates the raw Host header while
      readRequestHost prefers X-Forwarded-Host under trustedProxy — the
      allowlist check and origin comparison can disagree behind a rewriting
      proxy. Validate readRequestHost(req) instead, preserving the current
      "no Host header -> allow" behavior. Test: trustedProxy with
      allowedHosts ["mcp.example.com"], internal Host + X-Forwarded-Host
      mcp.example.com -> accepted; forwarded host not allowlisted -> 403.
      (2) purgeExpiredSessions runs an O(sessions) scan on every request
      (handleRequest). Remove it from the request path; when sessionTtlMs is
      set, run an unref'd setInterval (period min(sessionTtlMs, 60000)) doing
      the sweep, cleared in close(). Keep lazy expiry in getActiveSession.
      Test with fake timers: expired session deleted with session.deleted
      reason "expired" without any request arriving.
      (3) close() sets a closed flag; handleRequest returns 503 afterwards so
      keep-alive connections cannot recreate sessions mid-shutdown. Test:
      after transport.close(), POST -> 503 and no session.created event.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
      release: open

  - id: oauth-transport-fixes
    title: OPTIONS preflight exemption, central scopes, stream expiry
    prompt: |
      Three auth fixes in packages/tiny-http-mcp-server, TDD each:
      (1) CORS preflight is blocked by bearer auth: browsers send no
      Authorization header on OPTIONS and require a 2xx, but
      authorizeHttpRequest runs for every method (src/http-server.ts listenHttp
      handler and handleRequest; createExpressOAuthHandlers.mcpMiddleware in
      src/express-middleware.ts). Exempt OPTIONS from bearer authorization in
      all three paths; the transport's handleOptions responds as today. Test:
      OAuth-enabled server, OPTIONS preflight without a token -> 204 with CORS
      headers, while POST without a token stays 401.
      (2) authorizeBearerRequest (src/auth.ts) hands requiredScopes to the
      pluggable TokenVerifier and trusts it to enforce them — a custom
      verifier ignoring the argument silently disables scope checks. Enforce
      centrally after verify(): the returned scopes must include every
      required scope, else 403 insufficient_scope with the scope list in the
      challenge. Test with a stub verifier returning insufficient scopes
      without throwing -> 403.
      (3) SSE GET streams are authorized once and outlive token expiry (POSTs
      re-verify per request, streams never do). When OAuth is enabled,
      schedule a per-stream unref'd timer at req.auth.expiresAt (epoch
      seconds): end the stream cleanly at expiry; the client reconnects with
      a fresh token and resumes via Last-Event-ID. Clear timers on stream
      close and transport close. Test with fake timers: stream opened with a
      token expiring in 60s is ended at expiry with stream.closed emitted.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
      release: open

  - id: jwks-verifier-hardening
    title: JWKS verifier - require exp, timeouts, rotation, multi-aud
    prompt: |
      Harden packages/mcp-oauth/src/server/jwks-token-verifier.ts, TDD each:
      (1) Tokens without exp verify successfully (jose validates exp only when
      present; expiresAt falls back to 0) — eternal tokens. Pass
      requiredClaims: ["exp"] to jwtVerify, map the failure to invalid_token
      "token missing expiry", drop the ?? 0 fallback.
      (2) JWKS operations: loadJwks fetches with no timeout (a hung IdP stalls
      every request needing a fresh JWKS) — fetch with
      AbortSignal.timeout(jwksFetchTimeoutMs), new option, default 5000. After
      key rotation an unknown kid fails as invalid_token until the cache TTL
      lapses — on no-matching-kid force one cache-busting refetch before
      failing, rate-limited by jwksRefreshCooldownMs (default 30000).
      Infrastructure failures (timeout, network error, non-2xx, malformed
      document) currently surface as 401 invalid_token, driving healthy
      clients into re-auth loops during an outage — introduce a
      temporarily_unavailable error shape and map it in
      packages/tiny-http-mcp-server/src/auth.ts authorizeBearerRequest to 503
      without a challenge (extend BearerAuthResult statusCode to
      401 | 403 | 503).
      (3) normalizeVerifiedAudience requires exactly one audience; Auth0 and
      others routinely mint two (API + /userinfo), which hard-fails. Accept
      the token when ANY canonicalized audience equals the expected resource
      (no suffix/prefix matching); report the matching audience.
      (4) Minor hardening: reject non-HTTPS jwksUrl for non-loopback hosts at
      construction unless allowInsecureJwks: true; collapse unknown error
      messages to a generic "token verification failed" instead of passing
      error.message into the WWW-Authenticate error_description; optional
      requireAccessTokenType (default off) enforcing typ "at+jwt" (RFC 9068).
      Update the mcp-oauth README with the new options.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
      release: open

  - id: http-rejection-bodies
    title: Actionable JSON bodies on every transport rejection
    prompt: |
      Every transport rejection in
      packages/tiny-http-mcp-server/src/http-transport.ts answers with an
      empty body (403 host/origin, 400 missing session or protocol mismatch,
      404 unknown/expired session, 406, 409, 503 session limit), which is
      undebuggable — the loopback-default 403 is the guaranteed first-run
      failure when binding beyond localhost. Route all rejections through one
      respondWithRejection(res, statusCode, reason, message) helper emitting a
      one-line JSON body {"error": "<reason>", "message": "<remedy>"} — e.g.
      host_not_allowed naming the offending Host value and pointing at
      allowedHosts; session_not_found advising reinitialize. Add the same
      machine-readable reason to the request.end observability event for
      non-2xx responses (extend HttpObservabilityEvent). Existing JSON-RPC
      error responses (parse errors, etc.) stay as they are. TDD: each
      rejection path asserts its reason in body and event.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
      release: open

  - id: express-mount-path-challenge
    title: Correct WWW-Authenticate metadata path for Express mounts
    prompt: |
      httpServer.handleRequest hardcodes protectedResourcePath "/mcp"
      (packages/tiny-http-mcp-server/src/http-server.ts ~line 410), so
      mounting createExpressMiddleware at another path with oauth yields
      challenges pointing at /.well-known/oauth-protected-resource/mcp —
      OAuth clients follow it into a 404. Read Express's req.baseUrl via a
      structural type (no express import; the property exists on mounted
      middleware) and use it when non-empty, else "/mcp".
      createExpressMiddleware keeps its signature. TDD: an express app
      mounting the middleware at /api/v1/mcp with oauth -> the 401 challenge
      references /.well-known/oauth-protected-resource/api/v1/mcp.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
      release: open

  - id: tool-context-dx
    title: sessionId and auth on the tool context, safe default
    prompt: |
      In packages/tiny-http-mcp-server/src/http-server.ts, HttpToolContext
      exposes only request, and the non-HTTP fallback defaultContext is
      { request: {} as AuthenticatedIncomingMessage } — so
      context.request.headers.x type-checks and then throws TypeError at
      runtime. Extend HttpToolContext with sessionId?: string (from the
      Mcp-Session-Id request header) and auth?: RequestAuthInfo (from
      request.auth), populated in the request-context runner; give
      defaultContext.request a safe stub ({ headers: {}, socket: {} }) so
      property access degrades to undefined instead of throwing. TDD: a tool
      reads context.sessionId and context.auth.scopes over HTTP; a direct
      server.handleMessage call reaches a tool touching
      context.request.headers without throwing. Update the README API
      section.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
      release: open

  - id: cli-dx
    title: CLI --version, help hint, forced shutdown
    prompt: |
      In packages/tiny-http-mcp-server/src/cli.ts, TDD via runCli's injectable
      dependencies:
      (1) Add --version printing the package version (package info is already
      loaded for the server name).
      (2) On argument-parse failure, append "Run with --help for usage." to
      the error output.
      (3) A second SIGINT/SIGTERM during a hung graceful shutdown does nothing
      today (the once-handlers are removed; an in-flight slow tool call keeps
      close() waiting forever — only kill -9 works). Add --shutdown-grace-ms
      (default 10000): after the grace period, or immediately on a second
      signal, force-close remaining connections
      (nodeServer.closeAllConnections()) and exit non-zero.
      Update the README CLI table and the built-in help text.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
      release: open

  - id: core-registration-dx
    title: Throw on duplicate registration, tool-not-found hints
    prompt: |
      In packages/tiny-stdio-mcp-server/src/server.ts, TDD both:
      (1) .tool()/.registerTool()/.prompt()/.resource()/.resourceTemplate()
      silently overwrite existing names via Map.set. Throw
      Error("Tool already registered: <name>") (and the prompt/resource
      equivalents) unless the entry was removed first via the existing
      remove* methods. Before landing, verify no in-repo registration relies
      on overwrite (check packages/memory/src/mcp.ts and the test servers).
      (2) tools/call "Tool not found: <name>" gains
      ". Available: a, b, c" capped at 20 names — the list is already public
      via tools/list, and LLM callers self-correct from error text.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
      release: open

  - id: packaging-express-dep
    title: express as regular dependency, engines >=20
    prompt: |
      In packages/tiny-http-mcp-server/package.json:
      (1) src/index.ts eagerly re-exports ./express-middleware.js, which
      imports express at module load, while express is an optional peer —
      importing the package without express installed crashes. Move express
      from peerDependencies + peerDependenciesMeta to regular dependencies
      (repo convention: no optional peers, no dynamic-import gymnastics);
      keep @types/express in devDependencies.
      (2) engines.node ">=18.18" contradicts the README's "Node.js 20+ is
      required" (and Node 18 is EOL) — set engines.node to ">=20".
      Run the package build and full test suite to confirm nothing regresses.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
      release: open

  - id: test-helper-isolation
    title: Stop monkey-patching on import; test-support subpath
    prompt: |
      packages/tiny-http-mcp-server/src/test-support.ts monkey-patches
      http.Server.prototype.listen/address/close and globalThis.fetch at
      module-import time whenever VITEST or NODE_ENV=test is set, and the root
      entry (src/index.ts) re-exports it — importing the package inside any
      consumer's vitest run hijacks every http.Server in the process (their
      own servers never bind sockets; connection-refused with no visible
      cause). Fix, TDD:
      (1) Export an explicit installInMemoryHttp() instead of installing at
      import time; call it from this package's own vitest setup and from
      createHttpTestPair/createHttpTestPairWithTinyClient in src/testing.ts.
      nodeFetch keeps its in-memory fast path only when the install ran.
      (2) Add a "./test-support" subpath export to package.json (it must NOT
      import @modelcontextprotocol/sdk — that stays devDependency-only; the
      existing ./testing entry imports the SDK eagerly). Migrate consumers
      importing createTestMcpServer/nodeFetch from the root —
      packages/tiny-http-mcp-oauth-test-server (src + tests),
      packages/tiny-oauth-test-server, packages/tiny-mcp-client tests,
      packages/e2e-test-runner — then remove the root re-export from
      src/index.ts. ./testing keeps re-exporting the helpers for test code.
      (3) createHttpTestPairWithTinyClient returns null when tiny-mcp-client
      is not installed, making consumer tests silently pass while asserting
      nothing — throw with an actionable message instead ("install
      tiny-mcp-client as a devDependency"); update in-repo callers to skip
      explicitly where intended.
      Tests: importing the root and ./test-support entries under VITEST=1
      leaves http.Server.prototype.listen and globalThis.fetch untouched;
      after installInMemoryHttp() the existing in-memory suites still pass.
      Run the test suites of every migrated package.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
      release: open

  - id: publish-wiring
    title: Publish tiny-http-mcp-server to npm
    prompt: |
      packages/tiny-http-mcp-server is "private": true and 404s on npm while
      its README documents `npm install tiny-http-mcp-server`;
      tiny-stdio-mcp-server@0.1.14 is already published. Remove "private"
      from package.json and wire the package into the repo's release workflow
      the same way tiny-stdio-mcp-server is wired (see NPM_PUBLISHING.md;
      releases use OIDC trusted publishing, no NPM_TOKEN). For workflow
      changes use `npm run lint:workflows` — do not write unit tests for
      workflows. Note prominently in the commit message that the npm Trusted
      Publisher for tiny-http-mcp-server must be configured on npmjs.org
      before the first release, and after pushing, monitor the release build
      until the publish succeeds.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
      release: open

  - id: docs-production-guidance
    title: README production guidance and corrections
    prompt: |
      README updates for packages/tiny-http-mcp-server (scope strictly limited
      to the following):
      (1) Fix the Express quick start: remove app.use(express.json()) — it
      silently bypasses maxRequestBytes (express's 100kb limit governs) and
      turns parse failures into Express HTML errors instead of JSON-RPC
      -32700; the transport reads the raw stream itself. Note that any
      mounted body parser takes over body limits and error semantics.
      Complete the OAuth Express example with the actual app.use mounting
      lines for metadataMiddleware and mcpMiddleware. Document registerTool
      in the API reference.
      (2) New "Production deployment" section: recommend standalone
      listenHttp() behind a TLS-terminating reverse proxy (nginx/ALB), with
      Express reserved for embedding into an existing app. Checklist:
      allowedHosts with the public hostname (the loopback default 403s all
      public traffic), trustedProxy + forwarded headers, allowedOrigins only
      for browser clients, limits (maxRequestBytes 1-4 MiB, maxBatchSize
      ~16, maxSessions, sessionTtlMs ~15 min, maxConcurrentToolCalls,
      toolCallTimeoutMs), Node timeouts above the proxy idle timeout, nginx
      SSE settings (proxy_buffering off, HTTP/1.1 upstream,
      proxy_read_timeout greater than sseKeepAliveMs), OAuth via
      createJwksTokenVerifier, rate limiting at the proxy, and a ~10-line
      observability.onEvent recipe wired to console/pino.
      (3) Multi-instance honesty: a custom sessionStore gives session
      survival for a single instance; SSE streams and replay history are
      instance-local, so horizontal scaling requires sticky routing;
      maxSseEventHistory bounds the replay window.
      (4) Custom-verifier recipe for opaque tokens (RFC 7662 introspection
      sketch against the TokenVerifier interface).
      Also verify every option added by the earlier pipeline tasks
      (sseKeepAliveMs, maxStreamBufferBytes, toolCallTimeoutMs,
      maxStreamsPerSession default 1, authSubject binding, shutdown grace,
      jwksFetchTimeoutMs, jwksRefreshCooldownMs, allowInsecureJwks,
      requireAccessTokenType) appears in the relevant option/CLI tables of
      the tiny-http-mcp-server and mcp-oauth READMEs.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
      release: open
---

# Context

Audit of `packages/tiny-http-mcp-server` against the MCP Streamable HTTP spec (2025-03-26 / 2025-06-18), traced into the shared core (`tiny-stdio-mcp-server`) and the `mcp-oauth` verifier. Tasks above are ordered: HTTP spec compliance → core crash-proofing → output schemas → timeout → HTTP robustness → auth → DX → packaging → publish → docs. Every code task is TDD against the existing in-process harnesses (`nodeFetch`, `createTestMcpServer` for HTTP; in-memory `connect()` for stdio).

Audit correction recorded during planning: "request-scoped notifications should stream on the POST response" was dropped — the core has no progress/sampling support, so every notification it emits is unrelated to any in-flight request, and the spec routes exactly those to the standalone GET stream (current behavior). Revisit only if progress support is added.

## Auth assessment (context for oauth-transport-fixes / jwks-verifier-hardening)

The bearer implementation is solid at its core: asymmetric-only algorithm allowlist rejecting `none`/`HS*` (alg-confusion defense), `crit` header rejection, issuer pinned to configured authorization servers, strict RFC 8707 audience canonicalization (blocks token passthrough), `exp`/`nbf` with clock skew, JWKS key selection by `kid`/`alg`/`use`/`key_ops`, single-flight JWKS caching, `insufficient_scope` → 403, no query-string tokens, RFC 9728 metadata + `WWW-Authenticate` challenges. The two auth tasks close what separates it from production-grade: preflight exemption, central scope enforcement, stream expiry, required `exp`, JWKS timeout/rotation/outage taxonomy, multi-audience acceptance, and minor hardening.

## Accepted as-is (decisions, no tasks)

- **No JSON-RPC batch support on stdio** — batching was removed in protocol 2025-06-18; old-protocol stdio batch clients are not worth the parser complexity. HTTP keeps its existing batch handling for 2025-03-26 clients.
- **Handler error messages are sent to clients** (`Error: <message>` in `isError` results; prompt/resource internal errors) — matches official SDK behavior; redaction is the tool author's job.
- **Re-initialize is idempotent** — deliberate, documented in `server.ts` (kimi-cli/fastmcp compat).
- **No stdout backpressure handling in stdio `connect()`** — OS pipe buffering suffices for line-oriented traffic.
- **`SUPPORTED_PROTOCOL_VERSIONS` excludes 2024-11-05** — pre-Streamable-HTTP; clients get the server's latest version back per spec negotiation rules.
- **Bearer-only auth; no DPoP/mTLS sender-constraining** — the spec requires only bearer support; revisit if a deployment demands sender-constrained tokens.
- **No shipped opaque-token/introspection verifier** — the `TokenVerifier` interface covers it; the docs task adds a recipe.
- **Per-request JWT verification, no token-result caching** — signature verification is microseconds; caching adds revocation-latency questions for no measurable win.
- **Last-Event-ID replay window is bounded by `maxSseEventHistory`** — clients that miss the window must refetch state; documented in the docs task.
