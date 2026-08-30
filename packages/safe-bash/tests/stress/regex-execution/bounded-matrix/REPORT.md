# Bounded matrix: stopped on source drift

**Incomplete exposure measurement.** Exactly one benign actual-grep control
ran; no nested case and no rg command ran. The second parent attempt stopped
before spawning because a frozen contract-related source hash changed. No
refresh, repeat, larger window, alternate loader, or additional probe followed.
This is not an observed regex stall or a completed four-control matrix.

## Freeze, execution and source proof

- Freeze commit: `9653d91`, all seven scripts/protocol/manifest/profile files
  committed before any matrix execution. Four `node --check` checks succeeded;
  they did not execute product commands. Exact commands: `commands.txt`.
- Frozen profile: Node `v22.22.2`, V8 `12.4.254.21-node.39`, Darwin arm64,
  `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`, no NODE_OPTIONS.
  This is the measured runtime, not a claim about latest available Node.
- `frozen.json`: 41 full SHA-256 hashes at **2026-08-27 04:00:00.473 UTC**.
  Successful control began **04:00:40.352 UTC** (August 26, 23:00:40.352 Chicago).
  Its before/after source checks both matched the freeze (`sourceStable:true`).
- Subsequent `evidence/after.json`, **04:01:11.011 UTC**: 40/41 unchanged.
  All sixteen allowlisted product TS files and frozen harness files match.
  Sole observed drift: `src/shell/runtime.ts`, which is contract evidence,
  **not loaded by this direct-command harness**. Per the approved stop rule,
  this still halted the matrix. No claim about the new source's behavior.

```text
src/shell/runtime.ts before:
c7c9d02ddde5576b7810bfecbbd21b70c6eb2c0ea4fe1ee8bee92c21946d8449
src/shell/runtime.ts after:
a2a10bb7b34c4bb9da74348753d51cc1ad316727b161840d6594073df8b02d38
```

These are sequential worktree hash observations, not atomic snapshots or
clean whole-repository validation. Other owners' dirty files were untouched.
The source drift guard throws before `spawn`; its exact failed command,
exit 1 and raw tool output are in `evidence/grep-linear-nonmatch.tool.txt`.

## Actual outcomes

Nested lengths mean **repeated-a count**, with one trailing ASCII `!` and no
newline: 16/20/24/28 correspond to 17/21/25/29 subject bytes. All patterns,
subjects, native targets and control expectations remain unchanged in
`cases.mjs`; skipped cases are not passes.

| Declared case | Actual outcome | Selected native exec |
| --- | --- | ---: |
| grep-linear-match | completed, status 0, stdout `aaaa\n`, stderr empty | 1 |
| grep-linear-nonmatch | prelaunch source-drift stop; no child | 0 |
| rg-linear-match | skipped: source-drift stop | 0 |
| rg-linear-nonmatch | skipped: source-drift stop | 0 |
| grep-nested-16 | skipped: source-drift stop | 0 |
| grep-nested-20 | skipped: source-drift stop | 0 |
| grep-nested-24 | skipped: source-drift stop | 0 |
| grep-nested-28 | skipped: source-drift stop | 0 |
| rg-nested-16 | skipped: source-drift stop | 0 |
| rg-nested-20 | skipped: source-drift stop | 0 |
| rg-nested-24 | skipped: source-drift stop | 0 |
| rg-nested-28 | skipped: source-drift stop | 0 |

New cohort: **12 declared, 1 executed, 11 not executed** (one prelaunch stop
plus ten explicit skips). Controls: **1 executed/4 declared**, one expected
completion; risky: **0 executed/8 declared**. Two parent attempts, one child,
one selected native exec, zero parent kills, zero spawned harness failures,
zero cleanup failures, one source-drift preflight failure. Do not hide the
failed parent attempt inside the zero spawned-harness-failure count.

Raw successful parent stdout is `evidence/grep-linear-match.json`; parent
tool exit 0, parent stderr empty. Sole owned child PID 46845 exited 0 with
no signal. Child observation stdout 327 bytes, stderr zero; product stdout
five bytes, stderr zero. No output cap was reached.

