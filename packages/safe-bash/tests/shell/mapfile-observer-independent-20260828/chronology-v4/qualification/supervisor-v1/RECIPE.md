# Supervisor v1 preparation seal — 2026-08-28

PREPARATION ONLY. No dispatch token exists. Post-source controls are not blind.
All new files are opt-in data. Original 8779070712e5d2d253fd29f31b0294ae4b9414cc
qualification inputs and b1485454 failures remain immutable. Source candidate
3d3a0371729b88ced47b6e37376676746b638ad9/evidence
b9d681d9c25d4054ab6a9bf2d5470d88b39eed67 are unchanged.

## Mechanism and boundaries

The new parent owns an actual Node entry handle and all five actual Bash handles.
The entry loads the unchanged whole observer/driver and four dependency modules.
The sole child_process export is a sealed synchronous pipe broker; it replaces
the spawn builtin, not observer predicates. Parent FD3 receives <=16KiB newline
requests; FD4 replies synchronously; the independent IPC channel forwards actual
parent callbacks and copied output. A 2s entry RPC wait cannot stop the parent's
independent timers. Spawn returns the actual parent-owned PID. Pre-arm callbacks
are buffered, never invented; arm occurs after the actual driver's listeners exist.
Parent validates exact frozen executable/argv/env/cwd/stdin and sequence before
each acquisition. H05 remains an entry-host throw AFTER its forwarded actual
spawn callback and before spawn receipt publication. D03 retains exact host reason.
Cross-process OS error descriptions are wire data, not cross-process object identity.

Reuse: the accepted candidate data/lifecycle modules are loaded unchanged, including
finite own-data comparison and actual-event chronology. The earlier array supervisor
c630301c0b262d281dc8197a946cb3e03fa03788, blob
9f34bb6f54fc06c9d78dba72a50e537e7c62f483, was inspected but NOT reused: its
post-close group signalling is unsuitable here. New broker failure paths gain only
the mock evidence actually obtained; historical acceptance is not inherited.

PID authority is the parent's in-memory actual spawn handle, never journal JSON.
Only its matching positive detached leader PID is used for negative-PGID signalling,
only before an actual exit/close callback, and only TERM/KILL once each. Probes
after exit are signal 0 only. Unknown IDs/PIDs, replayed frames and malformed data
fail admission. Journal mutation cannot choose a signal target. No guarantee is
made against a hostile host/kernel PID ABA race between syscalls; only the sealed
no-descendant scripts are admitted. Surviving groups after leader exit are uncertain:
retain, fail, stop; never signal newly discovered/unowned members. Parent death is
not recoverable authority from a stale journal; no automatic recovery/retry exists.

## Finite bounds

Future process total: one externally started parent + one entry + five sequential
Bash = seven, at most three concurrently. No other subprocesses, network or workers.
Parent watches entry at60s; each Bash at3500ms, TERM then KILL after250ms,
1000ms actual-close/group settlement limit. Whole owner deadline65s, outer70s.
Source's2500/2750/3000ms timers remain unchanged. None preempts blocking host syscalls.
Entry256MiB V8 heap, parent256MiB; not RSS bounds. RPC1024 calls,16KiB frames,
32KiB incoming accumulation,64 outstanding IPC sends,128 pre-arm callbacks,
2MiB callback wire bytes. Raw parent capture jointly bounds entry stdout+stderr
(including Node warnings) at4MiB; each Bash stdout+stderr131072 bytes. Source
retains65536 bytes/row. Journal8192 frames,16384 bytes/frame,2MiB total, SHA chain,
exclusive0600/O_NOFOLLOW FD, every append checks inode/mode/size and fsyncs;
final re-read checks complete framing/chain/run/rootPID and owned digest.
32 parent files,16MiB parent storage; entry256 files/96 directories/8MiB writes;
parent evidence262144 bytes, entry publication4MiB. <=64 live descriptors is the
operational ceiling (store32 + two owned processes' pipes + hashes/RPC/runtime).
Hash chunks65536: parent tools4GiB cumulative, entry source reads8GiB; archive
parent64MiB cumulative. Node body<=256MiB, GNU<=16MiB. No unbounded failure concat.

Physical archive: /private/tmp/mapfile-observer-hq-archive-RUNID, exact COMBINED
members only, files0644/directories0700. No staging is performed during prep.
Future ROOT must materialize ONLY these authenticated bytes (PAYLOADS supplies old
members; new members come from the exact grant commit) and authenticate the census.
Output root /private/tmp/mapfile-observer-hq-RUNID is entry-owned; source roots are
its -D01 through -H05 siblings. Parent owns -parent directory and -guard.bin sibling.
The guard is exclusively created BEFORE parent-root mkdir or child acquisition.
Parent writes only guard, entry/H01-H05 stdout/stderr.raw, parent-final.json.
Entry writes only its fixed authorization/guard/PID/qualification-final files and
candidate-owned receipt names, prospectively registered in its bounded ledger.
Only identity-checked empty rmdir is used. Evidence is retained, not recursively
deleted. Cleanup means known child settlement and descriptor closure, not removal
of retained evidence. Unknown/partial acquisitions are retained and fail.

Authoritative parent stdout requires exit0, actual spawn/exit/close and absent
groups, exact entry report IDs/load hashes, complete raw capture, archive/tool/
GO/own-file guards, source cleanup, final receipt re-read, descriptor cleanup and
an after-cleanup census. Provisional JSON never grants success. Source CLI/native43/
product semantics remain excluded. ROOT alone can route later native observations.

## Frozen mock execution

Run once after committing this recipe, sources, COMBINED and CONTROLS. Trusted
Node --experimental-vm-modules --input-type=module reads mock-review.mjs.data on
stdin. Subject modules run in VM with explicit FS/process/timer/builtin ports.
Host child_process exports are denied before any subject load; unlisted imports
(worker/network included) STOP. The source tools become explicit one-byte mock
files with modeled hashes/inodes; fresh physical hashes are separate READONLY
attestation, not synthetic cryptographic evidence. No real qualification entry
or child executes. Virtual clock<=71000ms/control,<=20000 queue turns/control;
host wall180s, host stdout/stderr64KiB each, capture16MiB, no files except fresh
CAPTURE-01.json and host raw receipt files. One run, no hidden retries. Assertions
aggregate only with zero pending modeled descriptors/timers and integrity intact.
Unclean mock/safety failure stops. Any minimal harness correction is separately
versioned/presealed; originals remain. No author/native cohorts execute.

Future launch requires a new external approved JSON and token. The template is
NOT_AUTHORIZED. No execution in this packet constitutes ROOT GO.
