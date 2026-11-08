# Copy-on-write overlay

`index.ts` exports `OverlayFileSystem`, `createOverlayFileSystem`, and the
`OverlayFileSystemOptions` type. Both constructors take `{ upper, lower,
maxBufferBytes? }`. Each backend must already have a directory root. The two
backends must be distinct, non-aliasing storage namespaces. Upper must be
exclusively owned by this instance; lower must not be externally modified while
the instance is in use. No other wrappers are required.

`rmdir` refuses with `ENOTSUP` before upper mutation or whiteout publication if
the upper currently declares `capabilities.snapshotRmdir === true`. A successful
snapshot-marker removal may leave a late child visible in the backing store;
publishing a whiteout would incorrectly hide it. The refusal also covers
lower-only removal and conservatively covers a mixed-profile mounted upper.
It is checked after ordinary path, permission and visible-emptiness diagnostics,
including after the final asynchronous listing; errors and cancellation retain
their existing precedence. No other mutation capability is changed. A strict
upper retains its existing removal behavior, including above a static lower
that declares snapshot-marker support, because lower `rmdir` is never delegated.
The overlay does not advertise the weaker profile. These checks do not relax
the exclusive-upper/static-lower prerequisites or add external-writer safety to
strict backends that violate those prerequisites.

`compareEntry` resolves both followed read views without copy-up or staging
cleanup. It exposes the currently selected backing entry, not future write
authority. `copyFile` separately resolves its destination inside the mutation
queue, checks any physical upper target before content acquisition, and uses
the approved comparison authority when complete scoped identities are unknown.
Unknown remains unsupported; invalid/conflicting authority answers fail `EIO`.

Symlink namespace agreement is checked, not assumed. Before returning a resolved
path, every followed link's backend must confirm that the complete remaining
request resolves to the same canonical path as the overlay. This uses backend
`realpath` as validation only: actual reads/writes still use the overlay-selected
entry after whiteout checks. Entry operations validate the parent and the
unfollowed final name. A mismatch rejects `ENOTSUP`; backend `ENOENT`, `EACCES`,
and other validation errors propagate. For example, a mounted backend may report
`readlink('/mount/link') === '/file'` but intend `/mount/file`; the overlay rejects
that disagreement instead of reading `/file` from the wrong root. Validation
includes suffixes such as `../..`, not merely the immediate link target.

Opaque Mount/decorator composition is **not supported generically** by the
current contracts. A safe generic extension would need a namespace-aware
link-resolution operation that supplies the global target and traversal
boundary, works for dangling targets, and permits overlay whiteout checks before
target access. The conservative checks below intentionally reject cases whose
semantics cannot currently be established.

Reads prefer upper; directory listings merge both layers. Whiteouts suppress
removed lower names and their descendants. Recreated and moved directories are
opaque, so old lower children cannot reappear. Links are resolved component by
component in the overlay namespace, including `..`, with a 40-link limit.
No mutation method is ever called on lower. A backend's own read-side effects
(such as access-time updates) cannot be prevented by this adapter.

## State and guarantees

- Whiteouts, opacity, copied symlink mode/timestamps and origin-validation records,
  and staging cleanup records
  are **volatile, instance-local, nonpersistent metadata**. Reopening an upper
  with a new overlay instance loses this state and can reveal deleted lower
  entries or discard copied-link boundary provenance. Do not reopen an upper
  whose interpretation depends on a previous instance's metadata. This is not a
  durable overlay format or a safe persisted-state reopening protocol.
- Mutations require `upper.capabilities.atomicRename === true`; otherwise they
  reject `ENOTSUP` (or `EROFS` for a read-only upper). The overlay advertises
  `readOnly: true` if either prerequisite for mutation is absent. Upper must implement rename
  as an atomic publication that leaves source/destination unchanged on failure.
  All backend operations must settle only after they stop accessing their paths.
  Aborted host work that continues after rejecting violates this prerequisite.
