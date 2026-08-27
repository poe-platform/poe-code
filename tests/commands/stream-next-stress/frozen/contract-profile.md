# Independent source-contract profile

This profile is separate from native command parity. It is derived from the
existing supplied Shell/ByteIO/VFS contracts and accepted opt-in API proposals,
not from author implementation or fixtures. The original input and native
expectation hashes are unchanged. The source harness initial version is retained
in `ea2d833`; preparation refinements are separately committed.

## Publication and limits

The corpus runs with reused small producer buffers, deliberately splitting LF,
UTF8 and binary boundaries. Literal-byte results come from `stdoutBytes` and
VFS file bytes; terminal replacement characters are not evidence. Source-only
contract controls exercise delayed sinks and a large mutable producer chunk,
and retain published references to detect subsequent mutation. VFS write-stream
controls also check configured output slice sizes and sequential awaited writes.

Format output, record, input and argument caps are tested at low valid positive
values. Split input, argument, output and file caps are tested separately from
ordinary native behavior. A limit failure is not relabeled unsupported or a
native pass. The combined split file/output-limit control expects the already
completed two segments to survive; if an implementation fails before those
writes occur, that scheduling assumption must be reported and adjudicated by
root rather than silently rewriting the expectation after inspection.

## Cancellation and partial effects

Injected ENOSPC and cancellation cases use a transparent wrapper around the
actual MemoryFS stream writer. The wrapper deliberately writes an entire first
segment and one byte of the second before failing. Those exact effects must
remain, with no rollback or cleanup of either segment or an unrelated sentinel.
The injected signal is supplied to VFS work, and errno-shaped caller abort
reasons must survive as the original object, not a swallowed utility error.

Blocked VFS reads for `nl`, `rev` and `unexpand`, and a blocked `seq` stdout
sink, are released by cancellation before the artificial host operation rejects
late. Node runs with strict unhandled-rejection handling. This proves the
specified cooperative observations only; it cannot forcibly stop host work or
undo already completed effects.

## Composition and authority

Default factory and actual default Shell invocations must expose exactly 60
commands, with each new name absent until explicitly installed. The new families
are imported only from their accepted source-module paths. A collision must not
partially register a family. Invalid positive-integer limit settings must reject.

An actual Shell custom command invokes `seq` with literal argv containing shell
metacharacters; the nested dispatch must pass through the existing middleware,
not execute those characters. Nested command limits and pipeline output limits
share Shell accounting. Family-local caps do not create a claimed common global
budget. Three native-backed workflows combine the new families and verified
`expand`; a binary split/rejoin control uses the existing `cat` through a real
virtual pipeline on both MemoryFS and explicit-root RealFS.

No remote provider, native inode/allocated-block guarantee, race-free namespace
authority, package-public API, current whole-product gate, time/performance
superiority, or runtime duration completion is claimed by these controls.

An additional pre-exposure preparation control checks same-input split aliases
using the supplied adapters' own `compareEntry` relation before and after the
rejected invocation, alongside unchanged namespace bytes. This verifies preserved
alias relationships rather than treating equal file contents as identity, and
does not assert numeric host inode values or stability against external races.
