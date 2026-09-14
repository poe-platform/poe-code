# Current safe-bash contract findings for remote media execution

Research date: 2026-09-14. This is source-inspection evidence, not an implementation
plan or a compatibility certification. Line references describe the working tree
inspected on this date. No native media commands or provider deployments were run
for this investigation. Proposed contract shapes below are design alternatives,
not existing APIs. Implementation tasks belong in
`docs/plans/remote-media-cli.md`.

The required architecture remains a JavaScript frontend that reconstructs CLI
semantics, discovers dependencies and materializes them for native remote processing.
Native file mediation supplements that frontend. The gaps below do not authorize
dropping features, replacing the frontend with a mount, or claiming full compatibility
from a file-only subset.

## Existing strengths and exact boundaries

- `packages/safe-bash/src/contracts/command.ts:205` exposes byte sources/sinks,
  canonical filesystem, cwd/env, cancellation and invocation cleanup. Its owned
  `CommandArguments` carrier preserves argument bytes; string argv alone is weaker.
- `packages/safe-bash/src/contracts/io.ts:9` provides awaited byte writes and
  optional consumer-closure ownership. Pipe endpoints at lines 27–54 provide
  observation revisions, readiness, peer closure and reference acquisition.
- `packages/safe-fs/src/contracts/descriptor.ts:24` provides retained descriptors,
  positional/sequential reads and writes, truncate, sync and close. Positional
  support and synchronization strength are explicit capabilities.
- `packages/safe-fs/src/contracts/filesystem.ts:225` provides optional open,
  conditional/staged mutation, per-path capability queries, links and streams.
  Optional APIs and unknown capability values are not guarantees of support.
- `packages/safe-bash/src/contracts/filesystem-descriptor.ts:135` routes descriptor
  writes through shell output accounting. The same wrapper owns late acquisition
  and cleanup. Remote writes cannot bypass that accounting by calling a raw backend
  directly and still claim unchanged shell limits.

## Extra descriptors: internal support does not reach registered commands

Evidence: `CommandContext` at `command.ts:205` exposes stdin/stdout/stderr only;
`CommandInvokeOptions` at line 183 likewise lacks a descriptor table.
`shell/runtime.ts:737` attaches stdin metadata and a stdout-file path, not arbitrary
descriptor access. Internal `shell/descriptors.ts:38` and `:44` retain/acquire pipe
references. `shell/extensions.ts:66` offers numbered input borrow/observation to
shell extensions, but no corresponding general byte read/write descriptor API for
registered media commands.

Consequently a frontend cannot faithfully connect an arbitrary inherited native
fd through the public command context merely because shell redirection syntax was
accepted. Extra progress outputs, multiple pipe inputs and fd aliases need explicit
bridging. Reopening a filename loses shared cursor, append, closure and alias semantics.

A compatible extension is an optional invocation-owned descriptor capability on
command/invoke contracts. It should acquire admitted inherited descriptors by number,
return typed read/write/seek/observation operations, preserve open-file-description
identity across aliases and release references without closing the caller's ownership.
The shell constructs it from its existing descriptor frame after redirections. The
remote protocol maps admitted handles to native descriptors with close-on-exec and
inheritance rules; it never accepts arbitrary host descriptor numbers. Qualification
requires dup/close, EOF versus idle, shared offsets, append and failed writes.

## TTY and process signals are distinct from cancellation

**Scope correction:** the user confirmed noninteractive safe-bash. Terminal/PTY,
resize and foreground terminal job-control proposals in this historical section
are rejected for this plan. Descriptor streams, cancellation and supported explicit
process signals remain required. Do not implement terminal capabilities from this audit.


Evidence: `shell/types.ts:58` and `command.ts:205` provide an AbortSignal but no
terminal dimensions, isatty, termios, foreground process group or resize channel.
`command.ts:226` reports only exitCode. Existing
`shell/extensions/trap/index.ts:7` has a host signal subscription, so it would be
incorrect to say the shell has no signal machinery; that hook does not itself give
a registered command a native process-control/terminal contract.

An additive terminal capability should describe admitted fds, terminal mode and
window state and carry resize/control events separately from byte streams. A
process-control capability should carry ordered named/numbered signals, process-group
targeting and termination acknowledgment. Cancellation remains disposal of the job,
not a synonym for every signal. Keep richer exit/signal/spawn/transport outcomes in
the remote protocol and define their shell-status projection explicitly. A PTY is
selected only for terminal operation; using it by default corrupts binary pipe
semantics. Stop/continue, foreground groups and terminal-generated signals require
qualification rather than substitution with AbortController.abort().

## mmap and file locking have no current canonical contract

