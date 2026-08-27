# Empty-directory removal

`FileSystem.rmdir?(path: string, options?: FsOptions): Promise<void>` is an
optional, directory-only operation. `FsOptions` contains only `signal`; this
operation has no recursive or force mode. Existing `rm` semantics are unchanged.
Existing structural filesystem implementations remain valid without `rmdir`.

A supported call removes an empty directory entry, never its descendants or a
final symlink. Nonempty directories fail with `FsError.code === "ENOTEMPTY"`;
nondirectories (including final symlinks) fail with `ENOTDIR`; missing paths fail
with `ENOENT`. Preserve the directory and its children on these failures.
Protect virtual and mounted roots from removal. Permission, read-only, IO and
path-resolution failures retain their normal typed errors.

Emptiness must be enforced by the removal operation, not a prior `readdir`
followed by recursive deletion. A concurrent child must not be deleted because
an earlier listing was empty. Do not approximate this operation with
`rm({ recursive: true })`, a recursive remote collection DELETE, or traversal
and deletion of descendants. A backend unable to provide safe empty-directory
removal must leave the namespace unchanged and return `ENOTSUP`; absence of
the optional method is also an explicit unsupported capability at consumers.
Method presence alone does not guarantee support for every mounted path.

Forward `signal` into host work and reject a pre-aborted call before mutation.
Cancellation cannot undo a removal already performed by the host. This method
does not add a namespace transaction, descriptor-relative path identity or a
global snapshot guarantee to the existing filesystem contract.

Consumer checks may improve diagnostics, but must never replace the final safe
operation. `rm -d` uses it only for directories; ordinary file/symlink removal
and explicitly recursive `rm` continue to use `rm`. Missing capability is not
silently ignored, including with `rm -df`.

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
