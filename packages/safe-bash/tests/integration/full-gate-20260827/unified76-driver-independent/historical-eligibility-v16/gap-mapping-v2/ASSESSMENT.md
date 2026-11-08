# H06.3 / H11.2: source-only risk mapping

**No execution or rescore.** aea233274c5cdf5cff7bd667cd6c038eb6550ffb remains
38PASS/0FAIL/2UNEXECUTED, coordinator1. ROOT decides qualified release disposition;
this receipt issues no release or complete40 acceptance. Observed August28,2026
07:08:58CDT; existing instructions read, no private/retained-root access or copies.

All launcher paths below have prefix
`tests/integration/full-gate-20260827/unified76-driver/launcher-v3/` at
`e35d83ca97f6aa4f32b2cb8542f5e711458f6aeb`. `BINDINGS.json` records exact full
file Git blobs/SHA256 and function/block line-byte SHA256, predecessor02a/96da,
fe15 and targeted accepted-proof bindings. No executable body is retained here.

## Matrix

| Gap | New versus inherited | What is actually established |
| --- | --- | --- |
| H06.3 | New maintained setup and partial-state recovery compose with inherited catch/private-finally code | Source-qualified error preservation when final report persistence succeeds; no actual private-finally dual-failure execution |
| H11.2 | Supervisor/observer/worker bytes inherited; new setup and changed top-level verdict compose with them | Prior scoped process/observer success evidence, not injected observer-failure/unresolved-finally proof; a conditional inherited cleanup/error-retention gap exists |

## H06.3: changed state, unchanged branch, conditional persistence

`execute.mjs` whole-file SHA256 is
025968a81758ca3b8da8d9c17930ab085c2b55740fe2a600eb9fddd8f12d2189.
`execute` lines27–155 function SHA256 is
7914dfd9185d9046b5ffff49ada9a33205f20b3b2652f867354ca17bee5da984.
The primary catch at145 equals96da line140 byte-for-byte; the private-finally
branch at148 equals96da line142, block SHA256
4602e0d9d5f24fef6569716ea58089dfa64febe05ed9806e00ca5ec3f7a82a31.

Composition is nevertheless NEW: lines77–78 initialize the receipt BEFORE
awaiting maintained setup; line147 recovers a completed private-before token on
failure. `maintained-prerequisites.mjs:15-31` awaits all nine callbacks;
`:114-131` initializes `files`/`copiedRoot` and records progress before returning.
There is no `copyStarted` field; actual state is `safejs.before`, `files`,
`copiedRoot` and `completedStages`. Consequently partial-copy failure can now
reach the inherited final guard when the old assignment-only-after-return path
could not. Identical branch bytes do NOT prove identical execution context.

Exact two-error source trace: setup/copy fails A after a before token exists;
catch145 stores A's message/stack in `report.error`. The final private guard
fails B; catch148 stores B's stack in `report.privateGuardError`, forces exit1,
and leaves A intact. On successful `save` at151, both persist. The unchanged
adapter `tool-routing.mjs:228-290` separately retains callback/drift/restore
messages in `report.inheritedHelperRoutes`; multiple failures throw AggregateError
at287, restoration failure poisons reuse at281–283. A poisoned final guard may
refuse before privateState; that is not a clean private postguard.

The exact frozen early-failure scenario matters: failure BEFORE private-before
means branch148 is NOT entered. There is no unconditional private cleanup callback
to inject a second failure into. H06.3 therefore cannot simply be renamed a
private-finally pass using earlier setup controls.

There is an inherited terminal persistence limit: `save(output/REPORT.json)` at151
is outside a protecting catch. If A is already recorded and save throws B,
`execute` rejects B; `worker.mjs:9` logs B and assigns B.exitCode or78. A remains
in the in-memory report but is not guaranteed durably captured; the later console
summary is skipped. This is a conditional I/O-failure witness, NOT an observed
failure or evidence that normal private-finally B overwrites A. Prior scoped A10
and observer tests did not execute this complete function.

## H11.2: inherited lifecycle machinery, not a new detached setup task

`supervise.mjs` file SHA256
87837c2ff91182fc7b1b45f3d0b0ae54b7e1af66f289bd581d20a6cb5938773b;
`supervise` lines12–86 function SHA256
64fa0482f19a22154909aac8d21753ff6e457b8daa2210084763e06221ba2704.
It spawns at16, binds PID/birth/group at20–35, observes100ms intervals, enforces
setup/total watchdogs at58/71, relays abort/signals at37–41 and awaits child
`close` at48–51/73. Finally clears timers, removes listeners, signals observed
survivors and drains streams at75–79. These are qualified watchdogs, not a
kernel-hard completion deadline.

