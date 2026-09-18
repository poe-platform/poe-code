# Python filesystem translation

`PythonFileSystem` is the asynchronous, portable filesystem half of interpreter
worker RPC. The constructor receives the authoritative application FileSystem;
`dispatch` accepts only the enumerated operation tuples. It must execute on an
event loop that the synchronous interpreter cannot block. The runtime owns that
transport and its interpreter/pipe shutdown. The service never mirrors a tree,
reopens a descriptor by pathname, or buffers a file for delayed writeback.

Paths are joined to the absolute constructor cwd without collapsing supplied
symlink-sensitive components. Canonical backends remain responsible for path,
symlink, permission, mount and quota semantics. Filesystem acquisition may be
wrapped using `open`, for shell-owned output accounting; the original filesystem
still supplies path-specific capability admission. The service does not advertise
the backing filesystem's capabilities as its own supported RPC surface.

The defaults are 65,536 bytes per transfer, 256 simultaneous descriptors and
65,536 entries per directory listing. `maxTransferBytes`, `maxOpenFiles`, and
`maxDirectoryEntries` configure these admission bounds. Directory listing limits
are forwarded to the backend; cancellation is checked when the listing returns,
then an oversized reply is rejected with `EFBIG` before reaching the interpreter.
This does not bound allocations
already made by a backend that ignores the requested limit. Transfers return the
actual partial count; no write retry is hidden. The transport additionally must
bound admitted concurrent messages and its serialized reply capacity. Errors,
including exact cancellation reasons, are propagated by the asynchronous service;
wire errno translation belongs to the worker boundary. Unknown operations refuse.

`close` stops admission, cancels cooperative operations, drains admitted work and
closes every owned descriptor. A late acquisition is closed before cancellation
settles. Noncooperative provider work cannot be forcibly interrupted, and close
waits for it. A failed close is observable and does not prove the provider released
its external resource. An owner must register cleanup before the first dispatch.

Before service retirement begins, a canceled caller may still dispatch a
validated descriptor `close` request. Content operations retain cancellation
precedence. This release path cannot open, read or mutate files and does not
reopen service admission after `close()` has begun. The transport must drain a
descriptor's admitted work before releasing it.

`translatePythonOpenFlags` translates the pinned Emscripten flag ABI. Exclusive
creation delegates directly to canonical acquisition; O_NOFOLLOW is supported
only with O_CREAT|O_EXCL. Other unsupported flags refuse before effects. General
no-follow acquisition, retained fchmod/futimes, and unqualified provider guarantees
are not synthesized. Guest unlink requires canonical unlink, never weaker rm.

`PythonStatTranslator` maps complete canonical scope/device identities into a
bounded, invocation-local guest device namespace while retaining inode numbers.
The default limit is 1,024 scope/device pairs, configurable by constructor.
Aliases retain the same pair, disjoint scopes get distinct devices, and opaque
scope authority is never serialized. Incomplete canonical identities omit device
and inode fields; a runtime ABI must treat any required numeric placeholders as
unknown, never as a complete canonical identity. Other metadata is preserved.
Runtime bootstrap/std-library storage and namespace collision admission belong
to the runtime mount integration, separately from this application filesystem.

Exclusive opens skip capability queries that follow the final entry: those queries
would turn a self-loop into ELOOP before canonical exclusive acquisition can return
EEXIST. Explicit global descriptor refusal remains authoritative. A composite
reporting open:false and readOnly:false therefore refuses exclusive acquisition
with ENOTSUP; it does not expose a backing read-only error for an operation never
admitted. An exposed readOnly:true mutation restriction takes precedence over
open:false and returns EROFS. Nonexclusive queries retain selected-path policy.
