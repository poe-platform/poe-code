# #633: retire isolated inline-input snapshots

## Status and baseline

Root-integrated candidate, September 5, 2026; publication is not yet qualified.
On delivered #632, root reproduced six failures and 26 passes before applying
this patch. The expanded lifecycle selection then passed all 198 tests, including
the 32 new cases and #632 regressions. Root adds the literal discovery assertion
in `scripts/integration-inputs.test.mjs`. A shared full maintained gate with the
independently committed #631 fix subsequently failed; see the corrective evidence
below. The earlier focused pass was insufficient to qualify delivery.

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

## Corrective lifetime ordering, September 5, 2026

The incremental correction is against `ce043fa04c4ce7bec0e9354f5a8b020c49b08fac`,
whose runtime SHA-256 is
`ead11b1a6b9f68a876e2da97ba934786e1539a1b365f332c4c5156e669168f8a`.
The original #632/#633 candidates and logs remain unchanged. This correction was
prepared only in private scratch; root owns integration and full maintained gates.

The original scope closed in `simple` before its caller `executeCommand` finished
redirected outputs or emitted redirected expansion diagnostics. Because those
outputs were correctly enrolled in the snapshot scope, closing it early canceled
their operations. This caused spurious ECANCELED diagnostics on successful file
writes and suppressed redirected arithmetic/parameter diagnostics.

`executeCommand` now acquires and owns the optional snapshot scope when `simple`
requests isolation. Its work barrier remains held through prefix restoration,
output finalization, diagnostic emission, input/output cleanup and value-scope
cleanup. An outer `finally` releases that barrier and joins scope closure on every
exit. Snapshot creation timing, IO enrollment, error classification, budgets and
the #632 shared-binding retirement logic are unchanged. No limits or pooling were
introduced.

Private evidence directory:
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/tmp/633-correction.zUaJEE/evidence`.

- `regressions-red.log`: unchanged six failing cohorts reproduce all 11 leaf
  failures and five parent-batch failures: 48 total, 32 pass, 16 fail.
- `owned-red-corrected.log`: 32 original tests pass; all 11 new tests fail before
  the production change. They cover heredoc/here-string file completion,
  redirected parameter/arithmetic diagnostics, delayed streaming completion,
  and falsey caller cancellation while completion remains joined.
- `lifecycle-final.log`: 193/193 pass, comprising the original 182 non-public
  lifecycle controls plus the 11 added controls.
- `public-lifecycle-green-complete.log`: all 16 public lifecycle controls pass,
  including ten registered grep/rg scenarios and six source-binding negatives.
  Together these rerun the previous 198 controls plus 11 new controls (209).
- `regressions-final.log`: all 48 unchanged selected regression cases pass.
- `heredoc-adjacent-final.log`: 95/95 adjacent heredoc, fatal-scope and input-unit
  tests pass. The generated 65-depth and 8192-fragment cases were not executed.
- `redirect-adjacent-green.log`: 28/28 tiny redirect admission/ordering controls
  pass; the generated 64/65-redirect case was not executed.
- `types-final.log`: zero diagnostics under the actual package strict NodeNext
  options, with noEmit; 268 source files in the owned runtime/test import closure.

Harness corrections are preserved rather than erased: the first cohort run lacked
an authentic frozen-reference import, and the initial delayed-writer tests assumed
an optional capability method existed. Both were corrected before production RED.
The first public fixture attempts failed during setup, not lifecycle execution:
an obsolete prior peer chunk could not be copied, then a partial snapshot lacked
the current built SafeFS declaration import-map metadata. The successful run uses
the maintained bounded peer-admission API, current authenticated peer bytes, and
the authentic `packages/safe-fs/dist/package.json` resolution context. Their hashes
are recorded in `current-peer-binding.json` and `peer-resolution-context.json`.
Final non-public tests and types were rerun against that captured current peer.
These are private working-source qualifications, not committed-source or release
qualification. The public fixture stages and compiles its own isolated snapshot;
no live build, Git mutation, full gate, archived validator or large/deep probe ran.

Only runtime, this existing owned retirement test and this plan are in the
incremental patch. All other copied source/test inputs remain byte-identical to
their admitted baseline. Root's later #620/#622 commits leave these owned baseline
bytes unchanged; their registration changes are not part of this correction.

## Root correction validation (September 5, 2026)

Root authenticated all three owned baseline files after the independent #620 and
#622 local commits. The 11 added controls were applied first. Together with all
six previously failing files, the unchanged runtime produced 194 passes and 27
failures among 221 tests: the original 16 failures and the 11 new regressions.

After applying the exact corrected runtime and plan, the expanded root selection
passes all 387 tests with no skips. It includes every previously failing file,
the complete new retirement test, child dispatch, invoke, every adjacent
invocation-cleanup test, and input-return cleanup. No existing assertion, native
comparison, generated case, or public fixture was omitted from these selected
files. Root evidence is retained in
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/issue-633-correction-delivery.xqSCjc/`.

The failed full gate remains preserved in `issue-633-631-delivery.qjaUBg`.
A fresh full maintained gate is still required for the combined local fixes.
No push, issue closure, or release is implied by this focused correction result.
