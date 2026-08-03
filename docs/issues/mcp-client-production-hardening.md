---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
name: MCP client production hardening

tasks:
  - id: decompose-tiny-mcp-client
    title: Decompose the tiny MCP client by responsibility
    prompt: |
      Address the structural portion of MCP-028 before behavioral hardening.
      Write characterization tests first, then split
      packages/tiny-mcp-client/src/internal.ts into focused client, protocol,
      JSON-RPC, HTTP transport, SSE, stdio transport, limits/policy, and testing
      modules. Keep src/index.ts as the stable public barrel and preserve every
      existing runtime and type export.

      This task is behavior-preserving: do not fix protocol findings while
      moving code, do not add functions that only proxy another function, and
      do not duplicate shared state or validators. Split the oversized
      transports test file along the same responsibility boundaries while
      retaining all assertions, including assertions that later tasks will
      deliberately replace.

      Run all packages/tiny-mcp-client/src tests, the package build, ESLint, and
      its no-emit type check. Compare the public declaration surface before and
      after the move so downstream Toolcraft imports do not drift.
    status:
      implement: failed
      refactor: open
      test: open
      commit: open

  - id: oauth-discovery-credential-binding
    title: Bind OAuth discovery and credentials to one identity
    prompt: |
      Close MCP-029, MCP-030, MCP-035, MCP-038, and MCP-042 in
      packages/tiny-mcp-client/src/oauth-discovery.ts and packages/mcp-oauth.
      Write failing tests first. Implement the protected-resource and
      authorization-server discovery candidate order required by the current
      stable MCP authorization specification, including root PRM fallback and
      OIDC discovery, continuing past missing or invalid candidates. Match
      protected resources by same-origin path-segment boundaries.

      Treat network and injected-cache metadata as equally untrusted. Fully
      validate cached values, evict invalid entries, and fall back to network
      discovery. Parse Bearer parameters case-insensitively, choose an
      actionable challenge, compare issuers exactly, reject fragments before
      keying state, and accept only exact localhost/canonical loopback IP forms
      rather than prefix lookalikes, trailing-dot hosts, alternate numeric
      encodings, or IPv6 zone identifiers.

      Make resource, authorization-server issuer, client registration, local
      profile, and tokens one atomic stored identity. Never combine a session
      or refresh token from one identity with freshly discovered metadata for
      another; clear the old credentials and require a new authorization when
      any bound identity changes. Cover malicious cache injection, AS swaps,
      path-boundary confusion, loopback lookalikes, IPv6 loopback, candidate
      fallback, and official metadata conformance fixtures. Use memfs for
      storage tests and run the focused tiny-mcp-client and mcp-oauth tests,
      ESLint, and both package type checks.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: oauth-bounded-no-redirect-io
    title: Bound OAuth I/O and reject credential redirects
    prompt: |
      Close MCP-031 and MCP-036 across packages/mcp-oauth and the OAuth path in
      packages/tiny-mcp-client. Write failing tests first, then introduce one
      shared request/response boundary used by discovery, dynamic client
      registration, authorization-code exchange, refresh, and bearer recovery.
      Put common fetch/limit policy in a tiny-client transport utility so OAuth
      and ordinary MCP HTTP reuse it; do not create a second OAuth-only policy.

      Every credential-bearing request must set redirect behavior to error and
      must reject a custom fetch response whose redirected flag is true.
      Compose caller cancellation with finite configurable per-request and
      overall-flow deadlines. Bound decoded body bytes, JSON depth/items,
      candidate count, candidate deduplication, and retained diagnostics.
      Cancel unread bodies and return typed timeout, abort, invalid-metadata,
      and oversized-response errors with no raw response body.

      Add adversarial tests for 307/308 cross-origin and HTTPS-downgrade
      redirects, a custom fetch that reports a followed redirect, slow headers,
      stalled bodies, oversized JSON, candidate fan-out, cancellation, and
      cleanup. Defaults must be enabled, ranges and ceilings validated, and
      secrets absent from every error. Run focused OAuth/client tests, ESLint,
      and package type checks.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: oauth-storage-concurrency-lifecycle
    title: Secure OAuth storage, concurrency, and logout
    prompt: |
      Close MCP-039 and MCP-040 in packages/mcp-oauth and packages/auth-store.
      Write failing tests first. Replace the predictable host/user-derived
      default file-encryption boundary with an OS credential-store default or
      an explicitly supplied user-held secret. Enforce 0700 directories and
      0600 files, define migration and deletion behavior, and never silently
      downgrade to predictable encryption.

      Extend the provider API with atomic forget/logout and best-effort
      revocation/disconnect. Supply one canonical provider lifecycle per
      resource/profile, serialize refresh and interactive authorization
      mutations, union compatible concurrent scope requests, and prevent
      rotating-refresh-token lost updates across provider instances. Add
      compare-and-swap or a bounded cross-process lock to the store contract;
      do not solve this with an unbounded global map.

      Test concurrent refresh, concurrent step-up, stale writers, lock timeout,
      crash cleanup, migration, purge, and revocation failure; local purge must
      still succeed when remote revocation fails. File behavior tests must use
      memfs and must not create real files or credentials.
      Keep mcp-oauth provider-neutral with no Notion, Asana, Figma, or other
      provider branches. Run auth-store/mcp-oauth tests, lint, and type checks.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: oauth-callback-and-browser-consent
    title: Harden OAuth callbacks and browser consent
    prompt: |
      Close MCP-034, the callback and refresh portions of MCP-044, and MCP-074
      in packages/mcp-oauth. Write failing tests first. Expose validated
      loopback host, fixed or ephemeral port, and exact callback path options
      through DefaultOAuthClientProviderOptions; handle occupied ports and
      exact path/host matching without accepting lookalikes.

      Make callback waiting cancellable, bounded, idempotently awaitable, and
      fully cleaned up before settlement. Return strict text/plain
      failures and a success response with Cache-Control no-store, nosniff,
      restrictive CSP/referrer policy, and browser-history cleanup. Sanitize
      authorization-server error descriptions. Add a proactive token-expiry
      window and do not replay a rotating refresh token after an ambiguous
      response.

      Before opening a browser for a first or changed authorization, require a
      host-supplied approval callback that receives resource, authorization
      server, requested scopes, client identity, redirect URI, and local
      profile. No approval callback means no automatic browser launch. Namespace
      stored sessions by profile. Test approval, denial, timeout, cancellation,
      malicious descriptions, exact callbacks, and cleanup with in-memory
      servers only. Run mcp-oauth tests, lint, and type checks.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: mcp-sensitive-data-minimization
    title: Minimize and redact MCP-sensitive data
    prompt: |
      Close MCP-041 and MCP-075, plus the secret-minimization part of MCP-050,
      across packages/mcp-oauth, packages/tiny-mcp-client, and
      packages/toolcraft/src/redaction.ts and error-report.ts. Write failing
      secret and private-content sentinel tests first.

      Parse and redact URL query values, form bodies, JSON bodies, headers, and
      structured diagnostics. Classify authorization codes, PKCE verifiers,
      access/refresh tokens, client secrets, authorization URLs, session IDs,
      cookies, and configured secret headers. Treat MCP arguments, results,
      server instructions, logs, subprocess stderr, user/workspace identifiers,
      and tool metadata as sensitive by default; retain shapes, counts, public
      operation names, and allowlisted categories unless the user explicitly
      opts into values.

      Bound and clear stderr/diagnostic capture, write report directories with
      mode 0700 and files with mode 0600, define retention/deletion behavior,
      and ensure cache fingerprints and persisted metadata contain no secret
      values. Tests must use memfs and
      assert sentinels never appear in errors, observers, transcripts, cache
      content, or reports. Run focused tests, lint, and type checks for all
      affected packages.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: stdio-execution-and-shutdown
    title: Secure stdio execution and graceful shutdown
    prompt: |
      Close MCP-025 and MCP-058 in packages/tiny-mcp-client. Write failing
      tests first and extract the stdio transport from internal.ts into a
      focused module without adding proxy-only functions.

      Do not inherit the parent environment by default. Build a documented
      minimal environment, require explicit opt-in for additional variables,
      and support an executable-provenance policy based on an absolute or
      otherwise reviewed/pinned identity instead of ambient PATH lookup.
      Preserve an explicit escape hatch for trusted callers without weakening
      the safe default.

      Make close idempotent and awaitable: close stdin, wait a bounded grace
      period, send SIGTERM, wait, escalate to SIGKILL, and await final process
      settlement. Own descendant processes with platform-appropriate process
      tree behavior. Unit tests must mock process operations and stay fast;
      packaged cross-platform signal-resistant fixtures belong in the release
      matrix rather than slow unit tests. Cover environment secret sentinels,
      PATH hijacking, concurrent close, already-exited children, each timeout
      stage, and cleanup. Run transport tests, lint, build, and type check.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: toolcraft-authority-boundary
    title: Add local authority and execution consent boundaries
    prompt: |
      Close MCP-047, MCP-068, and MCP-069 in packages/toolcraft/src/mcp-proxy.ts
      and the declarative MCP configuration types. Write failing tests first.
      Default to exposing no upstream tool to agents or the downstream MCP
      surface unless a per-origin allowlist explicitly grants it. Quarantine
      new, renamed, schema-changed, or task-upgraded tools until locally
      reviewed.

      Never derive local authority from upstream descriptions, annotations,
      instructions, prompts, logs, or result text. Apply a local approval
      policy, display upstream identity and exact arguments, strip terminal
      controls, and do not hard-code confirm false. Hide or reject tools whose
      execution.taskSupport is required until Toolcraft implements the complete
      task lifecycle; prove that no ordinary tools/call is sent for them.

      Before any proxy side effect, validate the complete proxy tree so one
      invalid group prevents cache access, logging, network, or spawn. Before
      stdio discovery or spawn, require first-run and config-change
      approval showing the complete command, arguments, cwd, and environment
      variable names. Bind approval to the normalized config and executable
      digest, prohibit shell interpolation, and pass the minimal environment
      and provenance policy to tiny-mcp-client. Interactive CLI must prompt for
      missing approval; --yes may accept the displayed safe defaults, while
      noninteractive SDK/MCP requires an injected policy. Keep configuration
      provider-neutral and declarative. Test approval/denial, changed tools,
      hostile text, control characters, and no-side-effect validation. If CLI
      presentation changes, inspect ad hoc screenshots; do not add screenshot
      tests. Run Toolcraft tests, lint, build, and type checks.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: http-bounds-and-contracts
    title: Bound HTTP work and enforce response contracts
    prompt: |
      Close MCP-019, MCP-020, MCP-022, MCP-023, and MCP-078 in
      packages/tiny-mcp-client. Write failing tests first and extract the HTTP
      transport and bounded response reader from internal.ts into focused
      modules.

      Compose caller and transport abort signals. Provide finite enabled
      defaults with validated ceilings for connection/header, total request,
      body read, long-lived SSE idle, shutdown, decoded bytes, JSON depth and
      item count, event size, queue size, and writable backpressure. Never rely
      only on Content-Length. Return typed timeout, abort, overload/rate-limit,
      protocol-contract, and size-limit errors after cancelling or draining
      every owned response body.

      Capture sessions only from valid initialize responses, validate session
      IDs, accept only exact allowed media types and parameters, and reject
      redirects or other inappropriate success statuses. Parse bounded
      Retry-After values and permit capped jittered retry only for classified
      safe discovery/list operations; never automatically replay arbitrary
      tool calls. Omit raw bodies from errors by default.

      Test just-under/over limits, deeply nested data, compressed expansion,
      slow/hung bodies, backpressure, invalid media/session/status values,
      body ownership, cancellation, 429 date/delta forms, and no mutating-call
      replay. Run tiny-mcp-client tests, lint, build, and type check.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: http-egress-policy
    title: Enforce endpoint, redirect, and SSRF policy
    prompt: |
      Close MCP-021 for every tiny-mcp-client HTTP request, including OAuth
      discovery and bearer retries. Write failing tests first. Accept only
      HTTP(S) URLs, reject credentials and fragments, require HTTPS for remote
      origins by default, and require explicit policy for plaintext loopback or
      private endpoints. Set redirect behavior to error and reject responses
      already marked redirected.

      Add one injectable egress-policy interface that is applied to the initial
      target, every resolved DNS address, and every attempted redirect hop.
      Cover private/reserved ranges, IPv4-mapped IPv6, DNS rebinding, origin
      changes, and TLS downgrade. A custom fetch must not silently bypass the
      policy; require a policy-enforcing adapter or fail closed. Do not forward
      Authorization, cookies, session IDs, custom secret headers, or request
      bodies across an origin boundary.

      Use deterministic fake DNS/fetch tests for allowed public addresses,
      blocked ranges, mixed answers, rebinding, custom-fetch bypass,
      cross-origin redirects, and downgrade. Run tiny-mcp-client and OAuth
      tests, lint, build, and type checks.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: stable-protocol-negotiation
    title: Negotiate the release-time stable MCP revision
    prompt: |
      Close MCP-001, MCP-002, and the implementation part of MCP-082 in
      packages/tiny-mcp-client. Before changing code, verify the official MCP
      versioning page and identify the latest final stable revision; the audit
      baseline is 2025-11-25 and a release candidate must not be treated as
      stable early.

      Write failing tests first. Replace the single hard-coded version with a
      small reviewed supported-version policy, offer the current stable version,
      accept only explicitly supported server selections, and expose/store the
      negotiated revision. Initialize requests omit MCP-Protocol-Version; every
      post-initialize HTTP POST, GET, and DELETE includes the negotiated value
      even for stateless servers. Review 2025-06-18 and 2025-03-26 as possible
      fallbacks, but support one only when its behavior is implemented and
      conformance-covered. Do not use provider-specific branches.

      Cover current-stable negotiation, each deliberately supported fallback,
      unknown/future selections, stateless and session HTTP requests,
      reconnects, and defensive state ownership. Run the pinned official
      initialize/lifecycle scenarios plus tiny-mcp-client tests, lint, build,
      and type check.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: sse-resumption-and-isolation
    title: Implement conformant SSE retry and per-stream state
    prompt: |
      Close MCP-004 and MCP-005 in packages/tiny-mcp-client. Write failing tests
      first, extract the SSE parser/state machine from internal.ts, and use the
      official current-stable SSE retry scenario as a regression fixture.

      Parse retry fields, cap them, and wait the advertised bounded delay
      before reconnecting. Resume interrupted POST-originated streams through
      GET with the correct Last-Event-ID. Track retry and cursor state per
      originating stream so concurrent GET/POST streams cannot exchange state,
      and classify transient versus terminal failures without hanging the
      original request.

      Recompact multi-data-line JSON events before newline-framed internal
      delivery, discard incomplete EOF events, and distinguish no event ID from
      an explicit ID reset. Test retry timing with fake timers, POST-to-GET
      resumption, Last-Event-ID, two concurrent streams, multi-line events,
      empty/reset IDs, partial EOF, cancellation, limits, and final cleanup.
      Run transport tests plus the pinned official scenario, lint, build, and
      type check.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: client-session-close-lifecycle
    title: Recover sessions and own client close lifecycle
    prompt: |
      Close MCP-003, MCP-024, and MCP-026 in packages/tiny-mcp-client. Write
      failing state-machine tests first. A session-scoped 404 must surface a
      typed session-expired outcome, establish a fresh initialized session,
      and reject the triggering operation without blindly replaying a possibly
      mutating request.

      Make client, HTTP transport, and message-layer disposal idempotent and
      awaitable. Concurrent callers must share one close promise that includes
      bounded session DELETE, reader/body cancellation, message settlement, and
      transport completion, and exposes the close outcome. During failed
      initialization, detach state in finally, preserve the original initialize
      error, await bounded cleanup, and reject reconnect while close is active.

      Test session expiry during list and mutating calls, reinitialization
      failure, concurrent close/connect, DELETE timeout/error, transport sync
      throw/async reject, and no leaked readers or pending requests. Replace
      stale tests that expect close-on-404 or fire-and-forget cleanup. Run
      focused client/transport tests, lint, build, and type check.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: request-cancellation-and-notifications
    title: Unify request controls and bound notification delivery
    prompt: |
      Close MCP-016, MCP-017, MCP-018, and MCP-071 in
      packages/tiny-mcp-client. Write failing tests first and keep message-layer
      logic in a focused module rather than growing internal.ts.

      Use one public request-options type for every operation with AbortSignal,
      per-request timeout, and progress where legal. Track active outgoing IDs,
      forbid cancellation of unknown/completed/initialize requests, propagate
      downstream cancellation, and give incoming host handlers a signal that
      stops work and resource ownership when the peer cancels.

      Dispatch user notifications through a bounded, ordered, failure-isolated
      queue so slow callbacks do not block response correlation; keep protocol
      cancellation control synchronous. Preserve valid resources/updated
      notifications for subscribed child resources using scheme-aware URI
      boundaries, never a raw string prefix. Test callback floods, slow/throwing
      callbacks, queue overflow, cancellation/close races, timeout cleanup,
      exact/child/sibling/traversal/encoding URIs, and unsubscribe. Run focused
      tests, lint, build, and type check.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: strict-json-rpc-and-utf8
    title: Enforce stable JSON-RPC and UTF-8 invariants
    prompt: |
      Close MCP-006, MCP-007, MCP-008, MCP-015, MCP-070, and the stale-test
      portion of MCP-067 in packages/tiny-mcp-client. Write failing tests first
      and extract JSON-RPC parsing/dispatch and byte decoding from internal.ts.

      Reject wire arrays for the current stable MCP revision. Require numeric
      IDs and error codes to be safe integers, guard the outgoing counter
      before overflow/collision, preserve string IDs, and deterministically
      reject duplicate active incoming or outgoing IDs. Use fatal streaming
      UTF-8 decoders while still accepting valid multibyte sequences split
      across chunks.

      Validate incoming params before host callbacks, preserve explicit safe
      McpError code/data, and replace unexpected local exception text with a
      generic peer-facing internal error. Enforce unique active progress
      tokens, safe token values, finite monotonically increasing progress,
      completion/cancellation lifetime, and bounded notification rate.
      Test batches, malformed/split UTF-8, unsafe IDs/codes, duplicate IDs,
      counter exhaustion, invalid handler params, secret-bearing exceptions,
      duplicate/decreasing/non-finite progress, and cleanup. Run focused tests,
      lint, build, and type check.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: stable-schema-and-result-validation
    title: Align public types and validation with the stable schema
    prompt: |
      Close MCP-009, MCP-010, MCP-011, MCP-012, MCP-013, MCP-014, MCP-027, and
      the schema-fixture part of MCP-065 in packages/tiny-mcp-client. Write
      failing compile and runtime fixtures first. Move protocol types and
      validators out of internal.ts and reconcile them with the authoritative
      schema for the release-time stable revision.

      Include implementation metadata, titles/icons/annotations, _meta, tool
      execution/task fields, resource_link and current content variants,
      sampling tool-use/result variants, and stable schema fields. Validate
      every public request/result union, tool descriptor, prompt, resource,
      pagination/completion numeric field, and mutually exclusive content
      shape. Keep unsupported optional capabilities explicit rather than
      loosely casting them.

      Derive advertised known capabilities from installed handlers, reject
      contradictory options, and enforce peer capabilities in both directions.
      Retain each tool outputSchema and validate structuredContent with the
      existing full JSON Schema compiler instead of another partial validator.
      Deep-clone validated negotiated metadata at ownership boundaries.
      Differential fixtures must cover every authoritative union plus negative
      cases and compile-time API parity. Run schema/compile/client tests, lint,
      build, and type check.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: host-capability-safety
    title: Enforce host safety for optional MCP capabilities
    prompt: |
      Close the production-safety scope of MCP-012, MCP-072, and MCP-073 in
      packages/tiny-mcp-client. Write failing tests first. Roots may expose only
      user-approved canonical file URIs inside configured permission
      boundaries. Sampling must require a host review/edit/deny policy with
      server attribution, model/cost/rate/data controls, bounded input/output,
      and cancellation.

      Keep elicitation and experimental tasks unadvertised unless their complete
      runtime and approval policies are implemented. If elicitation is enabled,
      require field/target review, decline/cancel, secret restrictions, and
      explicit consent before URL navigation; never auto-fetch or auto-open a
      URL. Future icons, resource links, content URIs, and external schema
      references remain opaque unless a separate untrusted-URI policy approves
      scheme/origin and applies no ambient auth, redirect, MIME, byte,
      dimension/frame, and active-SVG protections.

      Test root traversal/symlinks/encoding, denied sampling, budget/rate limits,
      absent-handler capability advertisements, malicious elicitation targets,
      and that embedded URIs or external refs cause no network/file access.
      Keep optional features independent and avoid speculative boilerplate.
      Run focused tests, lint, build, and type check.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: oauth-scope-and-client-auth
    title: Complete OAuth scopes, client auth, and recovery
    prompt: |
      Close MCP-032, MCP-033, MCP-037, MCP-043, and the refresh-policy portion
      of MCP-044 in packages/mcp-oauth and packages/tiny-mcp-client. Write
      failing tests first and use the official stable authorization scenarios.

      Select scopes in the specified order from an actionable challenge,
      explicit configuration, and protected-resource metadata; persist granted
      scopes and support bounded 403 insufficient_scope step-up. If a cached
      bearer token was presented, allow one recovery on a bare 401, then fail
      deterministically.

      Negotiate and persist none, client_secret_basic, and client_secret_post
      from metadata/registration. Encode Basic credentials correctly and never
      duplicate a secret in the form body. Validate dynamic registration
      responses, client-secret expiry, registration lifecycle, and safe
      re-registration. Model Client ID Metadata Documents explicitly with the
      reviewed preregistration/CIMD/DCR preference. Apply a proactive expiry
      window and do not retry an ambiguous refresh response with the same
      rotating token.

      Cover scope precedence/union/retry cap, bare 401, 403 step-up, every token
      auth method, secret expiry, preregistration, CIMD, DCR, and ambiguous
      refresh. Run focused OAuth/client tests, pinned auth conformance, lint,
      build, and type checks.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: toolcraft-runtime-oauth-parity
    title: Wire provider-neutral OAuth through every Toolcraft surface
    prompt: |
      Close MCP-046, MCP-053, MCP-079, and MCP-080 in
      packages/agent-mcp-config and packages/toolcraft/src/mcp-proxy.ts,
      index.ts, sdk.ts, cli.ts, and mcp.ts. Write failing parity tests first.

      Add one declarative, provider-neutral runtime OAuth configuration and
      provider resolver shared by discovery and lazy connections. Secrets,
      tokens, providers, fetch implementations, and approval callbacks are
      runtime-only and must never enter serialized agent config, cache,
      fingerprints, command trees, or reports. Adding a provider must require
      one provider/config file and no provider-specific if/case branches.

      Define one validated runtime-options object for fetch, egress policy,
      environment, logger/observer, OAuth, deadlines, and teardown. Validate
      the complete MCP config before filesystem, network, or spawn side effects:
      reject unknown transports/fields, blank commands, invalid URLs,
      malformed headers/env, duplicates, oversized arrays, and missing
      allowlisted tools. Make CLI use the SDK path and prove identical behavior
      in CLI, SDK, and downstream MCP entrypoints.

      Send a stable non-sensitive default client name and the actual packaged
      Toolcraft version, not group aliases or 0.0.1. Test runtime parity,
      secret absence, no-side-effect failures, injected dependencies, and
      packed identity. Inspect screenshots for any changed CLI UI; do not add
      screenshot tests. Run Toolcraft/agent-mcp-config tests, lint, builds, and
      type checks.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: proxy-discovery-and-cache-bounds
    title: Bound proxy discovery and harden caches
    prompt: |
      Close MCP-048, MCP-050, MCP-051, and MCP-055 in
      packages/toolcraft/src/mcp-proxy.ts. Write failing tests first and use
      memfs for every cache test.

      Bound pages, tools, aggregate schema bytes, cursor length, repeated
      cursors, duplicate tool names, and concurrent proxy dials. Fail with
      deterministic diagnostics on cycles or limits. Apply the explicit
      allowlist before persistence and store only fields required to rebuild
      commands; cache identity must exclude secrets while still distinguishing
      canonical hierarchical proxy paths.

      Use 0700 directories and 0600 files, bounded reads, exact schema and
      version validation, and a checked-in source at
      docs/schemas/toolcraft/mcp-proxy.schema.json. Make writes atomic and
      collision-safe and surface explicit corruption errors. Add TTL/refresh
      and offline policy, subscribe to onToolsChanged for invalidation,
      quarantine changed tools, and support deliberate cache migrations.
      Safely honor typed bounded Retry-After only for discovery/list retries
      within the shared deadline; never retry tool calls. Ensure .toolcraft
      cache artifacts cannot be committed accidentally without overwriting
      unrelated ignore rules.

      Cover pagination cycles/limits, many proxies, duplicate names, oversized,
      corrupt, and prototype-polluted caches, same-leaf nested groups,
      concurrent writers, TTL, list-change invalidation, offline behavior,
      retry cancellation/budget exhaustion, migrations, permissions, and
      secret sentinels. Run focused Toolcraft tests, lint, build, and type check.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: proxy-lifecycle-and-cancellation
    title: Own proxy lifecycle, cancellation, and late dials
    prompt: |
      Close MCP-049 and MCP-056 in packages/toolcraft. Write failing tests
      first. Replace unowned global shutdown state with an explicit idempotent
      runtime/disposable returned through the core resolver and owned by CLI,
      SDK, and downstream MCP entrypoints.

      Drain every connection on normal completion, error, signal, and shutdown.
      Use a generation token so a dial that resolves after refresh/dispose is
      closed instead of installed. Share concurrent disposal, bound it, and
      expose outcomes without leaking raw upstream diagnostics. Thread
      AbortSignal and per-call deadlines from downstream MCP, SDK, and CLI
      handlers through Toolcraft to tiny-mcp-client while preserving MCP
      cancellation legality.

      Test late successful/failed dials, refresh races, concurrent dispose,
      process shutdown ownership, cancelled calls, timeouts, and that no client,
      reader, or stdio child remains referenced. Unit tests must stay
      in-memory/fast; real process exit belongs to packaged matrix validation.
      Run Toolcraft tests, lint, build, and type checks.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: proxy-result-semantics-and-schema
    title: Preserve MCP results and JSON Schema semantics
    prompt: |
      Close MCP-052 and MCP-054 in packages/toolcraft/src/mcp-proxy.ts,
      json-schema-converter.ts, and the downstream MCP adapter. Write failing
      integration fixtures first.

      Preserve isError, structuredContent, text/image/audio/resource and
      resource-link content blocks, annotations, _meta, icons, and execution
      metadata end to end instead of nesting or JSON-stringifying an upstream
      CallToolResult. When outputSchema exists, validate structuredContent
      without discarding content; when absent, retain the native result
      semantics across CLI, SDK, and downstream MCP boundaries.

      Replace the partial JSON Schema 2020-12 conversion with the existing
      proven compiler/conversion package, extending that package only when
      authoritative fixtures expose a gap. Honor explicit $schema, valid union
      and composition keywords, object and non-object branches, depth/work
      limits, and local refs. Never auto-fetch an external $ref; reject
      unsupported dialects explicitly without silently dropping constraints.

      Test every stable content/result variant, error results, output schema
      success/failure, unions/compositions/refs, unsupported dialects, external
      refs, and parity through low-level, Toolcraft command, SDK, and downstream
      MCP paths. Run Toolcraft and schema-package tests, lint, builds, and type
      checks.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: structured-mcp-observability
    title: Add safe structured MCP observability
    prompt: |
      Close the observability portion of MCP-028 and MCP-057 after behavioral
      hardening. Keep observer logic in focused modules within
      packages/tiny-mcp-client and packages/toolcraft rather than returning it
      to internal.ts or mcp-proxy.ts.

      Write failing tests first, then add injectable structured observers for
      request status/latency, reconnect, session, OAuth stage, limit/retry,
      cache hit/miss, discovery page/count, proxy call, and shutdown. Use
      correlation IDs, data minimization, and the shared redaction policy.
      Dispatch through a bounded, non-blocking, failure-isolated mechanism;
      observer slowness or failure must never change protocol behavior.

      Assert no secrets, session IDs, custom secret headers, MCP values, full
      URIs/paths, stderr, or raw errors reach events; cover slow/throwing
      observers and overflow. Run all tiny-mcp-client, mcp-oauth, and Toolcraft
      tests plus targeted lint, builds, and type checks.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: stable-conformance-release-gate
    title: Gate releases on stable MCP conformance
    prompt: |
      Close MCP-059, the automation portion of MCP-065, MCP-067, MCP-076, and
      the release check in MCP-082. Pin a reviewed
      @modelcontextprotocol/conformance version and explicit stable spec
      revision in repository tooling; do not rely on an unpinned npx download.
      Check in the client adapter and deterministic fixtures as test
      infrastructure, not as a QA script.

      Maintain a complete inventory of applicable core, authorization, and
      deliberately supported backcompat scenarios. Require zero unexpected
      failures and warnings, retain machine-readable results as CI artifacts,
      and classify tests as current normative, compatibility, security
      regression, or implementation detail. Replace expectations for batch
      acceptance, close-on-session-404, immediate SIGTERM, and permissive HTTP
      behavior.

      Update the Toolcraft release workflow so the exact release SHA must pass
      unit tests, ESLint, types, adversarial security tests, packaged runtime,
      privacy checks, and the full conformance inventory before publish.
      workflow_dispatch must run the identical immutable gates. Do not write
      unit tests for workflow YAML; run npm run lint:workflows. Also run the
      focused suites locally and verify the retained result artifact contains
      no credentials or private content.
    status:
      implement: open
      test: open
      commit: open

  - id: exact-artifact-platform-gate
    title: Publish one verified artifact across supported platforms
    prompt: |
      Close MCP-077 and MCP-081 in .github/workflows/release-toolcraft.yml and
      the package smoke tooling. Pack Toolcraft exactly once, then inspect,
      install-smoke, signature-check, vulnerability-scan, generate an SBOM,
      hash, attest, and publish that exact tarball file. Retain its digest and
      attestations. Pin action revisions and release tooling immutably.

      Add packaged local-only HTTP, stdio, OAuth-loopback, storage, SSE,
      cancellation, and graceful-shutdown fixtures across the oldest and
      newest declared Node versions and every supported operating system.
      Either make the complete bundled dependency graph work on the declared
      engines or narrow the support policy consistently; do not leave
      Toolcraft and bundled tiny packages contradictory.

      Scan the exact tarball dependency graph rather than treating a workspace
      audit as proof of shipped contents. Keep fixtures fast and deterministic,
      with no live credentials or external MCP dependency. Do not write unit
      tests for GitHub workflow YAML; validate with npm run lint:workflows and
      exercise the existing package smoke commands locally where supported.
    status:
      implement: open
      test: open
      commit: open

  - id: privacy-safe-interop-qa
    title: Re-run production paths under a privacy-safe QA plan
    prompt: |
      Close MCP-061 and MCP-064 and refresh the evidence represented by
      MCP-060, MCP-062, MCP-063, and MCP-083 after hardening. Update
      packages/toolcraft/QA-mcp-proxy.md as a markdown-only manual QA plan; do
      not create a TypeScript, JavaScript, or shell QA script.

      The plan must define fixed endpoint/tool allowlists, public-only inputs,
      secret and private-content sentinels, retained-output schema, isolated
      state, deadlines/limits, exact-origin policy, cleanup, git-status review,
      artifact scanning, and explicit consent checkpoints. Exercise low-level
      client, core proxy, public SDK, downstream MCP server, packed CLI,
      human-rendered terminal output, owned shutdown, and non-text/native MCP
      results. Inspect screenshots for affected CLI output; do not add
      screenshot tests.

      Repeat Notion only with fresh explicit user consent and discard all
      response data. Run Asana only with fresh consent plus a disposable app,
      workspace, exact callback, and securely supplied credentials. Do not
      attempt Figma registration or OAuth until Figma approves this client;
      after approval require fresh consent and only the approved identity/read
      boundary. Missing consent, credentials, or provider approval is a real
      external gate: record it and leave that exit criterion open rather than
      weakening the procedure. Retain only allowlisted aggregate evidence.
    status:
      implement: open
      test: open
      commit: open

  - id: public-api-documentation
    title: Reconcile MCP public API and package documentation
    prompt: |
      Close MCP-045 and MCP-066 only after the hardened behavior and public API
      are stable. Reconcile tiny-mcp-client exports/examples and mcp-oauth
      option names, then document the supported stable revision and fallbacks,
      capabilities, security/egress policy, deadlines/limits, cancellation,
      reconnection, shutdown, OAuth discovery/storage/callback/consent/logout,
      Toolcraft runtime parity, cache/approval behavior, and every exposed
      environment variable and config option.

      README edits require explicit user permission under repository policy.
      This plan-creation request does not grant it. If that permission has not
      been given when this task runs, do not edit a README and do not mark the
      documentation exit criterion complete; report the exact files/sections
      still needed. When permission exists, keep each package README scoped to
      its own API and avoid provider-specific boilerplate.

      Compile or execute every code example, run package lint/type checks, and
      verify help/output screenshots for any user-visible CLI documentation
      change. Do not add screenshot tests.
    status:
      implement: open
      test: open
      commit: open

  - id: release-production-hardened-client
    title: Release only after every production gate passes
    prompt: |
      This task is authorized only when the user explicitly requests the push
      and release. Recheck the official MCP versioning page immediately before
      release and rebaseline schema, lifecycle, authorization, security, and
      the full conformance matrix if the latest final stable revision changed.
      Do not advertise a release candidate as stable.

      Require every Critical finding and normative High finding in MCP-001
      through MCP-083 to be closed, the complete pinned conformance inventory
      to have zero unexpected failures/warnings, privacy-safe production-path
      QA to pass, and the exact tarball/platform gates to pass. Run the full
      relevant unit, lint, type, build, packaged smoke, conformance, adversarial,
      and workflow-lint commands. Verify the worktree contains no ignored
      artifact, credential, private response, or uncommitted relevant plan.

      Commit only the specific files changed using Conventional Commits and
      never bypass hooks. Push main without creating a branch; publication
      happens only in GitHub Actions, never locally. Monitor every build and
      release job to completion, diagnose and fix failures, and verify the
      registry package/version, provenance, and digest match the tested
      tarball before calling the release successful.
    status:
      test: open
      release: open
