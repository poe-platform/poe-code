# Continuation stopped on genuine rg import failure

**No risky exposure measured.** Freeze `8f5f185` preceded both child launches.
The remaining grep control completed; the next rg control failed before ready.
The required setup-failure stop applies to the entire cohort. No loader change,
retry, extra case, risky invocation, native oracle, network, shell or remedy ran.

Exact child stderr (73 bytes, including newline):

```text
setup: TypeScript parameter property is not supported in strip-only mode
```

Parent exit **1**, child exit **2**, no IPC/ready/native-entry marker. Static
inspection locates a parameter property at `src/commands/search/shared.ts:22`.
The unchanged child uses `--experimental-strip-types`; this is an import/setup
blocker, not a regex stall, product-command result, hash halt or new approval
refusal. No alternate transpiler/flag was attempted. Nine remaining rows have
explicit cohort-stop skips, not passes; all four controls did not complete.

## Exact denominators

| Cohort | Result, kept distinct |
| --- | --- |
| Static `0d625f3` | ZERO dynamic probes |
| Initial controls `2cd1673` | 1/2 expected; original failure retained |
| Corrected controls `72a0d51` | 2/2 expected; evidence `d6ff6d0` / `6fdb702` |
| Prior single grep `ac84d52` / `1207189` | 1 command, 1 selected exec; 0.102 ms bracket |
| Original matrix `9653d91` / `b0ff710` | 12 rows; 1 completed control/selected exec, 1 prelaunch halt, 10 original skips, 0 risky |
| Continuation `8f5f185` | 11 opportunities; 2 parent attempts/children, 1 actual command/expected control/selected exec, 1 import failure, 9 skips, 0 risky |
| Aggregate original 12 rows | 2 expected controls, 1 import failure, 9 skips (1 control + 8 risky); 3 child attempts but only 2 actual commands/selected execs |

The first control is referenced from its pinned original record, never rerun or
double-counted. The original prelaunch halt and ten skips remain valid historical
records; only scheduling was superseded. Aggregate four-control coverage is
**2/4 expected**, risky coverage **0/8 executed**. Parent kills, watchdog skips,
cleanup failures and active owned children are all **zero**. All rows are now
accounted for by evidence or this mandatory stop, not successfully measured.

## Timings and signals

Milliseconds; child and parent clock origins differ. Selected-call brackets
include instrumentation, not pure engine CPU. Both actual commands made exactly
one selected exec. Both returned expected output/status; the nonmatch has empty
product streams and status 1. Its parent exited 0 because the observation matched.

| Measurement | Original grep match | Continuation grep nonmatch | rg import failure |
| --- | ---: | ---: | --- |
| UTC on August 27, 2026 | 04:00:40.352 | 04:14:57.686 | 04:15:21.269 |
| Selected entry / leave | 0.553 / 0.571 | 0.609 / 0.628 | not entered |
| Selected bracket | 0.018 | 0.019 | unmeasured |
| Timer armed / nominal due | 0.527 / 5.527 | 0.574 / 5.574 | not armed |
| Actual delivery / lateness | 5.750 / 0.223 | 5.741 / 0.167 | not delivered |
| Command / artificial race settlement | 0.652 / 0.654 | 0.645 / 0.647 | no invocation |
| Parent ready / start | 71.406 / 71.424 | 65.641 / 65.667 | neither |
| Parent deadline nominal / actual | 271.424 / not fired | 265.667 / not fired | not armed |
| Parent exit / close | 80.706 / 80.716 | 76.126 / 76.138 | 73.478 / 73.490 |
| Parent start-to-close | 9.292 | 10.471 | not applicable |
| Kill-to-close | no kill | no kill | no kill |

For both completed grep controls, signal entry/leave/command settlement were
false; later timer delivery made the signal true. The same-invocation artificial
Promise.race winner was `command`. This shows neither significant stall nor an
ignored delivered abort; it supplies no empirical cooperative-preemption limit
for risky matching. No watchdog timing deviation was measured because no
execution deadline fired. Nominal 200 ms remains a timer, not a real-time promise.

## Guard, cleanup and artifact proof

`evidence/ledger.json` binds all 12 aggregate rows, separate histories and complete
observations. Two raw returned JSON files were saved with apply_patch immediately,
before any subsequent row; nine manual skips identify the setup-failure blocker.
`claims/` retains both pre-spawn exclusive claims, including the unsuccessful
child. Both children met the exit/disconnect/two-stream-close/child-close barrier;
the exclusive active lock is absent. No PID lookup or additional kill was used.

`frozen.json` binds 17 original manifest/evidence artifacts, including all terminal
records and exact halt output. `evidence/hash-proof.json` verifies **26 execution
files**, the fixed runtime binary digest and package boundaries; **49 original
audit artifacts** match both the continuation freeze and their individual last
commits. The 16 product and four original harness hashes match `9653d91`.
Original bounded artifacts diff clean against `b0ff710`; review against `3d8f96e`.
All continuation harness/manifest bytes remain at `8f5f185`.

The **21 observation hashes remain separate**. Only unexecuted shell runtime
differs from the original matrix freeze: original `c7c9d02…46d8449`, original
after-snapshot `a2a10bb…f8b02d38`, continuation frozen/before/after
`f307642…41c0ddb`. Full digests are retained in the manifests/proof. This was a
real shell-code change, observation-only for this direct-command experiment;
no whole-source stability is claimed. No additional observation drift occurred.
Node/V8/path and new binary digest matched throughout this continuation; original
historical binary identity remains unproven because no old binary digest exists.

Validation was three script syntax checks, a byte-identical comparison of the
copied parent timing/IPC/kill/cleanup core, scoped hash/Git checks and evidence
accounting—not a broad test/build or native utility oracle. PREPARATION.txt retains
one pre-freeze environment-guard failure: Darwin injected a fixed CoreFoundation
variable under env -i. It was pinned before commit; no product child launched in
that preparation attempt. No new safety/approval refusal occurred.

## Conditional next steps; no implementation

The immediate blocker is the frozen rg loading protocol. Any source hook,
loader/contract change or differently frozen experiment awaits root assignment;
this cohort remains terminal and cannot be silently rebaselined or retried.
Using only existing `../RESEARCH.md` and `../bounded-matrix/DESIGN_NOTES.md` evidence:

1. If preserving the current JS profile is required, investigate a pure matcher
   worker using Node builtins, retaining VFS/effects in the host and proving
   termination/cleanup. No hard-real-time or full-memory isolation claim follows.
2. If a specified byte BRE/ERE profile is acceptable, evaluate existing budgeted
   matcher reuse only after resolving leftmost selection, Unicode, case folding,
   anchors, backreferences, escapes and locale gaps; it is not a drop-in rg engine.
3. If deployment must contain uncooperative host work, evaluate external isolation
   independently of command semantics; no such deployment guarantee was tested.

These are conditional design directions, not remediation justified by measured
risky exposure. No parity, superiority, regex safety, full completion or work-
duration claim follows from this stopped cohort.
