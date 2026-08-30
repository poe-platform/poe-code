# Independent Phase A cleanup checkpoint

**Registration review passes its bounded controls. Public cleanup acceptance
remains BLOCKED: all original five still settle prematurely in compiled and
actual moved-package runs. No root-relayed Sagan runtime handoff was available
at this checkpoint.** This is not default acceptance or a full repository gate.

## Frozen provenance

- Approved contract and pre-registration baseline:
  `07acb1a4d30b7592cf247a0220250317be4e2038`. The verifier committed expectations,
  source hashes and original assertion/evidence identities in `a6a1a44`, then
  published baseline-ready before author edits.
- Author handoff: `01aa1bffe0568cc6787d5ff8e0331e024a787385`. Phase A consumes
  only its grep.ts, search/rg.ts, regex-execution/client.ts and local README,
  overlaid on the approved contract baseline. Its marker is retained verbatim
  with SHA256 in phase-a-freeze.json. Mutable Sagan runtime was excluded.
- Each freeze has196 source/config identities; each isolated build emits636
  hashed artifacts. Audit verifies15 contract/historical identities, no source
  drift, exactly four overlay differences and **zero root/export delta**.
  Baseline regex source matches prior frozen ef8bbe7. Protocol/default policy,
  worker and matching source are unchanged. No production edits by this verifier.
- Profile: Node v22.22.2, TypeScript5.9.3, Darwin arm64. Baseline freeze was
  August27,2026 07:36:48 UTC; overlay freeze07:49:51 UTC; final registration
  replay07:51:06 UTC. These are actual evidence timestamps, not a72-hour claim.

## Separate denominators

| Evidence | Result |
| --- | --- |
| Corrected preimplementation registration baseline |4/17 pass;13 fail |
| First Phase A registration run |15/17; two verifier FS-fixture timeouts |
| Corrected frozen Phase A registration |17/17;17 fake workers retire once;0 active |
| Original compiled baseline command triples |24/24 bytes/status |
| Original moved-package baseline command triples |24/24 bytes/status |
| Original compiled Phase A command triples |24/24 bytes/status |
| Original moved-package Phase A command triples |24/24 bytes/status |
| Original cleanup boundaries, each of those four formats |0/5; all five red |
| Exact native worker retirement, each format |29/29 eventually retire; listeners removed |
| Frozen builds |baseline and overlay pass |
| Actual moved packages |both public type consumers pass;636/636 emitted hashes match |
| Runtime boundary controls |8 prepared groups; NOT RUN, no handoff |
| Equal-work throughput |prepared prior32-file workload; NOT RUN, no handoff |

The17 named registration groups include explicitly recorded bounded subvariants:
both command families, stdin/FS/sink waits, constructor failure with/without
caller abort, and worker failure/prior falsy caller reasons. Groups are not17
different public Shell proofs. Runtime's8 groups plus these17 form the prepared
25-group scope; the original24 command vectors are reused evidence, not new cases.
All raw failed harness attempts remain archived; see HARNESS-CORRECTIONS.md.

## Independent source review

At the frozen author source, client.ts:33–43 checks preabort, registers the
empty owner, rejects a closing owner, then calls executor.open. Registrar throw
and synchronous cleanup during registration acquire no session or worker in
either grep or rg. Both entrypoints use this helper; no default network or new
public capability is introduced.

client.ts:36/49 uses the same callback from registration and local finally.
RegexSession.close at272–279 assigns its completion promise before asynchronous
request cancellation, closes future run admission, drains pending owned work
and retirement promises, and releases the executor session once. The reentrant
transport calls the registered callback from worker termination while local
finally is already closing; duplicate/concurrent callbacks remain pending until
the explicit retirement gate opens, with exactly one termination.

Direct controlled contexts verify that cleanup completes while an entered
opaque stdin/readStream/sink wait is still unresolved; releasing that host later
does not reopen admission. Active and queued session tests confirm cancellation
is local: closing a queued session does not terminate the active sibling, and
closing one active session does not await/cancel another live lease. Shared
executor repeated disposal awaits outstanding retirement. Constructor failure
retains utility status2/diagnostic, while caller abort preserves exact identity,
including errno-shaped reasons; prior falsy reasons survive session failure.

No concrete registration source defect was found by these controls/review.
This is bounded evidence, not proof against arbitrary trusted-host reentrancy
or every cleanup-failure combination. Actual public cleanup-error precedence,
drain-all and nested dispatch-tree behavior remain Phase B work.

## The five unchanged public reds

1. Original24's pipe-early final cleanup.
2. Long grep-to-head early downstream close.
3. Long rg-to-head early downstream close.
4. Caller abort immediately after an accepted benign content request.
5. Caller abort at an accepted ordinary glob row, preserving no-later-FS calls.

The exact historical callback bodies/fixtures are read from839f2d4. Scheduler
selection and data-directory relocation are the only replay transformations;
original/generated harness hashes are retained. Bytes/status/reason assertions
are not relaxed. Every exact worker eventually retires; these are **premature
settlement observations, not indefinite leaks**. Both real npm packages resolve
from their own node_modules, not repository self-reference/source aliases.
`InvocationCleanup` and optional registration type-check from the moved package.

Original old110/111 native-fixture profile failure remains preserved; no native
semantic oracle was rerun here. Named-backreference ACCEPTANCE/native gap remains
unchanged; no rejection policy was added. Old12 is archived, not rerun. The six
additional risky probes remain **UNUSED**, initial allocation0.

Author separately reports99/100 inherited isolated checks with unchanged
followup/messageerror.test.ts:123 expecting another worker after closing its
queued session. The verifier read that retained assertion and independently
tested owned queued cancellation, but did not rerun/rewrite that owner's suite
or declare a canonical migration accepted. Its author-reported regression stays
visible and needs root/test-owner disposition.

## Exact continuation prerequisite

Root must explicitly relay Sagan's frozen source via
`/tmp/regex-cleanup-runtime-ready.txt`, identifying the immutable integration
commit containing runtime admission/drain and the approved registration source.
Then freeze with runtime-handoff, build, run registration and the8 prepared
actual Shell groups, unchanged old5 compiled/packed, and three alternating
prior32-file equal-byte throughput pairs. README.md contains runnable commands.
Guard rejects runtime/throughput against a registration-only manifest.

No runtime/public acceptance is inferred from the source-only17/17. No risky
allocation may be consumed unless root first sees all benign actual boundaries
pass and explicitly allocates a subset. Source/contract/root edits, subagents,
broad tests, native artifact cleanup and commits of others' work were avoided.
All completed verifier children exited normally with disconnected IPC and closed
stdout/stderr. Final corrected fake transports and all native replay workers
retired; generated snapshots remain in this owned ignored directory.
