# Read-only filesystem wrapper

This directory exports `ReadOnlyFileSystem implements FileSystem`, with
`constructor(filesystem: FileSystem)`, and the synchronous factory
`createReadOnlyFileSystem(filesystem: FileSystem): ReadOnlyFileSystem`.
It uses only the shared contracts and has no runtime package dependencies.
No package-root or package-subpath export is added by this component.

## Mutation policy

Every mutation rejects its returned promise with `FsError` code `EROFS`, before
reading options, inspecting payloads, checking paths, or calling the delegate.
This includes `writeFile` with **any** flag (even a read-looking or invalid flag),
`appendFile`, `writeStream`, `mkdir`, `rm`, `rename`, `copyFile`, `symlink`, `link`,
`chmod`, `utimes`, and `truncate`. Optional mutations are present and denied even
when the underlying adapter does not implement them. The additional convenience
methods `unlink(path: string, options?: FsOptions): Promise<void>` and
`rmdir(path: string, options?: RemoveOptions): Promise<void>` are also denied.
Other adapter-specific methods are not forwarded; there is no native execution
or public delegate property.

`writeStream` does not acquire an iterator, advance a generator, or call its
cleanup methods. Mutation errors have precedence over pre-aborted signals,
invalid flags, missing paths, and empty/no-op payloads. A pre-aborted mutation
therefore still rejects with `EROFS`, not the signal's reason.

Errors retain the supplied, unnormalized paths and method name in `syscall`.
For `rename`, `copyFile`, `link`, and `symlink`, the first path argument is
`error.path` and the second is `error.dest`. All other denied operations have
only `error.path`. `access` rejects any valid mode containing `W_OK` with
`EROFS`, including combinations with `R_OK` or `X_OK`; invalid modes reject with
`EINVAL`. Neither case calls the delegate, even for pre-aborted options.

## Read delegation and ownership

Read operations preserve paths, option objects (including signals and limits),
delegate receiver binding, and underlying errors. `readFile` results and
`readStream` chunks are copied into fresh `Uint8Array` instances, including when
the delegate returns a Buffer or reuses chunk storage. Stats and directory
entries are shallow snapshots; their contract fields are all scalar values.
Mode bits and timestamps are not rewritten to pretend the underlying data has
different metadata. Non-writing access checks delegate normally.

Absent `readlink` rejects its promise with `ENOTSUP`. `readStream` is an async
generator: creating the iterable does no delegate work, and absence rejects
the first `next()` with `ENOTSUP`. Stopping iteration closes the underlying
iterator. Existing optional read methods are called even when their capability
flag is false or absent, so adapter-provided `ENOTSUP` errors remain intact.
Supported reads leave cancellation semantics to the delegate; an absent
optional read reports `ENOTSUP` even with a pre-aborted signal. The wrapper
does not forcibly terminate uncooperative operations.

## Capabilities and limits

Capabilities are a frozen, constructor-time snapshot held behind a getter:
`readOnly: true`; `hardlinks`, `permissions`, `timestamps`, `atomicRename`, and
`streamingWrite`: false. Here mutation-related flags describe operations
available through this wrapper, not whether underlying metadata remains
readable. `symlinks` and `streamingRead` are true only when the delegate explicitly
advertises the corresponding capability and provides `readlink` or
`readStream`, respectively. Unknown extension flags are omitted rather than
accidentally advertising a write capability or an unforwarded method. Mutating
the original capability object does not change this snapshot.

This is a composable read-only API view, not a snapshot filesystem, a sandbox
against a malicious delegate, or exclusive control of the underlying storage.
Changes through separately held delegate references remain visible. Reads may
trigger delegate-managed access-time updates, caching, or network activity.
Do not hand callers the delegate if they must have only this read-only view.
No superiority over other filesystem libraries is asserted.

## Focused verification

On 2026-08-26, `node --unhandled-rejections=strict --import tsx --test
tests/fs/readonly/*.test.ts` passed all 82 tests, including 20 repeated runs.
The tests use only an instrumented fake and the memory adapter, never real host
directories. They cover mutation denial, adversarial flags, stream
nonconsumption/lifecycle, error metadata, pre-aborted options, byte/metadata
ownership, optional capability permutations, alias safety, and nested wrappers.
Strict TypeScript checking of this implementation and its three test files also
passed with the repository's compiler settings. These are scoped results, not
whole-repository validation or comparative benchmark evidence.
