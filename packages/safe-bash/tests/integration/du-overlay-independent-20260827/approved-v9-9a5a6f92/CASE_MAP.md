# V9 frozen suite map

The historical original verifier remains the byte-identical 24-case artifact
inherited through v8. It is reported separately and is not added to the fresh
40-case count.

The corrected `harness/verify-v5.mjs` still emits exactly 40 records in three
non-overlapping lineages:

- 31 `historical-frozen-derived` records: 19 direct/read-only/mount-both-
  directions operation records; child-EIO failure/retry; exact pre- and
  mid-abort; two active-stage admission cases; the complete 16-row environment
  table as one record; explicit pending cleanup; normal mutation; ordinary
  content-read oracle; and upper-removal/content-read/copy-up mutants.
- 2 `postfreeze-lifecycle-addition` records: consumer-registered Overlay
  cleanup through Shell settlement, and actual Shell cancellation with exact
  caller reason plus exactly one registered DU cleanup execution.
- 7 `v5-observer-policy-control` records: real directory-listing atime, real
  lstat stability, observer-only file-read calibration, independent
  content-read/file-atime scope mutant, and real non-atime-stat/byte/entry
  mutants.

Each metadata/DU record retains pending and active stage state, merged
namespace order, identities, comparisons, whiteouts, both mount directions,
direct and read-only views, action calls, full lstat-only pre/post objects, and
every field delta. Only an actual same-layer/path directory `readdir` can
authorize a directory-atime delta. File atime and every non-atime delta remain
unauthorized. Byte and entry observers remain outside action lstat windows.

V5-023 executes and hashes the locked real-adapter content read, records whether
the forced-old atime survived to the pre-read sample and whether atime advanced,
stayed stable, or regressed during the read window, and rejects every non-atime
change. Its calibration no longer asserts that every provider read must advance
atime.

V5-024 independently detects the actual content-read violation from its
instrumented call log and locked byte hash. Its intentional host `utimes`
perturbation sets the actual file atime to a fixed future value and proves that
the complete delta policy rejects the file-atime field. Any accompanying
non-atime delta remains in the unauthorized set. Its actual directory listing
can authorize only the exact root-directory atime delta. The existing real
directory-listing calibration continues to require a visible directory-atime
change.

No traversal, byte, entry, mode, identity, ownership, timestamp, content-read,
copy-up, explicit-mutation, cancellation, cleanup, admission, loader, consumer,
package, or process control was removed. The 16 environment rows remain one
fresh record and one separately executed native table. The invalid-packlist and
timeout/grandchild checks remain replay-protocol controls, not semantic cases.
