# Issue #582: shared bounded tool-call admission

## Validated defect

A bounded eight-call witness reached eight simultaneous waiting tool handlers over
both stdio and HTTP. Stdio produced nine responses including initialization; all
eight HTTP requests returned 200. The core dispatch has no admission gate and the
HTTP transport's existing optional cap defaults to undefined. No large-memory or
OOM workload was used to validate this issue.

## Implementation direction

- Put shared admission in tiny-stdio-mcp-server's tool dispatch so the same server
  instance shares capacity across direct calls, message sessions and transports.
- Default maxConcurrentToolCalls to four and maxQueuedToolCalls to 64; validate
  explicit overrides, allowing zero waiting slots but requiring positive active
  capacity. Use bounded FIFO waiting and immediate overload errors beyond it.
- Admit only validated tool calls. Invalid requests and non-tool protocol messages
  must not wait behind occupied tool slots.
- Keep slots until actual handlers settle, even if their response times out.
  Queued timeouts/session closure must remove pending work before it can produce
  effects. Do not claim cancellation of opaque running handlers.
- Preserve request-local async context when queued HTTP handlers resume. Avoid
  running a queued callback in the previous request's context.
- Expose options in ServerOptions/HTTP factory and CLI. Preserve the HTTP
  transport's existing explicit-cap rejection behavior unless concrete tests
  establish that a change is necessary; the default shared queue still covers it.
- This limits concurrent handlers and queued calls, not total process RSS or
  arbitrary custom host servers outside createServer's implementation.

## Verification and delivery

Use TDD for default/exact boundaries, FIFO/overload, shared sessions, zero queue,
invalid values, timeout retention, queued cancellation and HTTP request context.
Exercise real in-memory stdio and bounded local HTTP routes, not only a limiter
helper. Re-run package and downstream suites. Because this crosses workspace
boundaries and affects shared server infrastructure, run the maintained full unit
route and repository lint before push. Visually inspect CLI help changes.
Commit this issue separately, verify remote main, close after delivery and monitor
the relevant package publications while continuing safe work.

## Verification record

- Default capacity, shared-session admission and timeout retention first failed
  against the original implementation; CLI queue forwarding also failed before
  the option was implemented.
- Both MCP package suites pass: 19 files, 1,102 tests, including the real in-memory
  stdio line protocol and HTTP request-context isolation after queueing.
- The selected tiny-http workspace build closure passes (seven build tasks).
- The maintained full `npm test`, including native workspace tasks and root
  post-test lint stress, passes on base e0b50eac3 plus this candidate. Shared
  Vitest reports 29,725 passes and 43 skips; virtual-bash reports 18,389 passes
  and 63 skips. Skips and workspaces without declared tasks are not passes.
- Guarded repository ESLint completes with 9,622 linted files, zero errors and
  zero warnings. CLI help was rendered with the maintained screenshot runner
  and visually inspected.
- After fast-forwarding separately owned main changes to 66dbb22b0, the MCP
  suites, selected build and workflow lint pass again. The pre-existing staged
  cut edit and test files were preserved; their five focused tests pass after
  rebuilding the virtual-bash closure. The earlier full run is not presented as
  a new full verification of the other owner's incoming changes.
