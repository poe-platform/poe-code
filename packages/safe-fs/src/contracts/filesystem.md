# Optional file descriptors

`FileSystem.open?(path, options)` returns a canonical `FileDescriptor` bound to
the opened object, not a pathname that is reopened for each operation. Its types
are defined in `contracts/descriptor.ts` and re-exported by this filesystem
contract. No native descriptor number, Node `FileHandle`, bridge pseudo-handle,
process-global descriptor table, or implicit host path is exposed.

`capabilities.open` describes support for descriptor acquisition, subject to
path, access mode, permissions, provider features and resource constraints.
True does not grant every access mode or every option. False is explicit refusal;
absence remains unknown. Method presence and `randomAccessWrite` do not establish
descriptor support. Readonly restrictions take precedence over mutation requests.

## Opening and authority

`OpenFileOptions.access` is required: `read`, `write`, or `readwrite`.
Creation defaults to `never`; `ifMissing` permits creation and `exclusive` must
atomically refuse an existing entry, including a final symlink. Default truncate
and append are false; default new-file mode is 0666, subject to provider policy.
Mode is a nonnegative integer no greater than 07777. Unknown fields, malformed
values and null in place of optional values are invalid rather than silently
ignored. Read-only access cannot request truncation or append. Creation remains
an independent open operation: readonly wrappers must also reject creating opens.

`synchronization: "data" | "all"` requests availability of the corresponding
descriptor synchronization operation, not a promise that a subsequent flush
cannot fail. A provider must reject unsupported requested guarantees before
creation/truncation. Ordinary access, I/O and runtime failures remain possible.
Opening/truncation is not a general multi-operation transaction or rollback API.

Permission and namespace authorization belong to acquisition. A successful
descriptor enforces its acquired read/write access mode, but does not consult
its former pathname for permission again on every operation. Later chmod,
rename, unlink or replacement does not change which object it references.
Providers must preserve truthful object metadata and existing identity-scope
qualification; no identity, allocation or durability fields may be invented.
An existing handle is not a lease on the continued existence of its pathname.

The acquisition signal is borrowed for that operation only. Providers clean up
resources opened before a failed acquisition, including errors while verifying
the opened object. They must not publish an acquired resource after cancellation.
The shared helper closes late successful acquisitions before rejecting with the
original cancellation reason, even when that close also fails.

## Byte and metadata operations

`stat(options?)` reports the retained object's current `FileStat`.
`read(buffer, position, options?)` and `write(buffer, position, options?)` operate
on exactly the supplied Uint8Array view, respecting byteOffset and byteLength.
They return actual integer byte counts from zero through the view's length;
partial operations are not automatically retried. A zero read of a nonempty
buffer means EOF; an error is never converted to EOF. A zero write is not an
implicit success for all remaining bytes: retrying consumers must handle lack
of progress. Empty views return zero without backend I/O after normal access
and argument checks.

Numeric positions are nonnegative safe integers and mean absolute byte offsets,
without changing the sequential cursor. Null uses and advances that cursor.
The backend, not a read/modify/replace pathname strategy, implements positioning.
Invalid offsets use EINVAL; numeric positioning on a nonseekable descriptor uses
ESPIPE. Providers must admit resulting cursor/extent arithmetic and storage
growth against their own bounds before effects; this API does not remove quotas.

Append descriptors accept only null write positions; explicit positions use
EINVAL rather than platform-dependent silent offset ignoring. Each append write
must use the provider's genuine append operation. This is not a promise that
multiple writes or a read/write sequence form a transaction.

Callers must not mutate, resize, detach or reuse borrowed buffers until their
operation settles. Providers must copy any data they retain past settlement.
Read results live in the caller's buffer; the count identifies the valid prefix.
The helper waits for already-dispatched backend work before settling an aborted
operation, so that work cannot subsequently mutate a released caller buffer.
Cancellation or errors can follow partial effects; neither implies rollback or
that a failed write is safe to replay in full.

`truncate(length, options?)` resizes the retained object, preserves its identity
and sequential cursor, and requires writable access. Growth reads back as zero
bytes where the provider supports ordinary regular-file semantics. This does
not establish physical sparse allocation. Length is a nonnegative safe integer.

`sync(dataOnly, options?)` requires a boolean. True selects data synchronization;
false selects full synchronization. `capabilities.synchronization` distinguishes
`none`, `volatile` and `storage`. Volatile synchronization only completes work
against an in-memory store and MUST NOT be described as durable storage.
Storage synchronization invokes the backing store's operation and retains its
platform/filesystem limits; it is not a universal hardware durability guarantee.

Descriptor capabilities are immutable snapshots. Positioned capabilities are
masked by the acquired access mode; append disables positionedWrite, and read
access disables truncate. Runtime provider errors still remain possible.
Wrong access mode uses EBADF; unavailable truncation/synchronization uses ENOTSUP.

## Lifecycle helper

The internal `fs/descriptor.ts` helper, `openFileDescriptor`, normalizes and
snapshots options/capabilities before calling its acquisition callback. It does
not resolve paths, authorize permissions, create/truncate files, invent cursors,
or provide a replacement backend. Its callback must implement the admitted open
against the real backing object and release partially acquired resources on
failure. The returned `DescriptorBackend` receives its retained resource as an
explicit argument; implementations must not reopen the original pathname.

Stat/read/write/truncate/sync operations are serialized per descriptor in call
order. Each operation snapshots its own borrowed signal. Canceled queued work
is not dispatched; its rejection can wait for earlier admitted work. Backend
errors do not poison the queue. Cancellation wins over the same operation's
backend failure, retaining exact falsey reasons. Arbitrary noncooperative work
cannot be forcibly interrupted by this API.

