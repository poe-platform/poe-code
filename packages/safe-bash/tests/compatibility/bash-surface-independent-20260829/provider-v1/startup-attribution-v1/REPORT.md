# Startup attribution: source/DATA only

## Finding

Cause remains **UNKNOWN**. No readiness, Bash, provider, product, compiler, engine or Worker target was launched. No fence was changed. Native qualification9/semantic40 remain UNRUN. F01, D01/D02 and D03 captures and original receipts remain immutable; this is not a rescore.

The current pinned Node/sandbox-exec/Bash hashes, sizes and modes match their prior bindings. Nineteen sealed source/input rows and four historical Git receipt/plan objects were authenticated. Eight source/DATA comparisons hold; these are not runtime passes.

## Concrete new metadata

One directly addressed, SHA-pinned Xcode llvm-objdump invocation read only Mach-O dylib/rpath metadata from sandbox-exec and Node. It exited0, emitted904 stdout bytes/0 stderr bytes, and was observed exited/closed. No executable was decoded as text, disassembled, or run as a target. The command bypassed /usr/bin/otool and its historically unresolved shim/xcodebuild route; no claim of full metadata-tool dependency or kernel descendant census is made.

- sandbox-exec directly names /usr/lib/libsandbox.1.dylib and /usr/lib/libSystem.B.dylib in both reported slices, matching reference38a4's saved linkage.
- Node directly names CoreFoundation, Security, libc++.1.dylib and libSystem.B.dylib. All FOUR are exact literal read paths in the original fence. No rpath rows were emitted by the selected metadata command.
- libsandbox is NOT an explicit fence literal. That is not evidence of a required post-fence read: wrapper image loading versus policy application was not observed. Do not add this permission on this evidence alone.
- The13 recorded shared-cache files still have their recorded metadata. /usr/lib/dyld is a regular file; the six other queried framework/library paths are ENOENT. Metadata/absence does not establish loaded-image identity, loader resolution, cache contents, or denial. It does not prove an image is missing at runtime.

See METADATA.json, FINDINGS.json and LINKAGE.stdout for exact values and qualifiers.

## Exact chain and comparison

| Axis | Historical qualified-write reference | Failed chain / reconciliation |
|---|---|---|
| Source | 38a4e7b evidence; immutable86038b27 launcher | ab99f154 provider;2200e564 pair;134b94d9 D03 |
| Policy | allow-default; scoped write/link restrictions and /dev/null write | deny-default; exact read/exec/sysctl rules; explicit network/fork denial. Reference does NOT qualify this broader fence. |
| Invocation | sandbox-exec -p inline profile | sandbox-exec -f authenticated regular profile, then absolute Node22 --eval literal (F01 instead imports its fixed fixture). No shell/PATH resolution. |
| Runtime/env | Node24.11.1; supplied env merge, TMP/TEMP/preload/IPC variants | Node22.22.2; exactly LC_ALL/LANG/TZ/HOME/TMPDIR/PATH, same owned F01 cwd. D01/D02/D03 argv suffix, six-key env and cwd compare equal. |
| Capture | preopened capture streams; pipes/IPC; polling/cooperative observation | F01/D01/D02 four pipes. D03 replaces stdout/stderr with owner-preopened exclusive/no-follow regular FDs, keeping empty stdin and unused fd3 pipe. |
| D03 delta | not applicable | Exact5745-byte original profile prefix plus383-byte exceptions only for metadata/write-data on its two output files. No broader read/library permission. |
| Observer | historical process polling, not full image census | parent child-process spawn/exit/close, stream completion or regular readback, group absence. None witnesses sandbox initialization success, exec transition, loaded Node entry, or aborting instruction. |

Source anchors: ../lifecycle.mjs:79; ../profile.mjs:32; ../diagnosis-v1/diagnostics.mjs:28 (capture), :31 (spawn); ../capture-transport-v1/capture-diagnostic.mjs:16/:63 (owner FDs), :35 (spawn). Hashes are in METADATA.json. Reference exact objects/raw source are archived; no mutable HEAD composition.

D01's historical26-byte success establishes that the literal/configured env/cwd worked without this fence. D02 fails with the unchanged fence; D03 also fails after the regular-FD change. This associates failure with the fenced composition but does not distinguish sandbox-exec startup/policy processing, target exec/dyld startup, or Node initialization. Empty captures are not a missing-capture finding: the records authenticate emptiness/completion; the missing witness is the process-image/initialization boundary. D03 regular readback is NOT streamed EOF.

## Minimal next decision — NO launch proposed

Authorize a designated collector to obtain **one existing OS diagnostic record for D03 PID17408**, launched2026-08-29T05:06:24.416Z and finished05:06:24.461Z. Narrow lookup window:05:06:22.416Z–05:06:26.461Z, with exactPID AND timestamp AND image/parent correlation (controller17404); never PID alone. Expected launch image sandbox-exec or post-exec Node, possibly dyld attribution. Do not assume which.

Root must specify the exact record locator/collector before access. Proposed admission: one regular non-symlink record <=256KiB, one read, no directory-wide content scan, <=32KiB selected output. Fields only: process/path/PID/time/parent; exception and termination namespace/code/description; crashed-thread first16 frames; image identifiers needed for those frames. Omit environment, unrelated processes, user identifiers and unrelated application data. Preserve selected raw fields with record hash/selection qualification; no full-private-log publication. No runtime rerun, privilege escalation, unified-log sweep or broad permission change. If absent, ambiguous, oversized or mismatched: HOLD, no fallback expansion. D02/F01 requests need a separate decision.

A bound report identifying sandbox-exec would inform wrapper/policy startup; a Node/dyld report would narrow post-exec startup; neither automatically proves a specific sandbox denial. A missing/uninformative record leaves UNKNOWN. Only evidence identifying the operation/image should drive a later single capability experiment.

## Primary-source basis and limits

Apple's execve manual documents image replacement with process identity retained: https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/execve.2.html . Thus a PID/exit alone is not an image-transition witness.

Apple explains that crash-report process/path fields, termination information and crashed-thread backtraces distinguish causes: https://developer.apple.com/documentation/xcode/examining-the-fields-in-a-crash-report . It documents multiple SIGABRT situations, including language exceptions and missing frameworks: https://developer.apple.com/documentation/xcode/identifying-the-cause-of-common-crashes . No specific one is inferred here. No host diagnostic record was read.

LLVM documents --macho, --dylibs-used and --rpaths as object-file metadata: https://llvm.org/docs/CommandGuide/llvm-objdump.html . Current upstream documentation does not attest the exact installed tool build; its local hash is separately recorded. Apple likewise distinguishes otool -L library names/versions: https://developer.apple.com/library/archive/documentation/Porting/Conceptual/PortingUnix/compiling/compiling.html . Static linkage is not a runtime image trace.

## Phase accounting

Fresh20min/40ALL-process/peak3/64MiB-capture/256MiB-work authorization, starting1787980447269; no historical reservation reused. Direct child starts/exits/closes and raw bytes are captured; no kernel-wide descendant census or hard preemption/RSS claim. Fixed metadata operation only, no compiler/target launches. Two module-locator preparation errors occurred BEFORE child admission (unsupported data URL, unsupported query suffix); an empty-input Git batch completed0/empty and was corrected as source/DATA. All are preserved, not runtime successes. Publication snapshots and finalization report exact cutoffs rather than claiming self-including hashes.