| Measurement | Milliseconds |
| --- | ---: |
| Selected exec entry / leave, child clock | 0.553 / 0.571 |
| Instrumented bracket duration, not pure engine CPU | 0.018 |
| Command settlement / artificial race settlement | 0.652 / 0.654 |
| Local timer armed / nominal due / actual delivery | 0.527 / 5.527 / 5.750 |
| Local timer delivery minus nominal due | 0.223 |
| Parent ready / start | 71.406 / 71.424 |
| Parent nominal execution deadline | 271.424; did not fire |
| Parent exit / close | 80.706 / 80.716 |
| Parent start-to-close | 9.292 |

At selected entry, leave and command settlement the signal was **not aborted**.
The local timer delivered later, aborted the signal, and recorded true. The
artificial Promise.race winner was `command`, before the timer was due. This
shows no meaningful stall, overdue command timeout or ignored delivered abort.
It does not measure what the race would do during a blocked native call.
Parent/child clock origins differ; their timestamps are not subtractable.

All five cleanup observations are true: exit, disconnect, stdout close,
stderr close, child close. **Active owned children: zero.** The failed next
preflight spawned none. No process lookup, group signal or descendant occurred.
The evidence-only `audit-evidence.mjs` succeeded under strict unhandled
rejections; exact output is `evidence/audit.txt`. This validates saved records
and frozen declarations, not another product run or a passing exposure matrix.

## Contracts and conditional design

Exact inspected contract/source paths and full hashes are in `frozen.json`,
with corresponding after hashes in `evidence/after.json`. In particular:
`src/contracts/command.ts:20`, `src/contracts/command.md`,
`src/contracts/io.ts:173`, `src/shell/types.ts:17`, the **before** version of
`src/shell/runtime.ts:100`, `src/commands/README.md:98`,
`src/commands/search/README.md:173`, and `src/commands/text-programs/README.md:19`.
These describe signals, logical budgets and cooperative waiting, not a general
hard wall-clock RegExp cancellation promise. Grep explicitly lacks hard regex
budgets; rg explicitly disclaims blocked-call preemption. No violation is
demonstrated by the completed benign control.

`DESIGN_NOTES.md` separates source-based semantic differences and verified
primary documentation from measurements. Conditional ranking, **not an
empirically justified remediation from this incomplete cohort**:
1. Pure matcher worker isolation, if preserving the current JS semantics is
   paramount; retain VFS/effects in the host and prove termination/cleanup.
2. Carefully scoped bounded byte-matcher reuse for grep only after resolving
   explicit selection/syntax/limit differences; not a drop-in rg Unicode engine.
3. Cooperative checkpoints/input quotas as supplementary protection only,
   never a replacement for controlling one native call.
No engine/API/dependency/production change was made. No blanket rejection of
valid patterns is proposed. A future stable-snapshot run requires coordinated
review; this frozen cohort must not be silently refreshed or repeated.

## Historical cohorts and limits

Keep these separate, not summed into an accepted regex audit:
- Static `0d625f3`: **zero** dynamic probes.
- Initial controls `2cd1673`: **1/2**; corrected `72a0d51`: **2/2**;
  evidence `d6ff6d0`/`6fdb702`. The initial failure remains historical.
- Prior single grep `ac84d52`/`1207189`: **one** actual invocation/selected
  native exec, fixed nested seven-character pattern on thirteen ASCII bytes,
  0.102 ms bracket, status 1, local timer after completion.
- New `9653d91` matrix: **one benign control**, **zero risky probes**,
  **zero rg invocations**, **eleven unexecuted cases**.

Original artifacts, including the exact prior service refusal preserved by
`3b4784f`, were untouched and hash-stable. During inspection a progress message
mistakenly asserted three new web refusals; it was immediately corrected because
the returned batch contained a successful V8 page and no explicit refusal text.
No actual new authorization refusal was observed or retried. Separately, web
reference-resolution/internal errors did not provide documentation evidence.
A zsh inspection variable named `path` temporarily shadowed PATH; missing-tool
and two nonexistent-path inspections ran no product probe. They are not stalls.

No native utility oracle, extra risky positive control, warmup/repetition,
Shell expansion, jq execution, broad build/typecheck/test sweep, or delegation.
Heap flags are not total RSS/kernel caps; peak RSS was not measured. Startup,
overflow, malformed IPC, termination, resource-exit and overdue-cleanup paths
remain dynamically unverified here. No regex safety, hard deadline, GNU/ripgrep
parity, full-shell completion, superiority, or 72-hour work claim follows.
