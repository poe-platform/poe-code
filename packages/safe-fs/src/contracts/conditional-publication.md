# Conditional byte publication

`FileSystem.publishFileConditional(path, source, options)` is an optional,
authoritative host operation for immutable flat path stores. Declare
`capabilities.atomicFilePublication: true` only when the backend can implement
the entire operation atomically. Ordinary `writeFile`, streaming writes, rename,
or client-side stat/check/write do not establish this guarantee.

The filesystem's normal `stat`/`lstat` supplies:

- `identityScope`: a shared reference representing the actual backing namespace.
- `opaqueIdentity`: a nonempty string (at most 4096 characters) identifying the
  backing object within that scope. Aliases of an object share this value.
- `opaqueVersion`: a nonempty string (at most 4096 characters) identifying an
  ABA-safe namespace generation. Replacement and delete/recreate change it even
  when bytes and metadata agree. A content hash alone is insufficient.

Known disjoint scopes compare distinctly. Missing identity remains unknown;
never manufacture inode numbers to obtain identity clearance. These observed
identities do not themselves provide leases or atomic publication authority.

`options.expected === null` means create only if the final binding is absent.
Otherwise, compare the supplied scope and generation with the current binding
at commit, rejecting stale writes with `EAGAIN` or exclusive-create conflicts
with `EEXIST`. Consume the complete byte source with backpressure before commit,
respect `maxBytes` before allocation and enforce independent backend quotas.
Keep produced bytes private until successful conditional publication. Return
the published regular file's coherent stat, including its new opaque generation.
Never acknowledge without exhausting the source, or publish partial bytes.

`options.parent` is the observed parent metadata. Native hosts may enforce a
stronger parent identity condition. Implicit-directory hosts enforce their own
authoritative path and namespace policy without inventing parent inodes.
Optional `mode` and `mtimeMs` requests must be honored when supplied or refused
before mutation. With `permissions: false`, ZIP omits permission requests and
canonical file modes may be advisory.

The host checks cancellation before commit and drains admitted cooperative
uploads. Producer failure, upload failure, conflict or cancellation before
commit preserves the destination and retires private uploads/retains. Release
the old blob retain only after successful publication. Cancellation after commit
cannot roll it back. Host caches, source retention and transport buffering have
their own configured bounds; source backpressure alone does not bound them.

Path authorization, symlink resolution, tenants and identity scopes must match
the filesystem's read/stat operations. `hardlinks: false` asserts the absence of
hardlinks, rather than just the inability to create new ones. ZIP accepts omitted
link counts only with opaque identity and that assertion. Actual blob/path
aliases still need truthful shared backing identities and are excluded.

Scoped, device and mount views preserve the capability with policy checks.
Readonly, overlay and quota wrappers that cannot enforce the operation refuse
it and do not advertise atomic publication; identityless hosts must enforce
publication quotas authoritatively at the backend.

An adapter only needs to expose this operation and the opaque stat fields on its
existing canonical namespace. No staging directory API, POSIX identity numbers,
permission API, command rewrite or new provider package is required.
