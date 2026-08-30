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
