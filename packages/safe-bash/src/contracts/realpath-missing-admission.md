# Missing-path canonicalization admission

`realpath -m` retains its preliminary `lstat` before consulting the optional
`FileSystem.canonicalizeMissingTarget` operation. This also applies to
`--relative-to` and `--relative-base` values. A returned string is used directly;
`undefined` selects fallback. A thrown error is not an instruction to retry.
Cancellation is checked before and after the synchronous operation.

The existing memory operation admits only its guarded stock implementation.
Modified adapters can refuse it, and quota views mask it. CP retains the
existing preflight-only admission; its execution path does not gain this hook.

Fallback preserves ordered `realpath`, ENOENT handling, and `lstat` symlink checks
while descending to a resolvable prefix. Reconstruction folds each saved basename
in reverse using the same individual `joinPath` operations as before. It is not
equivalent to normalizing the entire input before resolving links.

For realpath mode, fallback yields through `yieldTurn(signal)` every 32 missing
levels and every 32 reconstruction steps, with cancellation checks between
steps. CP does not gain these macrotask yields. Existing output before a later
failure/cancellation remains published, and non-ENOENT failures do not trigger an
extra yield before being reported.

This is cooperative scheduling, not arbitrary-host preemption or a universal
path-depth budget. Fallback can still perform quadratic cumulative prefix/string
work. A synchronous optimized operation or injected filesystem call cannot be
interrupted while it owns the event loop. No numeric path limit is introduced.

The operation preserves current path behavior, including existing dangling-link,
file-ancestor, trailing-slash, and missing-prefix lexical-suffix behavior. It does
not establish full GNU canonicalize-missing compatibility. `readlink -m` remains
unsupported, and `realpath -e` does not use the missing-target operation.
