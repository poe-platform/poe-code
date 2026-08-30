# Versioned body/verification separation

ROOT authorizes one remaining33 continuation after finite SOURCE/SYNTHETIC
checks. This is review-harness scope only; fca6f81d/282 inputs/full910 cc0e75c2
remain unchanged.8827ae25 stays27PASS/0caseFAIL/33UNRUN, overall deadline HOLD.

The existing30s batch body window still covers admission, actor execution,
in-flight RPC/capture and mandatory between-case guards through known worker
retirement. It is an upper bound, not a claim of pure product CPU time. No
in-flight check, byte/hash/membership assertion, or body timer is removed.
After worker retirement, a separate120s VERIFY window covers the existing
post-worker guards/deletion, loaded-code closure/restoration checks, and
verifyOrigins. BODY and VERIFY start/end/dispositions are captured separately.
Both windows clamp to their phase end and the same overall120min deadline,
with the existing360s final cleanup reserve. No old clock is restarted.

The outer owns a phase watchdog for both windows. Exact ordered messages bind
batch/kind/start/deadline/cap; arbitrary extension, overlap, reordering and
late PASS are rejected. Cancellation/TERM/KILL/reap occupy the existing final
five seconds of the bounded phase, not an additional allowance. The watchdog
is armed outside the coordinator so a stalled administrative await does not
silently make120s unbounded. No opaque promise or RSS guarantee is inferred.

Before each batch, its full30+120s must fit the remaining phase/global budget;
otherwise it is explicitly UNRUN and no body starts. Planned29 batches are
nine type and20 loaded batches, containing33 calls. Maximum batch windows
4350s plus1440s initial setup/guards and360s final cleanup =6150s, below7200s.
Compiler/build setup120s remains unchanged. No layouts get new clocks.

check-phases.mjs runs24 finite SYNTHETIC controls against only the new review
helper: boundary/clamping/expiry, body vs verification failures, ordering,
exact fields and outer-deadline protocol admission.60s including publication,
one Node controller/no descendants,1MiB capture,8MiB working. No product,
compiler, npm, native Git, private engine, or network. All results are captured
before assertions are aggregated. A nonzero controller is failure. These are
not actual-watchdog or candidate passes; actual phase records remain required.

The single actual run remains capped120min/168 all starts/peak4/256MiB capture/
1GiB work with cleanup inside. All previous failures, bare-OID26 errors,
S02/H09/private-writer limits and mappings remain unchanged. No retry follows
safety/capture/integrity/unknown-retirement failure.
