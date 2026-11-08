# Mount filesystem

`index.ts` exports `MountFileSystem`, `createMountFileSystem`, and the
`MountFileSystemOptions` type. The constructor and factory both take
`{ root: FileSystem, mounts?: Readonly<Record<string, FileSystem>> }`.
The factory returns `MountFileSystem`. Configuration is captured at construction;
there is no dynamic mount/unmount API. Mount keys must be absolute POSIX paths.
Configuration keys are normalized lexically; duplicate normalized keys and `/`
overrides are rejected with `EINVAL`. A backend can appear at multiple mount
locations; its backing-entry identities remain shared across those views.
Each backend exposes its own `/` as a directory.
When a backend is itself a `MountFileSystem`, its static mount table is flattened
and rebased during construction, preserving its internal device and symlink
boundaries. Collisions with the outer configuration are rejected, not overridden.
Opaque decorators are not unwrapped. Their policy and namespace information are
not assumed to match a single-device backend; see the verification limits below.

`capabilities.snapshotRmdir` is a live getter on the frozen capability object.
It is true when any routed backend currently declares the snapshot-marker
profile, including nested mounts and a host facade whose backing profile changes
after construction. The static mount table itself has no add/remove API.
This conservative aggregate flag does not weaken strict routed `rmdir` calls:
each backend retains its own operation semantics. Snapshot success can leave a
late child and therefore its logical directory visible; mount forwarding does
not hide that child or promise absence, rollback, or marker-instance identity.

## Namespace and symlinks

- Routing uses the longest component-prefix, never a plain string prefix.
  Relative operation paths start at virtual `/`, not the host working directory.
- Operation paths are walked component by component. Symlinks are resolved before
  subsequent `..`; trailing slashes require directories. Entry mutations such as
  `rm` and `rename` reject a final symlink with a trailing slash instead of deleting
  its referent. Root aliases cannot bypass mutation protection.
- Traversal uses the selected backend's execute/search probe unless that backend
  explicitly declares `permissions: false`. In that profile it uses existence
  access instead; directory metadata and the eventual read/write/copy operation
  still require actual backend authorization. WebDAV therefore uses authorized
  PROPFIND while walking collections, not fictional POSIX execute bits. This is
  not proof that a subsequent GET, PUT, COPY or MOVE is permitted; those requests
  must succeed independently. Every probe error and cancellation still propagates.
  Missing permission metadata is conservative and keeps the execute probe, as do
  native/memory backends even within a mixed mount whose aggregate permissions
  capability is false. Explicit caller `access(path, mode)` remains unchanged:
  mounted WebDAV X_OK/W_OK requests still reject `ENOTSUP`. No identity, symlink,
  mount-boundary or chroot guard is relaxed by this traversal policy.
- Absolute backend symlink targets mean the root of **that mount**, not global
  `/`. Relative targets start at the link's backend parent. `readlink` returns the
  stored target unchanged; `realpath` returns a canonical global path.
- Following a symlink pins the rest of that path walk to its mount. Neither its
  target nor remaining caller components may leave that mount or enter a nested
  mount; violations return `EACCES`. Relative `..` at this pinned root also fails.
  To access another mount, use a global path that does not traverse such a link.
  Up to 40 link expansions are permitted; loops return `ELOOP`.
- Symlink creation stores targets unchanged and permits dangling or currently
  out-of-bounds targets. Traversal, not storage, enforces the boundary. A forbidden
  link can still be inspected with `lstat`/`readlink`, renamed, or removed.
- Before using a followed symlink's resolved location, the wrapper also asks the
  selected backend to `realpath` the original link spelling plus its remaining
  caller components. For entry operations that do not follow the final link,
  this verifies the parent, retains the final name, and lstats the original full
  spelling to preserve denials at a hidden final mountpoint. Backend denials propagate;
  disagreement with the wrapper's canonical path returns `ENOTSUP`, not data from
  the differently interpreted target. This check preserves opaque backend
  denials such as `ReadOnlyFileSystem(innerMount)`'s nested-device boundaries.