- File updates clone the visible entry into a private temporary upper directory,
  apply changes there, then publish with rename. Source bytes are copied. Source
  and destination paths are checked in the overlay, including exclusive flags.
  Empty/new files, symlinks, directory copy-up, and deletion also use staging.
- Directory rename first copies every visible descendant into upper, without
  following final symlinks. One upper rename then moves the complete tree. The
  source is whiteouted and the destination made opaque. Failed preparation may
  leave valid, equivalent copy-ups and changed parent/ctime metadata; it does not
  publish partial file contents or discard whiteouts. This is **not a transaction**.
  Overlay `atomicRename` is consequently false, even though upper must support it.
- Namespace operations are serialized within this instance. Stream input is
  staged outside the lock, then destination existence is revalidated at publication. Concurrent
  appends therefore concatenate at commit time, rather than stream-open time.
  Cancellation before publication preserves visible file contents. Cancellation
  that races a successful publication may complete successfully. Recursive mkdir
  and rename preparation can leave completed directory/copy-up work on failure.
- Temporary `.virtual-bash-overlay-<UUID>` directories live in upper's root and
  are hidden from this instance. Active input stages are tracked separately from
  cleanup garbage, so reentrant input and concurrent `cleanup()` cannot remove
  in-flight streams. They require a writable upper root. Cleanup
  deliberately does not use the canceled caller signal. Failed cleanup is retried
  on subsequent calls; `cleanup(options?)` reports remaining failures through
  `AggregateError`. A committed operation remains successful if cleanup fails.
  Crash recovery and cleanup after process termination are not implemented.

## Capabilities and limits

- No runtime dependencies and no native command execution.
- Capabilities are a frozen, nonreplaceable snapshot. Metadata reads explicitly
  snapshot every named `FileStat` field, including optional zero-valued fields;
  prototype getters and nonenumerable backend properties are supported. Returned
  stats and directory entries are detached from backend objects.
- `readStream` lazily resolves the visible layer and delegates ranges/chunk sizes
  to its stream, copying chunks and preserving backpressure. Cancellation stops
  waiting and closes the iterator; late failures are observed. Stream reads are
  not snapshots against concurrent mutation. An unsupported selected stream
  retains the bounded `readFile` fallback, not a fake streaming guarantee.
- `writeStream` uses the atomic upper's real stream methods when available:
  stage input outside the namespace lock, revalidate the destination, stream any
  existing copy-up and append, then publish with upper rename. No full input
  collection occurs in this path. If a lower entry cannot stream, its copy-up is
  bounded and buffered. Nonstreaming upper adapters retain the bounded buffered
  convenience path. Failed writes never publish their partially staged bytes.
- `streamingRead` is true only when both layers advertise and expose reads,
  false when neither can stream, and otherwise omitted. `streamingWrite` is true
  only with a writable atomic upper exposing advertised read/write streams and
  both layers advertising reads; a capable upper with a limited/unknown lower
  omits this flag, while an incapable upper reports false. Omission denotes
  conditional support, not a namespace-wide guarantee. `atomicRename` stays false.
- The default `maxBufferBytes` is 64 MiB, applied per buffered file/input and to
  streamed writes/copy-up. Larger writes reject `EFBIG`; a buffered read's
  `maxBytes` can further lower its bound. Genuine streamed reads do not collect
  the file and may read files/ranges larger than that buffer limit. Backend
  memory usage and host-operation cancellation remain backend responsibilities.
- On 2026-08-26, the complete overlay suite passed 154/154 tests with strict
  unhandled-rejection checking. New streaming regressions include managed real
  upper roots, no-`readFile` stream/copy-up probes, backpressure, reentrant cleanup,
  binary/empty/range handling, failure atomicity, lower immutability, whiteouts,
  non-atomic upper denial, and cancellation/late-error cleanup. Scoped strict
  source/test typechecking also passed.
