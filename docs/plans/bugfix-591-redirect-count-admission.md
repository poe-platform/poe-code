# Fix #591: per-command redirect admission

## Validated gap

Three repeated redirects to descriptor 3 were accepted with command and
expansion-field limits of one. Each performed access/stat checks. Streaming
Memory inputs performed no byte reads, while the non-streaming fallback eagerly
read an eight-byte file three times with independent eight-byte input allowances.
The gap is redirect-operation count, not missing per-input byte validation or
universal eager streaming reads. No large-resource or historical timing claims
were reproduced.

## Accepted scope

Add nonnegative-safe-integer `ShellLimits.maxRedirects`, default 64 in both normal
and Worker profiles. Each executed command's redirect list is admitted before
target expansion, descriptor mutation or redirect IO. Check the current runtime
signal first, preserving caller and local cancellation priority. Count every
list entry, including parser-inserted `|&`, rather than distinct descriptor IDs
or paths. Zero allows commands without redirects. Nested and sequential command
lists are independently admitted; no retained reservation is needed.

Preserve below-cap left-to-right effects, descriptor aliases/moves, buffered
fallback timing, per-input `maxInputBytes`, and the preceding output-buffer fix.
This is not a total execution byte, filesystem-call, remote-request or memory
quota. Source and expansion admission remain separate. No README changes.

## Implementation and public evidence

- Extend ShellLimits, runtime defaults and the Worker profile.
- Check at the shared Runtime.redirect entry used by simple and compound
  commands, functions, eval/source/sh and command substitution.
- Register `tests/shell/redirect-limits.test.ts` literally in maintained discovery.
- Exercise the public constructor option in the existing strict source-consumer
  fixture; retain its other checks and exact consumer membership.

## TDD and checks

The initial 28-case run had 25 failures, including five fixture mistakes caused
by naming a custom command `local`, which selected the shell builtin. Correcting
only that test name gave the valid pre-implementation baseline: 20 failures and
eight passing preservation/cancellation controls.

The first implementation run passed 27 cases; the remaining fixture incorrectly
expected function definitions to persist across separate Shell.exec calls.
Keeping definition and invocation in one script corrected that fixture. All 28
focused cases then passed.

Focused coverage includes zero, exact cap, overflow, default 64/65, repeated
same-FD redirects, simple/compound and inline inputs, implicit pipe-stderr
duplication, early IO/expansion refusal, sequential/nested reuse, eval/source/sh,
literal invoke, local overrides, invalid values, left-to-right effects, eager
buffered inputs and falsey caller/local cancellation.

Run focused tests, related input/descriptor/inline-input/streaming suites, exact
discovery and the maintained selected virtual-bash build. The root owner runs
the current public-consumer route, guarded lint and independent review, then
owns atomic Git delivery and release monitoring.

## Integration checks — September 4, 2026

- Integrated remote #557–#559 fixes at `3deecc0c4`, preserving their registration
  and all unrelated user staging. After bounding the fixture described below,
  the complete selected shell/output and incoming grep/awk/stat cohort passed:
  2,129 tests, zero failures, cancellations or skips.
- Integrated remote #609 at `cecd806a8` before the final lint run. Its public
  export/provider changes do not alter the reviewed #591 runtime or tests.
  The normal `npm run build` passed, including root suffix stages.
- On that combined candidate, 235 redirect, shell-language, public-cleanup and
  bounded-provider tests passed with no failures or cancellations. This is a
  scoped follow-up, not a claim that the earlier 2,129-case run used #609 inputs.
- Maintained consumer typechecking passed three source groups, 25 packed groups
  and three exact negative controls against the rebuilt candidate. The global
  legacy-fixture typecheck issue is not claimed fixed.
- Packaging unit tests passed (2/2). Fresh local artifacts, version
  `0.0.0-issue591`, installed successfully into a temporary consumer; the
  maintained browser fixture bundled and ran, and portable-search public types
  passed strict NodeNext checking. This is local browser-bundle evidence, not
  workerd execution, registry publication or #609 release certification.
- Public-import smoke confirmed exact-cap success, overflow before filesystem
  access, and the Worker default of 64. Independent #591 review passed its
  focused suite, nine additional cases and the #589 preservation subset.
- The original pre-integration lint and the first integrated lint were stopped
  intentionally when inputs required integration or the validated fixture fix.
  Their exit-143 logs are retained and do not count as passes. Run the final
  maintained lint only after these source edits are stable.
- Final `npm run lint:eslint` completed successfully on the combined candidate:
  9,656 configured inputs linted, zero errors or warnings, all 25 receipts.
  `git diff --check` passed. No full `npm test` or general host/runtime
  preemption claim is made by these scoped checks.

### Integrated verification: bound broken-pipe fixture work

The first integrated cohort finished with 2,128 passes and one cancelled test:
the broken-pipe upstream-cancellation fixture exceeded its 2,000 ms timeout.
An unmodified focused rerun passed in 465.944 ms. Bounded instrumentation showed
26,216 successful five-byte writes across its two executions at the default
64 KiB pipe capacity, versus two successful writes with a one-byte capacity.
Both profiles observed EPIPE with the signal aborted and retained exit statuses
0 and 141 without/with pipefail. This supports bounding incidental fixture work,
not a claim that a runtime cancellation bug was found or fixed. Set only that
fixture's pipe capacity to one byte; retain its timeout and every assertion.
