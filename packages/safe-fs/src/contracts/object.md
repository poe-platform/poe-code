# Retained objects and lossless native values

This additive contract is exported by safe-fs, its portable core and its contracts
entrypoint. `ObjectAuthority` is exported by safe-fs and its portable core. Existing
string paths, numeric stat/read/truncate methods and bigint resize operations keep
their current behavior. A retained reader/resizer may expose an `exact` facet on
that same open object; its existing `close` owns the facet too. Absence is unsupported.
Never convert an unsafe number into bigint after precision has already been lost.
`fileOffset` retains explicit safe-number admission for legacy callers;
`encodeFileOffset` requires bigint at runtime, including for small exact stat values.
`encodeBytePath` reads the carrier's owned bytes directly, as authority admission
does. Replacing an instance's public `bytes` accessor cannot substitute a decoded
or replacement-character pathname in the wire representation.

`FileSystem.objects` is an optional stronger byte namespace. No shipped backend is
newly declared qualified by this change. Implementing the interface requires native
or backend evidence for the semantics actually advertised. Wrappers must not expose
it unless they enforce their confinement, readonly, quota and mount policies for
these operations. Never recover this capability by unwrapping a protected backend.

## Retention and authority

`open` atomically acquires an object and its qualified identity. Default access is
read only. The backend retains it until `close`, even after rename, final unlink,
path replacement or removal of its parent. Reads observe that object, not a frozen
copy and not a reopened pathname. Independent opens have independent ownership;
shared object identity does not imply a shared open-file-description cursor.

The backend's identity token is an object/symbol, equal across hardlink aliases
while any retain exists and distinct across unrelated objects and backing authorities. Qualified aliases through
different views may share a token; that does not authorize cross-mount linking. This is
a stronger promise than optional `FileStat.identityScope/dev/ino`. Unknown identity
must reject ENOTSUP or acquire stronger identity before returning an object. Path
hashes, content hashes and unqualified inode tuples cannot supply the promise.
The memfs fixture uses the actual retained Node: memfs can recycle inode numbers
while an unlinked Node still has an open handle.

Create one `ObjectAuthority` per authenticated job and server epoch. Its opaque IDs
remain bound to the byte namespace captured at authority construction.
Namespace operations retain their original backend receiver and special-file
capabilities are copied. Replacing `filesystem.objects`, editing its method table,
or advertising a previously unsupported endpoint cannot redirect an issued authority
or expand its capabilities. An authority created without a byte namespace stays
unsupported; a newly qualified backend requires a new authority. This captures
capabilities, not file contents: backend operations still observe live objects.
Its UUID-prefixed opaque IDs distinguish an individual open handle from object identity. Only handle
IDs admit operations; object IDs are correlation identities, never permissions or
native fd numbers. Backend identity tokens never cross the wire. Routing must first
check session, epoch, job and rights. IDs do not replace authentication. All handles
must be closed or disposed at job completion, disconnect expiry and failed launch.
Closing one alias does not close another. Close consumes ownership even on failure.
The authority captures bound operations and cleanup at acquisition. Later changes
to the backend's public method table cannot redirect a retained handle; bound
receivers still observe live object state. Cleanup is captured before identity
and type inspection so rejected admission releases the acquired retain.
Each handle retains its admitted access mode, defaulting to read. Read requires
read or readwrite; write and truncate require write or readwrite. The authority
rejects a mismatched operation with EBADF before calling the backend, even when
that backend exposes every operation or another alias has greater access.
Stat, metadata and link remain subject to backend permissions and capabilities;
native metadata and linking are not inferred from descriptor write access.
Disposal drains admitted operations, attempts every close and reports cleanup errors.
Object IDs are retained only while handles exist, with no guarantee of equality
across complete release/reopen, reconnect, epoch or authority replacement.

Configuration: `maxHandles` is a required positive safe integer; `maxIoBytes` is a
positive safe integer defaulting to 1048576. The broker limits individual reads,
positional writes, appends and retains, not the transport's total queued bytes or
request count. The transport must bound frames, queued requests and aggregate
inflight bytes before
calling it. No environment variables are introduced. Operations are serialized
within this authority; this does not coordinate external writers or establish
cross-client coherence, transactions, locks, mmap or exactly-once durability.

## Wire values

