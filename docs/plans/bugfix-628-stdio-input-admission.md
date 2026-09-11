# #628: bound stdio lines before readline accumulation

## Validated scope

Issue 628 is open and authored by `kamilio`. Its main HTTP concurrency claim is
not reproduced: the normal HTTP factory delegates to shared tool admission with
four active calls and a finite queue. The existing executed eight-session
control verifies that only four handlers start before capacity is released.
Do not change HTTP transport defaults or replace that queue with rejections.

The issue also requests a missing stdio line-length cap. Current stdio intake
passes input directly to `readline`; pending-message admission happens only
after a complete line arrives. Three bounded source-level controls submitted
64, 256 and 1024 bytes in 16-byte chunks with one pending-message slot and a
1024-byte output limit. All remained pending without a response until the line
terminator, then produced a parse error. Source inspection establishes the
absent pre-line byte policy; these controls do not prove OOM or measured severity.

## Implementation and configuration

Add `ServerOptions.maxStdioLineBytes`, a positive safe integer defaulting to
1 MiB. It limits UTF-8 input bytes per line, excluding CR/LF terminators, on
`connect` and the `listen` route that uses it. It is independent of pending
messages, output bytes and tool concurrency. SDK message transports and HTTP
request admission are unchanged. The HTTP factory already forwards ServerOptions;
its HTTP path does not acquire this stdio-only policy.

A private Transform admits chunks before forwarding them to the existing
readline parser. It counts bytes incrementally, preserving Buffer decoding,
raw string chunks, split surrogate pairs, CR/LF/CRLF, and the final EOF line.
It forwards admitted preceding lines but never forwards an over-limit remainder
or later lines after connection failure. It does not replace JSON-RPC parsing.

On failure, detach the owned transform, close its readline interface, pause the
borrowed source, and preserve the existing session/output failure cleanup.
On successful EOF settlement, detach and dispose the owned transform without
destroying the caller's source or destination. This bounds line accumulation;
it is not a total-memory guarantee or protection against memory already allocated
by a caller, native stream or transport. Existing pending/output caps still apply.

No README additions, dependencies, workflow changes or HTTP-default changes.
Owned integration paths are server.ts, types.ts, new stdio-input.ts, new
stdio-input-limit.test.ts, and this plan.

## Private TDD evidence

Private root:
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/628-candidate.dQCYQo`

Baseline source hashes:

- server.ts: `a72f286fc0ca61911d65d8f217000921a69de4dd154d8d2d36f9ec7bc5e55c70`
- types.ts: `da733182f9754bbc8269e7f5cf28420d1bd644b90da8ea7cb3300332c2b188ea`

Initial 18-test RED before implementation: 12 failures, six passes. The final
21-test cohort against independently copied, hash-identical baseline source:
13 failures, eight passes. New cases include the actual default 1 MiB bound and
falsey input error identity. No assertion was weakened to make the candidate pass.

Candidate: all 749 tests in all eight stdio test files pass, including the 21 new
cases and unchanged backpressure/SDK integration controls. The supported package
source TypeScript check and a separate new-test/import-closure strict check pass
with the actual package compiler options. Largest control is a single bounded
1 MiB plus one-byte Buffer, not an OOM or timing experiment.

Preserved harness failures: the first private whole-suite configuration omitted
the maintained Vitest globals, producing an `afterEach` setup failure after 463
other passes. The corrected harness uses the maintained globals and setup file.
An additional all-existing-tests TypeScript experiment reports existing SDK/type
diagnostics outside the package's maintained source-only build scope; those tests
were not edited or claimed type-clean. All original logs remain under evidence/.

## Delivery

Root reproduced the final cohort against unchanged current production source:
13 failures and eight passes. After integration, all 749 tests in the eight
stdio package files pass. The integrated source bytes match the private candidate.
The normal workspace build and maintained `npm test` route pass, including all
declared workspace unit tasks and native pre/post stages. The main Vitest cohort
reports 30,524 passing tests and 42 skips; Safe Bash reports 19,963 passing tests
and 63 skips. The other declared unit tasks also pass.

The initial full lint guard rejected transient checkout-root directory identity
drift (link count 19 to 21), with zero code diagnostics. Its complete failure
receipt is preserved. With unchanged candidate source and HEAD, a separate full
`npm run lint` retry and `npm run lint:packages` both pass. No identity guard,
source assertion, hook, or test was bypassed. These checks are not a completed
commit, push or release; incoming main changes still require integration checks.
Close 628 only after verified remote-main
delivery, explaining the corrected stdio subclaim and the already-bounded HTTP
path; then monitor publication separately.
