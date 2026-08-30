# Canonical first-read case-to-policy freeze

This mapping was committed before candidate TypeScript was edited. It adopts the
exact profile authorized from Curie `7bbfbfd342f15e59deb49f8cb284ef69dac7968d`.
Historical `.data` fixtures are inert and remain outside canonical TypeScript
discovery. The old score remains historical 2/6 and is not rerun or rescored.

| Canonical case | Frozen executable assertions |
| --- | --- |
| `first-read-head-zero` | Preserve literal `head -n 0`, status 0, empty stdout/stderr, reads 0, iterator return 1, and live caller. |
| `first-read-local-unenrolled-controlled` | Preserve the unenrolled producer on the command signal. After first read, public execution remains pending for the full 1200ms observation while caller and command remain live. Only then record a host-owned gate release, join the source, require return 1/active 0, and require public status 0 with no caller abort. This is an explicit input-schedule/profile migration, not automatic preemption. |
| `first-read-local-owned` | Use `createOutputOperation`, register acquisition release before constructing/admitting the source, read on the operation signal, and pipe through operation output. Require one acquisition and one completed release, source return 1/active 0, destination/operation EPIPE, live caller and command context, and all owned closure before public settlement. |
| `first-read-s3` | Preserve literal `cat /input \| head -n 0; true`, status/bytes, reads 1, return 1, active 0. Require the S3 GET operation/destination EPIPE while caller and `cat` context remain live. Do not loosen the accepted original. |
| `first-read-webdav` | Preserve the original no-body-acquired recipe. Require GET fetch/request settlement and its registered client cleanup before public settlement, allow zero GET response/body acquisitions, require owned GET operation/destination EPIPE with live caller/`cat`, then passively await remote response close before dispose/fixture cleanup. |
| `first-read-curl-body` | Preserve the original flushed-header but no-response-acquired recipe. Require admitted request cleanup and actual `ClientRequest` close before public settlement, response acquisition/disposal 0, transport/destination EPIPE, live caller/`curl`, then passive remote close before dispose. |
| `first-read-curl-headers` | Preserve the original no-header/no-response-acquired recipe with the same request-close, zero response disposal, signal, byte, and passive-close assertions as the body-labelled original. |
| `first-read-webdav-body-acquired` | Delay downstream until the actual GET body reader issues its first read. Before public settlement require GET read 1/pending 0, reader lock release 1, fetch settled, owned operation closure, and EPIPE-only settled cancel rejections for the already errored stream; arbitrary cleanup errors fail. Caller/`cat` stay live. Passively await remote close. |
| `first-read-curl-body-acquired` | Delay downstream until the acquired response body's first read. Before public settlement require response acquisition 1, body read 1/pending 0, iterator return 1/completed 1, response dispose 1/completed 1, request cleanup and actual close 1, transport/destination EPIPE, and live caller/`curl`. Passively await remote close. |
| `first-read-required-destinations` | Close stdout first, then let normal fixture service supply `first\nsecond\n`. Require VFS `/body` exact bytes, `/headers` HTTP 200 and content-length 13, verbose stderr HTTP 200, and request/response cleanup before public settlement. Stdout closure must not abort the caller, curl command, transport, file, header, or stderr work. |

All first-read cases retain exact empty shell stdout and status 0 for their
top-level scripts. Remote closure is a bounded passive post-settlement assertion;
server/socket destruction or `Shell.dispose()` cannot rescue it. Fixture hooks
must be restored in `finally`, journals stay bounded, arbitrary observer/cleanup
errors fail, and the supervisor retains its 3000ms hard bound, 1 MiB capture cap,
strict unhandled-rejection mode, and residual process-group check.

The negative controls listed as future work in the proposal are not silently
claimed here. This first migration includes only the authorized controlled
unenrolled case and successful enrolled control; stage2 cancellation remains out
of scope.