---

# MCP Client Production-Hardening Issue Register

## Audit record

- Audit date: 2026-07-17
- Audited commit: `27cd2371b90a7943a9444acbc04e6f3791b99c74` on `main`
- Scope: `packages/tiny-mcp-client`, `packages/mcp-oauth`, the Toolcraft MCP proxy path, relevant storage/error-reporting code, and existing tests
- Stable protocol target: MCP `2025-11-25`
- Conformance runner: `@modelcontextprotocol/conformance@0.1.16` (current registry release on the audit date)
- Change policy for this audit: documentation and testing only
- Source-code result: **no product or test source was changed by this audit**
- Tracked-worktree result: the only change produced by this audit is this `docs/issues` document; unrelated worktree changes, ignored build output, and temporary `/tmp` harnesses are outside this record

## Executive verdict

The baseline client is useful and interoperable with several real servers, but it is **not production-grade and does not implement the latest stable MCP revision**.

The strongest positive evidence is practical interoperability: the force-rebuilt low-level client, Toolcraft's core proxy resolver/handler path, public SDK, in-memory downstream MCP server surface, and in-process public `runCLI` path each completed one fixed public-only call against Microsoft Learn, DeepWiki, and Cloudflare Docs. A sanitized local run against the official Everything reference server also succeeded. With explicit consent, two one-shot Notion dynamic OAuth sessions passed three read-only tools plus resource and resource-template listing while all returned data was discarded; prompts were not advertised. Existing MCP/OAuth tests, builds, lint, and type checks are green.