`fenced-supervisor.mjs:13-46` tracks every asynchronous IPC phase operation in
`running`; close aborts its controllers, finish uses Promise.allSettled. The
intentional IIFE is tracked, not a forgotten fire-and-forget task. Its remote
client at60–75 rejects deadline/disconnect and clears listeners. Observer client
`process-observer.mjs:38-49` similarly uses5s deadline/disconnect handling.
`superviseFencedWorker:49-58` awaits worker supervision then phase finish and
observer finish. There is no separate hard bound on those final awaits/drains.

New setup callbacks are awaited; its native calls are synchronous, and dynamic
imports are awaited. No new unawaited native launch was found in the maintained
orchestrator. Its inherited bare-Git sync call has no local timeout; an unsettled
import/callback/native wait relies on outer setup600s/total25805s supervision.
Killing that worker cannot guarantee its JavaScript finally/private checks ran.

**Conditional inherited source finding G2-F01:** child spawn16 succeeds, then
`observe()` at73 throws A (for example the declared ps call rejects). Finally
clears watchdogs75; its next unguarded `observe()` at77 throws B. JavaScript
propagates B instead of A, skips subsequent signaling/polling/stream drains and
the survivor receipt. The child need not have closed and this path contains no
fallback cleanup. No survivor or failure is claimed to have occurred in an
accepted cohort. This is an exact source-level loss-of-guarantee, not merely
missing test coverage and not a new e35 regression.

Related inherited boundary: if supervision rejects A and
`phaseSupervisor.finish()` rejects B, `fenced-supervisor.mjs:54` propagates B and
does not reach observer.finish. Its file/function hashes are respectively
644b94da6339cee42c2ff0ccaaa0fc4a6d12746a39c0683fea339aea51f7a6f8 /
e628c385b6fd4475151f8899b237dd65f2bf88ea59acbca7c50f424a18358977.
Neither `Promise.allSettled(running)` nor successful ordinary observations proves
all host/native background work necessarily closes under observer failures.

## Accepted proof scope, not inheritance by implication

97c081ec on fe15 and38a4e7b on860 bind the SAME current supervise,
fenced-supervisor and process-observer bytes. They exercised shipping-fenced
scoped phases/A10, ordinary lifecycle, foreign-sentinel isolation, and native
write/transport refusals. They did NOT execute complete execute/private finally,
inject ps failure during cleanup, or establish uncooperative-background closure.

e584515f on fb376 and5c32f061 on e062 bind the SAME process-observer but an OLDER
supervise hash0367e28e. Its subsequent changes add IPC, abort relay/escalation
and onSpawn handling. Those older13 observer controls cover channel/ownership,
transport refusals and foreign isolation, not the new H11.2 composition or the
conditional failure path. Accepted proof files were read only for these scopes
and targeted hashes; captures/cohorts were not revalidated or rerun.

## Small future seams — proposal only

**H11.2 has a small source-exact synthetic seam:** evaluate the complete immutable
supervise.mjs module with an isolated module linker substituting only
node:child_process (spawn/execFileSync), node:fs (capture streams/directory/sentinel),
node:timers/promises, and controlled global clock/timers/process signal hooks.
Real assert/path can remain. Synthetic EventEmitter child/PID/streams and recorded
ps responses/throws ensure no real child, ps, kill or OS operation. Preseal exact
A/B observation failures and one timeout/close sequence. This exercises the
UNCHANGED function's actual await/finally ordering; it proves only control flow,
not kernel reaping, actual deadlines, private behavior or the shipping OS fence.
No such linker/runner is implemented or authorized by this assessment.

**H06.3 lacks an equally small private-finally injection seam.** An immutable
whole-module linker could preserve execute's bytes and fail `copySelection` after
report initialization, using synthetic profile/admission/common/fs/scope values
and a failing terminal save; all other imports become explicit fail-closed traps.
That narrowly tests pre-private catch/finalization, NOT private-finally cleanup.
Reaching private-before/copy/finally needs the earlier source/history/dependency/
tool/setup graph replaced as well, including the dynamic frozen private module.
Do not call that broad mock graph actual private proof or extract/reimplement the
finally block. A smaller new export would require author source change/rebinding;
none is requested or authorized here.

Recommendation: H06.3 can be dispositioned only with the changed-composition and
report-persistence qualifications. H11.2 must additionally disclose G2-F01; do not
treat it as an already-proven cleanup guarantee solely because older hashes match.
ROOT decides whether that inherited risk requires narrow owner correction or a
future presealed synthetic trace before release. No permissions widening or broad
experiment is proposed. Original counts, consumed0/14 failures, unknown denial
layers and absent private postguards remain unchanged.
