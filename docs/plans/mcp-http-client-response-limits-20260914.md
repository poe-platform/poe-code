# Bound MCP HTTP client response memory

The HTTP transport previously called Response.text for success and error bodies without a finite byte budget. The SSE parser accumulated unterminated lines and data fields without a limit. Disposal tracked SSE readers only, so ordinary response reads were not cancelled. An overflow could release an SSE reader without cancelling its open body.

Add maxResponseBytes (default 16 MiB, positive safe integer) to HttpTransportOptions. Apply the limit to complete JSON and HTTP error bodies and to retained SSE event data/partial lines. Count UTF-8 bytes before decoding, treat Content-Length as advisory, reject invalid UTF-8 in ordinary bodies, release reader ownership on all exits, and cancel oversized bodies. The same reader registry supports transport disposal for ordinary bodies and SSE. Long-lived SSE streams remain allowed: each event has a separate budget and keepalive comments do not accumulate.

TDD evidence: all seven original transport-limit regressions failed before integration; the reader's eleven in-memory cases cover boundary and split UTF-8 handling, oversized/misleading length headers, invalid budgets, malformed UTF-8, and cleanup. Six actual parser regressions failed before restoring bounds; two compatibility cases verify separately bounded events and keepalive comments. The SSE overflow cleanup regression failed with zero cancellations before the fix. The combined reader/parser/transport/lifecycle/utilities suites pass 68 tests. Focused ESLint and the maintained six-build client closure pass. The full client suite is running.

## Proposed README addition for user review

The user explicitly requires permission before README additions. No README has been edited. Add this single row to the HttpTransportOptions table in packages/tiny-mcp-client/README.md:

| `maxResponseBytes` | `number` | Maximum JSON/error body or retained SSE event bytes; defaults to 16 MiB and must be a positive safe integer. |

The full client suite now passes 403 tests across 18 files. The README row approval has been requested asynchronously; source improvements are reviewable, and independent protocol audit work continues while approval is pending.

Remaining audit: per-request deadlines and cancellation after HTTP headers arrive, stream forwarding backpressure, JSON-RPC line size limits, bounded callback/in-flight maps, discovery-body limits, and modern client negotiation. This change alone does not establish production readiness. No push or release is performed.