| Value | Representation and admission |
| --- | --- |
| Path / directory name | JSON array of integer octets 0–255 via `encodeBytePath` / `decodeBytePath`; nonempty and NUL-free. Binary framing may carry the same octets directly. |
| Offset / size | Canonical nonnegative decimal string, range 0 through 9223372036854775807. Decode directly to bigint with `decodeFileOffset`. No JSON numbers, exponent notation, signs or leading zeroes. |
| Open result | `{ "handle": "opaque", "object": "opaque" }`, interpreted only in the authenticated job/epoch. |
| Read/write payload | Bounded binary frame. Write acknowledgement is actual byte count, including partial progress. |
| Stat | `WireExactFileStat`: size/allocation decimal strings, signed nanosecond timestamps as decimal strings, numeric mode 0–65535 and uid/gid 0–4294967295. No identityScope/dev/ino serialization. |
| Metadata request | `WireObjectMetadata`: mode 0–07777, uid/gid 0–4294967294, optional signed-64-bit decimal atimeNs/mtimeNs. Omitted fields are unchanged; -1 owner sentinels are not wire values. |
| Error | Symbolic native errno, including EXDEV, EPERM, ESPIPE and EILSEQ; do not substitute success or convert to a generic I/O error. |

`BytePath` snapshots input, including Buffer subclasses, and returns copies. It does
all length and NUL validation on that owned copy, without invoking caller-provided
validation methods that could change or misreport the admitted bytes. It does
not decode, normalize, authorize or collapse symlink-sensitive components. Namespace
implementations enforce root/mount traversal rules using bytes, not UTF-8 replacement
strings or lexical prefix checks. Byte readdir names are individual components;
backends must reject slash, dot and dotdot in returned names. Display text is separate
from the authoritative octets. Decode budgets apply before constructing arrays.

Wire octets are snapshotted once before validation and typed-array conversion.
Accessor-backed inputs cannot substitute out-of-range values after admission;
missing octets reject rather than being synthesized by numeric coercion. The
Node argv decoder applies the same ownership rule before fatal UTF-8 decoding.
Path decoding snapshots the indexed carrier length and reads each own octet once;
custom iterators and inherited entries cannot substitute pathname bytes or extend
the admitted path during decoding.

Authority path admission snapshots the genuine `BytePath` carrier before queueing
open, link, rename, unlink or readdir. Replacing a caller's `bytes` method after
admission cannot redirect a pending operation. Backend operations receive a separate
owned carrier; no UTF-8 decoding or numeric conversion participates in this snapshot.

The authority accepts decimal positions in read/write/truncate and wire metadata
in `metadata`; it returns wire stat. Open/link take decoded `BytePath` instances.
Read results own their bytes, including when a backend returns a reused Buffer;
later reads or transport mutation cannot alter an earlier acknowledged result.
Read and write admission measures the intrinsic typed-array byte span, ignoring
shadowed `byteLength` properties. Oversized writes reject EINVAL before copying or
backend mutation; oversized backend reads reject EIO before returning wire bytes.
Byte rename/unlink/readdir are optional namespace operations on `objects`, mediated
by the authority's serialized `rename`, `unlink` and `readdir` methods; absence
rejects ENOTSUP. `readdir(path, maxEntries)` requires a nonnegative safe integer
limit, passes it to the backend and rejects EFBIG on overflow without truncation.
It returns `WireObjectDirectoryEntry` names as owned octet arrays and rejects
slash, dot and dotdot components with EIO. The server must additionally bound
aggregate response bytes. Preserve cross-mount failures without
copy/delete fallbacks. Retained `link` must act on the open object; an unlinked
object may fail to relink (for example EPERM), never silently link a replacement.

Backend listings must be dense arrays of entries with nonempty, NUL-free byte
components. The authority rejects malformed listings, missing entries and invalid
byte carriers with EIO before returning a wire response; array holes must not
become JSON null entries. Invalid UTF-8 octets remain valid components.
Listing admission captures the array length and reads own indexed entries, ignoring
custom iterators and inherited entries. Each returned octet carrier is copied to
an owned Uint8Array before component validation and serialization. Backend iterator
or validation-method overrides cannot replace the admitted bytes or enlarge the
admitted listing. The remote job callback applies the same ownership rules.

