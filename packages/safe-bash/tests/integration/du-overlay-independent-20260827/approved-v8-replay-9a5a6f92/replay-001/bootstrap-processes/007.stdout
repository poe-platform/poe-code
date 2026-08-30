# V8 frozen suite map

The historical original suite is the byte-identical 24-case artifact inherited
from v5. Its result is reported separately and is not added to the fresh 40-case count.
V8 does not change that verifier or its count.

The corrected `harness/verify-v5.mjs` suite emits the same 40 case records in three
non-overlapping lineages:

- 31 `historical-frozen-derived` records: 19 direct/read-only/mount-both-
  directions operation records; child-EIO failure/retry; exact pre- and
  mid-abort; two active-stage admission cases; the complete 16-row environment
  table as one record; explicit pending cleanup; normal mutation; ordinary
  content-read oracle; and upper-removal/content-read/copy-up mutants.
- 2 `postfreeze-lifecycle-addition` records: consumer-registered Overlay cleanup
  through Shell settlement, and actual Shell cancellation with exact caller
  reason plus exactly one registered DU cleanup execution.
- 7 `v5-observer-policy-control` records: real directory-listing atime, real
  lstat stability, observer-only file-read atime, file-atime scope mutant, and
  real non-atime-stat/byte/entry mutants.

Each operation record retains pending and active stage state, merged namespace
order, identities, comparisons, whiteouts, both mount directions, direct and
read-only views, action calls, full lstat-only pre/post objects and every field
delta. V8 retains v7's isolation of failure/retry, abort, queued and mutant byte/entry observers
from their lstat-only measured windows; only an actual same-layer directory
`readdir` can authorize a directory-atime delta. V5-023 now inventories only
with `lstat`, forces and proves an observable old file atime, then requires the
observer-only real-adapter read to produce exactly one file-atime delta while
all other stat fields stay exact. V5-024 separately proves its
forced-old file-atime precondition and requires both the rejected file-atime
delta and the narrowly authorized directory-atime delta. No traversal or count
policy was removed. The 16 environment rows remain one suite record; the replay
requires actual native spawn cwd on every row.

The invalid-packlist and timeout/grandchild checks are replay-protocol controls,
not product semantic cases, and are not added to the 40 suite records.
