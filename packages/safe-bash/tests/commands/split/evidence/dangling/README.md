# Dangling output correction: baseline and regression evidence

Author source freeze: 1836795aed012ad734fedbd0ed56c2c98ab57f56; final author
handoff: 4244e9a. `author-*-original` files preserve the complete original
handoff, README, contracts test and final result without changing their claims.
The original 43-test evidence remains in the parent evidence directory;
`baseline-author43.tap` independently reruns those exact tests: 43/43 pass.
That count included an incorrect expectation of EEXIST for a stable dangling
final output symlink, not native-compatible behavior.

The expectation correction and added native regression precede the product fix
in a separate commit. `initial-corrected-tests.tap` records 29/31 passing tests,
two failing tests (corrected author expectation and aggregate native regression).
`native-initial.json` preserves all fixtures, exact status/stdout/stderr, recursive
namespace/file bytes/link targets, platform, binary pins, source hash and failures.
Its 11 GNU cases replay on two backends: 6/22 backend-case observations pass,
16/22 fail. These are 11 native inputs, not 22 independent inputs. Six successful
dangling creation inputs fail on both backends; missing-parent and completed-output
then missing-parent also fail on both. Loop, non-directory and input alias controls
already pass on both. No independent reviewer fixtures were inspected.

GNU9.7 is the supplied pinned Darwin binary, not GNU/Linux evidence. Apple is
recorded separately: the six positive inputs also create targets; negative statuses
are 74 rather than GNU's 1, and Apple's nested input alias run succeeds destructively.
Do not substitute Apple for the GNU input-protection policy. Native absolute links
are explicitly rooted under test scratch; snapshot comparison strips that exact
prefix only, while virtual links retain virtual absolute targets. This mapping is
fixture setup, not a changed oracle or altered native output bytes.

Primary references consulted through web.run: GNU Coreutils `split invocation`
and POSIX.1-2024 `open`. The latter specifies that O_CREAT plus O_EXCL rejects a
final symbolic link, including dangling links. Live documentation is context only;
local pinned captures govern the tested GNU9.7/Darwin behavior. No downloads or
native builds occurred. Negative diagnostics are separately asserted typed-error
human-readable profiles, with exact original raw strings retained, not blanket
stderr normalization. Successful outputs require exact empty stderr.

## Source correction and fixture-only corrections

`Outputs.destination` separates absent names from dangling final links. It follows
only the latter with supplied capabilities, delegates component traversal to the
VFS, and retains `wx` at a missing target. Existing-file identity and compareEntry
checks remain unchanged. There is no remove, rollback, host fallback, fabricated
identity or external hostile mutation protection. Stable missing-parent failure
now reports ENOENT rather than incorrectly rejecting the link with EEXIST.

`fixed-core-tests.tap` is 31/31 passing against the unchanged corrected/native
fixtures. `native-fixed.json` is 22/22 matching backend-case observations (11 GNU
inputs times two adapters), with Apple observations retained separately. Thus the
16 initial native mismatches were fixed in source, not by changing fixtures.

The additional contract suite first yielded 15/16 (`fixed-contracts.tap` retains
that raw initial result despite its phase-oriented filename). One new fixture
incorrectly assumed the MemoryFS budget diagnostic on RealFS. Inspection of
`src/fs/real/index.ts` operation wrapping shows it preserves EFBIG but reconstructs
the syscall/path message. The corrected RealFS assertion is the exact observed
`split: file too large, writeStream '/second'` plus newline; the MemoryFS assertion
is unchanged. Status and exact completed/partial file bytes remain asserted. This
is a disclosed fixture profile correction, not a product diagnostic fix or a
blanket waiver. Final contracts: 16/16 in `final-contracts.tap`.

`typecheck.log` retains three initial fixture errors from assigning undefined to
optional methods with exactOptionalPropertyTypes. The fixture now hides absent
methods through a truthful forwarding Proxy, as existing author fixtures do;
`final-typecheck.log` is the succeeding noEmit run. Neither correction changes FS
code, oracle inputs or the split source fix.

## Final scoped replay

`final-author60.tap`: 60 passed, zero failures/skips (historical43 with one corrected
expectation, one new native aggregate test, and16 additional contract tests).
`native-final.json` matches all22 backend-case observations; initial/final fixture,
argv and native profile snapshots are exactly equal. This is not an independent
verifier run. `final-noEmit.log` and `final-build.log` are successful empty logs;
the noEmit/build/consumer exit codes are recorded in `final-manifest.json`.
`final-compiled-consumer.jsonl` preserves both binary and dangling-link consumers.
The isolated build emitted88 files for44 imported modules into the owned ignored
`.build` directory only. Hashes were captured and `.build` then removed. No owned
native scratch remains. Source-only opt-in/default60 scope is unchanged.