`close()` synchronously stops new admission, drains previously admitted work,
and attempts resource release exactly once. It has no cancellation signal and
repeated calls return the same completion, including a failed completion. The
helper clears its retained backend/resource references after the release attempt
even on failure; this is not proof that a failing provider closed its OS resource
or that external owners have released their own references. After close starts,
new operations reject EBADF. Owners must still close descriptors explicitly and
register invocation cleanup before acquisition when their host provides it.

## Adapter requirements and delivery boundary

Memory implementations must retain the actual inode-like node; changing its
buffer is allowed, replacing the pathname's node to imitate positioned I/O is
not. Existing descriptors survive unlink and refer to the original object after
pathname replacement. Permission checks occur at acquisition. Memory may declare
only volatile synchronization.

Rooted-real implementations must retain one native handle and preserve existing
rooted resolution, admission, final-component protection and regular-file-only
policy. Native special files remain refused. Character-device metadata support
does not authorize host /dev access. Stable identity begins after acquisition;
ancestor swaps, concurrent renames, mount changes and preexisting hardlinks remain
subject to the existing trusted, stable-root assumptions. These path checks are
not race-proof confinement. A retained descriptor does not continuously recheck
namespace containment after external renames. Virtual device streams remain a
separate explicit mount, with no native-device fallback.

Mount wrappers select a backend at acquisition, preserve restrictions and
capabilities, and must not re-resolve paths for descriptor operations. Readonly
wrappers refuse creating/mutating opens and cannot leak writable underlying
handles. Quota proxies must explicitly intercept open: a false capability alone
does not prevent a generic Proxy from forwarding an unaccounted descriptor.
Overlay and object providers must refuse rather than bypass accounting, copy-up,
whiteouts or object identity. Any wrapper forwarding must preserve actual
authority, not infer support from the underlying method's existence.

The initial September 4, 2026 contract-layer handoff added types, ESPIPE and the
internal lifecycle helper only. Its baseline was 36 descriptor contract tests,
80 tests including the portable and Node bridges, and a selected safe-fs build.
Adapter implementation and qualification followed as described below. Bridge
handles and dd integration remain outside phase 1. Shell descriptor-output
budget enrollment must be settled before dd uses these descriptors. The full dd
and other-provider parity goals remain open.

Contract tests use memfs fixtures, never on-disk fixtures. The initial red suite
failed on the missing descriptor module. Follow-up tests reproduced null-valued
options being incorrectly defaulted; that behavior is now rejected before
acquisition. A separate memfs observation showed that positioned reads advance
its internal cursor. The contract fixture therefore models an explicit logical
cursor over memfs positioned I/O; this fixture correction is not native-adapter
evidence. The separately authorized native qualification below does not relabel
these unit mocks as native parity.

## Phase 1 adapter behavior

`MemoryFileSystem.open` retains the actual file node. Sequential reads and writes
share a per-descriptor cursor initially at zero. Numeric positions do not change
that cursor. Appending chooses the node's current end for every write and moves
the sequential cursor to the accepted end. Truncation preserves the cursor.
Writes and truncation modify the retained node, so aliases observe the changes;
renaming, removing the last link, and recreating its former path do not retarget
the descriptor. Creating a mode-000 file still grants the requested descriptor
access, while a subsequent acquisition must pass the new file's permissions.

The memory constructor and `createMemoryFileSystem` accept optional
`{ maxBytes: number }` through the memory module. This is a nonnegative safe
integer limit on retained regular-file content bytes, not a JavaScript heap
limit. Without it, the limit is `Number.MAX_SAFE_INTEGER`. Hardlinks charge the
same node once. A node with no links stays charged while any descriptor or
active streaming writer retains it. Growth and truncation of an unlinked open
node adjust that same charge. Only final close releases its remaining charge;
repeated close does not refund twice. Rename-overwrite and recursive removal
use the same lifetime accounting. Exceeding the content limit rejects ENOSPC
before growing the node; invalid/unrepresentable descriptor write extents reject
EFBIG. Failed creation/write may leave an empty created entry, not a transaction.

Bounded memory stores allocate exact-size backing buffers rather than append
overcapacity. Metadata, directory entries, symlink text, caller-owned buffers,
read snapshots/chunks, temporary copies and transient old/new resize buffers are
outside this content-byte limit. Callers still need separate input/output and
buffering budgets. Volatile synchronization does not promise persistence.

`RealFileSystem.open` resolves through the existing rooted admission machinery,
then retains one Node `FileHandle`. Acquisition uses native access/creation and
append flags with `O_NOFOLLOW | O_NONBLOCK`. The opened object must pass fstat as
a regular file; directory and special-file handles are closed and refused.
Requested truncation occurs through that admitted handle, after the regular-file
check, rather than through a pathname reopen or an unqualified O_TRUNC open.
Reads/writes pass the caller's exact view, offset zero, view length, and
numeric-or-null position to that handle. Successful byte counts are returned
without retrying, filling, or replacing the file. `sync(true)` calls datasync;
`sync(false)` calls sync. Acquisition's synchronization option requests flush
availability; it is not an O_SYNC/O_DSYNC flag or per-write flushing policy.
Host permissions and umask apply. Stable-root/TOCTOU limits above remain intact.

