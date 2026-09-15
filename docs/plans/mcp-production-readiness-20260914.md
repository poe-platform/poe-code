# MCP specification and production readiness audit

Goal started September 14, 2026: work for at least nine hours improving all MCP tooling. The official specification latest endpoint identifies revision 2026-07-28. Verify requirements against official revision pages before implementing changes.

## Scope and execution

1. Inventory client, shared server core, HTTP and stdio transports, OAuth client/server, Toolcraft adapters, SafeJS integration, agent configuration, and exposed MCP tools.
2. Compare protocol negotiation, capability declarations, message validation, content/schema behavior, notifications, lifecycle, and transport behavior against the latest specification.
3. Audit authentication identity, discovery, credential handling, cancellation, resource bounds, concurrency, cleanup, and error handling.
4. Reproduce each issue with a failing regression test before implementation. Keep atomic changes focused and preserve public API compatibility where possible.
5. Run maintained focused verification for individual improvements; run repository-wide checks for shared or cross-workspace changes. Use manual screenshot validation for any CLI visual impact.
6. Record validated findings, fixes, test evidence, residual limitations, and delivery state here. Do not claim full production readiness from passing unit tests alone.

## Latest revision migration requirements

The official 2026-07-28 changelog removes the initialize handshake and protocol sessions. Compliance requires implementing stateless per-request version/capability metadata, server/discover, subscriptions/listen POST streams, required resultType and cache freshness/scope fields, and revised error codes. Multi round-trip requests replace server-initiated request flows. Schema/content changes, extensions, and HTTP header mappings must be checked against normative revision pages. Maintain explicit compatibility for older clients without advertising unsupported new-version behavior.

## Initial evidence

- Official latest specification fetched from https://modelcontextprotocol.io/specification/latest; visible version is 2026-07-28.
- Existing client hardening findings in docs/issues/mcp-client-production-hardening.md are leads to validate, not assumed current defects.
- OAuth discovery currently stores injected cache results without validation, normalizes issuer trailing slashes, and retains authentication parameter casing. Each requires focused reproduction and specification verification.

## Validated improvements

- Bearer authentication parameters are case-insensitive, but mixed-case resource_metadata, scope, and error were not available under the keys used by OAuth recovery. Added a regression test, observed its failure, and normalized parsed names. Focused OAuth suites pass (25 tests); full tiny-mcp-client source suite passes (339 tests). Focused ESLint passes. Selected workspace build verification is recorded in the ongoing audit.
- Official 2026-07-28 authorization discovery requirements confirm mandatory protected-resource root fallback, OAuth/OIDC candidate priority, exact issuer comparison, and separate registration state per authorization server. These are next verification targets.
- Reproduced missing protected-resource root fallback with two failing tests (missing and invalid endpoint-specific metadata). Added endpoint-then-root probing with deduplication, preserving explicit metadata hints. Reproduced missing OIDC candidate discovery with three failing tests (path insertion, path appending, and root issuer). Added required priority order before moving to another authorization server. Updated the existing request sequence assertion to include OIDC attempts. All 346 tiny-mcp-client tests pass; focused ESLint and selected workspace build closure pass.
- These discovery improvements do not yet establish full authorization compliance: exact issuer preservation, metadata trust/cache validation, finite I/O limits, credential identity binding, and authorization-response issuer validation remain to be audited and fixed from reproductions.
- Reproduced issuer identity loss in four tests: path/root trailing slash and explicit default port/hostname case exact matches were rejected; metadata with a removed trailing slash was incorrectly accepted. Preserve the validated input issuer string and compare metadata exactly. Updated legacy tests that explicitly expected normalization. Added seven failing endpoint-validation tests and reject insecure non-loopback HTTP, relative URLs, credentials, fragments, and non-string optional registration endpoints before returning discovery. All 357 client tests pass. Focused ESLint and workspace build verification recorded during this turn.
- Reproduced injected-cache validation bypass for resource identity, resource metadata, issuer, unadvertised issuer, insecure token endpoint, and unrelated metadata location; also reproduced caller mutations poisoning memory-cache results. Reuse shared metadata validation, enforce advertised issuer/discovery-location binding, deep-copy cache snapshots, and add optional cache deletion for invalid entries. Three additional failing tests demonstrated relative, credential-bearing, and fragment-bearing cached resource locations; reject these too. All 368 client tests pass, focused ESLint passes, and selected workspace build closure passes.
- OAuth provider and loopback unit suites attempted real listeners without explicitly installing the maintained in-memory HTTP harness, reproducing 27 and five EPERM failures respectively. Explicitly install the harness in both affected suites. Provider and standalone loopback unit tests now run in memory; combined client/OAuth verification covers 476 tests.
- Reproduced authorization-server swaps reusing still-valid old access tokens or submitting expired sessions' old client secret/refresh token to a newly discovered server. Two failing tests cover both expiry states. Reject inconsistent discovery issuer metadata and discard sessions whose resource/stored issuer/freshly discovered issuer binding changes before checking or refreshing tokens. Require a fresh consent flow for a new issuer. All 476 combined client/OAuth tests, focused OAuth ESLint, and the mcp-oauth workspace build closure pass.

## Delivery

Local commits: faa3b62df records the audit plan; 8830e4d83 fixes Bearer parameter casing; 1c381c399 adds protected-resource root fallback; 99eba0bbc adds OAuth/OIDC priority discovery; 80aeab85d preserves issuer identity; 1a3b10714 validates endpoint URLs; 823d7d14a validates and isolates cached discovery; 04caac7dc repairs explicit OAuth test-harness installation. Credential binding is verified and being committed independently. No remote delivery or releases yet. Work on the current main checkout. Push only when requested.