- Symlink creation requires upper symlink support. Read-only traversal can still
  read links when the selected backend supplies `readlink`. Copied symlink targets
  and mode/atime/mtime are preserved; link metadata lives in the volatile sidecar
  because the contracts do not have `lchmod`/`lutimes`.
- Following a dangling link, a link whose target exists only in the other layer,
  or an upper symlink override that redirects a lower link's route can reject
  `ENOENT`/`ENOTSUP` even when normal single-root overlay semantics would allow it.
  Newly creating directories through symlinks with recursive mkdir rejects
  `ENOTSUP` before creation through the link. Literal `readlink`, `lstat`, removal
  of the link itself, and exclusive-existence checks remain available without
  following its target. Creating a dangling link is allowed; following it still
  requires backend confirmation once its target exists.
- Copying up or relocating a symlink additionally requires an existing,
  alias-free target path in its originating backend. Reading/writing through
  ordinary symlink chains still works when every backend confirms the final
  namespace, but copying up/moving chains or dangling links rejects. Copied lower
  links retain their original backend-path validation after directory moves, so
  copy-up cannot discard an opaque lower traversal boundary. Relative relocation
  that changes an unprovable external target also rejects `ENOTSUP`. These are
  explicit feature limitations pending the namespace-aware shared contract.
- File/directory copy-up preserves mode, atime and mtime. It needs upper `utimes`
  and either `chmod` or exact mode creation. Missing support rejects `ENOTSUP`,
  rather than silently discarding metadata. Inode/device identity, ctime,
  birthtime, ownership, ACLs, and extended attributes are not preserved.
- `chmod`/`utimes` capability flags follow upper capabilities and methods.
  Directory metadata updates are delegated in place after directory copy-up;
  their failure semantics are those of upper, not transactional rollback.
- Permission checks use the selected layer's owner mode bits when that layer
  advertises permissions. There is no user/group identity or ACL model; backends
  may impose additional restrictions. Copy-up can fail when backend directory
  permissions forbid creation, even where a native overlay could perform it.
  Replacing an existing file requires reading it and write access to its parent;
  those are stricter requirements than in-place POSIX writes.
- Hardlinks are unsupported. `link` rejects `ENOTSUP`; copying up/replacing an
  entry with `nlink > 1` (or an unknown count on a hardlink-capable backend)
  rejects rather than breaking aliases. Moving existing
  upper hardlinks without copying remains possible. `truncate` is provided with
  a bounded buffer fallback when upper lacks a truncate method.

## Directory-only removal

`rmdir(path, options?: FsOptions)` rejects non-directories with `ENOTDIR`,
missing entries with `ENOENT`, and a nonempty merged view with `ENOTEMPTY`.
It never uses staged rename, recursive backing removal, or pending garbage
cleanup. Removing an upper entry invokes only the upper backend's optional
directory-only `rmdir` and then records the whiteout. Removing a lower-only
entry records an instance whiteout without any backing mutation. Backing errors
are not swallowed, and a raced upper child remains visible when the backend rejects.
Errors retain the original operand and the `rmdir` syscall. Lower entries
are never deleted. Existing `rm` semantics are unchanged.

Under the existing unchanged-lower/exclusively-owned-upper prerequisites,
lower-only, preexisting upper-only, and merged empty directories are supported.
The merged emptiness decision and whiteout publication run within the instance's
namespace queue. A same-instance child committed first causes `ENOTEMPTY`; a
child queued after successful removal sees `ENOENT` unless its parent is first
recreated. Recreation remains opaque, so removed lower descendants do not return.
All physical lower bytes and entries are preserved, including whiteouted children.

If an upper entry must be removed but upper lacks `rmdir`, removal returns
`ENOTSUP` without mutation. A physically nonempty upper directory is left intact
when the backing `rmdir` rejects, even if the merged listing hides its children;
there is no recursive fallback or whiteout on that failure. A lower-only whiteout
does not require an upper deletion primitive. External lower mutation violates
the documented prerequisite: readonly capability is not a snapshot guarantee,
and the overlay does not promise atomic cross-provider state or undo such writes.
