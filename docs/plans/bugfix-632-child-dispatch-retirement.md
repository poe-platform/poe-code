# #632: retire completed child-dispatch ownership

## Status and scope

Root-validated implementation, September 5, 2026. Publication is tracked separately.
Source snapshot: `1731b41cbf83be4f75aeac2a70fd5c8d11424fe8`.
The original read-only evidence and its 51 controls remain unchanged.
Root owns live integration, literal test registration, Git and maintained gates.

Root reproduced the identical 17-test cohort on unchanged production at
`34a025dcbdcfdb60fe18005aa99c2b50a4ac1c20`: 12 passes and five failures.
After applying the candidate bytes, the expanded lifecycle/invocation selection
passes all 166 tests, and the discovery registration suite passes all 98 tests.
Root additionally changes `scripts/integration-inputs.test.mjs` to retain the
new regression in actual discovery. The normal workspace build, maintained
`npm test` route, complete `npm run lint`, package lint and Safe Bash
`typecheck:all` all pass on the frozen candidate. The main Vitest cohort reports
30,578 passes and 42 skips; Safe Bash reports 19,980 passes and 63 skips.
Every other declared workspace unit task also passes. Unavailable optional
profiles are not counted as passes, and no hooks or identity guards are bypassed.

Changed production paths are limited to `src/shell/cleanup.ts`,
`src/shell/arrays/state.ts`, and `src/shell/runtime.ts` in safe-bash.
Register `packages/safe-bash/tests/shell/child-dispatch-retirement.test.ts`.

## Validated mechanism

Completed invocation scopes remain linked to their parents and retain cleanup
captures. Invoked state snapshots additionally register monitor cleanup at the
root and retain bookkeeping until root teardown. Their `ValueStore.close()`
calls alone do not retire the snapshot ownership. These are within-invocation
retention findings, not evidence of a particular native allocation size, OOM,
RSS growth, or leakage after root execution returns.

## Candidate design

- Drain registered cleanup, admitted work and children before detaching a child
  scope. Consume the cleanup callback array. Keep the shared failure ledger so
  already-closed child failures and subsequent recorded failures still reach root.
- Give an invoked snapshot a private session ownership tree and monitor set,
  sharing existing value/array budgets rather than resetting or changing limits.
  Register its cleanup before acquiring snapshot resources.
- After invocation work drains, close monitor values, remove owned bindings with
  awaited reference release, clear monitor captures, and close the owner tree.
  Parent state, shared binding references and public output ownership stay intact.
- Do not copy inherited restoration frames for the invoked-command path: that
  path already clears `child.locals` before executing. The earlier copy retained
  saved indexed bindings that the child could never restore. Other snapshot
  callers keep their existing frame-copy behavior.
- Do not pool runtimes, share mutable environments, change defaults, or treat
  logical ledger charges as native allocation sizes.

## TDD and bounded evidence

Evidence directory:
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/tmp/632-candidate.2UaqME/evidence`.

- Initial RED: 3 retention failures and 7 passing lifecycle controls before the
  production patch (`retirement-red.log`).
- A subsequent valid tiny local-array control exposed saved binding references
  rising 2/3/4/5 instead of remaining 1; fixed before final GREEN.
- Final identical regression file: original baseline 12 pass / 5 fail; candidate
  17/17 pass. Final RED and GREEN use the same privately captured dependency bytes.
- Candidate focused regression plus four adjacent in-memory invocation/cleanup
  files: 77/77 pass (`focused-green-isolated.log`).
- Rebound copies of all prior probes: 20 operation controls plus 31 lifecycle
  controls pass. The originals are untouched.
- Actual package strict NodeNext options, no emit, four explicit owned roots:
  zero diagnostics (`types-isolated.log`, `type-options.json`). This is not the
  maintained full source/type gate.
- For 1/2/4 xargs or direct child calls, sampled active logical metadata after
  each child settles is zero, and only one root monitor callback remains.
  All active ledger counters are zero after root cleanup. Reservations still
  occur and some operation counts increase; this is not an allocation-free path.

Tests cover closed admission, late admitted work, child/root joining, falsey
failures including already-closed children, sibling success, parent cancellation,
failed environment setup, local indexed restoration, shared bindings and output.

## Evidence corrections and limitations

The first array fixture incorrectly combined declaration and compound assignment;
the unsupported syntax failure is preserved, not counted as a product RED.
An intermediate replay failed to load SafeFS while root rebuilt live dist files.
The final replay instead uses a regular-file/size-admitted, hash-recorded 62-file,
431472-byte authentic SafeFS runtime/declaration closure. Tool dependencies remain
the existing Node/tsx/TypeScript installation. No native validators, build, full
gate, Git mutation or live source edit was performed by this candidate task.

Separate #633 probes confirm the heredoc registered-command isolation path still
uses an unscoped snapshot. This candidate removes closed scope links there but
does not retire those state snapshots early. Its assessment and evidence are
separate; no heredoc limits or further production changes are included.
