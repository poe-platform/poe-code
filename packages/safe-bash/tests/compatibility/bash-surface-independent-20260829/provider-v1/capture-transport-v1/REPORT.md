# Sole D03 capture-transport diagnostic — failed readiness, known closure

Source/preseal commit `134b94d90a4639aeb1c47c9688f6c010de8902ff`. PRESEAL SHA256 `9f4455364897bdb5418ba39a79f0fc40b5592699679cb272820800e1c8d8bc8a`. One actual target, no retry. This is a new diagnostic identity, not F01/D01/D02 replay or rescore.

## Actual result

Target PID17408: raw status null, signal SIGABRT, stdout0bytes, stderr0bytes. Both empty files SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. No readiness. Controller17404 exited1/closed. Target exit/close, stdin finish and unused observer-pipe EOF observed; owned group absent. No TERM/KILL intervention or capture/identity errors.

Parent preopened the two regular0600 single-link files before source/tool admission and launch, enrolled actual FD mappings, and retained stable device/inode/link/mode identity through fsync and bounded FD readback. Owner descriptors closed. These are completed REGULAR FILE captures; stdoutEOF/stderrEOF are null, NOT streamed EOF/backpressure proof. RAW-CAPTURE preserves the transfer chronology, output files and exact tuple.

The original5745-byte profile SHA256 `f0c96a5833d751c7b1ca194094390d75f91fe7c2286920c8eb3c4163afd2c58d` stayed unchanged. New6128-byte profile SHA256 `cd24747ce2db626904e4c6c3986e6a303a85dada923a9dc1e6e8496dee9a93a5` is exactly that prefix plus383 approved bytes: file-read-metadata/file-write-data only for the two exact new stdout/stderr paths. No other rule changed. Historical23-entry fixture namespace remained unchanged; postexecution source/profile authentication passes.

## Inference and smallest next step

The regular-FD replacement plus its exact file exceptions was NOT sufficient to restore readiness. This result does not identify the aborting image/instruction or prove/refute a particular permission denial. Empty regular captures do not establish that Node never reached its write. Realpath metadata matches both configured executable paths, but that is not a loaded-image or firmlink/kernel-path attestation. Cause remains UNKNOWN.

Do NOT promote this variant as a provider repair or try another permission guess. The smallest supported next work is SOURCE-only attribution of the pinned launcher/runtime startup boundary: distinguish sandbox-exec profile application/exec from Node/libuv initialization and identify an exact evidence-backed operation/path before proposing another rule. Any abort-site/denial observer or runtime probe needs a separately reviewed, explicitly authorized bounded mechanism; no host logs, broader read/library permissions or another target launch is authorized here. This observation supplies no justified additional fence delta.

## Scope and accounting

Fresh15min/24 ALL owned processes/peak3/16MiB capture/64MiB work. Sole target3s active +TERM2s/KILL1s;12s cohort, expected literal stdout26 bytes.64KiB-per-file20ms sampling and1MiB capture/16MiB scratch sub-bounds are logical/source-bounded, not kernel file-size/RSS/hard post-kill guarantees. Actual target completed within45ms.

At archived cutoff:14 registered administrative/controller launches +1 target =15 known launches, known peak3 including outer controller; all known retired. Target owner capture5170bytes, raw regular outputs0bytes. No universal tool-internal descendant census. Later evidence-publication commands remain in the retained outer capture and final checkpoint. No previous budget reused.

Native Bash/version/native9/40, product/engine/fixtures/imported target code, private-state/host-log inspection, network tests and further fence variants: NONE. Original15 provider fixtures remain UNRUN. Sagan822e82a70dfebc071d3b6e27bc78967afa40a993 separately reports local Bash3.2.57(1); no repeat probe and no5.3/fence qualification implied.

Owned evidence roots retained: `/private/tmp/safe-bash-surface-provider-capture-diagnostic-v1` and `/tmp/bash-surface-capture-diagnosis-1BzcXo`. Target admission is closed.
