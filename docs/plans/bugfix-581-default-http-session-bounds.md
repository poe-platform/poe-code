# Issue #581: bounded HTTP MCP sessions by default

## Validation

A bounded local HTTP witness on main accepted all 129 initialize requests and
retained 129 sessions. A session with lastSeenAt set to the Unix epoch remained
usable. Current code skips admission when maxSessions is omitted and disables
expiry when sessionTtlMs is omitted. The larger audit memory measurements were
not rerun and are not being claimed as independently verified.

## Change

- Default to 128 active sessions and a 15-minute idle TTL, preserving explicit
  positive-integer overrides and stateless operation.
- Add maxSessionsPerSubject, default 16, for authenticated subject/client IDs.
  Unauthenticated sessions remain subject to the global cap. Reject excess
  authenticated-subject sessions before creation with an observable 429 reason.
- Expire transport-owned sessions even for custom stores without entries().
  Reclaim expired sessions before admission so expired capacity is reusable.
- Expose the subject limit through the existing CLI option pipeline as well as
  the SDK. Preserve authentication ownership checks and session cleanup.
- Do not introduce a process-RSS guarantee or change tool-concurrency policy.

## Verification and delivery

Add failing tests before product edits: default/global and subject boundaries,
idle expiry with and without store enumeration, explicit overrides, capacity
reuse, invalid values, stateless behavior and CLI forwarding. Use in-memory HTTP
test helpers and fake clocks. Run maintained focused/package test routes, selected
build and lint; visually inspect changed CLI help. Do not add README content
without permission. Commit this issue separately, verify remote-main delivery,
close after push and monitor its actual publication separately.

## Results

- Five initial production-readiness cases failed before implementation; CLI
  forwarding separately failed on the then-unknown subject-limit flag.
- A candidate regression that undercounted retained local protocol sessions when
  a non-enumerable store lost metadata was reproduced and corrected. Existing
  conservative global-cap accounting is preserved for that case.
- All 391 tests across 14 HTTP-package files passed with no skips. Coverage
  includes global and subject boundaries, client-ID fallback, ownership checks,
  overrides, expiry/reuse, non-enumerable stores, invalid values and stateless mode.
- Keepalive tests identify their own timer rather than confusing it with the new
  default expiry timer. They still verify sharing, cleanup, restart and disablement.
- The selected tiny-http-mcp-server workspace build closure passed (seven builds).
- A real local HTTP witness changed from 129 accepted sessions to 128 accepted
  plus one 503; an epoch-aged session returned 404 and retained count fell to 127.
- Actual CLI help was rendered with the maintained screenshot runner and visually
  inspected. Existing README default cells were corrected without adding sections
  or option rows; the subject limit is described in CLI help and API comments.
- Maintained root ESLint completed across 9,620 configured inputs with zero errors
  or warnings. Diff whitespace passed. No full-repository unit-test claim is made.
- Publication uses the existing dedicated release-tiny-http-mcp.yml workflow;
  root CLI release status remains separate.
