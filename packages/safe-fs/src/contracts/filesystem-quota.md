# Filesystem quota accounting

`withFileSystemQuota(fs, { maxBytes })` uses a nonnegative safe-integer byte
ceiling. Its census sums each visible non-directory entry's `lstat().size` under
the filesystem root. It includes symbolic-link storage and counts each visible
hard-link entry separately. This is logical namespace accounting, not unique
physical storage, allocated blocks, process memory, or cumulative write traffic.

## Existing-file growth

Before increasing an existing file's size, admission accounts for every visible
file entry that is the same backing entry or cannot be proved distinct. Complete
identity tuples retain the filesystem contract's meaning: equal scope/device/
inode denotes sameness; different complete identities denote distinctness.
Physical `nlink` is not the number of entries visible through a composed
namespace. Repeated mounts of one backing file count separately.

When complete identity is unavailable, the wrapper may ask the backing
filesystem's optional `compareEntry` binding. Absence means unknown. Returned
values must be `same`, `distinct`, or `unknown`; any other result, including
`null` or `undefined` from a present callback, fails with `EIO` before writing.
Comparison failures and caller cancellation retain their identity.

Unknown file entries conservatively receive the proposed positive growth charge.
Consequently a write can be refused even when its actual resulting namespace
size would fit. This does not turn unknown identity into a sameness claim.
No file-content reads are needed for this census.

## Shrinking, streaming, and composition

Shrinking retains the prior single-entry credit. Read identity does not prove
that a later write mutates every alias: an overlay can copy up only the selected
view. The wrapper therefore does not multiply shrink credits across read aliases.
Later admissions recalculate the actual namespace census.

Writes, appends, copies, truncation, and each streamed append use the same
admission. Streaming preserves existing behavior: non-append streams truncate
first, and accepted earlier chunks remain if a later chunk exceeds the quota.
The wrapper does not roll back completed effects or buffer the whole stream.
Symbolic-link writes account for the followed file, not the link's own bytes.

The mutation queue serializes calls through one wrapper. It does not lock
external backend writers, independent wrappers, changing mounts, or a remote
provider. Identity observations are point-in-time evidence, not a lease or a
guarantee that a provider preserves inode identity during replacement.

This existing-file growth correction is not a comprehensive composed-namespace
quota guarantee. In particular, creating a previously absent file through two
mounts of the same empty backend can expose two namespace entries while the
existing creation path charges once. That separate pre-existing creation case
is not repaired here. Use an appropriately bounded backing filesystem when that
composition is required; do not infer protection from this contract's narrower
existing-file checks.