Mounts select the backend once, preserve actual returned descriptor capabilities,
and remap errors to virtual mount operands without re-resolving later operations.
Readonly views permit only noncreating read opens, reject creating/mutating opens
with EROFS, and mask returned handles to read access even if an underlying
provider incorrectly returns wider authority. Wrong-access descriptor writes
and truncation fail EBADF. Readonly descriptor synchronization is deliberately
unavailable (`synchronization: "none"`); it cannot flush a mutable backing store.
Synthetic mount directories do not advertise descriptor support.

Quota proxies intercept `open` before generic method forwarding and advertise
`open: false`, globally and per path. Every open is refused with ENOTSUP because
the pathname-based quota layer cannot account retained, unlinked descriptor
identity. Overlay, S3 and WebDAV also explicitly advertise false and refuse open
without acquiring lower/upper handles, copying up, contacting remote storage,
or imitating a descriptor through read-modify-replace. These are deliberate
phase-1 refusals, not claims of descriptor parity for those providers.

The lifecycle helper permits a backend to supply actual per-handle capabilities
after acquisition (needed by forwarding wrappers). It validates those before
publishing the handle, masks access, and closes on rejection. Wrapper adaptation
failures, including throwing capability inspection, also release acquired handles.
An already-performed mutation by a noncompliant provider is not rolled back.

## Phase 1 evidence (September 4, 2026)

The initial adapter tests failed before implementation: six memory tests reported
missing `open`; six rooted-real tests reported missing `open`; fourteen wrapper
tests reported missing admission/capability handling, including the quota Proxy
advertising the underlying memory provider's true capability. Two later lifecycle
regressions reproduced mount/readonly capability-inspection failures leaking an
acquired descriptor (expected one close, observed zero); both now pass. A strict
build also exposed generic resource inference as unknown; explicit retained
resource types corrected that compiler failure. The temporary memory test use of
`unlink` was corrected to the existing canonical `rm` API, not a new unlink API.
Two additional helper regressions exposed repeated getter observations changing
admission: an unsupported truncating open reached acquire/close instead of being
refused before acquisition, and capability validation disagreed with its later
snapshot. Options and capabilities are now snapshotted before validation.
Root's independent review then reproduced four `copyFile` accounting failures:
unchecked copy growth, uncharged retained copies, releasing a copied inode's
unrecorded charge, and failure to credit copy shrink. Copy now uses the same
size admission and node-data replacement accounting as descriptor writes.
The independent review tests were run unchanged; this implementation did not
edit or take ownership of `tests/descriptors/review.test.ts`.

Native evidence is retained in the authorized directory
`/tmp/safe-bash-scripting-oracles-20260904/descriptor-qa-vXYFk5`:

- `native-handles.json`: seven passed native-handle checks, zero skips.
- `native-admission.json`: five passed native-admission checks, zero skips.
- `gnu-dd-differential.json`: six passed byte-exact GNU comparisons, zero skips.
- `final-build-recheck.json`: three additional native rechecks after the final
  helper/copy-accounting fixes and rebuild, zero skips, with SHA-256 bindings for
  all thirteen changed implementation/type source files. The earlier records
  and native fixtures were preserved.

The execution host was Darwin 25.4.0 arm64, Node v22.23.2, effective UID 501.
All native fixtures stayed within that new controlled directory. The special-file
check used a newly created FIFO there; no host /dev file was opened. The native
checks exercised sequential-vs-positioned cursors, retained tails, zero-filled
extensions, permission acquisition, native inode identity through last-link
removal/replacement, append behavior, close, fsync/fdatasync, falsey cancellation,
and refusal of root-escaping symlinks and FIFO opens. Late-acquisition cleanup and
active-work cancellation are separately covered by deterministic unit fixtures.

The clean oracle was
`/tmp/safe-bash-scripting-oracles-20260904/coreutils-9.7-clean/src/dd`, reporting
`dd (coreutils) 9.7`, verified SHA-256
`fadf2537de7e051d0ddda1f4e793da9c51034b2bff8cb9d593ad4855305fcd4f`.
Descriptor workflows matched its notrunc/nocreat positioned write, seek plus
truncation, zero-count seek extension, data synchronization, full synchronization,
and append output bytes. These comparisons qualify the filesystem primitives,
not the pending dd command integration. No timing equality, power-loss recovery,
hostile-root race safety, or complete GNU dd parity is claimed.

Primary reference material consulted: Node's filehandle read/write, datasync,
sync and filesystem flag documentation (`https://nodejs.org/api/fs.html`), and
the GNU dd invocation manual
(`https://www.gnu.org/software/coreutils/manual/html_node/dd-invocation.html`).
The online GNU manual is not pinned to 9.7; measured 9.7 behavior is qualified by
the verified clean executable above.

The shared ESPIPE union requires exhaustive consumers to handle that code. Root
owns the safe-bash `which` description mapping (`ESPIPE: "invalid seek"`) and its
integration qualification; this phase does not edit that command. No default
mount, command registry, shell budget, root export, README, or bridge changes
are included here. Phase 2 must register owned acquisition/close with the runtime
and settle validated partial writes against its shared output ledger before dd
can use these descriptors by default. The dd runtime-identity tag is also deferred
until work returns to dd source.

## Phase 1 acceptance and owned files

Final focused validation passed 329 tests in 17 files, with zero skips. This
includes 66 implementation-owned descriptor tests (38 contract, six memory,
six real, sixteen wrapper), thirteen unchanged independent-review tests owned
by root, and 250 existing bridge/wrapper/memory/mount regressions. The maintained
runner was `npm run test:unit --` with those selected safe-fs paths. Strict
no-emit compilation also covered every descriptor test.