Optional retained `append` chooses EOF and writes as one canonical backend
operation on the admitted identity, even after rename, unlink or replacement.
It returns actual settled byte progress, including short writes. Absence rejects
ENOTSUP; neither pathname `appendFile` nor a stat/positional-write pair supplies
this guarantee. A successful count promises visibility according to the backend,
not fsync durability or command-wide transactions. Earlier progress survives a
later quota refusal, cancellation or command failure. No existing backend gains
this capability implicitly.

`ObjectAuthority.append(handle, bytes)` dispatches optional retained append using
the same owned binary payload and intrinsic byte-span limit as positional writes.
It requires write or readwrite access and validates the actual partial byte count.
The append wire request has no offset: EOF is chosen by the canonical backend,
never by a launcher-side stat/write pair. Missing support rejects ENOTSUP, and
native errors such as ENOSPC survive unchanged. The server acknowledges only the
awaited append receipt; it cannot repair failure by reopening the original path.

Optional `objects.create(path, { flag, access, mode, signal })` acquires the
created or existing retained identity in the canonical namespace. `w` creates
or truncates during acquisition; `wx` creates exclusively. `a` creates or opens
without truncating; `ax` creates exclusively without truncating. Exclusive flags
refuse existing symlinks too. The backend enforces confinement, mount, readonly,
permissions and quotas; consumers never implement exclusivity with a stat/create
pair. Mode affects newly created files only. The returned `CreatedFileObject`
has an acquisition receipt `creation: 'created' | 'opened' | 'truncated'`.
This receipt describes the actual acquisition, not a later pathname observation.
Completed truncation survives subsequent failure. The flags do not synthesize
retained append, an append cursor, sparse allocation or durability guarantees.
Scoped and device views mediate resulting retains just as they mediate opens.
Other wrappers without qualified objects remain unsupported. No shipped backend
is enrolled by adding this contract; ObjectAuthority does not expose a create
operation. The authenticated remote job boundary dispatches it directly.

Remote `create` callbacks accept optional `flag` and `mode`. Explicit requests
require `objects.create`; legacy host creation hooks cannot silently discard
those options. Acquisition receipts distinguish file creation from early
truncation in the effect ledger, and existing append opens add no creation effect.
Callbacks preserve the canonical error, including its syscall and path.

A byte `rename` may return `{ moved: boolean }` from the canonical operation.
`false` means a successful no-op, including renaming two names of the same object;
`true` means the source namespace entry moved. A later pathname observation cannot
supply this receipt. Existing void-returning backends remain supported with unknown
namespace effect. Execution bookkeeping must not infer a move from that absence.
The receipt is an observation of this rename, not a lease on either pathname or an
authorization for future reads. Retained identities continue to govern handle IO.
`ObjectAuthority.rename` preserves this receipt, including legacy `undefined`, so
wire dispatchers can distinguish a confirmed no-op from an unknown namespace effect.

Metadata support is per backend and per field. The backend must reject unsupported
fields before mutation. Multiple supported fields are not promised atomic: preserve
native ordering and failures. Xattrs, ACLs and block-device operations are not added
without corresponding native workflow evidence. Exact read/write/truncate support
does not promise that every representable offset is supported by a filesystem;
EFBIG and other native failures are valid. Legacy-only backends must not round or
simulate large sparse files by allocating dense buffers.

Exact stat may additionally report `nlink` as bigint. Wire stat and remote file
metadata carry it as a canonical decimal string in the same checked nonnegative
signed-64-bit range as offsets. Zero is valid after final unlink. This is an
observation of the retained object, never an identity token, permission or reason
to reopen a pathname. Encoders capture the field once and reject numeric values
before conversion; omission preserves backends that do not expose link counts.

## Server launcher handling

The remote server must decode and validate requests before invoking backend
operations. Acknowledgement follows the awaited canonical operation, including
partial writes; successful mutations are not held until process exit. Existing
shell output accounting must wrap remote writes just as it wraps local writes.
This broker alone does not connect shell limits or implement the remote server.
The authority rejects unknown access modes and endpoint kinds with EINVAL before
backend acquisition. Metadata requests must be objects, excluding null and arrays;
invalid containers reject EINVAL before mutation rather than becoming empty updates.

