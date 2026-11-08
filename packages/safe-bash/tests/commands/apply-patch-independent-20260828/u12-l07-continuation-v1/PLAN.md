# Frozen U12/L07 continuation, 2026-08-28

This version does not rescore 83c2711f. Candidate753f33d2fa1a2ccd86089c563d4ad66b9a1ae26d,
derived tree6a59ca403c5411344dea2ee057909ba179bf7043 and full882 package
f04afbf9230fd9e3275f83c7dab26837aeb618bd6178f4ac0b794b93302d6d95 remain unchanged.
There are nine new cases: U12-v2-ordinary and U12-v2-caller in source/installed/moved,
plus L07-16383/L07-16384/L07-16385 in source-layout direct MemoryFS only.

## Expectations frozen from source, before execution

The source-bound Shell capture writes bytes before forwarding to the external
sink (shell.ts207-219). Runtime ordinary errors become status1 with exact
`shell: line 1: [object Object]\n` (runtime.ts1197-1216). U12 ordinary therefore
expects a fulfilled status1 result containing the already captured exact summary
`Success. Updated the following files:\nM a\n`, the exact diagnostic, and the same
stderr bytes at the external observer. It does NOT demand execution rejection.
Caller abort rejects with the same caller object; no result is available and no
stderr diagnostic is expected. Both independently fresh Shells expect one sink
attempt with the summary, actual primary identity at that throw, and `new\n`
already published. The two middleware registrations (run_patch/apply_patch) must
finish exactly once before public settlement. Every observation is collected
before assertions; disposal is separate and does not manufacture settlement proof.

L07 paths contain 64 components each252 ASCII x bytes and one final y component
of190/191/192 bytes: 65 components, absolute lengths16383/16384/16385. Frozen
MemoryFS resolve has a255-byte component cap, no lower full-path cap and no
symlinks here. All parents are initially absent and ordinary Add creates them.
Minus/at expect status0, LF-only target and exact success summary. Over expects
status1, empty stdout, exact `apply_patch: UTF-8 byte limit exceeded\n`, no FS calls.
No custom provider or lowered command limits is used. Complete hashed-path
namespace comparison includes every created parent and unchanged binary sentinel.

Profile maxima: patch4194304/file8388608/read67108864/stage33554432 bytes;
files256/hunks4096/path16384 bytes/components256/lines262144/chunks65536/
FS calls65536/work134217728/output1048576/diagnostic16384. Patches are16430-16432
bytes, four lines, one input chunk, one file, no hunks, one staged/output-file byte,
no target file reads. The success summaries16424/16425 bytes are below output cap,
not subject to diagnostic cap. No full-path/provider limit is bypassed. FS traversal
is bounded by65 components and finite prepare/publish passes, not repeated files.

## Admission, capture and process recipe

PRESEAL binds the exact Node22.22.2 binary, source metadata, original build/runtime
seals, all882 package entries, archive/membership, original strict loader/decoder
and new bodies. The owner authenticates before product loads. Streaming archive
rehydration checks every positive-size record's membership, contiguous offsets,
total and hash; zero-byte selected files come only from authenticated membership.
Only the three unmodified full packages are materialized. Source means archived
compiled-source package projection, not a new build. Installed bare resolution uses
a distinct consumer package. Moved is physically renamed and its origin absent.
All job/hash/package guards are durably published before any product import.
Original strict loader is reused unchanged, including no ambient/network fallback.
All216 actual product modules per worker must be authenticated; all-work before/after
inventories reject changed or extra files. No native/oracle/private/network/compiler
or package installer executes. No old types/author/mutants/54 replay.

One controller and three sequential child workers: four runtime processes,
peak2 including controller, no hidden Git/tool descendants. At most16 all-owned
process admissions including subsequent evidence archival, peak3 maximum. Owner
raw stdout/stderr files are precreated at exact new attempt-01 before CLI startup;
the trusted shell opens them before exec, owner opens EVENTS before admission.
Literal pinned Node, login:false, `exec -c`; finite environment is sealed.
Worker permissions are read-only exact consumer/product roots; no FS-write,
worker, child-process or network grants. Case watchdog30s, child watchdog100s,
whole continuation10min including cleanup. Child stdout+stderr cap4MiB each worker;
combined raw/observer/result limit32MiB, scratch256MiB. Archive expansion is streaming
and bounded210MiB, not materialized. Only about13MiB product bytes are written.
Any capture/integrity/unknown retirement error stops dependent cases; no retry.
Ordinary assertions retain all observations and continue after disposal. Receipts
record exact child close/absence and raw byte hashes. Scratch is removed only by
its original owner after identity check. Product files remain read-only.

Unchanged historical results include 15 types,189 author,12 versioned-tail,
8 adapters,33/36 S54,16/18 limits,10 targeted mutant kills,11 failed legacy records,
and21 uncredited legacy records. S32/S57/S61 and WebDAV remain limitations. The
legacy static S54 label is not fresh evidence about this candidate. This is a
qualified module assessment, not default/root/global acceptance.
