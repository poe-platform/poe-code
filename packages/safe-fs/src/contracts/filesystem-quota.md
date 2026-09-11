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

## Retained writable resizing

The quota view explicitly guards `openResizeFile`; its generic proxy forwarding
must not expose the backing writable handle. Support requires affirmative
selected-path `retainedResize`, a callable backing opener and no readonly
restriction. Capability admission uses the retained-resize helper, including
interruptible pre-acquisition capability queries. An opaque capability promise
does not become a resource-retirement barrier or permit a late open after abort.

The initial quota profile additionally requires a regular-file handle with a
complete `identityScope/dev/ino` tuple. Unknown identity fails with `ENOTSUP`
after retiring the acquired handle. Invalid handle sizes or subsequent identity
changes fail with `EIO`. The wrapper copies observations before awaiting its
census and never rebinds the handle to a later occupant of the opening pathname.
No `compareEntry` call using that pathname can establish the retained identity.
Known preferred-I/O-block observations are forwarded without synthesis.

Retained resize handles preserve a backing `seekEnd` only when it is available.
The method is captured once during acquisition and invoked with the original
handle receiver, preserving its exact bigint result without content changes,
namespace census or quota charges. End seeking shares the mutation queue and
cancellation checks of handle metadata work; close drains an in-flight seek
before retiring the resource. Retained read handles are forwarded unchanged,
including their optional end-seeking support.

Acquisition, handle metadata operations and resizing share the wrapper's mutation
queue. Every resize validates a nonnegative safe-integer length and performs a
fresh bounded namespace census before calling the same backing handle. The
retained census validates non-directory sizes and sums them with exact integer
arithmetic. Its entry and depth limits also apply to shrinking and same-size
operations; no content reads or zero-buffer emulation are used for accounting.
Backing allocation, retained-storage and permission policy remain in force.

Namespace `readdir` and `lstat` promises used by the retained census are opaque
metadata, not owned handle work. Caller cancellation interrupts those waits,
including the pre-creation census before any handle exists. Their eventual
fulfillment or rejection remains observed, but cannot resume the canceled
census, open a file or resize a handle. The quota queue can then admit other
work without waiting for that metadata to settle. The census is never skipped
for an operation that proceeds; limits and alias accounting remain unchanged.
Legacy pathname mutation routes retain their existing metadata-wait behavior.

For each visible file with the pinned complete identity, positive admission
covers any increase from that visible entry's observed size to the requested
length. Every incomplete-identity file is a possible alias: it receives the
larger of the handle's positive size delta and any positive increase from its
own observed size to the requested length. Complete distinct identities receive
no growth charge. Hardlinks and repeated mount views count independently;
physical `nlink` does not limit their namespace multiplicity. When the census
finds neither a matching nor a possible alias, positive handle growth is still
charged once conservatively.

Shrink credit is limited to one freshly confirmed visible alias and to the
smaller of its observed size and the handle's observed size. Unknown aliases,
replacement pathname occupants and an entirely unlinked handle supply no shrink
credit. The remaining entries retain their full census charges. This can reject
a resize whose actual resulting namespace would fit; it must not release quota
using a stale opening-path size or an unsupported alias assumption.

When `create` is true, a bounded exact census must fit the byte quota before the
backing opener is entered. This conservative admission also runs if the target
already exists. Malformed sizes, census exhaustion, cancellation and byte-quota
failure prevent the creation effect. A conforming missing-file open creates a
zero-length file without creating parents. Its zero-byte aliases need no growth
reservation; every later resize censuses the now-visible aliases. Thus this
route does not inherit the older nonzero absent-file write's single-mount charge
gap. Creation remains visible when later growth or handle validation fails; no
rollback or pathname replacement is attempted. Unsupported copy-up/replacement
backends cannot gain retained support merely by forwarding the new method.
The admitted backing opener is captured before the census and invoked with its
original filesystem receiver after a final cancellation check. Acquisition does
not repeat an observable method lookup after that check; a reentrant getter
cannot cancel admission and then dispatch an already-canceled creation.

Handle close synchronously stops new admissions with `EBADF`, shares one promise
and waits for that handle's already queued operations before closing its backing
resource once. It does not wait for unrelated later acquisitions. Failed queued
operations retain their own rejection; close reports its own retirement failure.
An interrupted namespace census therefore does not delay handle close. In
contrast, actual backing acquisition, retained-handle `stat` and `truncate`,
and backing close remain owned work that must finish; these promises are not
raced against cancellation. A mutation completed during cancellation is not
rolled back, and cancellation does not release its handle while it is in use.
Late acquired resources are retired before cancelled acquisition settles. The
original acquisition failure or caller abort wins over a secondary close failure,
including falsey values. No completed mutation is undone by later cancellation.

These guarantees remain local to one quota wrapper. External writers, independent
wrappers and namespace remounts are not locked: identity and size observations
are point-in-time evidence, not a transaction or a storage lease. The legacy
path-write creation limitation described above is unchanged by this new route.
