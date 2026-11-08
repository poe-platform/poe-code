# Sole Bash3.2.57 readiness — STOP, known new-target closure

## Actual result

Source/preseal commit fb3609affe314285b8664063585f56c8b9a37f99, PRESEAL SHA256 f08664a9566a2d616f09fb4d27ac03bee831acf0e5dbf6578aeb1bc27a6407ef. One authorized fixed-program target, no retry. Actual target PID60047: status null, SIGABRT, stdout0bytes, stderr0bytes; readiness NOT observed. Target interval 2026-08-29T06:16:17.889Z–2026-08-29T06:16:17.917Z (28ms). This PID is the observed spawned sandbox-exec/requested-Bash chain; no actual crash-image record was read, so this result alone does not prove which image or startup instruction aborted.

Controller PID59943 is the separate pinned, unfenced Node22.22.2 capture controller (execArgv=[]), not a Node readiness target. It reauthenticated19 physical tool/cache/loader bindings before starting the target, then exited1/closed with61stdout bytes and0stderr. Its8146ms duration includes source/tool authentication and must not be reported as Bash execution duration.

Both target regular outputs remain0600, single-link, identity-stable, size0, SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855. Owner fsync/readback/close completed. streamEOF is explicitly null for regular stdout/stderr; actual child exit/close, stdin finish and unused fd3-pipe EOF are separate observed fields. No TERM/KILL cleanup signal was sent; primary TARGET_SIGNAL has no secondary error.

## Repaired observer evidence, not historical rescore

The new standalone adapter imports kill explicitly from node:process. Its new-target group observation is absent with preserved name=Error, code=ESRCH, errno=-3, syscall=kill, all presence=value. This is the one recorded group check for this newly owned PID, not a universal descendant census or future PID-reuse guarantee. Error fields and their presence remain in RESULTS.json. Eight presealed DATA counterexamples pass separately; they are not eight native/fence passes or broad lifecycle qualification.

The historical log query []/exit0/unknown-group STOP remains unchanged. No historical group, crash record, log, Node readiness or Bash --version was revisited. Successful operation of the new observer does not recover the old discarded exception or establish its cause.

## Profile and tool scope

Bash regular0555/1293840bytes SHA25635536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3 matches Sagan's prior3.2.57 version evidence. This is not GNU5.3. SOURCE bindings reference ff2ebe44's loader graph/cache identities and preserve runtimeLoadedImagesObserved=false.

Profile5690bytes SHA25617d2628a44e52c4fe245021ccdca8cc8ae7202b123800a3659a7fd79eee2c037 has only the22 enumerated literal occurrence substitutions from D03: target/read identity and owned paths. Its operation skeleton/system-read/sysctl rules remain unchanged. No ncurses/Mach/library/network/home expansion was introduced. The declared ncurses system-image edge is not proof a denied ncurses read caused this abort; no permission delta is justified by this result.

The parent streamed5,909,077,919 tool/cache bytes in256KiB buffers, copied no binary tools, and rehashed the controller before activation. The controller independently reauthenticated19 entries before the target. Source files and staged profile were reauthenticated after completion; raw evidence is encoded losslessly in RAW-CAPTURE.json. The fixed expected stdout was26bytes; observed stdout is0, not a waived mismatch.

## STOP and next finite decision

No further target admission, profile variant, native9/40, GNU5.3 build, engine/product operation or readiness retry is authorized or performed. The target-admission marker and ONE-TARGET-CONSUMED remain retained. Permission cause and actual crash image are UNKNOWN; do not transfer Node's old dyld diagnosis to this new PID by similarity.

Minimum proposed next step, requiring a new grant: independently review this observer/profile/tuple binding, then at most one narrowly selected existing diagnostic record for PID60047 and the exact target interval above, with presealed bounded identity/time predicates and the same limited image/termination/startup-field whitelist. No new launch or broadened fence accompanies that proposal. If there is no qualified matching evidence, keep readiness blocked. Native nine-fence controls and forty semantics remain UNRUN; their qualification must wait for an actually working, independently reviewed provider/reference path.

## Resource accounting and closure

Fresh20min/40ALL/peak3/32MiB capture/128MiB working only; old reservations are not used. At initial evidence checkpoint17 registered administrative/controller starts plus1 target=18 known starts, all observed exited/closed; later dev-Git publication is separately counted in FINAL-CLOSED.json in the outer capture. Peak known chain is coordinator→controller→target (3); no tool-internal kernel census is claimed.

Raw regular capture0bytes; owner events and fixed/controller data are well below their bounds. Regular64KiB caps are source-bounded plus20ms sampling, not hard kernel filesize or RSS guarantees. One instantaneous absent-group result is not arbitrary-child escape/fence proof. All owned target descriptors and controller streams closed; no background watcher was left running. No old raw directory or evidence is deleted.

Retained roots: /private/tmp/safe-bash-reference-readiness-v1-abpaov and /tmp/bash-reference-readiness-abpaov. The primary failure is immutable; independent publication completion is not readiness acceptance.
