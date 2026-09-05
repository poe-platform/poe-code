# #633: retire isolated inline-input snapshots

## Status and baseline

Root-integrated candidate, September 5, 2026; publication is not yet qualified.
On delivered #632, root reproduced six failures and 26 passes before applying
this patch. The expanded lifecycle selection then passed all 198 tests, including
the 32 new cases and #632 regressions. Root adds the literal discovery assertion
in `scripts/integration-inputs.test.mjs`. A shared full maintained gate with the
independently committed #631 fix remains pending before either is pushed.

The baseline is the frozen #632 candidate, not unpatched main:

- #632 patch SHA-256: `17eb8cf1d8a8a129b023a48ebca4c53787f76d13115019e25664d713db3462a5`.
- Baseline runtime SHA-256: `4f3a210430bb4539d51c77d1365a2653b211f709f651fcdd1cdb32a19cddce96`.
- #632 files and evidence remain immutable. Root owns integration and registration
  of `packages/safe-bash/tests/shell/inline-input-retirement.test.ts`.

## Confirmed cause and bounded change

Registered commands with heredocs/here-strings use `isolatedInlineInput` in
`Runtime.simple`. This clones state without a dedicated owner and retains monitor
callbacks and bookkeeping until root cleanup. The tiny cat controls execute
neither `invokeChild` nor shebang dispatch. This is not evidence of the issue's
claimed native-byte amplification or OOM magnitude.

Only `packages/safe-bash/src/shell/runtime.ts` changes in production:

- Create an inline snapshot scope before cloning and route dispatch through it.
  Reuse the #632 scoped-session ownership mechanism without changing array/state
  code, limits or defaults.
- Track a completion barrier through assignment/overlay restoration. Cancellation
  may seal admission, but owned state cannot retire before admitted restoration
  work finishes. Always resolve the barrier and join scope closure in `finally`.
- Separate local-frame inheritance from scope ownership. Inline snapshots retain
  inherited frames; explicit command invocation continues discarding those frames
  exactly as in #632.
- Release unused copied saved-binding references when their tickets retire.
  Register a waiter for owner completion and any asynchronous binding release;
  record falsey failures through the shared cleanup ledger and join the work.
- Keep expansion order, prefix environment isolation, outer value-arena/output
  ownership and existing input disposal/error classification intact.

## TDD and validation

Evidence:
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/tmp/633-candidate.YQEpWL/evidence`.

- Initial RED preceded production edits: 19/24 passed, five failed.
- The initial plateau expectation also included legitimate first-use parent
  wrapper enrollment. A bounded observation found five one-time wrappers, with
  active logical metadata 2304 then 3264/3264/3264/3264. Preserve that enrollment;
  the corrected test compares post-first-use samples. Initial test/logs remain.
- A deferred-binding-release control exposed an intermediate unjoined release.
  One event-loop turn was insufficient because of existing internal checkpoints;
  four bounded turns exposed RED. Both runs are retained; no timing inference.
- Final identical 32-test file: #632 baseline 26 pass / six fail; #633 candidate
  32/32 pass. RED is `retirement-red-final.log`.
- Candidate plus unchanged #632 retirement and four adjacent in-memory lifecycle
  files: 109/109 pass (`focused-green-final.log`).
- All 51 earlier operation/lifecycle controls pass via rebound private copies.
  Nine separate heredoc/builtin/file observation controls also pass.
- Strict NodeNext no-emit check, using actual package options and only runtime/new
  test roots: zero diagnostics (`types-final.log`, `type-options.json`).

Coverage includes 1/2/4 commands during a live root, root callback retirement,
copied local bindings and restoration, quoted/skipped expansion, prefix timing,
UTF-8 expansion boundaries, falsey command/cleanup/cancellation/input-disposal
failures, delayed input close, returned bytes and asynchronous binding retirement.
No archived/native validators or large/deep/stress inputs were executed.

## Limits and handoff

This patch contains only runtime, the new test and this plan. Its base is #632;
do not apply it independently to pre-#632 source or modify the frozen #632 patch.
Tests use the same hash-recorded private SafeFS dependency closure as #632, plus
existing Node/tsx/TypeScript tooling. These are focused results, not full-gate or
public-release qualification. Logical reservations are not native allocations;
no heap/RSS/OOM/default-cap claims are made.