`npm run build:workspaces -- --workspace=@poe-code/safe-fs` passed through the
maintained selected workspace closure. Scoped ESLint using the repository's
configuration passed for every owned TypeScript source and test. These results
do not replace root's default/public bundle, shell integration, or full guarded
repository lint qualification after shared changes.

Implementation ownership for this phase is exactly these paths beneath
`packages/safe-fs/`:

- `src/contracts/descriptor.ts` (new)
- `src/contracts/errors.ts`
- `src/contracts/filesystem.ts`
- `src/contracts/filesystem.md`
- `src/fs/descriptor.ts` (new)
- `src/fs/capabilities.ts`
- `src/fs/memory/index.ts`
- `src/fs/real/index.ts`
- `src/fs/mount/index.ts`
- `src/fs/readonly/index.ts`
- `src/fs/quota/index.ts`
- `src/fs/overlay/index.ts`
- `src/fs/s3/filesystem.ts`
- `src/fs/webdav/webdav.ts`
- `tests/descriptors/contracts.test.ts` (new)
- `tests/descriptors/memory.test.ts` (new)
- `tests/descriptors/real.test.ts` (new)
- `tests/descriptors/wrappers.test.ts` (new)

The controlled native QA artifacts are outside the repository in the authorized
directory identified above. The independent reviewer approves phase 1, not DD
integration or unsupported providers. Root's maintained filesystem run passes
1,270 tests across 58 files, including all 79 descriptor tests. The full maintained
workspace/root build succeeds. Actual `poe-code/safe-fs` runtime and declaration
consumers verify retained identity, unlinked capacity, close, and mounted readonly
access. A read-acquired descriptor rejects writes with EBADF; opening for writing
through a readonly wrapper rejects with EROFS. An initial manual assertion mixed
those operations; correcting that harness expectation required no source change.

# Preferred I/O size

`FileStat.ioBlockSize?: number` is an optional, readonly preferred I/O size in
bytes. A supplied value must be a positive safe integer. Absence means unknown;
zero is not a known size. This is independent of logical `size`, physical
`allocatedBytes`, allocation units, device numbers, and actual stream chunk
boundaries. Consumers must not derive any of those quantities from this field.

The rooted real adapter preserves native `Stats.blksize` only when it is a
positive safe integer. Missing, zero, negative, fractional, nonnumeric, infinite,
or unsafe values remain absent; there is no platform fallback in canonical
metadata. Native `stat` and `lstat` retain their respective target/entry semantics.

Memory declares a virtual filesystem preference of 65,536 bytes on its metadata
entries, using the same policy as its existing default `readStream` chunk size.
Explicit stream chunk sizes remain supported and do not change the preference.
This is not a claim of physical allocation, disk sectors, or native filesystem
geometry, and does not populate `allocatedBytes` or require new configuration.

Faithful readonly, mount, and overlay views preserve the selected backing's
value or its absence. Synthetic mount ancestors leave the field absent. After
overlay copy-up, metadata reflects the upper backing, including an unknown
upper preference; the lower preference must not be retained as upper geometry.
Quota forwarding preserves the underlying observation unchanged. Providers
without a supported preference must leave it absent.

The generic bridge reports a supplied `ioBlockSize` as `Stats.blksize`. When the
canonical field is absent, its existing numeric compatibility fallback remains
4096; this fallback is not an observation about the backing filesystem and must
not be copied into canonical metadata. Block-unit consumers such as `truncate
-o` must use canonical metadata rather than that compatibility fallback. Different
legitimate filesystem preferences can produce different byte lengths for the
same block count.

# Character-device metadata

`FileType` includes `"character"` for an explicitly supplied virtual character
device. This is distinct from a regular file, including an empty regular file.
A character device may report `size: 0` while its read stream has no EOF. Consumers
must not use that size as the readable-stream length.

`FileStat.rdevMajor` and `FileStat.rdevMinor` are optional, nonnegative safe
integers identifying the special device, when the provider has that observation.
They are not `dev`, which identifies the filesystem containing the entry.
Absence means unknown, not zero. Faithful metadata forwarding preserves supplied
values; consumers must not invent native major/minor numbers from an inode,
logical size, or backing filesystem ID. The generic bridge preserves character
type and mode in Stats/Dirent predicates; its legacy numeric `rdev` field does not
yet encode these optional components.

This contract does not mount devices, widen the rooted real-filesystem adapter
to native special files, supply process-wide permissions, or promise kernel
ioctl, seek, entropy-pool, or device-driver behavior. Those require separately
implemented capabilities. Default filesystem instances remain unchanged.

# Directory enumeration admission

The [Directory Enumeration Admission Specification](directory-enumeration.md)
defines per-listing `ReadDirectoryOptions.maxEntries` admission,
its cancellation and error rules, composed-filesystem profiles, and command
integration. Its implementation-version record identifies the verified code;
it does not establish registry publication.

# Semantic operation capabilities

Capability flags describe operations, not JavaScript method presence. `true`
declares support subject to normal path, permission, provider, cancellation, and
resource constraints; `false` declares known lack of support; absence is unknown.
The required `FileSystem` methods may intentionally reject `ENOTSUP` and do not
establish support. `readOnly: true` takes precedence over all mutation flags.