- This is deliberately conservative: dangling-link traversal and followed-link
  paths with missing suffixes return `ENOENT` rather than creating an unverified
  target, even on a single-device backend. Create targets by explicit global
  paths first. Existing links work only when both interpretations agree. For
  example, a relative link within an opaque inner mount can work, while an
  absolute link interpreted relative to a hidden inner device root is rejected
  with `ENOTSUP` when it resolves differently. Non-following inspection still
  returns the stored link, and ordinary explicit-path reads remain supported.
- Backends are trusted to implement their contracts, enforce their own host-root
  isolation, and honor cancellation. The contract has no atomic no-follow handles:
  this wrapper cannot secure resolution against external concurrent backend
  symlink replacement. Do not expose writable backend references to adversaries.

## Directories and mutations

Mount roots hide the underlying entry entirely. Mount ancestors are directories
even when the underlying entry is missing, a file, or a symlink. Such synthetic
parents have stable `0555` metadata and never follow the hidden entry. Existing
backing directories retain their metadata and ordinary children. `readdir`
merges backing children with immediate mount/synthetic children, replaces hidden
entry types with `directory`, deduplicates names, and sorts by name.

Virtual `/`, mountpoints, and all directories containing mounts cannot be
removed, renamed, replaced, chmodded, timestamped, or otherwise mutated through
this wrapper (`EBUSY`). Recursive mkdir on an existing directory is a no-op.
Ordinary children of real backing directories remain writable. Synthetic-only
parents can be traversed to mounts but cannot acquire ordinary children
(`ENOTSUP`); they are not implicitly materialized in a backend.

Rename and hardlink require the same mount identity (`EXDEV` otherwise). Rename
never falls back to copy/remove. Cross-mount copy transfers bytes using the
selected source reader and destination writer, awaiting consumption and closing
the reader on failure. If either selected backend lacks streaming, a bounded
64-MiB `readFile`/`writeFile` fallback is used; source overflow fails before the
destination write. Destination exclusivity and read-only checks precede input
consumption. New-file modes are requested only from permission-capable writers.
Complete `identityScope`/`dev`/`ino` tuples reject observed aliases before source
acquisition or target writes (`EINVAL`, or `EEXIST` for exclusive copies).
Different complete scopes must denote genuinely disjoint storage; missing or
invalid identity alone cannot justify an existing overwrite through this wrapper.
For unknown tuples, the approved optional `compareEntry` authority is consulted
before content acquisition. Recognized distinctness permits copying; unknown
remains `ENOTSUP`, and invalid or conflicting answers fail `EIO`. Arbitrary
`copyFile` method presence is not a negotiated native guard. Both operands resolve
through trusted wrapper views without erasing readonly policy. A shared actual
backend can receive its native copy operation after the guard, even when mounted
twice. See `COMPARISON.md` for the internal integration API and provider limits.
Observed missing targets use exclusive creation, preserving raced entries.
These are point-in-time checks, not leases or pathname/ABA race protection.
Copy is not a transaction: a failed destination write can leave partial bytes,
but source deletion is never attempted. Same-mount copy and streaming writes
delegate to the selected backend and retain its failure/partial-write semantics.

## Optional methods, errors, and streams

`rmdir(path, options?: FsOptions)` removes only an empty directory using the
selected backend's optional `rmdir`, never a listing followed by recursive
`rm`. It preserves mount-root/ancestor protections, readonly checks, exact
global error operands and cancellation forwarding. Missing backend support
returns `ENOTSUP` before any deletion; errors including `ENOTEMPTY` propagate.
The backend must perform its own empty check atomically with deletion, so a
child arriving after mount resolution is not recursively removed. Existing
`rm` behavior is unchanged.

