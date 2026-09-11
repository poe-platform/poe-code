# Async-generator replay readiness

## Reproduction

The undefined full run exposed two async-generator snapshot restoration
failures in sources that do not mention undefined. Focused run 14445 reproduced
both. A built-runtime dump inspection showed a guest-generator referencing
driver 517, whose request capability referenced replay-only promise/resolver
metadata instead of durable typed heap nodes. The prior active-reaction replay
fix allowed this intermediate capture; it must not emit mixed representations.

## Repair

During trusted dump indexing, inspect async-generator request promises for
replay-only connected components. If one exists, raise SnapshotNotReadyError.
The public dump controller already defers unfinished captures with that error
until a later stable boundary. Keep untrusted validation unchanged and preserve
trusted replay for the ordinary two-promise harness recovery case.

Focused run 43517 reported all 90 tests passing across async-generator behavior,
harness recovery and trusted replay. Confirm process completion and run broader
snapshot checks, lint and build before a separate commit/push. The unrelated
undefined parser candidate remains uncommitted and is not part of this repair.

The input-error-projection file passed all 11 tests after the overlapping build
finished (88989), supporting the diagnosed build/test artifact race. Future
full tests must start only after maintained builds finish.

Run 43517 exited successfully. Broader run 7462 passed 1,445 tests across
88 files, including all snapshot tests and public dump/restore/harness recovery.
Candidate ESLint 81792 passed. Main was fast-forwarded to 1ae8f83e2 after those
tests completed; protected user staging retained patch hash
d770ec782b2a4ae7e2580e63ded765933890a1c5. Maintained build 49299 is now active.
No new commit or push of this readiness repair is claimed yet.

Build 49299 completed successfully: 23 workspace builds and four fresh-process
import checks. Delivery is scoped to dump-format.ts and this plan, using the
existing red/green async-generator recovery regressions. The parser candidate
and all protected user files remain outside this commit.