The strongest negative evidence is official conformance and security review:

- the client offers and accepts only MCP `2025-03-26`;
- the full pinned `2025-11-25` suite records 148 passed checks, 23 failures, and 4 warnings across 18 scenarios; only 7 scenarios are clean;
- the initialize scenario fails on version mismatch;
- SSE retry/resumption conformance fails; the optional elicitation coverage scenario also fails because that capability is not implemented;
- the stable authorization suite records 146 passed checks, 15 failures, and 3 warnings, with only 6 of 14 scenarios clean;
- a fresh authorization-server challenge can combine a stored refresh token/client secret with a different authorization server;
- credential-bearing POST redirects are followed by default;
- HTTP, OAuth, parsing, pagination, and callback paths have important missing deadlines and resource limits;
- configured stdio servers spawn during discovery without a first-run approval boundary and inherit ambient environment/executable resolution;
- proxied tools default to broad exposure and hard-code `confirm: false`, so upstream descriptions/annotations are not separated from local authority;
- Toolcraft does not expose any OAuth path, so Notion and Asana cannot be exercised through the production-facing proxy API;
- publication is not gated on the full production/conformance set for the exact release SHA or exact published tarball.

Release recommendation: do not describe this client as latest-spec or production-grade until all Critical findings, all normative High findings, and the conformance gates in this document are closed.

## Specification and standards baseline

As of the audit date, MCP `2025-11-25` is the latest stable revision. The announced `2026-07-28` revision is a release candidate and must not be advertised as stable before its release.

Primary sources:

