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
| `descriptorWriteStream` | Optional stronger incremental, pinned-resource descriptor semantics for `writeStream`; never inferred from ordinary streaming or random-access eligibility |
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

`implicitDirectories` does not promise that writes create missing ancestors.
Adapters may expose both implicit prefixes and explicit directory markers. Flags
do not promise transactions, arbitrary file sizes, preserved inode identity,
successful cross-device operations, or deployed server feature availability.

`randomAccessWrite` is not a new positional-writer API. It expressly permits the
existing shell strategy that observes current bytes and writes an offset-adjusted
replacement; it must not be inferred from `write`, `append`, or `streamingWrite`.
Memory and real adapters advertise it; atomic/sequential object adapters do not.
This does not add a new emulation route or promise concurrent-writer isolation.

## Descriptor write streams

`descriptorWriteStream?: boolean` is an additive optional capability, not a new
writer method or stream mode. A positive claim requires a callable `writeStream`
and compatible write/append stream support; `readOnly: true` still takes
precedence. Unknown and false claims must not select this stronger profile.

The profile opens one resource per stream. `w`/`wx` truncate on open and use an
independent positional cursor, advancing only after a successful nonempty chunk.
`a`/`ax` write each chunk at that opened resource's current EOF, including after
another writer appends or truncates. Rename, unlink and name replacement do not
retarget the opened stream. Concurrent independent opens have independent
cursors. This is not a transaction across chunks or protection from interleaved
external effects.

Each completed chunk is visible before the stream requests its next input.
Bytes retained in the file are owned independently of the producer's buffer;
the producer may reuse its buffer after that acknowledgement. This does not
authorize delaying visible writes until a batching threshold or stream EOF.
An empty chunk neither extends the file nor advances the cursor. Writing past
EOF after a truncation zero-fills the gap; positional overwrites preserve the
unaffected current suffix, rather than rebuilding it from a stale file image.
Source failure and cancellation preserve already published prefixes and do not
turn them into an atomic stream publication.

Stock Memory implements this profile with its existing pinned node, geometric
storage growth, and direct synchronous copying from each input chunk into owned
storage. No extra full-file mirror or intermediate owned chunk copy is required.
Input validation, acquisition, exclusive-create errors and per-chunk cancellation
remain observable. Its optional capability is a guarded getter: an inherited
subclass, substituted root/capability object, or replaced relevant write,
metadata, access, resolution or allocation method withdraws the stock claim.
Accessor overrides are inspected as descriptors rather than executed. This is
a conservative stock enrollment check, not a host-JavaScript sandbox; an
explicit custom host declaration must itself be truthful. A copied capability
snapshot is not ongoing authentication of a wrapper's future methods.

Compatibility change: Memory previously appended every `writeStream` chunk even
for `w`/`wx`. Non-append streams now retain their positional cursor under external
interference. For example, after `AAAAAAAA`, an external append of `X`, then
`BBBBBBBB` from the original non-append stream produces `AAAAAAAABBBBBBBB`, not
`AAAAAAAAXBBBBBBBB`. Direct Memory stream consumers also observe this change;
there is no extra opt-in mode preserving the former append-like `w` behavior.
Ordinary non-interfered streams and current-EOF append semantics are preserved.

Readonly, Quota and Overlay explicitly report `descriptorWriteStream: false`.
Quota's replacement stream is append-based, and Overlay's staged publication
does not establish this incremental descriptor contract. Neither may inherit a
positive claim from an underlying backend. Mount forwards the selected backing
stream and path capability, rejects readonly/disabled/missing-stream positive
claims, and preserves its existing namespace rules. Its global capabilities are
construction-time summaries; use `capabilitiesFor` for current path admission,
including after a Memory policy method changes. A query is not a lease across
later host mutations.

Real, S3 and WebDAV do not opt in in this slice. Their existing stream and direct
append implementations are unchanged. In particular, non-streaming remote
append fallback costs are not repaired by this capability. There is no new
global allocation limit, heap amplification claim, OOM protection, or arbitrary
host deadline/preemption guarantee.

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

## Quota accounting

The [filesystem quota contract](filesystem-quota.md) defines logical namespace
bytes, alias-aware admission for existing-file growth, conservative identity
handling, incremental stream effects, and the limits of composed namespaces.

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
