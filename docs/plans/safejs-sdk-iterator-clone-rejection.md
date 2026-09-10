# SDK structured-clone iterator rejection

## Validated gap

Six native-comparison cases failed before implementation (86f5e2): array,
typed-array, string, Map, Set and RegExp-string iterators returned TypeError
instead of DataCloneError from the low-level structured-clone copy path.
The failure messages came from ordinary data-copy/prototype restrictions, not
structured-clone admission.

Reject the existing array, string, collection and RegExp iterator brands before
ordinary copy handling when structured cloning is requested. Tests cover fresh
and exhausted iterators, direct and record-nested input. Ordinary copying and
portable snapshot behavior are not changed by this guard. This does not claim
coverage for iterator helpers, wrappers or other untested iterator kinds.

## Verification

- Node 22: all 177 tests in the 16 filename-selected structured-clone files pass.
- Node 18.18.2: all six new native-comparison cases pass.
- Package TypeScript no-emit check passes.
- Focused lint passes for values.ts and the new regression file.

Only the three-line iterator guard, its regression file and this plan belong in
the atomic commit. Other uncommitted values.ts work and unrelated staged Safe
Bash changes remain untouched. Full-suite failures and broader integration stay
open. Local commit only under the release hold; no push, publication or issue
closure. No CLI appearance changes.