- [MCP versioning](https://modelcontextprotocol.io/docs/learn/versioning)
- [MCP 2026-07-28 release candidate announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- [MCP 2025-11-25 lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
- [MCP 2025-11-25 transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP 2025-11-25 authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP 2025-11-25 schema](https://modelcontextprotocol.io/specification/2025-11-25/schema)
- [MCP cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation)
- [MCP progress](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress)
- [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)
- [MCP roots](https://modelcontextprotocol.io/specification/2025-11-25/client/roots)
- [MCP sampling](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling)
- [MCP elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
- [MCP tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
- [MCP security best practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- [Official MCP conformance suite](https://github.com/modelcontextprotocol/conformance)
- [RFC 9728: OAuth Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
- [RFC 8414: Authorization Server Metadata](https://datatracker.ietf.org/doc/html/rfc8414)
- [RFC 7591: Dynamic Client Registration](https://datatracker.ietf.org/doc/html/rfc7591)
- [RFC 6749: OAuth 2.0](https://datatracker.ietf.org/doc/html/rfc6749)
- [RFC 8252: OAuth for Native Apps](https://datatracker.ietf.org/doc/html/rfc8252)
- [RFC 9700: OAuth Security Best Current Practice](https://datatracker.ietf.org/doc/html/rfc9700)
- [RFC 9110: HTTP Semantics](https://datatracker.ietf.org/doc/html/rfc9110)
- [WHATWG Fetch redirect behavior](https://fetch.spec.whatwg.org/#http-redirect-fetch)
- [WHATWG server-sent events processing](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [Notion MCP client guide](https://developers.notion.com/guides/mcp/build-mcp-client)
- [Notion MCP supported tools](https://developers.notion.com/guides/mcp/mcp-supported-tools)
- [Asana MCP integration guide](https://developers.asana.com/docs/integrating-with-asanas-mcp-server)
- [Asana V2 client and callback guide](https://developers.asana.com/jd/docs/connecting-mcp-clients-to-asanas-v2-server)
- [Asana MCP tools reference](https://developers.asana.com/jd/docs/mcp-tools-reference)
- [Figma MCP introduction](https://developers.figma.com/docs/figma-mcp-server/)
- [Figma MCP Catalog](https://www.figma.com/mcp-catalog/)
- [Figma remote MCP setup](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/)
- [Figma MCP tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)

## Severity and status

- **Critical**: plausible credential disclosure, uncontrolled memory/network exhaustion, or a central normative failure that makes the advertised production boundary unsafe.
- **High**: release blocker, common interoperability failure, lifecycle leak, or significant protocol/security requirement.
- **Medium**: important correctness, maintainability, operability, or optional-feature gap.
- **Low**: contained documentation or developer-experience improvement.
- **N/A**: verification evidence rather than an unresolved risk.

Statuses used below:

- **Open — observed**: confirmed by source inspection or a focused baseline test.
- **Open — conformance failure**: confirmed by the official conformance suite.
- **Verified baseline pass**: passed against the unmodified audited source; this does not imply production readiness.
- **Partially verified**: the named core path passed, but adjacent public entrypoints or lifecycle behavior remain unverified.
- **Pending user OAuth**: public metadata was checked, but authorization requires explicit user consent or credentials.
- **External access gate**: public interoperability was checked as far as possible, but the service does not admit this client without provider approval.
- **Improvement**: not currently a normative violation because the capability is not advertised, but required for a complete production surface.

## Verification snapshot

| Gate                          | Baseline result                                      | Interpretation                                                                                            |
| ----------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| MCP/OAuth unit tests          | 16 files, 423/423 passed                             | Existing behavior is internally consistent; coverage omits many findings below                            |
| Tiny transport tests          | 209/209 passed                                       | Several tests encode stale behavior such as batch acceptance, immediate SIGTERM, and close-on-session-404 |
| Toolcraft tests               | 49 files, 612/612 passed                             | No production OAuth, cyclic pagination, required-task, or owned-shutdown coverage                         |
| Builds                        | Forced Toolcraft dependency build passed 67/67 tasks | Compile success only; ignored artifacts were hashed in the evidence ledger                                |
| ESLint                        | MCP/OAuth/Toolcraft sources passed                   | Static style gate only                                                                                    |
| Type checks                   | MCP/OAuth/Toolcraft package checks passed            | Exported types are still older than the stable schema                                                     |
| Official full stable suite    | 148 passed, 23 failed, 4 warnings                    | 18 scenarios; only 7 were clean                                                                           |
| Official initialize           | 0/1; failed                                          | Expected `2025-11-25`, client offered `2025-03-26`                                                        |
| Official tools call           | 1/1 passed                                           | Basic tool flow remains compatible                                                                        |
| Official SSE retry            | 1/2 passed, 1 warning; client timed out              | Retry timing failed; `Last-Event-ID` warning; response never completed                                    |
| Official elicitation defaults | 0/6 passed                                           | Optional capability is not implemented; this is a coverage gap, not a violation while unadvertised        |
| Official stable auth suite    | 146 passed, 15 failed, 3 warnings                    | Only 6/14 scenarios were clean                                                                            |
| Official legacy auth fallback | 0/7 passed checks across 2 scenarios                 | Both `2025-03-26` compatibility scenarios stopped after path-PRM 404                                      |
| Public no-auth remotes        | 3/3 across all five exercised paths                  | Low-level negotiation was `2025-03-26`; passing calls do not establish current-spec compliance            |
| Sanitized Everything server   | Passed                                               | 13 tools and synthetic echo; package `2026.7.4`, server identity version `2.0.0`                          |
| Notion/Asana/Figma discovery  | 3/3 passed                                           | Public metadata only; authenticated Notion evidence is recorded separately                                |
| Notion live OAuth             | Passed low-level                                     | 3 read-only tools plus resource/template listing passed; prompts not advertised; all responses discarded  |

## Objective coverage

| Requested outcome                      | Current evidence                                                                                        | State                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Audit against the latest specification | Current stable sources, full pinned conformance matrix, source/security review                          | Documented against `2025-11-25`             |
| Test popular unauthenticated MCPs      | Three representative hosted public endpoints on five paths; local official Everything server            | Verified baseline pass; popularity unranked |
| Do not leak local or remote data       | Fixed public inputs; no intentional local context; only aggregate metadata/status retained              | Bounded by design; sentinel gate pending    |
| Test Notion OAuth                      | Two consented dynamic sessions; 3 read-only tools and advertised resource surfaces passed               | Verified low-level pass                     |
| Test Asana OAuth                       | Consent received and artifacts rebuilt; expected Keychain credentials are absent, so no browser opened  | Pending disposable credentials              |
| Test Figma OAuth                       | Public discovery passed; Figma admits only catalog-approved clients, and `poe-code` is not listed       | Externally blocked; no registration sent    |
| Create `docs/issues` hardening docs    | This register contains all 83 findings/verification records identified by this audit                    | Delivered                                   |
| Implement production fixes             | User clarified that this task is documentation, not remediation; this audit changed no source/test code | Intentionally outside this audit            |

## Retained evidence ledger

The following evidence run was repeated after a forced, uncached build from audited commit `27cd2371b90a7943a9444acbc04e6f3791b99c74`. The documentation-only working-tree change cannot affect these packages.

Toolchain:

- Node `v22.22.2`
- npm `10.9.7`
- Turbo `2.9.18`
- Vitest `3.2.6`
- `@modelcontextprotocol/conformance@0.1.16`

Forced-build artifacts (`SHA-256`):

| Artifact                                                     | SHA-256                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `tiny-mcp-client/dist/index.js`                              | `931433629210f38402ccd139e5d7dec7f357c940bfd46df15ae6d7994086e2b3` |
| `mcp-oauth/dist/index.js`                                    | `94b2311eee9b20579374dbc29858094b39788ee34e2b8be2a6640b3c8503e208` |
| `toolcraft/dist/index.js`                                    | `bd0f8d877d0407be549dc8c88f862cbdd531d36166051fd6246e8930a9ebfbf9` |
| 20 path-sorted, concatenated conformance `checks.json` files | `02f3bc0bc918cfc39d850e5aaeda187756821ee891d9c6b09f6963b790367a94` |

Temporary privacy harnesses (`SHA-256`; intentionally outside the repository):

| Harness                                   | SHA-256                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ |
| Low-level public HTTP interop             | `7d57cf39577621ec2da420c1e5195678115a41c214c61fd192cf55aadf4f7932` |
| Everything sanitized stdio interop        | `a3463b8f7508d04cb7f353a9d14de36510f8bb6dc8065391449e6d722d651c0c` |
| Toolcraft core/SDK/downstream-MCP interop | `a8fe922e094e7f45e72e8531f92f8ac22a37f6467719c2e1b5b1a8d3b7b78a2f` |
| Toolcraft in-process `runCLI` interop     | `5eb1cdb6c1433660d4b5457276a91ddbaad5b4d1f36c354b2f21960a96151f28` |
| Notion/Asana public OAuth metadata probe  | `8b8a3d36e1f8d286242f8b261fb182186eec332dbfea18ef96b020fec04c1d1c` |
| Notion live OAuth one-shot harness        | `5203c4f9514c31eb9d2c802382d759a01edab5e47e8e6184731942bf903ff712` |
| Notion authenticated surface harness      | `a4c173c7b2f3903366da1dde477ebe8cd33a3b8c18860f4c64ad147a18f88f81` |
| Figma public OAuth metadata probe         | `30868acebc98dc53bffc6e4619c9e386f5a996352779d856ca6bd7cdf89c21f4` |
| Official-conformance client adapter       | `7f7d1be3a5147ad6b8e17083fad828b50e6db1eec2ca1f3cdeb74963e7658e0d` |

Commands and sanitized outcomes:

- `npx turbo run build --filter=tiny-mcp-client... --filter=toolcraft... --force --output-logs=errors-only` → 67/67 tasks passed, 0 cached.
- `npx vitest run packages/tiny-mcp-client/src packages/mcp-oauth/src --reporter=dot` → 16 files, 423/423 tests passed.
- `npx vitest run packages/tiny-mcp-client/src/transports.test.ts --reporter=dot` → 1 file, 209/209 tests passed.
- `npx vitest run packages/toolcraft/src --reporter=dot` → 49 files, 612/612 tests passed.
- Targeted ESLint and all three package `tsc --noEmit` commands → exit 0.
- `conformance client --suite all --spec-version 2025-11-25` → expected nonzero exit; 148 passed checks, 23 failures, 4 warnings across 18 scenarios.
- The two named `2025-03-26` OAuth compatibility scenarios → expected nonzero exits; 0/4 and 0/3 checks passed.
- Low-level HTTP harness with fixed calls → Microsoft Learn, DeepWiki, and Cloudflare Docs each initialized, listed tools, and completed the allowlisted call.
- Sanitized Everything stdio harness → initialized, listed 13 tools, and completed synthetic echo.
- Toolcraft core, SDK, and in-memory downstream-MCP harness → 9/9 fixed calls passed.
- In-process public `runCLI` harness → 3/3 fixed JSON-mode calls exited 0; response payloads were counted and discarded before terminal output.
- Public OAuth metadata probe → Notion and Asana discovery both passed without browser authorization, credentials, or private data.
- Figma public OAuth metadata probe → the unauthenticated challenge and exact PRM passed; authorization server `https://api.figma.com`, DCR, scope `mcp:connect`, token auth basic/post, and S256 were advertised. No browser authorization, credential, or private data was involved.
- User-consented Notion OAuth harness → dynamic registration, authorization, bearer retry, initialization, first-page tool discovery, and `notion-fetch {"id":"self"}` passed; only the allowlisted summary was retained.
- Second consented Notion surface harness → `notion-fetch` self, `notion-get-users` self, `notion-get-teams`, `resources/list`, and `resources/templates/list` passed; `prompts` was not advertised. All returned data was discarded.

Evidence limitations:

- This binds observations to a forced build and hashes, but is not a clean-room reproducible-build attestation or installed npm artifact test.
- Temporary harnesses were deliberately kept outside the repository and deleted after the run because repository QA must be markdown. Their hashes identify the harness source content, not execution or outcomes, and do not replace a future checked-in privacy-safe manual QA procedure.
- `runCLI` was called in-process with an injected command tree/output emitter; downstream MCP used an in-memory test pair. Packed binary startup, real terminal rendering, and process-level shutdown remain unverified.
- Public tests used fixed inputs and aggregate output with isolated temporary caches, but no independent packet capture or local content/secret sentinel was retained. Privacy is bounded by design, not proven against every accidental egress path; MCP-064 remains open.
- Synthetic conformance machine files were reduced to counts/hash and removed from `/tmp`; the ledger is not a substitute for the future CI artifact required by MCP-059.

The three hosted targets were selected for representative vendor/community coverage, public no-auth availability, and operations confined to public documentation/repository data. No quantitative popularity ranking was performed.

## Review traceability map

This map shows the reviewed specification and production surfaces. It is evidence of systematic coverage, not proof that no additional defect exists.

| Reviewed surface                                       | Disposition in this register                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Versioning, initialization, capabilities, lifecycle    | MCP-001, MCP-002, MCP-009, MCP-026, MCP-027, MCP-059, MCP-082                        |
| JSON-RPC, IDs, cancellation, progress, notifications   | MCP-006 through MCP-008, MCP-015 through MCP-018, MCP-070                            |
| Streamable HTTP, SSE, sessions, redirects, bounds      | MCP-002 through MCP-005, MCP-019 through MCP-024, MCP-031, MCP-078                   |
| Stdio execution, environment, and shutdown             | MCP-025, MCP-058, MCP-069, MCP-075, MCP-081                                          |
| Tools, schema, content variants, result semantics      | MCP-010 through MCP-015, MCP-047, MCP-052, MCP-054, MCP-065, MCP-068, MCP-073        |
| Resources, prompts, completion, logging                | MCP-009, MCP-010, MCP-013, MCP-018, MCP-057, MCP-071 through MCP-073                 |
| Roots, sampling, elicitation, and experimental tasks   | MCP-009, MCP-011, MCP-012, MCP-015, MCP-047, MCP-070, MCP-072                        |
| OAuth discovery, registration, tokens, callback, store | MCP-029 through MCP-045, MCP-062, MCP-063, MCP-074, MCP-083                          |
| Toolcraft proxy configuration, cache, parity, teardown | MCP-046 through MCP-058, MCP-061, MCP-068, MCP-069, MCP-075, MCP-078 through MCP-081 |
| Privacy, diagnostics, release, supply chain, runtime   | MCP-019 through MCP-023, MCP-040, MCP-041, MCP-057, MCP-064, MCP-075 through MCP-083 |
| Official conformance and real-server interoperability  | MCP-059 through MCP-067                                                              |

## Register at a glance

| ID      | Severity | Status                     | Area                                                |
| ------- | -------- | -------------------------- | --------------------------------------------------- |
| MCP-001 | High     | Open — conformance failure | Stable protocol negotiation                         |
| MCP-002 | High     | Open — observed            | HTTP protocol-version header                        |
| MCP-003 | High     | Open — observed            | Session-expiration recovery                         |
| MCP-004 | High     | Open — conformance failure | SSE retry and resumption                            |
| MCP-005 | High     | Open — observed            | Per-stream SSE state and framing                    |
| MCP-006 | Medium   | Open — observed            | Removed JSON-RPC batching                           |
| MCP-007 | High     | Open — observed            | UTF-8 enforcement                                   |
| MCP-008 | Medium   | Open — observed            | Request IDs and error codes                         |
| MCP-009 | High     | Open — observed            | Capability honesty                                  |
| MCP-010 | Medium   | Open — observed            | Stable schema/type parity                           |
| MCP-011 | High     | Open — observed            | Current content variants                            |
| MCP-012 | Medium   | Improvement                | Elicitation, tasks, and sampling tools              |
| MCP-013 | High     | Open — observed            | Result validation                                   |
| MCP-014 | Medium   | Open — observed            | Structured tool output validation                   |
| MCP-015 | High     | Open — observed            | Incoming handler validation and errors              |
| MCP-016 | High     | Open — observed            | Cancellation ownership and propagation              |
| MCP-017 | Medium   | Open — observed            | Per-request timeout/cancellation API                |
| MCP-018 | High     | Open — observed            | Notification callback isolation and bounds          |
| MCP-019 | Critical | Open — observed            | Network and body deadlines                          |
| MCP-020 | Critical | Open — observed            | Input, event, body, and buffer limits               |
| MCP-021 | High     | Open — observed            | Endpoint, redirect, plaintext, and SSRF policy      |
| MCP-022 | High     | Open — observed            | HTTP/session/media contracts                        |
| MCP-023 | High     | Open — observed            | Response-body ownership and diagnostic leakage      |
| MCP-024 | High     | Open — observed            | Client/HTTP close completion                        |
| MCP-025 | High     | Open — observed            | Stdio shutdown sequence                             |
| MCP-026 | High     | Open — observed            | Initialization and concurrent-close cleanup         |
| MCP-027 | Medium   | Open — observed            | Defensive ownership of negotiated metadata          |
| MCP-028 | Medium   | Improvement                | Module boundaries and observability                 |
| MCP-029 | High     | Open — conformance failure | PRM/OIDC discovery candidates                       |
| MCP-030 | Critical | Open — observed            | Authorization-server/session binding                |
| MCP-031 | Critical | Open — observed            | Credential-bearing redirects                        |
| MCP-032 | High     | Open — conformance failure | Scope selection and 403 step-up                     |
| MCP-033 | High     | Open — conformance failure | Token endpoint authentication negotiation           |
| MCP-034 | High     | Open — observed            | Exact callback port/path                            |
| MCP-035 | Critical | Open — observed            | Loopback hostname validation                        |
| MCP-036 | Critical | Open — observed            | OAuth deadlines, body bounds, and candidate fan-out |
| MCP-037 | High     | Open — observed            | Bare-401 recovery                                   |
| MCP-038 | Critical | Open — observed            | Discovery-cache validation                          |
| MCP-039 | High     | Open — observed            | OAuth single-flight and session mutation races      |
| MCP-040 | Critical | Open — observed            | Token/session storage security                      |
| MCP-041 | Critical | Open — observed            | OAuth secret redaction and report permissions       |
| MCP-042 | Medium   | Open — observed            | Bearer parser, issuer, and resource identity        |
| MCP-043 | Medium   | Improvement                | Client ID Metadata Documents                        |
| MCP-044 | Medium   | Open — observed            | Callback lifecycle and refresh retry safety         |
| MCP-045 | Medium   | Open — observed            | OAuth public API/documentation drift                |
| MCP-046 | High     | Open — observed            | Toolcraft OAuth wiring                              |
| MCP-047 | High     | Open — observed            | Required-task tool handling                         |
| MCP-048 | High     | Open — observed            | Proxy pagination and discovery bounds               |
| MCP-049 | High     | Open — observed            | Proxy connection teardown and dial race             |
| MCP-050 | High     | Open — observed            | Proxy cache secrets, permissions, and minimization  |
| MCP-051 | High     | Open — observed            | Proxy cache freshness                               |
| MCP-052 | High     | Open — observed            | MCP-to-MCP semantic preservation                    |
| MCP-053 | High     | Open — observed            | CLI/SDK/MCP runtime parity                          |
| MCP-054 | High     | Open — observed            | JSON Schema 2020-12 conversion                      |
| MCP-055 | Medium   | Open — observed            | Cache validation, versioning, and collisions        |
| MCP-056 | Medium   | Open — observed            | Proxy cancellation and deadlines                    |
| MCP-057 | Medium   | Open — observed            | Proxy observability                                 |
| MCP-058 | High     | Open — observed            | Stdio environment/executable identity               |
| MCP-059 | High     | Open — conformance failure | Official conformance release gate                   |
| MCP-060 | N/A      | Verified baseline pass     | Public unauthenticated interoperability             |
| MCP-061 | High     | Partially verified         | Production-path interoperability gap                |
| MCP-062 | N/A      | Verified baseline pass     | Notion OAuth interoperability                       |
| MCP-063 | High     | Pending user OAuth         | Asana OAuth interoperability                        |
| MCP-064 | Medium   | Open — observed            | Repeatable privacy-safe live QA                     |
| MCP-065 | High     | Open — observed            | Automated stable-schema conformance                 |
| MCP-066 | Low      | Open — observed            | Public API and README completeness                  |
| MCP-067 | Medium   | Open — observed            | Tests that lock in stale behavior                   |
| MCP-068 | High     | Open — observed            | Tool trust, allowlisting, and approval              |
| MCP-069 | Critical | Open — observed            | Stdio execution consent and provenance              |
| MCP-070 | High     | Open — observed            | Progress-token and value invariants                 |
| MCP-071 | Medium   | Open — observed            | Sub-resource update notifications                   |
| MCP-072 | High     | Open — observed            | Roots, sampling, and elicitation host safety        |
| MCP-073 | High     | Improvement                | Untrusted icon/content/schema URIs                  |
| MCP-074 | High     | Open — observed            | OAuth authorization-server/browser consent          |
| MCP-075 | High     | Open — observed            | Diagnostic data minimization                        |
| MCP-076 | High     | Open — observed            | Same-SHA release gates                              |
| MCP-077 | Medium   | Open — observed            | Exact artifact, SBOM, and vulnerability gate        |
| MCP-078 | Medium   | Open — observed            | Rate-limit and safe-retry policy                    |
| MCP-079 | Medium   | Open — observed            | Runtime proxy-configuration validation              |
| MCP-080 | Medium   | Open — observed            | Remote client identity/version privacy              |
| MCP-081 | High     | Open — observed            | MCP runtime and platform compatibility matrix       |
| MCP-082 | High     | Improvement                | Release-time stable-spec rebaseline                 |
| MCP-083 | N/A      | External access gate       | Figma OAuth and catalog interoperability            |

## Protocol, transport, and lifecycle issues

### MCP-001 — Stable protocol negotiation

- Evidence: `packages/tiny-mcp-client/src/internal.ts:114,359-375` hard-codes `2025-03-26` and rejects every other server selection. Official initialize failed because the scenario expected `2025-11-25`.
- Risk: the client cannot claim latest stable MCP support and cannot selectively support compatible fallback revisions.
- Recommendation: offer `2025-11-25`, maintain an explicit reviewed supported-version set, store/expose the negotiated revision, and test current, fallback, and unknown selections.

### MCP-002 — `MCP-Protocol-Version` is missing for stateless HTTP

- Evidence: `internal.ts:2624-2652` sets the header only when a session ID exists and uses the hard-coded revision.
- Requirement: after initialization, every subsequent Streamable HTTP request must use the negotiated version header, with or without a session.
- Recommendation: pass the negotiated revision to the transport; assert initialize omits the header and later POST/GET/DELETE requests include it.

### MCP-003 — Session expiration closes instead of reinitializing

- Evidence: `internal.ts:2609-2612,2720-2723`; baseline tests explicitly expect closure on session-scoped 404.
- Requirement/risk: the transport requires fresh initialization after session expiration. A recovery layer must not blindly replay a possibly mutating request.
- Recommendation: surface a typed session-expired event, establish a new session, reject the triggering operation, and require explicit idempotency/retry policy before replay.

### MCP-004 — SSE retry and resumption are incomplete

- Evidence: `internal.ts:2618-2620,2682-2689,2710-2744,2822-2859,3050-3160`; `retry` is ignored, reconnect is immediate, POST-originated streams are not resumed through GET, and transient failures terminate.
- Verification: official SSE retry recorded 1/2 passes, a retry-timing failure, a `Last-Event-ID` warning, and a timed-out `tools/call`.
- Recommendation: parse and cap `retry`, wait before reconnecting, resume through GET with the correct event ID, and use the official SSE scenario as the regression gate.

### MCP-005 — SSE state/framing is not isolated or fully conformant

- Evidence: `internal.ts:2483-2485,2642-2644,2843-2855` uses one global event ID for concurrent GET/POST streams. `writeSseMessages` injects multi-line event data into a newline-framed stream; `SseParser.flush()` emits an unterminated EOF event and empty IDs remain an empty header value.
- Risk: concurrent responses can exchange cursors; valid multi-`data:` JSON can split into invalid messages; reconnection can resume the wrong stream.
- Recommendation: track retry/cursor per originating stream, recompact each SSE JSON event before internal framing, discard incomplete EOF events, and distinguish “no ID” from an explicit ID reset.

### MCP-006 — Current MCP batches are accepted

- Evidence: `internal.ts:3331-3363`; `transports.test.ts:1952-2145` locks in array dispatch.
- Risk: MCP `2025-11-25` removed batching and expects a single message per wire payload/POST body.
- Recommendation: reject arrays under the current revision; version-gate legacy behavior only if an actually supported older transport requires it.

### MCP-007 — Malformed UTF-8 is silently repaired

- Evidence: default non-fatal `TextDecoder` use at `internal.ts:2827-2855,3016-3043`.
- Risk: replacement characters can transform malformed wire bytes into a different JSON message instead of failing the transport.
- Recommendation: use fatal streaming decoders; test split valid multibyte sequences and invalid stdio/SSE byte sequences.

### MCP-008 — Numeric request IDs/error codes are too permissive

- Evidence: `internal.ts:3731-3732,3760-3769,3818-3825,3858-3864`; outgoing counter at `:3203,3261-3263`. A duplicate active incoming ID overwrites the first request at `:3496`.
- Risk: fractional, non-finite, or unsafe integers can lose correlation in JavaScript; the counter has no exhaustion guard; duplicate IDs can misroute cancellation/completion.
- Recommendation: require safe integers, preserve strings, fail before counter overflow/collision, and reject duplicate active incoming or outgoing IDs deterministically.

### MCP-009 — Advertised capabilities are not tied to implementations

- Evidence: `internal.ts:51-60,98-112,202-205,342-355,381-385` accepts caller-provided roots/sampling capabilities even when handlers are absent. Conversely, `notifications/message` is delivered at `:251-274` without checking that the server advertised `logging`.
- Risk: a server legitimately invokes an advertised method and receives method-not-found, or an unnegotiated peer feature reaches host code.
- Recommendation: derive known capability fields from installed handlers or reject contradictory construction options; enforce every capability/sub-capability in both directions and reject or isolate out-of-phase peer messages deterministically.

### MCP-010 — Exported types lag the stable schema

- Evidence: `internal.ts:46-95,692-910` omits current implementation metadata, titles/icons, annotations, `_meta`, tool execution, schema fields, and other fields in the stable schema; it also lacks the stable revision's experimental task types.
- Risk: callers cannot represent valid current messages, while loosely typed extension records hide unsupported behavior.
- Recommendation: reconcile public types and compile fixtures with the authoritative `2025-11-25` schema.

### MCP-011 — Valid current content variants are rejected

- Evidence: `internal.ts:759-781,3601-3615,3704-3721` lacks `resource_link`; current sampling tool-use/result variants are also absent.
- Risk: a conforming server can return a valid tool result that the client rejects as invalid.
- Recommendation: implement and validate stable content unions with metadata round-trip tests.

### MCP-012 — Optional and experimental features are absent

- Evidence: no form/URL elicitation, experimental tasks, sampling `tools`/`toolChoice`, `tool_use`, or `tool_result` surface exists.
- Status nuance: this is not itself a protocol violation while the client does not advertise these capabilities.
- Recommendation: implement features independently and advertise each only when its real runtime handler exists. Elicitation needs server attribution, review/decline/cancel, form-secret restrictions, target-domain display, and explicit consent before URL navigation; it must never auto-fetch or auto-open a URL.

### MCP-013 — Result validation is inconsistent

- Evidence: tool descriptors are not validated, prompt lists are blindly cast, resource content can contain both `text` and `blob`, and several pagination/completion numeric fields are unchecked (`internal.ts:412-425,593-605,3617-3620,3652-3658,3678-3695`).
- Risk: malformed upstream data becomes trusted application state or fails later in a less diagnosable layer.
- Recommendation: validate every public result against revision-appropriate schemas and add negative fixtures.

### MCP-014 — Structured tool output is not checked against `outputSchema`

- Evidence: `internal.ts:692-698,412-425,428-477` neither retains tool schemas nor validates `structuredContent`.
- Requirement level: clients should validate structured results when a tool declares an output schema.
- Recommendation: cache tool schemas by name and surface deterministic schema mismatch errors.

### MCP-015 — Incoming handler validation and error boundaries are unsafe

- Evidence: sampling params are cast, roots are not schema-validated, and handler `McpError` values are flattened (`internal.ts:202-205,381-385,3492-3529`). Generic local exception messages are returned to the peer.
- Risk: invalid server inputs reach host callbacks; local paths/secrets in exceptions can be disclosed remotely.
- Recommendation: validate request/result pairs, preserve explicit safe `McpError` code/data, and replace unexpected peer-facing messages with a generic internal error.

### MCP-016 — Cancellation ownership and propagation are incomplete

- Evidence: public `cancel()` can cite arbitrary IDs; incoming cancellation only suppresses the response and does not stop callback work (`internal.ts:647-655,3169-3187,3492-3558`).
- Recommendation: track active outgoing IDs, prohibit illegal initialize cancellation, expose `AbortSignal` to incoming handlers, and test resource cleanup and close/abort races.

### MCP-017 — Per-request controls are inconsistent

- Evidence: cancellation/progress options exist only for `callTool`; other methods use one global timeout (`internal.ts:3210-3223,3252-3298`).
- Recommendation: one request-options type should carry `signal`, timeout, progress where legal, and cancellation policy across all operations.

### MCP-018 — Notification callbacks can block or exhaust the protocol loop

- Evidence: `internal.ts:208-310,3425-3441` awaits user callbacks inside input consumption.
- Risk: a slow log/progress/list-change callback blocks later response correlation and can cause false timeouts. Simply detaching without a bound would permit callback-flood memory exhaustion.
- Recommendation: bounded, ordered, failure-isolated callback dispatch that keeps cancellation control messages synchronous.

### MCP-019 — Network and body deadlines are absent

- Evidence: `internal.ts:2582-2593,2603-2607,2822-2868`; message timeout does not abort its HTTP request, header fetches can hang, and body reads can stall after headers.
- Risk: one peer or custom fetch can hang connect, token exchange, a request, or shutdown indefinitely.
- Recommendation: compose caller/transport abort signals and enforce finite enabled defaults for total request, body-read, long-lived SSE idle, provider-hook, and shutdown deadlines. Validate configuration ranges/ceilings and return typed timeout/abort errors after cleanup.

### MCP-020 — Messages, events, bodies, and queues are unbounded

- Evidence: `internal.ts:2478-2479,2878-2884,3016-3043,3050-3160,3241,3292` buffers without byte/queue limits and ignores writable backpressure.
- Risk: memory exhaustion from a large line, SSE event, JSON/error body, callback flood, or slow downstream consumer.
- Recommendation: finite enabled byte/depth/item limits on decoded content, bounded queues/concurrency, reader cancellation, and backpressure-aware writing. Never trust `Content-Length` as the sole bound; validate configurable ceilings and test just-under, just-over, deeply nested, compressed-bomb, slow, and hung cases.

### MCP-021 — Endpoint and redirect policy is missing

- Evidence: `internal.ts:2492-2501,2582-2590,2655-2660,2702-2707,2756-2761,2891-2896` accepts arbitrary URLs and default-follow redirects.
- Risk: credentials/payloads can cross origins or downgrade to plaintext; server-side use creates SSRF/private-network exposure.
- Recommendation: allow HTTP(S) only, reject URL credentials/fragments, require remote HTTPS by default, reject redirects, and expose an injectable egress policy for controlled private endpoints. Apply it to every DNS answer and redirect hop, including IPv4-mapped IPv6/reserved ranges, and prevent DNS-rebinding/custom-fetch bypass through address pinning or an enforced egress proxy.

### MCP-022 — HTTP, session, and media-type contracts are permissive

- Evidence: `internal.ts:2664-2675,2751-2819`; session IDs are accepted from arbitrary POSTs without character/size validation, redirects/other `<400` statuses count as success, media types use substring matching, and missing content types can be silently ignored.
- Recommendation: capture sessions only from valid initialization responses, validate IDs, require exact media types with valid parameters, and fail invalid request/notification status combinations promptly.

### MCP-023 — Response bodies are abandoned or copied into errors

- Evidence: success/error/retry branches do not consistently cancel or drain bodies; raw DELETE/GET/POST error bodies are embedded at `internal.ts:2692-2707,2725-2731,2751-2761`.
- Risk: streaming bodies pin sockets; malicious response text enters logs/reports and may echo sensitive request data.
- Recommendation: define ownership for every response branch, cancel abandoned bodies, cap retained diagnostics, and omit raw bodies by default.

### MCP-024 — Client and HTTP close are not awaitable end-to-end

- Evidence: `internal.ts:672-689,2529-2564,2692-2707`; `close()` returns before session DELETE and transport closure, which themselves have no timeout.
- Recommendation: idempotent disposal promises, one shared concurrent-close completion, bounded DELETE, and explicit close outcome.

### MCP-025 — Stdio shutdown is not graceful or bounded

- Evidence: `internal.ts:2452-2467`; tests at `transports.test.ts:2783-2819` expect immediate SIGTERM.
- Recommendation: close stdin, wait a grace period, send SIGTERM, wait, escalate to SIGKILL, await/bound final process settlement, contain descendant processes with platform-appropriate process-tree ownership, and test a real signal-resistant child on every supported OS.

### MCP-026 — Initialization cleanup can replace the real error or race reuse

- Evidence: the `connect()` catch calls `transport.dispose()` before detaching, does not await it, and does not contain sync throws/async rejection (`internal.ts:390-404`). Concurrent `close()` can settle before transport cleanup.
- Recommendation: detach state in `finally`, preserve the initialize error, await bounded cleanup, and reject reconnect while close is active.

### MCP-027 — Negotiated metadata ownership is inconsistent

- Evidence: `serverInfo` is returned directly, stored with a shallow spread, and exposed without defensive cloning.
- Risk: nested current metadata such as icons would be aliased between returned and internal state once stable types are added.
- Recommendation: deep-clone validated negotiation state at ownership boundaries.

### MCP-028 — The implementation is a mega-module with little safe observability

- Evidence: `packages/tiny-mcp-client/src/internal.ts` mixes schema/types, client state, message layer, stdio, HTTP, SSE, OAuth integration, factories, and testing helpers.
- Recommendation: split by stable responsibility and add non-blocking structured observers for request/reconnect/session/OAuth/shutdown events with strict redaction.

## OAuth and authorization issues

### MCP-029 — Stable PRM/OIDC discovery candidates are incomplete

- Evidence: `oauth-discovery.ts:174-195,213-217,254-287` has only path PRM discovery and one RFC 8414 endpoint. It lacks root PRM fallback and OIDC candidates; exact endpoint-only resource matching rejects valid secure base resources.
- Verification: official stable metadata variants failed. Both official `2025-03-26` OAuth compatibility scenarios also failed (0/7 checks) because the client stopped after path-PRM 404 instead of continuing to authorization-server metadata. Current Notion, Asana, and challenge-directed Figma metadata happened to match the implemented discovery path.
- Recommendation: implement required candidate ordering, continue after invalid candidates, and bind base resources using same-origin path-segment boundaries.

### MCP-030 — Stored credentials can be sent to a different authorization server

- Evidence: `default-oauth-client-provider.ts:106-180` combines existing session refresh/client credentials with fresh discovery without comparing `session.authorizationServer`.
- Impact: a resource that changes or maliciously advertises AS-B can cause an AS-A refresh token/client secret to be posted to AS-B.
- Recommendation: make resource, issuer/AS, client registration, and credential identity one atomic session binding. Any identity change must clear credentials and require fresh authorization.

### MCP-031 — Credential-bearing redirects are followed

- Evidence: DCR/token/refresh/MCP POSTs omit `redirect: "error"` at `default-oauth-client-provider.ts:408-415`, `token-endpoint.ts:116-123`, and `internal.ts:2891-2896`.
- Impact: 307/308 redirects preserve POST bodies and can exfiltrate auth codes, PKCE verifier, refresh token, client secret, or MCP payload.
- Recommendation: reject redirects and custom `Response.redirected` values; test cross-origin and HTTPS-downgrade redirects.

### MCP-032 — Scope selection and 403 step-up are absent

- Evidence: challenge scope and PRM scopes are ignored (`default-oauth-client-provider.ts:72-90,710-743`); only 401 invokes the provider (`internal.ts:2764-2785`); 403 is terminal.
- Verification: scope-from-challenge/PRM emitted warnings and step-up failed in official conformance.
- Recommendation: challenge scope first, then explicit configuration/PRM fallback as specified; retain granted scopes, handle `insufficient_scope`, and cap repeated challenges.

### MCP-033 — Token endpoint authentication is not negotiated

- Evidence: `token-endpoint.ts:107-122` uses no client authentication when no secret exists and `client_secret_post` whenever one does; it never implements `client_secret_basic`. DCR requests `none` but does not persist the returned method or client-secret expiry/registration lifecycle metadata (`default-oauth-client-provider.ts:404-430,819-851`).
- Verification: official `client_secret_basic` and preregistration checks failed; post and none scenarios passed.
- Recommendation: support/persist `none`, `client_secret_basic`, and `client_secret_post`; implement RFC form-encoded Basic credentials without duplicating the secret in the body; validate registration responses and expire/re-register rotated or expired dynamic clients safely.

### MCP-034 — Exact loopback callback configuration is impossible

- Evidence: the internal loopback helper accepts `callbackPath`, but `DefaultOAuthClientProviderOptions` exposes neither port nor path and the provider does not forward a path (`types.ts:91-117`; `default-oauth-client-provider.ts:248-253`). `startServer()` always requests ephemeral port 0 on `127.0.0.1` (`loopback-authorization.ts:23-55`).
- Impact: pre-registered clients such as Asana require an exact redirect and cannot reliably interoperate.
- Recommendation: validated fixed port/path options, occupied-port handling, exact callback checks, and a user-visible timeout/cancel path.

### MCP-035 — Loopback hostname validation accepts attacker lookalikes

- Evidence: `oauth-discovery.ts:46-67` and `default-oauth-client-provider.ts:754-777` accept hostnames beginning `127.` such as `127.attacker.example`, while rejecting the URL hostname representation `[::1]`.
- Impact: insecure HTTP OAuth endpoints can be misclassified as loopback.
- Recommendation: strict IP/hostname parsing with test vectors for IPv4, IPv6, alternate encodings, trailing dots, and DNS names.

### MCP-036 — OAuth requests and discovery fan-out are unbounded

- Evidence: metadata/token bodies use unbounded JSON reads; no total deadline exists; every authorization-server candidate can trigger multiple sequential requests and diagnostics accumulate without limit.
- Risk: body OOM, stalled authorization, network amplification, and multi-minute failure paths.
- Recommendation: per-request plus overall discovery deadline, body limits, candidate deduplication/cap, bounded diagnostics, and abort composition.

### MCP-037 — Bare 401 does not invalidate a presented cached token

- Evidence: refresh is forced only for explicit `error=invalid_token` at `default-oauth-client-provider.ts:78-90`.
- Risk: a bare 401 retries the same rejected token and cannot recover from common server behavior.
- Recommendation: if an Authorization token was presented, allow one refresh/reauthorization on bare 401, then fail deterministically.

### MCP-038 — Shared discovery cache data is trusted verbatim

- Evidence: `oauth-discovery.ts:239-252` returns external cache objects without the network validation path.
- Impact: cache corruption can inject a token endpoint and combine with MCP-030 to disclose credentials.
- Recommendation: treat cache as untrusted input, fully revalidate, evict invalid entries, and let cache failures fall back to network discovery.

### MCP-039 — OAuth concurrency is scoped to one provider instance

- Evidence: refresh/authorization maps exist per provider. The default OAuth options construct a provider per `HttpTransport`; callers can inject a shared provider manually, but no canonical shared-provider lifecycle is supplied. Refresh and interactive authorization use separate mutation paths.
- Risk: duplicate browser flows, rotating-refresh-token races, and step-up/refresh overwrites for the same resource or across processes sharing a store.
- Recommendation: share one concrete provider per canonical endpoint and serialize/revision-check all session mutations per resource while unioning concurrent requested scopes; require store-level compare-and-swap or a bounded cross-process lock for rotating credentials.

### MCP-040 — Default token/session encryption is not a production secret boundary

- Evidence: default file storage derives its key from predictable hostname, username, and fixed salts (`auth-store/create-secret-store.ts:47-59`, `encrypted-file-store.ts:314-345`, `auth-store-session-store.ts:7-12`).
- Lifecycle gap: the public provider API has no logout/forget/revoke operation (`mcp-oauth/src/client/types.ts:39-53`); default session/client stores are internal implementation details.
- Risk: possession of the file plus easily derived host/user values can be enough to decrypt bearer credentials.
- Recommendation: OS credential store or a user-held encryption secret by default; define file/directory modes, migration, backup, and deletion policy; expose atomic local purge plus best-effort server revocation/disconnect.

### MCP-041 — OAuth secrets can survive in reports and transcripts

- Evidence: `toolcraft/src/redaction.ts:56-76` does not parse form bodies; transcript URLs are unredacted; reports at `error-report.ts:530-551,629-648` use ordinary file modes.
- Risk: client secrets, codes, verifiers, refresh tokens, state, authorization URLs, `MCP-Session-Id`, and secret custom headers can be persisted.
- Recommendation: structured URL/query/form/header redaction, session/custom-header classification, `0600` reports, secret-sentinel tests, and no raw auth URL retention.

### MCP-042 — Bearer parsing and OAuth identity normalization need hardening

- Evidence: auth-parameter names are case-sensitive and the first parameterized Bearer challenge wins even if a later challenge is actionable (`oauth-discovery.ts:506-577`). Issuer trailing slashes are rewritten, and fragment/resource canonicalization policy is incomplete.
- Recommendation: RFC case-insensitive parameter handling, actionable challenge selection, exact issuer comparison, and fragment rejection before cache/session keying.

### MCP-043 — Client ID Metadata Documents are not first-class

- Evidence: `client_id_metadata_document_supported` and the recommended preregistration → CIMD → DCR preference are not modeled.
- Status nuance: a URL-shaped static client ID may work accidentally, but policy and validation are absent.
- Recommendation: explicit CIMD mode/capability with conformance coverage.

### MCP-044 — Callback lifecycle and refresh retry safety are incomplete

- Evidence: callback wait has no timeout/cancellation or `Cache-Control: no-store`; codes can remain in browser history. Error responses reflect authorization-server text without explicit content type, `nosniff`, CSP, or referrer policy (`loopback-authorization.ts:93-123`). Token expiry is tested only at `expiresAt <= now()` without a safety window (`default-oauth-client-provider.ts:498`). Refresh retries immediately after ambiguous 5xx and can replay a rotating token.
- Recommendation: bounded/cancellable callback lifecycle; strict `text/plain` error and success-page security/no-store headers; malicious-description tests; a bounded proactive expiry window; explicit transient retry policy; and no unsafe replay after ambiguous token responses.

### MCP-045 — OAuth public API and documentation drift

- Evidence: the tiny-client README imports an export not present in `src/index.ts`; the `mcp-oauth` README documents unsupported `serviceName`.
- Recommendation: reconcile exports/examples/options only after behavior is stable; no README was changed because repository instructions require explicit permission.

## Toolcraft proxy and production-surface issues

### MCP-046 — Toolcraft has no OAuth wiring

- Evidence: `mcp-proxy.ts:54-56,623-646`, agent MCP config, and CLI/SDK/MCP entrypoints expose only URL, headers, and `projectRoot`.
- Impact: Notion and Asana cannot be used through the real Toolcraft proxy even though the low-level transport has partial OAuth support.
- Recommendation: runtime-only provider resolver shared by discovery/lazy connections, injected fetch/network policy, CLI/SDK/MCP parity, and proof that secrets never enter serialized config/cache/fingerprints.

### MCP-047 — Required-task tools are exposed as ordinary calls

- Evidence: stable `Tool.execution.taskSupport` is absent and Toolcraft blindly creates a synchronous command at `mcp-proxy.ts:136`.
- Requirement: a `taskSupport: "required"` tool must be invoked as a task.
- Recommendation: reject/hide required-task tools until the full task lifecycle exists; assert no plain `tools/call` is sent.

### MCP-048 — Tool pagination and multi-proxy discovery are unbounded

- Evidence: `mcp-proxy.ts:352` has no repeated-cursor, page, tool, aggregate-schema-byte, or duplicate-name limit; all proxies dial through unbounded `Promise.all` at `:649`.
- Recommendation: conservative fixed/configurable caps, cycle detection, bounded concurrency, and deterministic diagnostics.

### MCP-049 — Proxy teardown is incomplete and late dials can leak

- Evidence: `shutdownDisposers` is never drained (`mcp-proxy.ts:25,100-102`); disposing clears `connecting`, whose late result can still install a client (`:228-268`). Public CLI/SDK/MCP APIs do not own cleanup.
- Recommendation: explicit idempotent teardown integrated with every runtime lifecycle; generation-safe late dial closure; real stdio process-exit coverage.

### MCP-050 — Proxy caches over-collect secrets/metadata and lack restrictive modes

- Evidence: full config including secret headers/env is fingerprinted; all upstream tools including arbitrary metadata are persisted before allowlisting; cache writes do not request `0600`; `.toolcraft/` is not ignored.
- Recommendation: secret-independent identity, minimal command-needed fields only, allowlist before persistence, restrictive file/directory modes, and secret-sentinel tests.

### MCP-051 — Proxy caches do not expire or react to upstream changes

- Evidence: `fetchedAt` is informational; validity depends only on config fingerprint; `onToolsChanged` is not wired.
- Risk: removed, renamed, or task-upgraded tools remain exposed indefinitely.
- Recommendation: TTL/refresh policy, list-change invalidation, explicit offline behavior, and cache schema migrations.

### MCP-052 — MCP-to-MCP proxying loses result semantics

- Evidence: without `outputSchema`, the proxy returns the entire upstream `CallToolResult` as an ordinary Toolcraft value; with `outputSchema`, it returns only `structuredContent` (`mcp-proxy.ts:155-177`). The downstream MCP fallback JSON-stringifies non-content values (`mcp.ts:1046-1048`).
- Runtime confirmation: all three public calls completed through the downstream MCP surface, but each became one text content item. This proves call transport, not preservation of upstream MCP result variants or metadata.
- Risk: `isError`, native image/audio/resource blocks, annotations, `_meta`, icons, and execution metadata are lost or nested incorrectly.
- Recommendation: map native MCP result semantics end to end with integration fixtures.

### MCP-053 — Runtime option parity is incomplete

- Evidence: CLI/SDK/MCP expose environment, fetch, and logging controls, but proxy resolution receives only `projectRoot`; refresh reads global `process.env`.
- Recommendation: one runtime options object shared by all surfaces; CLI must use the SDK path; injected fetch/env/logger/OAuth must behave identically.

### MCP-054 — JSON Schema 2020-12 conversion is incomplete

- Evidence: `json-schema-converter.ts` supports a narrow keyword list, rejects valid multi-type schemas, and assumes object branches for some compositions.
- Requirement: clients must support the stable revision's default JSON Schema 2020-12 dialect; graceful rejection applies to unsupported additional dialects, not valid default-dialect constructs.
- Recommendation: use a proven parser/converter or implement full 2020-12 semantics without silently dropping constraints; honor explicit `$schema`, bound depth/validation time/regex work, and never auto-fetch external `$ref` URIs.

### MCP-055 — Cache validation/versioning/path identity is weak

- Evidence: cache reads are unbounded, tool entries are not validated, all errors are suppressed, cache version is coerced, and paths use only the leaf group name.
- Risk: corrupted/oversized cache, same-name nested proxy collisions, and nondeterministic final writes.
- Recommendation: bounded parse, exact schema/version validation, hierarchical identity, atomic collision tests, and a checked-in schema source.

### MCP-056 — Cancellation and deadlines stop at the proxy boundary

- Evidence: proxy `callTool` does not receive/forward downstream signals or per-call timeouts.
- Risk: a cancelled CLI/SDK/downstream MCP request continues running upstream.
- Recommendation: propagate cancellation/deadline metadata through Toolcraft to the low-level client and preserve MCP cancellation legality.

### MCP-057 — Proxy observability is insufficient

- Evidence: discovery emits only a few global stderr lines; there are no structured cache-hit, page/count, latency, reconnect, OAuth, call-status, or shutdown events.
- Recommendation: injectable non-blocking observers with correlation IDs and strict redaction, including session IDs and custom secret headers; never let observability alter protocol behavior.

### MCP-058 — Stdio inherits environment and ambient executable identity

- Evidence: omitted `env` passes through Node spawn defaults (`internal.ts:2371`); command lookup uses ambient `PATH` (`internal.ts:2343-2349,2371-2375`).
- Risk: a local MCP subprocess receives every parent environment secret and may resolve to an attacker-controlled executable. An untrusted subprocess also has the user's filesystem/network authority.
- Recommendation: document the trust boundary, make a minimal explicit environment the default, require opt-in for full inheritance, require an executable provenance policy (absolute/pinned identity or reviewed package/version), run untrusted servers in an external sandbox, and test secret sentinels and PATH hijacking.

## Verification, interoperability, and documentation issues

### MCP-059 — Official stable conformance is a release blocker

- Observed baseline results:
  - full `--suite all --spec-version 2025-11-25`: 148 passed checks, 23 failures, 4 warnings across 18 scenarios; 7/18 scenarios clean;
  - initialize: 0/1, version mismatch;
  - tools call: 1/1 pass;
  - SSE retry: 1/2 plus one warning and request timeout;
  - elicitation defaults: 0/6, method-not-found;
  - stable auth: 146 passed checks, 15 failures, 3 warnings; 6/14 scenarios clean;
  - `2025-03-26` OAuth compatibility: 0/7 passed checks across `2025-03-26-oauth-metadata-backcompat` and `2025-03-26-oauth-endpoint-fallback`.
- Clean auth scenarios: `metadata-default`, `basic-cimd`, `scope-omitted-when-undefined`, `scope-retry-limit`, `token-endpoint-auth-post`, and `token-endpoint-auth-none`.
- Recommendation: pin the runner and `--spec-version 2025-11-25`, retain the complete applicable scenario inventory plus machine-readable results, and gate every supported core/auth/backcompat scenario with zero unexpected failures or warnings.

### MCP-060 — Public unauthenticated interoperability passes through five exercised paths

All tests used fixed public-only inputs. Raw results were not retained; only public server/tool metadata and aggregate result kind, content type/count, serialized/text/output length, output-event count, and exit status were recorded.

| Server                      | Endpoint                              | Baseline observation                                                                                   | Status |
| --------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| Microsoft Learn             | `https://learn.microsoft.com/api/mcp` | `2025-03-26`; 3 tools; fixed docs search succeeded; 13,021 text characters                             | Passed |
| DeepWiki                    | `https://mcp.deepwiki.com/mcp`        | `2025-03-26`; 3 tools; public `modelcontextprotocol/specification` structure succeeded; 156 characters | Passed |
| Cloudflare Docs             | `https://docs.mcp.cloudflare.com/mcp` | `2025-03-26`; 2 tools; fixed Durable Objects docs query succeeded; 18,106 characters                   | Passed |
| Everything reference server | sanitized stdio, package `2026.7.4`   | server version `2.0.0`; 13 tools; synthetic echo succeeded                                             | Passed |

These passes show compatibility, not latest-spec compliance. The three remote servers tolerated missing production hardening and the older negotiated revision.

The Toolcraft core proxy and public SDK each repeated all three calls with one allowlisted command per server. They retained only object result kind and serialized lengths (12,411; 169; and 18,936 characters respectively). Toolcraft's downstream MCP server surface also completed all three calls using each advertised input schema and returned one text item per call.

The public `runCLI` API completed all three in-process in JSON mode with exit code 0 and one intercepted output event each. The harness counted 12,759, 174, and 19,302 output bytes, discarded each payload immediately, and suppressed discovery diagnostics. Direct stdout emitted zero bytes. Every temporary cache tree was removed; downstream in-memory test client/server pairs were closed; the CLI harness manually disposed its proxy through a private symbol. This was not an installed/packed CLI subprocess or human terminal-rendering test.

The core and SDK surfaces expose no owned public teardown, so their live proxy connections ended only when the short-lived harness process exited. The downstream pair cleanup does not prove ownership of its upstream proxy. Those lifecycle gaps remain MCP-049 rather than being counted as passes.

### MCP-061 — Production-path interoperability is only partially tested

- Evidence: the core `resolveMcpProxies`, public `createSDK`, in-memory downstream `createMCPServer`, and in-process public `runCLI` paths performed discovery, wrote isolated temporary caches, rebuilt one allowlisted command, lazily reconnected, and completed the same fixed call for all three public remotes. Only result kind, content type/count, serialized/text length, output-event count, and exit code were retained; every temporary cache tree was removed. Downstream test pairs were closed, and the CLI proxy was disposed through a private symbol.
- Remaining gap: this did not exercise human terminal rendering, semantic preservation of non-text MCP result variants, long-lived process teardown, cancellation, cache refresh, required-task handling, or OAuth.
- Recommendation: after hardening, repeat the same privacy-safe operations through CLI, SDK, and MCP server surfaces with owned shutdown and non-text result checks.

### MCP-062 — Notion OAuth interoperability passes at the low level

- Endpoint: `https://mcp.notion.com/mcp`.
- Baseline public metadata discovery passed: exact resource, DCR present, token auth methods basic/post/none, and S256 supported. No browser, token, authorization header, or workspace data was involved.
- Live result: after explicit user consent, two independent dynamic-registration and authorization sessions succeeded and negotiated `2025-03-26`. `notion-fetch` with `{ "id": "self" }`, `notion-get-users` for the authenticated user, and `notion-get-teams` all completed without a tool error. `resources/list` and `resources/templates/list` also completed. Prompts were not advertised, so `prompts/list` was not sent.
- Privacy result: both one-shot processes used in-memory sessions. The first retained only target, success stage, public revision, selected public tool name, and `isError`; the second retained only public operation labels and per-operation pass/not-advertised status. Neither printed or locally persisted the authorization URL, token, dynamic-registration material, tool inventory, response metadata, resource inventory, or any user/workspace content. No arbitrary resource was read and no prompt was rendered. Browser history and server-side dynamic registrations are explicitly outside this claim.
- Harness SHA-256 values: `5203c4f9514c31eb9d2c802382d759a01edab5e47e8e6184731942bf903ff712` for the minimum self-fetch and `a4c173c7b2f3903366da1dde477ebe8cd33a3b8c18860f4c64ad147a18f88f81` for the extended surface check. Both temporary harnesses were deleted after the runs.
- Proof boundary: this verifies two low-level sessions only. It does not clear Toolcraft OAuth, current-spec, persistent-store, refresh/rotation, revocation, callback-history, or bounded-transport findings. Dynamic client registrations or grants may remain at Notion until the user disconnects the test connections.

### MCP-063 — Asana OAuth interoperability is consented but waiting for a test app

- Endpoint: `https://mcp.asana.com/v2/mcp`.
- Baseline public metadata discovery passed: no DCR, token auth basic/post, scope `default`, S256, and exact resource.
- Preflight result: the user explicitly consented and the audited artifacts were force-rebuilt with matching hashes, but both expected Keychain entries were absent. No browser or OAuth flow was opened.
- Remaining prerequisites: disposable Asana app/workspace, client ID/secret supplied through Keychain, and the harness-only exact callback `http://127.0.0.1:3334/callback`. The official common-client example is `http://localhost:3334/oauth/callback`, which the baseline cannot express.
- Safe first operation: list current tools, then call `get_me` only if advertised. Retain only success/failure stage because it returns name, email, and workspace memberships; do not enumerate or mutate tasks/projects/teams/attachments.
- Boundary: the production API cannot configure Asana's official exact callback; a temporary fixed-port injection is only a test workaround. Toolcraft still cannot pass OAuth.

### MCP-064 — Live QA needs a repeatable privacy boundary

- Current tests used temporary scripts outside the repository, fixed public inputs, no shell tracing, and result redaction. The sanitized stdio run used `/tmp` as cwd and an explicit minimal environment.
- Existing `packages/toolcraft/QA-mcp-proxy.md` covers cache, refresh, rename, schema fallback, help, and visual checks, but not privacy-safe live interop or OAuth. Missing: live endpoint/tool allowlists, secret/content-sentinel validation, artifact cleanup evidence, and a retained-output schema.
- Recommendation: a markdown manual QA plan rather than a script that stores secrets; review `git status` and every retained artifact after each run.

### MCP-065 — Automated schema conformance is absent

- Evidence: public types/guards are hand-maintained and no authoritative stable-schema fixture/differential gate exists.
- Recommendation: generate or import fixtures from the official schema/SDK, test every request/result union, and explicitly mark unsupported optional capabilities.

### MCP-066 — Public API/README documentation is incomplete

- Missing documentation includes transport security policy, deadlines/limits, shutdown, OAuth storage/callbacks, reconnection, supported revision/capabilities, runtime parity, and every exposed environment/config option.
- Repository constraint: README changes require explicit user permission; none were made in this audit.

### MCP-067 — Some green tests lock in obsolete behavior

- Examples: array batch dispatch, closing on session 404, immediate stdio SIGTERM, and permissive HTTP behavior.
- Recommendation: classify tests as normative-current, compatibility, security regression, or implementation detail; replace stale expectations with official conformance cases.

### MCP-068 — Proxied tools have no trustworthy least-privilege/approval boundary

- Evidence: `mcp-proxy.ts:155-174` copies server-controlled descriptions and hard-codes every generated command to `confirm: false`; `:203-210` exposes every upstream tool when no allowlist is configured.
- Risk: a compromised or changed server can add/rename tools, inject hostile descriptions, and gain agent-facing authority for destructive or exfiltrating calls. Tool annotations are explicitly untrusted; server instructions, prompts, logs, and result text are also untrusted content.
- Recommendation: default-deny agent/MCP exposure; require explicit per-origin allowlists; quarantine changed tools; apply a local approval policy independent of annotations; show upstream identity and exact arguments; strip terminal controls; and test that descriptions/annotations cannot bypass approval.

### MCP-069 — Stdio discovery can execute local code before informed consent

- Evidence: proxy discovery dials configured servers at `mcp-proxy.ts:346-350,623-646`, and `StdioTransport` spawns immediately at `internal.ts:2364-2375`.
- Risk: merely loading/discovering a repository-supplied MCP configuration can execute an ambient executable with the user's environment, cwd, filesystem, and network authority.
- Recommendation: require first-run/config-change approval before discovery or spawn; display the untruncated command, arguments, cwd, and environment variable names; bind approval to a config/executable digest; prohibit shell interpolation; resolve executables deterministically; and use least-privilege environment/cwd plus an external sandbox for untrusted servers.

### MCP-070 — Progress tokens and numeric progress violate stable invariants

- Evidence: duplicate active progress tokens are counted/reused (`internal.ts:449-453`), while progress and total accept non-finite or decreasing values (`:275-310`).
- Requirement: tokens must be unique across active requests and progress must increase for each notification.
- Recommendation: reject duplicate active tokens before writing; require safe string/integer tokens and finite numeric values; track monotonic state per token; stop delivery at completion/cancellation; rate-limit notifications; and preserve task-lifetime rules if tasks are added.

### MCP-071 — Valid sub-resource update notifications are dropped

- Evidence: `internal.ts:225-239` delivers `notifications/resources/updated` only when its URI exactly equals a subscribed URI. The stable schema permits the notified URI to identify a sub-resource of the subscription.
- Risk: applications silently retain stale resource state.
- Recommendation: preserve valid notifications associated with an active subscription or define scheme-aware URI-boundary semantics; do not use an unsafe generic string-prefix match; add exact, child, sibling, traversal, encoding, and unsubscribe fixtures.

### MCP-072 — Roots, sampling, and future elicitation lack host safety policy

- Evidence: `roots/list` returns callback data verbatim (`internal.ts:381-384`), and `sampling/createMessage` directly casts and forwards server input (`:202-205`). MCP-012 records elicitation as a future feature.
- Risk: roots can disclose unintended paths; sampling can transmit sensitive prompts, incur unbounded model cost, or choose disallowed models; elicitation can become a phishing/secret-collection channel.
- Recommendation: expose only user-approved canonical `file:` roots within permission boundaries; require human review/edit/deny for sampling with model, cost, rate, and data controls; and implement elicitation only with server attribution, field/target review, decline/cancel, secret restrictions, and explicit navigation consent.

### MCP-073 — Future icon/content/schema URI handling needs a separate untrusted-URI policy

- Evidence: MCP-010/MCP-011 require current icons, resource links, and content variants, while MCP-054 requires broader JSON Schema support. The transport endpoint policy in MCP-021 does not govern server-supplied URIs embedded in protocol data.
- Risk: naïve implementation can introduce SSRF, local-file disclosure, credential/cookie forwarding, oversized media bombs, MIME confusion, active-SVG script, or unbounded external `$ref` retrieval.
- Recommendation: keep resource links and external schema references opaque unless separately approved; restrict fetch/render schemes and origins; send no ambient auth/cookies; reject redirects; enforce byte/dimension/frame/MIME-magic limits; and sanitize or disallow active SVG.

### MCP-074 — OAuth browser launch lacks authorization-server trust consent

- Evidence: discovery-selected authorization endpoints flow to `openBrowser` (`default-oauth-client-provider.ts:273-281`; `loopback-authorization.ts:158-159`) after URL-shape validation, without a product policy or approval for the selected authorization server/scopes.
- Risk: a resource can redirect the user to a newly advertised phishing authorization server, and a stored multi-account session can be selected without clear local identity.
- Recommendation: before every first or changed authorization flow, show and require approval for resource, authorization-server host, scopes, client, redirect URI, and local profile; support allowlists; never auto-open; and namespace sessions by local profile/account where multi-account use exists.

### MCP-075 — Diagnostics retain non-secret user and workspace data by default

- Evidence: `error-report.ts:231-275,595-596` redacts only declared/schema-named secrets and persists other parsed arguments; reports lack an explicit mode at `:643-647`; stdio retains up to 65,536 raw stderr characters (`internal.ts:2361-2449`).
- Risk: queries, document text, emails, IDs, tool results, and subprocess output can survive locally even when they are not credentials.
- Recommendation: treat MCP arguments/results as sensitive by default; retain shapes/counts rather than values unless explicitly opted in; write reports with `0600`; define retention/deletion; make the stderr cap configurable while redacting/minimizing/clearing capture; and use PII/content sentinels in privacy tests.

### MCP-076 — Publication is not gated on all production checks for the same SHA

- Evidence: `release-toolcraft.yml:2-60` publishes on main push/manual dispatch and makes publish depend only on its build-smoke matrix. Unit/lint/type checks run in a separate workflow with no same-commit dependency; official MCP conformance and adversarial security gates are absent.
- Risk: a release can publish despite failing or skipped checks elsewhere.
- Recommendation: require the exact release commit to pass unit, lint, type, adversarial security, packaged-runtime, privacy, and official MCP conformance gates; manual dispatch must run the identical immutable gate set.

### MCP-077 — The inspected tarball is not guaranteed to be the published artifact

- Evidence: `release-toolcraft.yml:125-139` packs and signature-checks one tarball, then publishes the directory, which creates another tarball. Actions use mutable major tags and npm is installed from a range. Provenance and signature checks are present, but no exact-artifact SBOM or package-scoped vulnerability gate is enforced.
- Audit note: the monorepo `npm audit --omit=dev` reported one high and one moderate advisory, but dependency tracing placed them through a development-only MCP SDK chain and an unrelated package respectively. They are not claimed as shipped MCP vulnerabilities; the workspace graph cannot substitute for scanning the exact bundled tarball.
- Risk: inspection and publication can diverge; mutable release tooling weakens reproducibility; workspace-wide dependency audits cannot prove the bundled runtime artifact is clean.
- Recommendation: pack once; inspect, smoke, vulnerability-scan, signature-check, hash, and generate an SBOM for that exact file; publish the file; retain its digest/attestation; and pin actions/release tooling immutably.

### MCP-078 — Rate limits and retries have no explicit safe policy

- Evidence: HTTP GET/POST failures become generic errors (`internal.ts:2725-2731,2751-2761`); status 429 and `Retry-After` have no representation.
- Risk: callers cannot back off coherently, while a naïve future retry could duplicate a mutating tool call after an ambiguous response.
- Recommendation: return typed overload/rate-limit errors and safely parse bounded `Retry-After`; use capped exponential backoff with jitter, cancellation, and a shared budget only for classified safe discovery/list operations; never automatically replay arbitrary tool calls.

### MCP-079 — Proxy configuration is not fully validated before side effects

- Evidence: runtime checks cover only selected rename/human-loop fields (`index.ts:1100-1103`); `index.ts:414-432` treats every non-`stdio` transport discriminant as HTTP; unknown allowlist entries are silently ignored (`mcp-proxy.ts:203-210`).
- Risk: malformed/typoed configuration can choose the wrong transport, trigger filesystem/network/process activity, or silently expose a different command set.
- Recommendation: apply one runtime schema before any cache, network, or spawn action; reject unknown transports/fields, blank commands, invalid URLs, malformed headers/env, oversized arrays, duplicates, and missing allowlist entries; test CLI/SDK/MCP parity.

### MCP-080 — Remote client identity leaks aliases and reports a false version

- Evidence: `mcp-proxy.ts:19-22` hard-codes client version `0.0.1`; `:627-631` sends `toolcraft-${groupName}` to upstream servers.
- Risk: internal group aliases leak into remote telemetry, while operators cannot correlate behavior with the deployed package version.
- Recommendation: use a stable non-sensitive default name and actual packaged version, allow an explicit privacy-reviewed override, and assert initialize identity from the packed artifact.

### MCP-081 — Declared MCP runtime/platform support is not exercised end to end

- Evidence: Toolcraft declares Node `>=18.18` while its bundled `tiny-http-mcp-server` declares Node `>=20`. Release tests run only on Ubuntu; the multi-Node CLI bundle smoke excludes `tiny-mcp-client`/`mcp-oauth`, and packaged MCP execution occurs only in the Node 22 publish job.
- Risk: HTTP/stdio, loopback callback, credential-store, signal, and shutdown behavior can break on the oldest supported Node or another user platform without blocking release.
- Recommendation: run packaged local-only HTTP, stdio, OAuth-loopback, storage, and shutdown fixtures on oldest/latest supported Node and supported operating systems, or narrow the declared support policy explicitly.

### MCP-082 — The stable target must be re-evaluated at release time

- Evidence: `2025-11-25` is current on the audit date, while the breaking `2026-07-28` revision is a release candidate scheduled to become final shortly.
- Risk: completing this checklist after a new stable release could still produce a client falsely described as latest-spec.
- Recommendation: re-read official versioning immediately before release; if the stable revision changed, rebaseline schema, lifecycle, authorization, security, and the complete conformance matrix before claiming support. Do not advertise the release candidate as stable early.

### MCP-083 — Figma OAuth is externally gated by catalog approval

- Endpoint: `https://mcp.figma.com/mcp`.
- Baseline public discovery passed without authorization: the endpoint returned a 401 challenge with exact protected-resource metadata; the resource matched; authorization server `https://api.figma.com`, dynamic registration, scope `mcp:connect`, token authentication basic/post, and PKCE S256 were advertised.
- External support boundary: Figma's current official documentation says only clients listed in its MCP Catalog can connect and directs new client developers to apply for remote access. The catalog lists Codex, but not `poe-code`; they are distinct clients. Public DCR metadata does not grant this custom client registration authority.
- No state-changing negative probe was sent. Dynamic registration could create server-side state if policy changes, and impersonating a listed client name or reusing its credentials would be inappropriate and would not test this client.
- Client compatibility gaps remain even after provider approval: the DCR body hard-codes `token_endpoint_auth_method: "none"` although Figma advertises only basic/post; the harness must explicitly request `mcp:connect`; and the public API cannot configure an exact callback host/port/path if approval requires one.
- Future approved boundary: use only the provider-approved identity/registration mechanism, initialize, call documented remote-only `whoami` once, and discard its email, plans, and seat data. List only the first prompts/resources pages when advertised, retaining status but no inventory or content. Do not render a prompt, read a resource, or invoke any file, canvas, screenshot, asset, library, shader, Code Connect, search, generation, upload/download, or write-capable operation.
- Proof boundary: a future approved pass would establish only one low-level OAuth/PKCE session and selected read/list surfaces. It would not prove arbitrary-client eligibility, stable-spec compliance, or production Toolcraft OAuth support.
- Metadata harness SHA-256: `30868acebc98dc53bffc6e4619c9e386f5a996352779d856ca6bd7cdf89c21f4`; this identifies source content only, and the temporary harness was deleted after the public probe.

## Baseline interoperability details

### Public no-auth retained-data boundary

- Sent only fixed public documentation/repository queries.
- Sent no local file content, repository source, environment value, clipboard value, account identifier, credential, or user prompt.
- Remote testing necessarily exposed ordinary connection metadata such as the runner's network address and TLS/HTTP timing to each named endpoint; no stronger network-anonymity claim is made.
- Retained no response text; only length/type/count and public server/tool metadata.
- Did not follow a tool merely because it claimed read-only; each selected operation was reviewed for a public data domain.

### OAuth metadata probe results

| Target | Resource                       | Registration | Token authentication | Public scopes          | PKCE        | Result          |
| ------ | ------------------------------ | ------------ | -------------------- | ---------------------- | ----------- | --------------- |
| Notion | `https://mcp.notion.com/mcp`   | DCR present  | basic, post, none    | none advertised in PRM | plain, S256 | Metadata passed |
| Asana  | `https://mcp.asana.com/v2/mcp` | no DCR       | post, basic          | `default`              | S256        | Metadata passed |
| Figma  | `https://mcp.figma.com/mcp`    | DCR present  | basic, post          | `mcp:connect`          | S256        | Metadata passed |

These rows contain only public discovery metadata. Authenticated Notion results are recorded separately in MCP-062 and the retained evidence ledger.

## OAuth live-test boundary and status

Notion consent was explicitly granted for two one-shot sessions and those checks are complete. Asana consent was explicitly granted, but both expected Keychain credentials were absent, so no Asana browser or OAuth flow was opened. Figma public discovery passed, but Figma admits only catalog-approved clients and `poe-code` is not listed; no registration request or browser flow was attempted. No authorization URL, code, token, client credential, or private response content was printed or persisted by the harness or repository output; Notion response data existed only in process memory and was discarded. The Notion callback URL may remain in browser history, and dynamic registrations or grants may remain server-side.

Controls used for Notion, required for the consented Asana run, and reserved for a future provider-approved Figma run:

- Force-rebuild the audited `mcp-oauth`/`tiny-mcp-client` artifacts and record their hashes before the live run.
- Run each provider in a separate one-shot process with an in-memory session store, isolated temporary cwd, no shell tracing, and no repository writes.
- Show the user only the public resource and authorization-server host before opening the URL. Pass the full authorization URL directly to the browser with `execFile`; never print or persist it.
- Wrap the injected fetch with per-request deadlines, an overall authorization budget, exact expected-origin checks, and `redirect: "error"`; never follow a credential-bearing redirect merely to make the test pass.
- Add a five-minute user/callback timeout through the injected `readLine` path and a harder external child-process watchdog because the baseline loopback provider has no timeout/cancellation option.
- Read only the first `tools/list` page and abort if an explicitly approved documented tool is absent; do not traverse unbounded pagination. The minimum identity run must not call a write, search, task, project, attachment, or arbitrary server-suggested operation. Any expanded surface probe requires renewed user consent and may list resources/templates without reading an arbitrary resource.
- Retain only target, success/failure stage, negotiated public revision, selected documented operation names, per-operation pass/not-advertised status, and `isError` where applicable. Do not retain tool inventory/count, response shape/type/count/text/length, server instructions, user/workspace fields, IDs, emails, names, or token/session values.
- Map failures to an allowlisted local category and stage; never print exception messages, stacks, response bodies, OAuth error descriptions, or subprocess diagnostics.
- Read the negotiated revision from the `connect()` result; treat `isError: true` as a failed process. Wrap setup and Keychain reads in the same sanitized error boundary.
- Close the client, await `transport.closed` with a bound, clear the in-memory session map, terminate the one-shot process, delete temporary state, inspect `git status`, and scan retained documentation for known credential fields and local paths. An injected secret/content-sentinel and repeatable artifact-evidence gate remain future QA under MCP-064.
- Warn that the baseline callback page does not scrub its query or send complete no-store/security headers, so the callback URL may remain in local browser history (MCP-044).

Notion execution (completed):

- The user separately consented before each browser flow. Both sessions used dynamic client registration, the baseline ephemeral `http://127.0.0.1:<port>/callback` URI, and in-memory session state only.
- The minimum run passed `notion-fetch` with `{ "id": "self" }`. The extended run passed `notion-fetch` self, `notion-get-users` self, `notion-get-teams`, `resources/list`, and `resources/templates/list`. Prompts were not advertised.
- Returned identity, team, resource, and template data was treated as private and discarded without printing or persistence. No arbitrary resource was read, no prompt was rendered, and no mutating or search operation was invoked.
- Only allowlisted public operation labels, aggregate statuses, the negotiated public revision, `isError` status, and harness hashes remain in this document. The two temporary harnesses had SHA-256 values `5203c4f9514c31eb9d2c802382d759a01edab5e47e8e6184731942bf903ff712` and `a4c173c7b2f3903366da1dde477ebe8cd33a3b8c18860f4c64ad147a18f88f81` and were deleted.
- The user should disconnect both test connections in Notion settings. Ephemeral dynamic-client registrations may remain server-side, so these runs are not evidence of complete revocation cleanup.

Asana procedure:

- Consent preflight is complete. The force-rebuilt artifacts matched the retained hashes, but neither `poe-code-asana-mcp-client-id` nor `poe-code-asana-mcp-client-secret` existed in Keychain; the run stopped before browser launch.
- Use a disposable Asana MCP app/workspace and register the harness-only exact redirect `http://127.0.0.1:3334/callback`. This differs from Asana's current common-client example `http://localhost:3334/oauth/callback` because the baseline provider cannot expose callback host/path options (MCP-034).
- Enter the disposable client ID and secret into macOS Keychain from an interactive terminal; `-w` must remain the final option so the value is prompted rather than placed in argv/history:

  ```sh
  /usr/bin/security add-generic-password -U -a "$(/usr/bin/id -un)" -s poe-code-asana-mcp-client-id -w
  /usr/bin/security add-generic-password -U -a "$(/usr/bin/id -un)" -s poe-code-asana-mcp-client-secret -w
  ```

- The separate Asana prompt disclosed that its MCP grant has no per-tool scopes—it grants the chosen workspace's current/future MCP tool set even though the harness calls only `get_me`—and the user explicitly replied `ready for Asana`.
- The temporary harness may inject a server that binds port 3334, but it must not claim support for the official callback shape or modify repository source.
- Require the discovered authorization endpoint to match the expected Asana browser origin before opening it.
- After consent, call `get_me` only if advertised and discard its name, email, and workspace-membership response completely.
- Revoke/delete the disposable Asana grant or app, then delete the Keychain items after the run:

  ```sh
  /usr/bin/security delete-generic-password -a "$(/usr/bin/id -un)" -s poe-code-asana-mcp-client-id
  /usr/bin/security delete-generic-password -a "$(/usr/bin/id -un)" -s poe-code-asana-mcp-client-secret
  ```

Figma procedure:

- Stop at public discovery while `poe-code` is outside the Figma MCP Catalog. Do not send a negative DCR request, impersonate Codex or another listed client, or reuse another client's credentials.
- Apply for Figma remote access before any live OAuth attempt. Once approved, use the exact provider-approved client identity/registration and callback mechanism, explicitly request only `mcp:connect`, and keep Figma separate from Asana authorization.
- Before a future browser launch, disclose that `whoami` returns email/plan/seat identity and require fresh explicit consent. Pin MCP origin `https://mcp.figma.com`, OAuth service origin `https://api.figma.com`, and browser origin `https://www.figma.com`.
- Call `whoami` only if its live schema matches the documented no-file-context identity operation, and discard the complete response. When advertised, list only the first prompts and resources pages while retaining status only; do not render a prompt or read a resource.
- Do not invoke any file, canvas, screenshot, asset, library, shader, Code Connect, search, generation, upload/download, or write-capable operation.

Even a pass proves only one-session low-level discovery, PKCE/state, DCR or static-client token exchange, bearer retry, initialization, one tool listing page, and one read call. It does not prove Toolcraft OAuth, stable-spec compliance, the production callback API, persistence/restart, refresh rotation, revocation, bounded transport behavior, or write-tool safety. All related findings remain open.

## Recommended hardening order

1. Contain credentials, local execution, and untrusted authority first: MCP-030, MCP-031, MCP-035, MCP-038, MCP-040, MCP-041, MCP-058, MCP-068, MCP-069, MCP-074, and MCP-075.
2. Establish bounded network/lifecycle behavior: MCP-016 through MCP-026, MCP-036, MCP-044, MCP-048 through MCP-051, MCP-055, MCP-056, MCP-070, MCP-071, and MCP-078.
3. Implement the stable protocol and schema faithfully: MCP-001 through MCP-015, MCP-027, MCP-047, MCP-052, MCP-054, MCP-065, and MCP-073.
4. Make OAuth and every Toolcraft surface production-owned: MCP-029, MCP-032 through MCP-039, MCP-042 through MCP-046, MCP-053, MCP-057, MCP-072, and MCP-079 through MCP-081.
5. Close release, test, privacy-QA, observability, and documentation gates: MCP-028, MCP-045, MCP-059, MCP-064, MCP-066, MCP-067, MCP-076, MCP-077, and MCP-082.
6. Recheck the then-current stable revision, rerun its full official conformance inventory and all public surface interop, repeat the consented Notion check after hardening, perform the consented Asana check, and test Figma only after provider approval.

## Production-ready exit criteria

- [ ] Official versioning is rechecked immediately before release; the target and complete test inventory match the then-current stable revision.
- [ ] Negotiation and HTTP headers for the release-time stable target (currently `2025-11-25`) pass official initialize/lifecycle checks.
- [ ] SSE retry, timing, `Last-Event-ID`, POST-to-GET resumption, and concurrent streams pass official and adversarial tests.
- [ ] Session expiration establishes a fresh session without unsafe automatic replay.
- [ ] Progress tokens are unique, values are finite/monotonic, sub-resource updates are preserved, and notification delivery is bounded.
- [ ] Every input/body/event/queue/diagnostic has a finite enabled default, validated ceiling, typed failure, cancellation path, and adversarial boundary test.
- [ ] Every network/provider/shutdown phase has a finite enabled deadline with abort propagation and cleanup tests.
- [ ] Redirect, TLS, every DNS answer/hop, private/reserved ranges, rebinding, credential-forwarding, custom-fetch bypass, and response-body policies are explicit and tested.
- [ ] Authorization-server/resource/client/session identities are atomically bound; no credential can cross to a newly discovered AS.
- [ ] A changed OAuth resource/authorization server/scopes/browser target always receives explicit informed consent.
- [ ] Full pinned current-stable core/auth/backcompat conformance passes with zero unexpected failures/warnings and retains machine results.
- [ ] Secrets and non-secret user/workspace content use production storage/minimization and are redacted from errors, transcripts, caches, reports, and telemetry.
- [ ] No stdio executable starts before config-digest approval; executable provenance, minimal environment, cwd, and sandbox policy are enforced.
- [ ] Tool exposure is default-deny; changed tools are quarantined; destructive/exfiltrating calls require a local policy and untrusted server text never grants authority.
- [ ] Roots, sampling, and elicitation enforce user review, disclosure, model/cost/rate, secret, and navigation boundaries.
- [ ] Toolcraft supports provider-neutral runtime OAuth without serializing secrets.
- [ ] Required-task tools are never invoked as ordinary calls.
- [ ] Proxy pagination, cache, dial concurrency, and shutdown are bounded and owned.
- [ ] Stable schema/types/guards and MCP-to-MCP result semantics pass authoritative fixtures.
- [ ] `Retry-After`/overload handling is typed and bounded; no arbitrary tool call is automatically replayed.
- [ ] The exact hashed, scanned, SBOM-attested tarball is published only after same-SHA gates pass on every supported runtime/platform.
- [x] Baseline low-level public no-auth calls pass under the privacy boundary.
- [x] Baseline calls pass through the core proxy, SDK, in-memory downstream MCP server, and in-process `runCLI` JSON paths under the retained-data boundary.
- [ ] The same surface matrix is rerun after hardening, including human rendering and non-text results.
- [x] Baseline low-level Notion OAuth, three read-only tools, and advertised resource listing surfaces pass after explicit consent with response data discarded.
- [ ] Notion OAuth is rerun after hardening against the then-current stable revision and production-facing client surface.
- [ ] Asana OAuth and one disposable-workspace identity/read-only call pass after explicit consent.
- [x] Figma public OAuth metadata passes and the current MCP Catalog eligibility boundary is documented without a state-changing registration request.
- [ ] After provider approval, Figma OAuth, `whoami`, and advertised prompt/resource listing surfaces pass under fresh explicit consent.
- [ ] Retained artifacts are manually checked for credentials and user/workspace data.
- [ ] Public API/README documentation is updated after explicit permission.

Until these gates are met, the accurate label is **MCP client under production-hardening audit**, not production-grade.