The launcher accepts admitted argv/environment/path octets in bounded length-delimited
frames. Reject embedded NUL; preserve empty argv entries and all non-NUL bytes. A
native execve/posix_spawn bridge must construct native byte strings directly. Do not
pass arbitrary byte argv through Node's string-only spawn API, TextDecoder, JSON text
operands or a shell command. A string-only launcher must reject unrepresentable
requests before launching, and cannot claim byte-name compatibility. Paths used by
native open/stat/rename/link must pass through the same authorized byte namespace.
The Node launcher rejects missing argv entries and missing octets before spawn;
array holes must never become empty arguments or synthesized NUL bytes.

For native positional I/O, convert validated decimal strings to checked signed-64-bit
integers directly, or receive a specified 64-bit binary integer frame. Check the
native off_t width. Never use Number, parseFloat, strtod or a JSON numeric intermediate.
Native stat sizes and times return through bigint/decimal conversion, not JS numbers.
Remote stat encoders capture each backend field once, then validate and serialize
that same observation. Re-reading an accessor after validation may substitute an
inexact number, a different type or metadata that was never admitted.
The local `exact` facet is required when a retained legacy handle mediates such I/O;
missing support rejects ENOTSUP, including on otherwise readable backends.

`ExactFileSeekHandle` adds a bigint cursor operation on an existing retained open
description. It belongs to the enclosing lease's lifetime and must not reopen a
pathname. Remote inherited descriptor leases may expose this as `exact`; the
descriptor materialization broker captures and binds that facet only when seek
rights are admitted. The existing seek request remains a canonical decimal string,
decoded directly to bigint and passed with the operation's cancellation signal.
Aliases retain the same serialized cursor queue. Exact-only leases are supported;
when the facet exists it handles both small and large offsets, and native errors
are preserved without retrying the numeric operation. Legacy-only leases still
receive safe numbers and reject larger values with ENOTSUP before backend calls.
This capability does not add a numeric initial-position observation or qualify a
shipped backend or native launcher automatically.

The launcher maps admitted handle IDs to owned native descriptors with close-on-exec
by default. Only explicitly admitted child descriptors are inherited; remote numbers
cannot select arbitrary host fds. Duplicates of one open description share cursor
and close ownership; independent opens of one object do not automatically share a
cursor. Native fd numbers and retained object IDs are separate domains. On startup
failure, cancellation or transport disposal, drain admitted operations and release
all retained resources; never reopen paths to repair a lost handle.

Special-file observation includes character devices, FIFOs and Unix sockets.
`specialFiles[kind] === true` and an explicit matching `open` request are both
required. The backend must enforce endpoint authorization and kind checks before
potentially blocking acquisition; the broker also rejects a returned regular file
as a substitute. These flags do not promise camera/device ioctl forwarding, socket
protocols or FIFO readiness mediation. Those require separately qualified endpoint
bridges in the launcher; until present, refuse the affected execution explicitly.
Positional operations on nonseekable objects retain ESPIPE. No synthetic regular
file, downloaded snapshot or exit-time copyback may stand in for a special endpoint.
The authority rejects stat types that differ from the admitted retained object's
type with EIO. Identity and type are captured once at acquisition; later backend
property changes cannot redefine admission or prevent retained ownership cleanup.
Directory observations likewise reject types outside this contract;
unqualified block devices cannot enter the wire as an implicit new capability.
Both authority and remote callback directory handlers capture each entry's name
carrier and type once. The wire response uses the admitted type; backend property
changes cannot substitute an unsupported special-file kind during serialization.

## Qualification evidence

Explicit native invocation (outside unit discovery):

```
python3 packages/safe-fs/tests/integration/object-contracts.py --run
```

It creates only owned temporary fixture files and cleans them. The recorded output
is `docs/remote-media/safe-fs-native-evidence.json`. On macOS 15.7.7 arm64 it establishes
retained hardlinks/rename/unlink/replacement and append to the unlinked original
after pathname replacement, retained mode/owner/time operations,
sparse positional I/O above JS safe integers, actual FIFO/socket/character types,
ESPIPE and cross-mount EXDEV. Linking /dev/null reports EPERM. The local filesystem
rejects invalid UTF-8 names with EILSEQ: this is refusal evidence, not successful
Linux byte-filename qualification. Portable unit tests validate lossless invalid-byte
transport and explicit unsupported behavior; they do not claim native Linux success
or a deployed remote launcher. Native fixtures are integration evidence, not unit
fixtures or a compatibility certification.

The retained-append rerun is recorded in
`docs/remote-media/safe-fs-retained-append-evidence-20260919.json`.