| Capability | Meaning |
| --- | --- |
| `open` | Canonical retained-object descriptor acquisition, independently of streaming or replacement-write support |
| `read` | Ordinary `readFile` bytes |
| `stat` | `stat`/`lstat` entry metadata |
| `readdir` | Directory enumeration |
| `realpath` | Canonical path resolution |
| `access` | Access/permission inspection, not unconditional authorization |
| `write` | Ordinary `writeFile` create-or-truncate (`w`) |
| `append` | Direct incremental `appendFile`; separate from stream append |
| `exclusiveCreate` | Exclusive file creation (`wx`/`ax`), not ordinary overwrite |
| `streamingWrite` | `writeStream` write/truncate route |
| `streamingAppend` | `writeStream` append (`a`) route, independent of `append` |
| `truncate` | Explicit `truncate(path, length)` resizing, distinct from `w` |
| `explicitDirectories` | Explicit/empty directory entries are representable |
| `implicitDirectories` | Directory views can arise from existing file prefixes |
| `mkdir`, `recursiveMkdir` | Explicit directory creation, and recursive parent creation |
| `remove`, `removeDirectory`, `recursiveRemove` | File-entry deletion, empty-directory removal, and recursive removal |
| `copy`, `exclusiveCopy` | Ordinary and exclusive `copyFile` operations |
| `rename` | Configured rename primitive, not necessarily atomic |
| `atomicRename` | Existing stronger atomic-rename guarantee |
| `readlink`, `symlinks`, `hardlinks` | Link inspection, symbolic-link creation, and hard-link creation |
| `timestamps`, `permissions` | Timestamp and permission mutation |
| `randomAccessWrite` | Eligibility for the shell's existing bounded descriptor-offset update strategy |
| `independentWriteStreams` | Independent concurrent sequential writers to the same destination |

`implicitDirectories` does not promise that writes create missing ancestors.
Adapters may expose both implicit prefixes and explicit directory markers. Flags
do not promise transactions, arbitrary file sizes, preserved inode identity,
successful cross-device operations, or deployed server feature availability.

`independentWriteStreams: true` explicitly admits multiple simultaneous sequential
writers to the same path without one writer replacing, truncating or invalidating
another writer's output. Each writer retains its own lifetime and cancellation.
This does not promise shared offsets, positional writes, ordering between writers,
transactions, or atomic publication. The shell requires an exact `true` for this
sequential-writer exception and uses destination-specific capabilities when
available; absence or false retains the conflict refusal. Faithful wrappers must
preserve the actual destination assertion rather than infer it from streaming
support. Stateless discard devices satisfy this contract; an object-replacement
backend cannot advertise it merely because its API accepts concurrent requests.

`randomAccessWrite` is not a new positional-writer API. It expressly permits the
existing shell strategy that observes current bytes and writes an offset-adjusted
replacement; it must not be inferred from `write`, `append`, or `streamingWrite`.
Memory and real adapters advertise it; atomic/sequential object adapters do not.
This does not add a new emulation route or promise concurrent-writer isolation.

## Adapter and wrapper declarations

Memory and real declare their supported primitives explicitly. S3 conditions
exclusive creation/append on conditional PUT, exclusive copy on conditional COPY,
and rename on its configured non-atomic rename policy plus conditional copy/PUT
and delete prerequisites. This documents existing S3 semantics; it does not add a
rename emulation. WebDAV declares empty-directory removal only with its explicit
atomic binding and does not advertise unsupported explicit truncation.

Readonly views preserve inspection and directory-representation declarations but
disable mutation flags. Mounts report true only for uniform declared support,
false only for uniform lack of support, and omit mixed/unknown declarations;
multi-mount rename remains unknown because cross-mount rename is not a primitive.
`capabilitiesFor?(path, options)` optionally resolves a specific target through the
same mount path rules, including symlinks and a missing final entry, without
creating anything. Synthetic directories return a readonly profile. It is a
point-in-time observation, not a lease, and can fail with normal resolution errors.

Readonly and quota views preserve selected-path resolution. Quota stream flags
describe its actual incremental append-based route, not the backing atomic
writer's flags. Overlay declarations conservatively include upper staging and
copy-up prerequisites; missing required declarations remain unknown. Wrappers
must not manufacture support from delegated mandatory methods.

# Optional allocation metadata

`FileStat.allocatedBytes?: number` is an optional, readonly observation of the
bytes allocated to the same backing entry by its filesystem or provider. A
present value must be a nonnegative safe integer; reported zero is valid.
Absence means unknown or unavailable, never zero. Existing structural `FileStat`
implementations remain valid without the field; no capability flag is required.
`stat` describes the followed entry and `lstat` the final entry without following
its symlink, subject to the filesystem's existing path-resolution contract.

This is filesystem/provider-reported per-entry allocation, not logical length,
unique physical storage, exclusive or reclaimable bytes, quota/billing usage,
process RSS, or a sum of all storage layers. Shared extents and hardlinks may
report allocation attributed to more than one visible entry. Directory and
symlink observations are provider-specific. Do not derive allocation from `size`,
round logical length to an assumed block size, or substitute preferred I/O size.
Consumers needing comparable accounting must qualify the reporting providers and
handle unknown entries explicitly; they must not silently fall back to length.

Faithful wrappers preserve a present value and its absence for the selected
backing entry, including reported zero. Synthetic directories and providers
without an allocation observation omit the field. After copy-up or another
backing-entry change, use the new entry's observation or omit it; do not retain
allocation from the replaced view or sum invisible overlay layers. This metadata
adds no identity authority, lease, snapshot, transaction, or race protection and
does not change `identityScope`, `compareEntry`, or `snapshotRmdir` semantics.
Memory, S3, and WebDAV do not acquire physical-allocation values by this addition.

# Append capability

`FileSystemCapabilities.append?: boolean` describes the filesystem-wide support
profile for `appendFile`. A value of `false` is a truthful, preflightable
declaration that `appendFile` is unsupported on every path, so consumers can
reject an operation before performing a destructive preparatory write. Absence
is the legacy/unknown profile and must not be promoted to support or rejection.
A value of `true` truthfully declares general operation support, but does not
promise that every path or individual call succeeds; normal path, permission,
limit, cancellation, and provider errors still apply.

