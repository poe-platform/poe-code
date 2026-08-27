# Approved bounded fixture qualification

Root authorizes fixture/profile qualification only. Production chmod, filesystems,
contracts, root configuration and immutable reports stay read-only. Evidence was
sealed first in commit `9fa86b2fd23525bfa4ab944fef404654ce90c9d6`.

## Narrow change and ordering

Only the first native mode-transition test in `chmod-controls.test.ts` and the
first test in `native-differential.test.ts` opt into a new owned fixture helper.
The generic namespace/oracle helpers and every other fixture remain unchanged.
The helper accepts the test-created `.native-*` root and explicit direct-child
file/directory names. Before changing anything it verifies the namespace, real
non-symlink paths, caller ownership and an ordinary same-real/effective-identity
process. It uses only builtin `fs.chown(target, originalUid, callerPrimaryGid)`;
that group must be the caller's effective primary group. It verifies ownership,
group and entry identity after establishment. No ambient group changes, privileged
setup, arbitrary group selection or symlink following are permitted.

Group qualification occurs after native objects are created and BEFORE any
initial setid mode is applied. A returned `setMode` operation verifies qualified
ownership/group, applies the original requested initial mode with builtin
`fs.chmod`, and reads it back, requiring exact `07777` bits before the oracle or
virtual command runs. Missing capabilities, unsafe paths, failed chown/chmod,
wrong group, changed identity or unrealized initial mode fail with an explicit
`metadata permission prerequisite` error; there is no skip or weakened comparison.
These checks are trusted test-fixture preconditions, not a race-proof product API.

## Preserved vectors and disclosed delta

Preserve the full original 384-iteration seed, PRNG, file/directory alternation,
24 mode strings, four umasks, literal command argv, status/mode comparisons and
file bytes. Preserve all 4 x 12 directory-setid controls and their comparisons.
No mode, iteration, assertion, denominator or command operand is removed.

The deliberate metadata delta is verified native membership in the caller's
primary group instead of inherited host group selection, plus exact initial-mode
verification. In particular requested06755 must now actually establish06755.
This is NOT unchanged-all-input evidence: original Darwin nonmember setup measured
04755, and GNU1 versus Node0/MemoryFS0 outcomes remain separately sealed.

## Separate profile and prerequisite controls

Authenticate all25 sealed files and original17 transitions, retaining the
historical-requested-versus-newly-measured distinction. Name fresh representative
nonmember controls explicitly `Darwin9.7/Node22 divergence characterization`;
they preserve GNU failure versus Node/RealFS/MemoryFS success and mode/ctime
differences, not pass a GNU equality assertion. They require the authenticated
installed Darwin GNU9.7 binary, Node22 profile, nonprivileged uid and inherited
nonmember gid0 on newly owned `/tmp` objects. They never chgrp to an unauthorized
group. An unavailable profile fails a clear prerequisite, never silently skips.

Also test genuine member-group SGID success, rejection of unsafe qualification
paths, and normal directory-search denial with raw Node EACCES, typed RealFS
FsError(EACCES), command failure, unchanged child modes/ctime/bytes and separately
preserved diagnostics. Profile observations are reported separately from qualified
native parity counts. No Linux or OS-universal inference is permitted.

## Validation and author checkpoint

Run only the complete384 cohort, all chmod-controls tests, and new archive,
qualification/profile/denial regressions. Record source/test/helper hashes,
vector preservation, exact commands, oracle/host identity, counts, fixture cleanup
and concurrent git status. No source build, dependency change or whole gate.
Commit qualification and new tests/evidence separately from the sealed archive,
using explicit owned paths and `git commit --only`. Independent review follows
the author checkpoint; author success is not independent acceptance.
