# Independent six-slot bounded closure

**Recommendation: accept default regex containment and cooperative cleanup only
within this frozen, measured six-slot scope.** All six jobs have scoped reviewed
passes: two defaults, two active aborts and two benign queued controls. This is
not full-goal closure, universal preemption, all-regex/full-shell parity, an RSS
guarantee, a performance win or superiority over just-bash.

This independent final-slot leaf executed **only `rg-queued-abort`, once**, after
committing gate resolution as `0f57ae90e4b50fbd1cc08a76b68579ba114494b2`.
The unchanged guard reverified the 216 source and 704 emitted identities, actual
moved archive and frozen harness bindings before reserving/fsyncing the final
claim and journal entry. Claim: **2026-08-27T09:36:22.845Z**; result:
**2026-08-27T09:36:23.032Z**; gate expiry: **2026-08-27T11:20:45.477Z**.

## Six results; first five immutable, not replayed

Every evidence path below is relative to this directory. The first five raw
results remain byte-identical to commit `21a209bd6d9bb85df2fa3b545ed259867bfb2fe9`.
Their independent inspections and the preserved adjudication supply prior review;
this leaf did not rerun or freshly execute those cases.

| Slot / evidence | Scoped result | Pathological requests | PID | Fork-to-close ms |
| --- | --- | --- | --- | --- |
| 1 `evidence/grep-default.json` | PASS: default REQUEST_TIMEOUT | 1 | 44880 | 1171.665 |
| 2 `evidence/rg-default.json` | PASS: default REQUEST_TIMEOUT | 1 | 46942 | 1172.643 |
| 3 `evidence/grep-abort.json` | PASS: exact caller rejection | 1 | 49106 | 194.313 |
| 4 `evidence/rg-abort.json` | PASS: exact caller rejection | 1 | 50484 | 179.648 |
| 5 `evidence/grep-queued-abort.json` | PASS: benign queue; STOP explicitly resolved | 0 | 55232 | 180.399 |
| 6 `evidence/rg-queued-abort.json` | PASS: benign queue; last-closer reviewed | 0 | 71911 | 171.845 |

Exact result hashes, six once-only claims, unchanged first-five bytes and passive
PID checks are recorded in `evidence/six-slot-closure-checks.json`. Budget is now
**6/6 jobs consumed, 4/4 pathological requests plus 2 benign queue jobs, zero
remaining launches, zero retries**. The journal retains its exact five-slot prefix
and exactly one new final-slot entry; no claim, reservation or budget was reset.

## Default origin and scoped cleanup

`evidence/prepared.json` records actual request/startup/capacity defaults
**1000 ms / 3000 ms / 2**, matching frozen `src/commands/regex-execution/protocol.ts:13`.
The unchanged child constructs public `Shell` plus `agentCommands()` without limit
overrides and supplies no caller signal in default cases. Both default outcomes
are status **2**, zero stdout, and exactly
`<command>: regex REQUEST_TIMEOUT: active request exceeded 1000ms\n`.
This establishes regex request-timeout origin, not Shell outer timeout or parent
kill. Accepted-to-settlement times are **1004.400 / 1003.367 ms** (grep / rg);
active-abort-to-settlement times are **1.524 / 1.878 ms**. These are diagnostic
measurements, not SLAs. The preserved single-probe inspections show responsive
host timers, exact caller reasons, awaited owned retirement and zero tracked
worker/abort listeners at their public settlements before dispose.

Actual native matching-call entry is **not instrumented**. Default matching-phase
requests were accepted after ready with no matching reply recorded; this is a
protocol observation, not proof of native instruction entry.

For slot six, five pending admissions share the recorded callback hash; only four
sibling requests were posted (two empty validations and two benign `ab` matches).
The queued target posts nothing and creates no third/replacement worker. Its public
rejection preserves the exact caller reason, zero owned worker work and zero
tracked caller/context listeners. Both siblings remain alive, with one held reply
each and **zero termination calls** at that target settlement. Queued abort latency
is **0.345458 ms**; both siblings subsequently return exact `ab\n`, status 0,
empty stderr.

