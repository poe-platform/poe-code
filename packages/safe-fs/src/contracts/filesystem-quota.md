# Filesystem quota accounting

`withFileSystemQuota(fs, { maxBytes })` uses a nonnegative safe-integer byte
ceiling. Its census sums each visible non-directory entry's `lstat().size` under
the filesystem root. It includes symbolic-link storage and counts each visible
hard-link entry separately. This is logical namespace accounting, not unique
physical storage, allocated blocks, process memory, or cumulative write traffic.

## Census admission

The optional `maxScanEntries` and `maxScanDepth` settings default to 4096 and 64.
Both must be nonnegative safe integers; invalid values throw `RangeError` when
the wrapper is created. Omission or `undefined` selects the default, not `null`.
Scan settings are validated and captured once per wrapper. `maxBytes` retains
its existing meaning and validation.

Every census gets a fresh, global entry allowance shared by all its directory
listings. Each returned name consumes one entry, including directories, symbolic
links, hard-link aliases and repeated names. The root itself is not an entry.
The remaining allowance is forwarded as `readdir.maxEntries`. A reply larger
than that allowance is rejected before inspecting entries or issuing their
metadata/comparison work, even if the adapter ignored the listing limit.
The whole admitted reply is reserved, so shrinking it during awaited metadata
does not refund returned names. Iteration also admits extra entries beyond that
reservation, including entries appended while metadata work was awaited.

Depth measures directory traversal: the root is depth 0. A directory at the
configured maximum depth may be listed, including its non-directory children;
another child directory fails admission before descent. Thus depth 0 permits a
flat root census but refuses child directories, including empty ones. Symbolic
links are counted without changing the existing non-following census behavior.

Entry/depth exhaustion fails with `FsError` code `EFBIG`, distinct from the
existing `FileSystemQuotaError` for byte overflow. Backend errors and cancellation
are not converted into scan-limit errors. These limits also apply to shrinking
operations that require a census. Removing entries through existing delegated
operations can make a later census admissible again.

These are per-census traversal limits, not namespace-entry or aggregate-command
quotas. In particular, an empty census with entry limit 0 can admit a new file;
the next census will reject until the tree fits again. Separate mutations and
stream chunks each start a new census. Direct backend changes remain visible to
later censuses; there is no incremental usage cache or new cross-wrapper lock.

The limits bound the wrapper's admitted traversal, not arbitrary adapter work,
path lengths, host allocations, network/provider costs or total execution CPU.
Adapters that ignore `maxEntries` may allocate an oversized reply before it can
be rejected. No time, process-memory, preemption or linear-algorithm guarantee
follows from these settings.

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
first, and accepted earlier chunks remain if a later chunk exceeds the byte or
census limits. A first-chunk census refusal does not undo the initial truncation.
On refusal, iteration closes the source using its existing iterator cleanup.
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
