# Issue #588: bound encoding and checksum input consumption

## Validated gap

With shell `maxInputBytes: 8`, a 64-byte exec stdin or named file reaches
encoding/checksum commands in full. Redirected `<` input correctly fails with
EFBIG. The shell limit is intentionally per redirected input; these commands
stream with bounded working storage but lack a practical total-read budget.

## Scope and policy

- Add separately configurable encoding/checksum `limits.maxInputBytes`, default
  32 MiB cumulative per command invocation. Validate nonnegative safe integers;
  zero accepts empty EOF and zero-count commands retain no-read behavior.
- Route options through direct factories, byte family factories/plugins, and
  aggregate `bytes` options. Compression and shell limits remain unchanged.
- Admit each whole source chunk once before codec/hash processing, including
  ignored/skipped bytes and both checksum manifests and referenced data.
- An over-cap read produces sticky EFBIG and stops the invocation before later
  file acquisition or resumption of paused manifest reads. Exact-cap EOF succeeds.
- Preserve cancellation priority, cleanup, byte ownership, streaming backpressure,
  empty-chunk yielding, and ordinary per-file error continuation.
- This is not pre-admission of producer-owned allocation, a zero-byte-work bound,
  a total process-memory limit, or a universal shell input budget.

## Verification

Write small in-memory failing tests before implementation. Cover all eight
commands, exact and over-cap input, zero/invalid options, cumulative files,
manifest-plus-data accounting, sticky exhaustion, public routing, independent
invocations, unchanged compression/redirection, and falsey cancellation cleanup.
Run focused tests followed by maintained family/lifecycle and integration
registration checks. Root coordinates build, strict consumers, lint, Git, and
release delivery. No README additions are authorized.

## Verification record

- Before runtime changes, 17 of 18 new tests failed; all 18 pass afterward.
- The author's eight-file related cohort passes all 209 tests, and the maintained
  discovery-registration check passes.
- Independent read-only review passes 109 selected tests and ten additional
  falsey source-finalization cases; no concrete regression was found.
- The complete selected byte/byte-stress suites plus root-export and byte-ownership
  coverage pass all 499 tests with no skips. These overlapping cohorts are not
  additive counts or a claim that the entire repository suite was run.
- The maintained full build passes, including its root suffix stages. A direct
  `poe-code/safe-bash` smoke verifies independent encoding/checksum thresholds
  and unchanged compression behavior.
- Guarded lint passes with 9,648 configured/linted files, no errors/warnings,
  and 25 boundary receipts before the subsequent #585/#608 follow-up edits.
- The maintained consumer check is not green: all 25 packed groups and all
  three exact negative-diagnostic checks pass, but three source groups compile
  and then fail a peer/candidate ownership assertion. This is tracked as #608;
  do not suppress that failure or claim complete consumer acceptance.
- Remote delivery remains required. Publication is tracked separately from
  issue closure.

The #608 repair now restores the maintained consumer gate: all three source
groups, 25 packed groups and three unchanged negative-diagnostic groups pass,
including after integrating remote 5fd0a94cd and a fresh public build. The
combined budget/guard/plugin cohort passes 78 tests after that integration.
Guarded lint passed with 9,649 files, no errors/warnings and 25 receipts before
the incoming WebDAV-only integration; the byte-command candidate is unchanged
since that check. Deliver the gate repair before this candidate in separate
commits; do not combine their issue scopes.

## Implementation evidence

The initial focused run failed 17 of 18 tests against the unchanged runtime;
the existing cancellation-priority control passed. After implementation all
18 focused tests pass. The eight-file encoding/checksum, byte-plugin, aggregate,
and new-budget cohort passes 209 tests without skips. Scoped diff checking passes.
Root validation and delivery remain separate acceptance steps; see the current
verification record above for completed checks and the consumer-guard failure.