**Last-closer public settlement, not just final zero:** sibling-one's captured
boundary shows both shared workers still retiring. Constructor AsyncLocalStorage
labels do not identify current lease ownership. Frozen client ordering releases
the successful request before `pending.resolve` (240–251); session close awaits
its own retirement set and executor close (264–279), and only shared-session count
zero awaits pool retirement (140–148). Native termination precedes listener removal
(111–127). At **sibling-two's public settlement**, both workers have exited,
`terminationCalls:1`, `terminationAwaited:true`, zero held replies and zero worker
listeners; all tracked signal listeners are zero. This source ordering plus the
captured boundary qualifies the manual last-closer check; session counters are not
directly instrumented. Before-dispose/final snapshots also show retirement and no
late errors, but do not replace that settlement evidence. The frozen harness's
queued per-boundary assertion gap remains disclosed, not silently strengthened.

## Resolution, identity and preservation

The original STOP was prudent reviewer ownership ambiguity, **not a failed
assertion or established product bug**. ROOT explicitly resolved it after separate
read-only adjudication. No actual command approval denial occurred. Before launch,
`evidence/five-slot-2026-08-27/` preserved exact committed STOP, prior inspection,
report, audit script/result and journal bytes. Only the prior inspection's
continuation decision and a provenance note changed. Original `REPORT.md`, README
and final-audit script/evidence remain historical five-slot snapshots, unchanged;
the old audit was not rerun or adapted to pass after continuation.

- Runtime: `1b133a8662a32ee84524794842074c9c98d5f6c3`; registration `01aa1bf`;
  fixture `8d0909ff3cf29290051e3d91dc3205e629ef6bda`; package remains `virtual-bash`.
- Source manifest SHA256: `ef7d7c018ca19cc699a3ddcd009b8d1197de416f154651885738ce7537369b2e`.
- Build manifest SHA256: `9194095150789c25ff250aa746b567aac584d433a6330180f37d4924195a30d9`.
- Actual moved archive SHA256: `86c34e382c85563afbd9c760aa2e0f161308e8f43e14fe99dfec9ed96d77539b`.
- Prepared harness SHA256: `276b972c3334f0452d26e20fcd0256445f3cbc2dcd43d5b815cbd6d607b1b3b3`.
- Native moved worker SHA256: `bb568433f1194d957dd14d1eb8229e9733bd13cd42db7ca5f2ac77b5f739b8f7`.
- ROOT resolution SHA256: `a12049910371021b1f2d16aa316e1e2ef153839fed392e716e8eaeb225b14eb5`.
- Independent adjudication SHA256: `d3f90bb6403389be6f2d5d8a54b1835afa82ddbfaff5e6c48e40fa16e0d414f4`.
- Original gate SHA256: `f0979bf95c009526e30db02b9c402867bbe176fef5816c70003d89e824431092`.
- Final raw result SHA256: `ce927e099e40869398a6d8e8d3ab2a43abdd91d4ddc5a0a50caf6863a13e27fa`.

The exact native worker URL is preserved in `evidence/rg-queued-abort-inspection.json`
and raw result; it points into the actual moved package, not repository self-reference.
`evidence/slot-six-resolution-record.json` binds original/archive hashes and all
three authority documents. The final journal SHA256 is
`d8bee51c57027b75e127fc6423bbd82c1c1022e1959af6c7d4f37625df3d8d38`.

## Limits and distinct history

The last child used the unchanged **8000 ms watchdog from fork**, strict unhandled
rejections, **128 MiB heap / 1024 KiB stack**; native worker limits remain
**128 MiB old generation / 4 MiB stack**. Output/IPC caps remain **16384 / 65536
bytes**. Slot six used 0 output bytes and 14542 IPC bytes, exited 0 without parent
kill, and awaited child close with IPC/stdout/stderr closed. All six targets total
47998 IPC bytes. Passive checks find all eleven recorded phase-1/target child PIDs
absent (`ESRCH`), no active lock or owned child, and unchanged frozen assets.

Original **12 historical executions**, original **7/8 plus 16 positive variants**,
author compiled **9/9**, independent actual-packed **9/9**, and original **5/5 in
both formats** remain distinct cohorts, not replays or new passes here. Supervisor
**4/4** remains separate. The **17.784 vs 15.617 ms** candidate/baseline benchmark
includes startup: a penalty, not a win. Five custom first-read cases, legacy
**110/111** and profile caveats, and global six-data-TypeScript corrections remain
separate qualification work. No product/frozen harness changes, broader test runs,
new pathological matching, performance runs or claimed 72-hour duration occurred.
