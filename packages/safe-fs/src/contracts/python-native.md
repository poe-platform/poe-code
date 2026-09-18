# Native asynchronous Python syscall adapter

`createPythonNativeSyscalls` is a lower-level host building block exported from
`@poe-code/safe-fs/core` (the standalone distribution uses
`@poe-platform/safe-fs/core`). It is **not a qualified Cloudflare executor**.
Its runtime argument is the pinned Pyodide 314.0.6 Emscripten module ABI.

`invoke(name, args)` implements asynchronous musl/WASI syscall dispatch. It must
be installed at a Wasm import suspension boundary, not returned as a Promise from
a synchronous Emscripten FS callback. Native open/read/write use the canonical
`dispatch` endpoint; no workspace data is copied into MEMFS. Bootstrap runtime
paths use the explicitly supplied original syscall implementation and are
read-only through this adapter. Unknown canonical descriptors never fall back
to bootstrap files. The original runtime and dispatch provider remain borrowed.

The adapter covers retained file open/read/write/close, positioned I/O, seek,
dup, sync, truncate, metadata, basic pathname creation/removal/rename/symlink,
access, cwd, binary stdin/stdout/stderr and limited fcntl/ioctl behavior. It does
not implement every POSIX syscall. Unsupported native directory descriptors,
locking, ownership changes, timestamp updates and other unimplemented calls
fail with ENOTSUP or ENOSYS. This component alone does not disable unrelated
runtime host/network APIs or provide confinement.

Transfers respect `maxTransferBytes`, await backpressure and copy outgoing
fragments before awaiting the host. Native reads may return short reads.
Descriptors retain canonical identity across pathname changes; seek does not
reopen the path. Each invocation has independent stdio-close state and native
descriptor bookkeeping. Native errno uses the pinned guest ABI, not host errno
numbers; unknown host exceptions become EIO. A canceled invocation returns EINTR
at the syscall boundary without undoing earlier effects.

`metadata(pathOrFd, follow)` projects canonical metadata for Python consumers
that can represent absent optional fields. Native fixed-layout stat instead
returns EOVERFLOW when required fields cannot be faithfully encoded. No inode,
allocation count or ownership fields are fabricated to make imports succeed.

Only one native request or metadata projection may be admitted at a time.
`close()` closes admission, waits for admitted work, and serially closes owned
descriptors. It attempts remaining closes after a failure and preserves cleanup
failure across repeated calls. It never disposes the borrowed filesystem or a
sibling adapter. The caller must coordinate cancellation and retirement of its
dispatch service; this object cannot force an opaque host Promise to settle.
