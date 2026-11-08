# Exact diagnosis of all four unchanged v1 failures

This leaf reexecuted the unchanged original5 in a fresh writable reconstruction
of v1/r1, independently of the previous author's result summary. This is author
diagnosis, not independent-verifier acceptance. Source/test/compiled identities
matched `c13d21a4205f75a846363e7e2c13db103ed841ee61397553105745c940f31c44`,
`bdae375b37ea07dcbbd505a23873d472cfd379eae70f0b037d82b9830046de44`, and
`c4df1c6910557948441eb47b3b7a9a9d069267e14e3745541f5d1e8c6d766bb0`.
The reconstruction is `/tmp/safe-bash-owned-output-direction-prototype-a1Rz7L`.
`diagnosis-source-excerpts.json` supplies exact numbered lines and whole-file
hashes. Paths and line numbers below refer to that v1, never live current source.

## Local custom producer: real 1200ms timeout

Raw: `runs/v1-diagnosis-first-read-local.json`, exit1. Its stderr is
`DEADLINE: first-read-local (1200ms)` at
`tests/stress/remote-cancellation/helpers.ts:29`, not an outer supervisor kill.
The pre-teardown snapshot has reads1, active1, returned0 and caller un-aborted;
events show the pending first read and `head:0`, but no producer settlement.

`tests/shell/first-read-probe.ts:74` registers `pending-stream` with the ordinary
context signal and stdout. Line75 passes that stage signal to both
`pendingSource` and `pipeBytes`. Lines22-32 save it and await its abort before any
byte is written. The handler never calls `createOutputOperation`, registers no
owned source cleanup, and never uses the owned write capability. There is no
write-driven legacy stage cancellation to unblock that pending read. The exec
await at line98 times out; assertions99-111 are unreached. Cleanup during the
finally teardown at lines115-117 is not an acceptance rescue or a passing
cleanup assertion.

## WebDAV: stage-signal assertion, not timeout

Raw: `runs/v1-diagnosis-first-read-webdav.json`, exit1, roughly271ms including
process startup/teardown. The failure is `false !== true` at
`tests/shell/first-read-probe.ts:103`. Exec has already settled with empty bytes
and final status0 (the command is followed by `true`), and lines99-102 passed.
The trace explicitly reports `transport.signal.abort:DAV.GET:/dav/input`,
`cat:141`, and `true:0` while the caller remains live.

The `observed` variable is assigned the **stage** signal in middleware line80;
the WebDAV fixture never calls `pendingSource` to overwrite it. In contrast,
`src/commands/streams.ts:193` enrolls named-file cat and line194 replaces only
the local command context's signal/output with operation-owned counterparts.
`src/fs/webdav/webdav.ts:623` passes read options through to the GET at631, and
`requestStream` combines those options with its own timeout at282. Thus actual
GET I/O aborts without mutating the middleware's stage signal.

At the original failed-assertion snapshot the server-side close event has not
yet been observed: active1, returned0. Line105's awaited server close, lines106-
108's resource counters, and line111's unhandled-rejection assertion are all
**unreached**, not passes. The raw trace proves I/O signal abortion and command
settlement, not that those later assertions passed.

## Curl response body: stage-signal assertion, not timeout

Raw: `runs/v1-diagnosis-first-read-curl-body.json`, exit1, roughly236ms. Again
line103 fails after exec and lines99-102 succeeded. The server fixture flushes
headers at `first-read-probe.ts:55-57` and withholds the body. It records one GET;
trace then records `head:0`, `curl:141`, `true:0`.

Middleware line80 retains `context.signal`, the stage signal. Curl creates a
separate transfer operation at `src/commands/network/curl.ts:115`, takes its
signal at116, and passes that signal to authorization/transport at179/190.
`src/commands/network/transport.ts:27` combines it with transport disposal,
registers request cleanup at40 before native request creation at41, and supplies
that combined signal to the Node request. Output closure aborts owned transfer
I/O, not the saved stage signal. The original raw fixture does not directly
capture curl's operation signal: that identification is source-derived and is
separately corroborated by the adapted replay below, not falsely described as
an original-fixture signal observation.

Original snapshot: active1, returned0, caller live. Lines104-108 and111 are
unreached. No inference of original cleanup success is made from curl:141.

## Curl before response headers: stage-signal assertion, not timeout

Raw: `runs/v1-diagnosis-first-read-curl-headers.json`, exit1, roughly213ms. Same
line103 failure, same stage binding at80, same completed shell result before
the failed assertion. This fixture deliberately skips `writeHead/flushHeaders`
at lines55-57: the request is pending **before response acquisition**, unlike
curl-body. The transport registers disposal before `http.request` at40-41;
curl's acquisition at189 uses the operation signal. This allows request/socket
cleanup even though there is no acquired response object to dispose yet.

Trace: one GET pending before first byte, head0, curl141, true0; original
snapshot active1/returned0 and no caller abort. The original directly observes
only the saved stage signal, not curl's operation signal. Assertions104-108
and111 are unreached here too. It is incorrect to classify this as another
1200ms timeout or to claim those later cleanup checks passed.

## Why S3 passes unchanged

Raw: `runs/v1-diagnosis-first-read-s3.json`, exit0, explicit passed marker,
reads1/returned1/active0 before teardown. Middleware first stores cat's stage
signal at80. But `getObjectStream` at45-47 later calls
`pendingSource(options.abortSignal)`, and line23 **overwrites** `observed` with
the real I/O signal. Named cat already forwards its operation signal. Therefore
line103 tests operation cancellation for S3, whereas it tests stage cancellation
for WebDAV/curl. S3 reaches all subsequent cleanup and unhandled assertions.
This difference in signal capture, not a blanket rule that all backends stage-
abort, explains the 1/5 result.

## Separately adapted corroboration, never a silent input rewrite

`runs/v1-diagnosis-adapted-five.json` reexecutes the already frozen v1 adapted5,
unchanged. All5 pass with operationAborted=true, stageAborted=false, writes0,
reads1/returned1/active0, caller live, and server-close events before teardown.
The adapted helper binds `fs.readStream` options.signal at70-73 and curl's
authorization request.signal at77-78; it separately saves stage at95-96.
Its local producer explicitly enrolls an owned operation at80-91. Those are the
declared adapted bindings and semantics, not the unchanged original fixture.
This confirms cooperative cleanup for that separate cohort without promoting
unreached assertions in the original cohort to passes.

## Compatibility decision, not waiver

Known command implementations can enroll only their genuinely owned I/O before
acquisition. V1 already demonstrates this for cat with named operands and curl
stdout transfer requests. Necessary curl file/header tasks retain a separate
lifetime; borrowed stdin cannot be folded into stdout ownership. V2 adds the
explicit delayed preparation profile rather than cancelling shared input.

A generic handler receiving stage signal, stdout and arbitrary promises does
not reveal which tasks belong to stdout, whether stdin is borrowed, or which
resources can cooperate in cleanup. Automatically changing its stage signal or
wrapping its whole execution would cancel unrelated work and misstate opaque
promise ownership. Custom producers require explicit enrollment; no compatible
universal automatic inference is established.

The three WebDAV/curl original assertions require stageAborted=true. This is
logically incompatible with the new profile's stageAborted=false for owned
stdout cancellation. That exact incompatibility is retained as three failures,
not fixed through stage autocancel or fixture rewriting. The unenrolled local
producer remains a distinct real timeout. V2 reproduces the same four failures.