Evidence: `descriptor.ts:24` has only read/write/stat/truncate/sync/close plus
optional cursor/read observation. `filesystem.ts:225` has no mapping, locking,
lease, invalidation or memory-coherence operations.

Private immutable mappings can be backed by an authenticated retained snapshot
when that is the actual requested behavior. Shared writable mappings cannot be
implemented faithfully by downloading a file and copying it back at process exit.
An extension design needs object-scoped range coherence: mapping registration,
read version/invalidation, dirty-range publication, flush barriers, truncation
notifications and retained identity. Native page fault/mmap mediation feasibility
is separate provider research; a TypeScript interface does not establish it.

For locks, introduce explicitly qualified object/range lock operations with owner
identity, blocking versus nonblocking acquisition, cancellation, unlock and
disconnect cleanup. Distinguish process-associated and open-description-associated
ownership if the native interface requires both. Locks must be enforced in the
canonical authority across all participating writers; locking only the remote
scratch copy does not coordinate with another canonical client. Existing backends
without enforcement remain a recorded engineering gap, not silent lock success.

## Hardlinks exist, but portable identity and complete metadata are incomplete

Evidence: `filesystem.ts:63` declares hardlinks; `:258` exposes optional `link`;
`:245` exposes tri-state `compareEntry`. `FileStat` at `:9` includes optional
identityScope, dev/ino/nlink/revision. identityScope is an object or symbol, not a
serializable cross-process identity. There is no hardlink-by-open-descriptor API.

Use authority-issued opaque object handles in the remote protocol. Derive them
from qualified retained identity rather than serializing dev/ino alone or hashing
a pathname. Map hardlink aliases to one object, retain it after unlink, preserve
cross-mount failure and define lock/cache ownership on that identity. Unknown
comparison must trigger stronger identity acquisition, not an assumption that two
paths are distinct. Extending an object-handle contract is preferable to giving
remote jobs unrestricted namespace access.

`FileStat` can report uid/gid, but the FileSystem interface has chmod/utimes only,
not chown, xattrs or ACL mutation. Full metadata behavior therefore needs additional
capability-qualified operations where observed native workflows use them; copying
bytes and mode is not complete metadata preservation.

## Live visibility requires a coherence protocol, not exit-time synchronization

Evidence: canonical writes, rename and unlink are operations in
`filesystem.ts:240–263`; optional conditional/staged operations are at `:226–233`.
Neither these contracts nor retained descriptors define a cross-client change
subscription, coherent remote cache or linearization point for materialized copies.
Descriptor sync declares strength (`descriptor.ts:21`) but does not by itself
invalidate another process's cached pages or bytes.

Define acknowledgment points for every read/write/truncate/rename/unlink and bind
them to authority-issued object handles and revisions. Acknowledged canonical
writes remain visible after subsequent native failure. Read freshness requires
revalidation at the native operation or a real lease/invalidation mechanism, including
aliases, retained opens and mutable secondary inputs. An authority-side operation
journal can order participating operations and reconnect acknowledgments, but cannot
manufacture exactly-once durability after journal loss or bypass external writers.
Conditional publication is useful for selected operations, not a replacement for
native early truncation or progressive segment output.

For backend interoperability, define which guarantees the adapter can enforce for
all writers and which require new backend capabilities. Delayed backends, read-only
mounts, partial writes, quota errors and concurrent local/remote clients are essential
evidence. Mirror-at-exit semantics would contradict the full native target.

## Additional representational gaps

`filesystem.ts:6` enumerates file/directory/symlink/character, without FIFO, socket
or block-device types. Its paths and directory names are strings (`:31`, `:240`),
while raw-byte argv can express names not faithfully represented by ordinary UTF-8
decoding. Descriptor positions/sizes are numbers (`descriptor.ts:26–31`,
`filesystem.ts:11`); only the separate read handle's optional seekEnd returns bigint
(`filesystem.ts:96`). JSON decimal-string offsets alone do not fix local unsafe
number conversion.

Compatible extensions should add typed byte-path operations/carriers, exact large
offset operations and explicit special-file capabilities without changing existing
string/number callers silently. Device and socket forwarding needs separately
authorized endpoint capabilities; a synthetic regular file cannot stand in for a
camera, terminal, FIFO or socket. Offset admission must reject inexact values until
the backend supports exact operations. These remain full-target gaps to implement
and qualify, not exclusions from compatibility accounting.

## Evidence limits

This inspection establishes public contract omissions and reuse opportunities,
not that every native invocation needs every extension. Native traced fixtures
must identify actual access paths and observable behavior. The proposed additive
shapes require contract review, failing tests and deployed native evidence before
support is claimed. Existing source and tests were not changed or rerun.
