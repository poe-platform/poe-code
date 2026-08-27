# Independent abort-count migration review

Frozen before candidate execution. Product and historical fixtures are read-only.
Candidate is exactly b282159921ce530e932b02f90c64eca987de2704, not current HEAD.
Six controls: exact readBytes schedule, old-count rejection, public rejection,
wrong-reason rejection, accepted-output rejection, missing-finalization rejection.
Negative guards mutate actual runtime observations, not source text assertions.

## Contract proof

The unchanged borrowed helper increments yielded before each yield, and increments
unchangedChecks in the inner finally. After the first next resumes, that finally
runs, resumed becomes 1, and afterRead synchronously aborts. Abort is not a throw
inside this producer: its loop continues to prepare and yield the second (empty)
chunk. Thus yielded becomes 2. contracts/io.ts abortable has already subscribed
before iterator.next; the abort event rejects with signal.reason before that next
result is delivered. readBytes rethrows and schedules iterator.return; closing
the suspended second yield runs its inner finally (unchangedChecks becomes 2),
skips the next resumed increment, and runs outer finalization. Final state is
{yielded:2,resumed:1,finalized:true,unchangedChecks:2}.

These are producer-local events, not two chunks delivered to readBytes' caller,
two accepted output writes, or permission for new post-abort host operations.
The direct control expects only first chunk 41e2 delivered. Public jq raw slurp
must reject by exact reason identity, emit no bytes and leave VFS unchanged.
src/contracts/command.md caller settlement precedence and shell/shell.ts public
throwIfAborted require rejection, not a fabricated command exit status.
readBytes does not promise awaiting an arbitrary uncooperative iterator.return;
these controls establish completion only for this synchronous cooperative helper.

## Review gate

Historical 24 inputs/commands/helper/signal/schedule remain identical. Only the
abort state assertion changes yielded and unchangedChecks from 1 to 2. Stronger
exact rejection, empty-output, unchanged-FS and disposal evidence are allowed.
No producer or cancellation timing edits, weakening or source edits are allowed.
Historical first21/24, fixed23/24 and direct1/2 remain separate and unchanged.
No v2 24/24 claim until actual authenticated moved-package execution.

Use existing read-only fix-review fixed source/build/tarball only after comparing
every archived source/config byte to git b282 and verifying build/package pins.
Authenticate bytes of every loaded package module. Strict unhandled rejections;
180-second bounded parent watchdog and natural child closure. No real network,
servers, regex probes, root dist builds, dependency installation or broader gate.
