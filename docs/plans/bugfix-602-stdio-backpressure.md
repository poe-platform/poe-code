# Bugfix #602: bounded stdio output and message admission

## Validated defect

Two malformed JSON lines and an in-memory Writable with highWaterMark one and
a blocked first callback reproduce the defect: two parse-error responses are
submitted despite backpressure, buffered bytes grow from 76 to 152, and connect
resolves on input EOF before those writes settle. This validates the transport
boundary without asserting the report's 200 MiB, 400-call or timing claims.

Both response and notification paths ignore write return values. Merely awaiting
drain independently in concurrent handlers would leave an unbounded population
of retained results. Serializing request execution instead would break existing
handler concurrency and delay ping/custom cancellation behind long handlers.

## Selected policy

- Add optional ServerOptions.maxStdioOutputBytes, default 1 MiB, and
  maxPendingStdioMessages, default 128. Both are positive safe integers and apply
  per connect/listen connection, not to direct sessions or SDK transport.
- Use one FIFO output writer for responses, errors and notifications. Account
  UTF-8 frame bytes including the newline before queue admission, including
  submitted but unsettled output. Await write completion and, after write false,
  drain before submitting the next frame.
- Retain finite message admission from input dispatch through response/output
  settlement. Keep the existing shared tool-handler/queue capacity independent;
  actual host-handler occupancy must not be released early by a response timeout.
- Refuse output or message overflow by failing that connection, without writing
  another overload response into the saturated output. Do not create an
  unbounded admission-waiter queue. Input parsing of a chunk may already have
  yielded additional lines; reject them rather than retaining them.
- Normal input EOF waits for accepted messages and admitted output. Writable
  error/premature close, readable error and admission failure stop input, close
  the message session, reject pending output and settle connect without waiting
  forever for an uncooperative host handler. Observe late handler settlements.
- Caller streams remain caller-owned; do not destroy/end them as a side effect
  of normal EOF or overload. Retain only the necessary observation for an
  already-submitted write until its callback/error/close settles.

This bounds transport-owned retained frames and admitted messages, not transient
JSON serialization, input's incomplete-line buffer, active handler allocations,
external writes to a shared Writable, process RSS, or wall-clock latency. The
HTTP SSE policy remains separate; its threshold is not a prospective byte bound.

## TDD and delivery

Use small in-memory streams with explicit write callbacks, real event-loop
turns and bounded cleanup. First prove backpressure/EOF and exact/overflow
admission failures. Then cover concurrent handlers and control requests, response
and notification ordering/accounting, UTF-8 bytes, writable error/close, falsey
or late failures, session isolation, and retained tool timeout/capacity behavior.
Run the complete stdio package tests and affected consumers, maintained build and
lint routes as appropriate. No README change is authorized. Local qualification,
remote delivery, issue closure and publication are recorded separately.

## Implementation evidence

Initial transport tests had four failures and one exact-boundary pass. The
bounded writer and connection admission made all five pass. Additional writable
error/close tests exposed a first-implementation defect: queued frames rejected
but the active frame's promise remained unresolved. Both controls failed before
preserving the active frame through abort, then passed. Expanded stdio controls
cover UTF-8/newline accounting, retained primary failure after a late callback
error, falsey synchronous failure, shared response/notification ordering, EOF,
concurrent hosts plus ping, configuration validation, and session abort without
waiting for a held host handler.

The first broader consumer run had 1,459 passes and one concrete failure in the
client test-pair utility. Its one-line read helper exits the readLines async
iterator early, destroying the shared stream with ABORT_ERR before explicit
pair cleanup; an isolated source-level PassThrough probe confirmed both effects.
The server now correctly reports that output failure. Only that fixture's
observation is changed to a one-shot data listener, with exact-byte and
not-destroyed assertions. Neither the production client reader nor the server's
error policy is weakened. The isolated existing test reproduced the same error.

The selected stdio build closure passed. The first root lint attempt was stopped
with TERM before the consumer-fixture edit, so `/tmp/poe-602-lint.log` is incomplete,
not a pass. Source and test validation is rerun after this correction. Evidence
logs use `/tmp/poe-602-` prefixes; no delivery or publication is claimed yet.

The corrected combined stdio/HTTP/client selection passed all 1,460 tests.
The maintained stdio TypeScript configuration, with both new test files added
explicitly to the no-emit program, also passed. A complete `npm test` and final
`npm run lint` were then started against frozen source/test inputs. The new transport behavior and
client fixture change are kept together as this issue's compatibility boundary.

A built public-package entry smoke independently rejected aggregate output
overflow after one submitted frame, preserved the caller-owned writable, and
removed its error listener after the outstanding callback settled. The client
package's maintained TypeScript configuration, with the changed utility test
explicitly included, also passed without emitting files.

Final `npm run lint` exited zero: all 9,666 configured files, zero errors or
warnings, 25 authenticated receipts, root type checking and workflow lint.
The complete maintained unit run exited zero: shared Vitest passed 29,881 tests
with 43 skips, Python passed 29 tests, Bash runner checks passed 241 tests, and
Bash passed 18,912 tests with 63 skips. Terminal-pilot's native pretest build and
239 tests passed, followed by both root posttest lint-stress tests. Orchestration
was uncached with no excluded declared tasks; skips and undeclared tasks are not
passes. This full result precedes the two review corrections below.

Review found a further concrete encoding mismatch while that full run was in
progress: a Writable configured with defaultEncoding utf16le accepted the frame
`a\n` as four bytes although the writer charged its two UTF-8 bytes. The bounded
source-level probe observed bytes `61000a00`. The correction must explicitly
submit UTF-8 and preserve the caller's configured default, with a failing
regression first. Source remained frozen until the full run completed; the
writer's pre-correction SHA-256 was
`d6fba1f58e3952821029595fe86b7a2ed7eb091d62cccdcfb2d47a4dde91a607`.

A second bounded review probe confirmed a cleanup edge: submit owned frame A,
then a separate caller write B; complete A while B keeps backpressure active,
abort the connection, and finally complete B. The owned frame rejects correctly,
but the writer still retains its error listener after drain because A's callback
has already run. Abort must release this already-completed active record, while
leaving caller listeners untouched. Add a failing regression before correction;
this does not expand byte accounting to the caller's separate writes.

Both new regressions failed before correction (two failures, five passing
writer controls). The writer now explicitly passes UTF-8 to write, and abort
releases an active record whose callback already completed. These are the only
two product-line changes after the full run. The corrected stdio/HTTP/client
selection passed 1,462 tests across 32 files. The selected stdio build closure
also passed. A rebuilt public server smoke proves exact charged UTF-8 bytes even
with a UTF-16LE caller default and proves that the caller's default is unchanged.
Final corrected-source type checking and lint are separate delivery gates; no
second full repository unit run is claimed for this two-line correction.

Corrected-source qualification is complete: both new test files pass type
checking under the maintained stdio configuration, and the final root lint
exited zero with 9,666 configured files, zero errors/warnings, 25 receipts, root
types and workflow lint. No source or test changes followed these checks.
Delivery includes only this issue's seven files; the three unrelated staged
Bash files remain excluded. Commit, verified remote-main delivery, issue closure
and publication still require their separate evidence.