The separate `streamingWrite` capability and `writeStream` method govern the
streaming-write path, including its declared write flags. In particular, an
adapter may reject direct `appendFile` while supporting append through
`writeStream`. Wrappers preserve a delegated `false`, or expose an accurate
aggregate profile when routing across backends; they must not turn absence into
`true` or conceal a globally unsupported delegated operation.

## Real filesystem conversion

Real uses the native `Stats.blocks` observation returned by the existing rooted
`stat`/`lstat` operation. On Darwin and Linux only, the documented unit is 512
bytes. The count must itself be a nonnegative safe integer and its product with
512 must also be a safe integer. Missing, invalid, negative, fractional, unsafe,
or overflowing reports, and other platforms, omit `allocatedBytes`; they do not
fabricate zero or fail an otherwise valid stat. Existing filesystem errors and
cancellation still propagate. No extra content read, native process, provider
lookup, or dependency is used to obtain allocation.

Primary references for the unit and mapping:

- [Node v22.22.2 `stats.blocks`](https://github.com/nodejs/node/blob/v22.22.2/doc/api/fs.md#statsblocks)
  defines the allocated block count, not a portable byte unit.
- [Apple `stat(2)`](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/stat.2.html)
  specifies 512-byte `st_blocks` units and allows zero for short symlinks.
- [Linux `inode(7)`](https://man7.org/linux/man-pages/man7/inode.7.html)
  specifies 512-byte units, distinct from `st_blksize`, and notes that POSIX does
  not universally specify the `st_blocks` unit.
- [Node v22.22.2 bundled libuv Unix mapping](https://github.com/nodejs/node/blob/v22.22.2/deps/uv/src/unix/fs.c)
  copies native `st_blocks` into the returned stat structure.
- [The corresponding Linux statx mapping](https://github.com/nodejs/node/blob/v22.22.2/deps/uv/src/unix/linux.c)
  likewise forwards `stx_blocks` without logical-size estimation.

These sources justify the platform-specific conversion, not universal runtime
acceptance. Native witnesses must record their actual platform, runtime, and
filesystem profile; executing a Linux conversion branch on Darwin is not a
Linux filesystem witness.

# Empty-directory removal

`FileSystem.rmdir?(path: string, options?: FsOptions): Promise<void>` is an
optional, directory-only operation. `FsOptions` contains only `signal`; this
operation has no recursive or force mode. Existing `rm` semantics are unchanged.
Existing structural filesystem implementations remain valid without `rmdir`.

In the default profile a supported call removes an empty directory entry, never
its descendants or a final symlink. Nonempty directories fail with `FsError.code === "ENOTEMPTY"`;
nondirectories (including final symlinks) fail with `ENOTDIR`; missing paths fail
with `ENOENT`. Preserve the directory and its children on these failures.
Protect virtual and mounted roots from removal. Permission, read-only, IO and
path-resolution failures retain their normal typed errors.

Default-profile emptiness must be enforced by the removal operation, not a prior
`readdir` followed by recursive deletion. A concurrent child must not be deleted because
an earlier listing was empty. Do not approximate this operation with
`rm({ recursive: true })`, a recursive remote collection DELETE, or traversal
and deletion of descendants. A backend unable to provide safe empty-directory
removal must leave the namespace unchanged and return `ENOTSUP`; absence of
the optional method is also an explicit unsupported capability at consumers.
Method presence alone does not guarantee support for every mounted path.

The only additive alternative is the explicitly disclosed **snapshot-marker
profile** below: `capabilities.snapshotRmdir === true`. It qualifies both the
nonempty-directory rule and removal-time-emptiness rule for marker-only calls.
Omission or `false` retains the default contract; it does not silently select
snapshot behavior. Neither profile ever permits deletion of descendants.

Forward `signal` into host work and reject a pre-aborted call before mutation.
Cancellation cannot undo a removal already performed by the host. This method
does not add a namespace transaction, descriptor-relative path identity or a
global snapshot guarantee to the existing filesystem contract.

Consumer checks may improve diagnostics, but must never replace the final safe
operation. `rm -d` uses it only for directories; ordinary file/symlink removal
and explicitly recursive `rm` continue to use `rm`. Missing capability is not
silently ignored, including with `rm -df`.

## Explicit snapshot-marker profile

`FileSystemCapabilities.snapshotRmdir?: boolean` discloses that supported
`rmdir` calls may use snapshot-empty **explicit directory-marker** removal,
rather than removal-time logical-directory emptiness. It is a semantic profile,
not a claim that `rmdir` exists, that every path supports it, or that a provider
implements atomic prefix deletion. Existing memory/real guarantees are unchanged.
The operation signature and signal-only options remain unchanged; callers must
not infer this profile from a backend name, missing capability or transport type.

A backend using this profile must declare `snapshotRmdir: true` and document its
marker representation and supported provider configuration. It must:

- Resolve an unambiguous explicit directory marker and protect roots, final
  symlinks, ordinary files and ambiguous file/prefix representations. Existing
  typed errors, read-only checks and permission/cancellation rules still apply.
- Complete the required emptiness observation, including pagination, before
  mutation. Any observed descendant, including a nested directory marker, causes
  `ENOTEMPTY` without mutation. Incomplete/failed inspection is not empty; an
  unsupported representation or unavailable safe operation yields `ENOTSUP`.
  Provider listing correctness remains a prerequisite, not established by HTTP200.
- Delete **only the exact identified marker key**, never any child, nested marker,
  prefix batch, recursive collection, or descendant namespace entry. Do not use
  recursive `rm`, recursive DELETE, cleanup traversal, or a compensating whiteout.
- Report success only when the marker-removal operation succeeds. Success means
  marker removal under this profile, **not logical-directory absence**. A child
  created after inspection survives unchanged and can keep the directory visible
  after a successful call. Do not turn that observation into an `ENOTEMPTY` claim
  of no mutation, delete the new child, or reinsert a marker as purported rollback.

This profile does not make the observation/removal pair transactional and does not
promise marker-instance or same-content ABA protection. A concurrent replacement
at the same marker key can be affected if the provider lacks a verified stronger
condition. Truthful object conditions may improve marker protection but are not
prefix-emptiness conditions. Once deletion is issued, an error or cancellation
may leave its outcome uncertain; preserve the error and never claim rollback.
Pre-aborted calls still perform no mutation, and signals propagate into host work.

Wrappers must not conceal weaker delegated semantics. A mount/composite that
allows snapshot-marker removal on any routed writable path must expose
`snapshotRmdir: true`, or refuse that delegated operation. The aggregate flag
does not weaken strict operations on other paths; clients needing the stronger
guarantee must resolve that path's actual contract or refuse snapshot-profile
calls. A wrapper that always refuses removal need not advertise this profile.
Flag propagation alone is insufficient for an overlay: it must not hide a
concurrent descendant with a whiteout or otherwise turn surviving children into
removed namespace entries. It must independently preserve the invariant or refuse.

This is not a WebDAV recursive-DELETE exception. A collection lock, empty listing,
validator or lease checked before recursive traversal does not supply the default
empty-only removal operation. A WebDAV deployment without a genuine server-side
atomic empty-directory primitive must refuse with `ENOTSUP`. An explicitly
configured host adapter/extension may provide such a primitive only for its
truthfully bound backing resource: the primitive itself must reject nonempty
directories without deleting descendants, including concurrent native/alias
writers. Lock expiry or cancellation cannot be relied on to undo recursive work.
No bundled primitive, new WebDAV API or provider support is implied by this rule.

# Point-in-time backing-entry identity

`FileStat.identityScope?: object | symbol` is an additive, opaque identity
namespace token for the **actual backing entry** observed by `stat`/`lstat`.
Existing implementations may omit it. It exposes no host root pathname and is
not a serialized ID, content digest, pathname or adapter/client instance ID.

A complete identity consists of a non-null object or symbol scope plus both
`dev` and `ino` as nonnegative finite safe integers. Both complete identities
are required before drawing a distinctness conclusion. Compare scopes only by
reference/symbol equality (`===`), never by coercion, JSON, descriptions,
`toString`, object contents or symbol names.

- Equal scope, device and inode denotes the same observed backing entry.
- Equal scope with different device/inode denotes distinct observed entries.
- Different scopes promise disjoint identity universes. Publishers must not
  allocate distinct scopes merely because adapters, clients, credentials,
  mountpoints, roots or wrapper objects differ when storage can overlap.
- Missing/invalid scope, device or inode means **unknown**, including when the
  other stat has complete identity. Legacy unscoped `dev`/`ino` values do not
  establish cross-backend distinctness. Unknown is not false/safe.

All native-real instances addressing the same host-native identity universe
must share a process-local scope; the agreed in-process convention is
`Symbol.for("virtual-bash.fs.native")` with the actual native device/inode.
Do not reuse this host-native namespace for a remote host's native IDs. Unsafe
integer conversion of native identifiers makes the tuple unknown, not rounded
identity. Independent memory stores may use independent opaque tokens only
when they truly cannot share entries.

Wrappers preserve the scope token and device/inode of the actual selected
backing entry. They must not relabel it using the wrapper or mount instance.
An overlay must expose the currently selected backing identity, and reassess
when copy-up changes the backing object. A wrapper that cannot faithfully
describe an entry omits identity rather than claiming a disjoint namespace.
Read identity is not automatically identity of a future write/copy-up target;
the mutation implementation must resolve and guard its actual destination.

Remote publishers may expose complete identity only with a truthful shared
identity authority across every overlapping storage view they claim to compare.
Otherwise omit the scope or identifiers. An arbitrary per-client token, numeric
hash, ETag, textual URI comparison or normalized local path is not proof.
Tokens are process-local opaque references, not durable/replay/cross-process
identifiers. A deserialized fresh object cannot stand in for the same scope.

Cross-backend/wrapper copy consumers must resolve/observe identity **before**
opening a destructive destination or acquiring/reading a potentially eager
source. Reject observed aliases (`EINVAL`, or `EEXIST` for exclusive creation).
An existing destination with unknown identity must fail closed with `ENOTSUP`
unless the operation has another authoritative same-entry/distinctness guard
(for example a backend-native guarded copy). Do not infer safety from unequal
local paths, absent fields, different objects or two nonmatching bare inode
numbers. A missing destination can use actual exclusive creation, not an
existence check followed by an ordinary truncating open. A raced existing
destination must remain untouched.

These are observation-time identities, not leases or transactions. They cannot
prove pathname stability after observation, prevent inode reuse/ABA, authenticate
a malicious adapter, or protect against external-writer/path-replacement races.
Provider limitations and remaining pathname TOCTOU windows must stay explicit;
the field alone does not resolve a source-truncation failure or prove race safety.

# Optional comparison authority

`EntryComparison = "same" | "distinct" | "unknown"` and
`FileSystem.compareEntry?(path, peer: FileSystem, peerPath, options?: FsOptions)`
provide one optional metadata-only comparison, returning `Promise<EntryComparison>`.
This addition follows the source-owner proposal `6df52ef` and independent review
`29fe1bf`; it does not add a `guardedCopy` capability or public authority registry.
Legacy implementations remain structurally valid.

The relation concerns the actual **followed** backing entries observed at both
paths, not their contents or their directory entries before following symlinks.
Only native/provider-owned or mutually recognized identity authority may establish
distinctness. Absent support, unrecognized peers or insufficient authority means
unknown. Different clients, URLs, credentials, protocols, roots, ETags or fresh
tokens never by themselves prove distinctness. Complete `identityScope/dev/ino`
tuples retain their existing meaning; this method does not redefine them.

Comparison must not acquire file content, open a destination, copy up, create a
lock-null resource, publish or remove anything. Real missing-path, authorization,
I/O and cancellation errors propagate; they are not converted to unknown or
distinct. Forward `options.signal` into host work and check cancellation between
peer queries. Consumers may query each distinct operand authority at most once,
without recursive negotiation. Validate returned literals; invalid or conflicting
observations fail with `EIO` before effects. Known complete identities need no
query, and known aliases must not be overridden by another answer.

Wrappers resolve both operands to the actual backing views and preserve read-only
policy. If a future mutation selects a different entry (for example overlay
copy-up), separately prove that target safe; comparison of the read view is not
write authority. Followed comparison cannot authorize unlinking an unknown final
symlink entry. Missing destinations still require actual exclusive creation.
Unknown existing destinations do not authorize truncation. A move must finish
copying before source removal; successful alias/no-op copy is not permission to
remove its source.

The answer is point-in-time evidence, not a cached lease, transaction, conditional
delete, provider authentication or ABA/pathname-race guarantee. The backend owner
implements qualified positive workflows and tests authority; method presence is
not proof that every arbitrary provider pair can be compared.

## Faithful forwarding of provider-owned observations

Approved implementation rule, August27,2026: a fresh provider-owned identity
observation describes the actual backing resource used by the corresponding
content operations. A faithful opaque client/fetch/transport forwarder may
preserve that assertion only while it preserves that backing-resource binding.
Different method/factory references alone do not invalidate otherwise fresh,
provider-owned provenance. Do not require recognition of the forwarder's entire
method table as an additional identity eligibility condition.

Fresh query provenance and filesystem/path/stat binding remain required for
the provider-owned observation mechanism. Wrong-path, stale, replayed,
manufactured or copied/serialized metadata does not acquire that provenance.
Retain all permission, cancellation, conflict and alias checks. This rule does
not change complete native/scoped identity semantics or invent scopes for
clients, transports, protocols or storage views.

A remapper or cache gateway must omit the forwarded assertion or replace it
with truthful authority for the actual backing resource its content operations
use. Describing one resource while reading/writing another violates the host
transport's semantic contract. Host-supplied JavaScript is not sandboxed by this
API, and method-reference checks cannot provide that security boundary. Faithful
overlapping configurations remain legitimate: Real and WebDAV may address one
entry; prefixes, mounts and separate clients can alias shared storage. Preserve
their actual relation rather than declaring disjointness by protocol or class.

This is neither a broad trust flag nor a new public binding API. Generic SDKs
and copied/serialized metadata lacking recognized fresh provenance still require
real-provider identity integration and remain an open product requirement.
Poincare owns backend implementation; distinct Dirac review is required before
acceptance. Qualified-mock38/38 is additional evidence, not closure of the
original31/38 or proof of arbitrary real-provider interoperability.

# Permission capability and remote access profile

`capabilities.permissions === true` promises supported POSIX-style mode handling;
`false` explicitly does not. An absent capability does not imply enforcement.
Creation `mode` values on a non-permission backend may be retained as **advisory
metadata**, or ignored with that behavior documented. Valid explicit modes need
not fail `ENOTSUP`. Creation modes do not chmod an existing entry. Invalid modes
must fail `EINVAL` before mutation. Without permission support, `chmod` must
report `ENOTSUP`, not claim a successful security change.

Advisory mode0000/0600 never guarantees private storage, inaccessible content or
POSIX authorization. Permission-sensitive consumers must require actual permission
support rather than interpreting mode bits as protection. This includes secure
temporary-file/directory creation. Remote authorization remains provider policy.

`access` validates mode combinations 0..7, resolves the target and preserves real
missing, authorization, read-only and cancellation errors. `F_OK` is an existence
probe. `R_OK`/`W_OK` are best-effort checks of known backend policy, not destructive
GET/PUT permission experiments or promises about a subsequent operation. Known
read-only writes fail `EROFS`; a metadata request denial must not become success.
On a non-permission backend, directory `X_OK` may succeed when virtual traversal
is permitted; regular-file `X_OK` may fail `EACCES` because execution is not
permitted, even with advisory execute bits. Do not infer execute authorization
from synthetic modes or require every unsupported permission check to be ENOTSUP.
This profile does not launch native executables or guarantee later host access.

Contract-owner decision on August 27, 2026: the S3 behavior characterized in
`d0948bb` (advisory creation modes, file X_OK EACCES, directory X_OK success) is
permitted. Replacing that historical generic row's explicit-mode/X_OK ENOTSUP
expectations is an intentional profile delta, **not a source bug fix**. Preserve
the red historical cohort, exact bytes, exclusivity, invalid-mode, chmod,
authorization, cancellation and read-only assertions when revising backend tests.