All contract optional methods are exposed as guarded dispatchers. A method absent
on the selected backend, or explicitly disabled by its associated capability,
returns `ENOTSUP`; other mounts can still support it. Global capability flags are
conservative intersections of explicit backend flags and required methods,
except streaming: true requires all backends to advertise support and expose
the method; false means no backend can support that dispatcher; the flag is
omitted for heterogeneous/unknown support. An omitted flag is not a guarantee.
Dispatch still checks the selected backend before consuming input, so an
unstreamable remote mount neither disables local streams nor gains fake support.
`readOnly` is true only when all backends declare it; `atomicRename` is false with
multiple mounts because global cross-mount rename is unavailable. Unknown
capabilities are not advertised. `truncate` has no contract capability flag and
is dispatched solely by method availability.

Signals are forwarded throughout resolution and backend work. Data-operation and
stream options are forwarded unchanged. Recursive mkdir is decomposed into
nonrecursive backend calls, preserving its signal and mode; failures can leave
already-created ordinary directories in place **only during execution**. Before
any mkdir call, a nonmutating planning walk models missing directories and checks
the entire path, including symlinks, dotdot, known mount boundaries, and backend
realpath verification. A static planning denial does not create prefixes or
modify backend content/metadata through mutating calls. Metadata-read side effects
of a backend itself are outside the shared contract's guarantees.
Read streams are lazy, preserve streaming, and use `readBytes` to stop waiting on
cancellation and close the underlying iterator when the consumer stops. Late
read/cleanup rejections are observed. Pre-aborted operations do not touch a backend. Backend errors
are wrapped as `FsError` with the public operation's syscall, global input `path`,
and global `dest` when applicable; backend-local details remain only in `cause`.
Unrecognized failures become `EIO`. A signal's actual abort reason is preserved.

### Production-fix checkpoint (2026-08-26)

`node --unhandled-rejections=strict --import tsx --test tests/fs/mount/*.test.ts`
passes 105/105 tests. Cross-device copy's former `EXDEV` prohibition is replaced
by exact-byte transfer, exclusivity, no-source-deletion, and partial-write error
tests; rename and hardlink still require one mount identity.

The three owned wrapper suites pass 361/361; the unmodified shared conformance
suite passes 202/202. The unmodified complete filesystem test glob passes
1,091/1,091, and `npm run typecheck` passes in the concurrent working tree.
No shared conformance or integration expectations were edited.

The unchanged 79-case adapter-tools matrix initially reproduced 58 passes and
21 failures, reached a 77-pass checkpoint during concurrent remote fixes, then
reported 70 passes and nine failures: six shell missing-path
diagnostics no longer contain `ENOENT`, two readonly redirection diagnostics no
longer contained `EROFS`, and jq rejected `split/1`. After wrapper commits
`402bda8`, `b05b734`, and `78f5cd6`, with concurrent owner fixes present, the
unchanged matrix passed **79/79**, with zero failures, cancellations, skips, or
TODOs. Mount cross-backend copies, mount/overlay named-file probes, and readonly
named gzip pass. These are observed
working-tree results including other owners' concurrent changes, not isolated
wrapper attribution, a complete product gate, or comparative superiority evidence.

Stat and directory-entry snapshots read named contract fields, including optional
stat metadata, so prototype getters and nonenumerable properties are retained.

## Shared-contract requirements for broader composition

The current interface does not expose an owning device identity or its virtual
root, nor a side-effect-free resolution operation for missing tails with an
explicit final-symlink policy. These are needed to support generic opaque
multi-device decorators without the conservative rejections above; decorators
must preserve that information and their original path-traversal policy.
The present verification assumes a trusted backend's `realpath` enforces the same
static traversal boundaries as its other operations and returns a canonical path
in its public namespace. It does not infer hidden device identities from `dev`
or inspect decorator internals. Race-proof guarantees additionally require atomic
no-follow/handle-based operations; neither planning nor realpath comparison can
provide them using the existing contract.
