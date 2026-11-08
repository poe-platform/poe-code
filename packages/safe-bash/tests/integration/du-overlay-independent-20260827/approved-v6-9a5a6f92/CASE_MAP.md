# Frozen suite map

The historical original suite is the byte-identical 24-case artifact inherited
from v5. Its result is reported separately and is not added to v6 counts.

The byte-identical `harness/verify-v5.mjs` suite emits 40 case records in three
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
delta. No traversal or count policy was removed. The 16 environment rows remain
one suite record; v6 additionally requires actual native spawn cwd on every row.

The invalid-packlist and timeout/grandchild checks are replay-protocol controls,
not product semantic cases, and are not added to the 40 suite records.
