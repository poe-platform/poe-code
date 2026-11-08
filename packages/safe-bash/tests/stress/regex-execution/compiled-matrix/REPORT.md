# Compiled fixed matrix: bounded completion

Measured August 27, 2026, 04:30:08–04:31:14 UTC (August 26 America/Chicago).
**12/12 declared outcomes: 4 controls completed, 4 risky completed, 2 risky
watchdog-killed, 2 larger-family inputs skipped—not passes.** Six new risky
executions, seven including the separate historical 13-byte grep probe, below
the eight-new/twelve-user ceilings. No repeated risky execution or warmup.

Twelve parent scheduling invocations launched ten children/commands, each with
one selected native-entry marker; eight returned and two were killed inside
open brackets. The ledger's `parentAttempts:10` counts launching parents, not
the two skip-only invocations. `nativeCalls:10` counts these selected entries;
an open bracket is not proof of the exact native instruction at termination.
Parent native-regex calls: zero. All ten children satisfied exit, disconnect,
both stream closes and child close, without cleanup warnings. No active owned children
remain; checked-in cleanup removed only the verified owned `.build/` directory.

## Results

Original `cases.mjs` is imported unchanged: `^(a+)+$`, N `a` bytes plus `!`, no
newline. Grep's actual source/flags are `^(a+)+$` / `g`; rg's are `(?:^(a+)+$)` /
`gu`. Completed risky commands returned status 1, empty stdout/stderr, native
null, exactly one selected call. “Completed” does not mean “within 5ms.”

All times are milliseconds. Native brackets include instrumentation/IPC cost.
WD is the parent's actual watchdog time after start (armed immediately after
ready); child due/actual, command and race times use the child invocation clock.
An em dash means unavailable, not zero. `command@time` names the artificial
same-invocation Promise.race winner; it is not a product timeout API.

| Tool | N / bytes | Outcome | Native bracket / parent WD | Child timer due / actual | Command end | Race winner / end |
| --- | --- | --- | --- | --- | --- | --- |
| grep | 16 / 17 | completed | 1.308 | 5.526 / 6.948 | 1.882 | command@1.884 |
| grep | 20 / 21 | completed after 5ms due | 20.400 | 5.569 / 21.092 | 21.058 | command@21.062 |
| grep | 24 / 25 | watchdog killed | WD 202.087 | 5.551 / — | — | — |
| grep | 28 / 29 | family skipped; no spawn | — | — | — | — |
| rg | 16 / 17 | completed | 1.324 | 5.902 / 7.101 | 2.281 | command@2.283 |
| rg | 20 / 21 | completed after 5ms due | 20.058 | 5.871 / 21.039 | 21.012 | command@21.015 |
| rg | 24 / 25 | watchdog killed | WD 201.712 | 5.878 / — | — | — |
| rg | 28 / 29 | family skipped; no spawn | — | — | — | — |

All four benign controls ran first under the new compiled profile. The two grep
repeats are profile validation, **not additional unique fixture coverage**.

| Control | Status / stdout | Native bracket | Timer due / actual | Command end | Race winner / end |
| --- | --- | --- | --- | --- | --- |
| grep-linear-match | 0 / `aaaa\n` | 0.021 | 5.570 / 7.092 | 0.766 | command@0.768 |
| grep-linear-nonmatch | 1 / empty | 0.016 | 5.520 / 6.855 | 0.579 | command@0.581 |
| rg-linear-match | 0 / `aaaa\n` | 0.018 | 5.912 / 7.401 | 1.086 | command@1.088 |
| rg-linear-nonmatch | 1 / empty | 0.018 | 5.916 / 7.286 | 0.981 | command@0.983 |

Control stderr was empty; each made exactly one expected native match/null call.
Every completed row had signal=false at entry, leave and command settlement;
the timer delivered signal=true only afterward. At N20 the same command won
the race after its timer was nominally due. At N24 each child sent ready/enter
but no leave/cancel/done; exact-handle SIGKILL was accepted and confirmed by
exit/close. There was **no observed cancellation delivery before termination**,
not evidence that matching ignored an already-delivered abort. The two open
native brackets and delayed N20 callbacks empirically expose a cooperative
execution limit, without pretending that the parent watchdog is hard realtime.

## Contract, not a broken hard promise

`src/contracts/command.ts:30` requires `readonly signal: AbortSignal;` but declares
no synchronous-regex deadline. `src/contracts/command.md:15` preserves signal and
shared-budget forwarding; it does not introduce regex preemption. This cohort
directly invokes actual `grepCommands()` / `rgCommand()` command definitions,
not Shell, middleware, other commands, filesystem backends or network APIs.

`src/commands/README.md:100` says regex execution is synchronous and “cannot
provide hard preemption of an individual JavaScript computation”; its grep
section at line 105 says “hard regex execution budgets are not implemented.”
`src/commands/search/README.md:187` states “No catastrophic-regex safety guarantee
is made.” Lines 188–191 say a signal/timer cannot stop an individual blocked
regex call and direct hard-deadline callers to external isolation. These are
separate inspected product statements, not promises invented by this harness.

## Provenance and limits

- Freeze commit: `d3f9e8d6b3cc359b5cc13361e6f440fb10997630`, before any compiled
  probe. Source Git snapshot: `e0325b590b593fbe5fd17b2b1b778fe8badb25f0`.
  All sixteen live execution-source digests matched the original `9653d91`
  manifest at preparation; three package/config files were captured separately.
- Local profile only: Node `v22.22.2`, V8 `12.4.254.21-node.39`, Darwin arm64,
  installed TypeScript `5.9.3`. `local-profile.json` retains local Node help,
  compiler/package/config metadata; `compiler.json` records successful bounded
  compilation and actual input/emitted file lists. No documentation network
  lookup, new dependency, native GNU/ripgrep oracle, or runtime TS loader.
- Exact source/package/config bytes: `source-bundle.json`, SHA-256
  `45b5b80804116c02ac5be9f78c43d603c139b0ce46ba7133441156b2bfd14568`.
  `frozen.json`, SHA-256
  `099d4c5c0c6095cc5f1ef541db0cdcd9079d6439a4b1bb28ce80f59e302501e9`, pins
  source, compiler, declarations, harness, historical evidence, compiled JS and
  fixed ESM graphs. Original fixture SHA-256:
  `99a5392e48f0602599dc8da88400ff5f9c34781fe608b320250a0486178df7be`.
- Runtime-reachable compiled graphs contain nine grep and fourteen rg modules
  (sixteen in their union). Every child hashed the actual paths before import;
  eight completed children rehashed them afterward. Killed children cannot
  produce post-kill proofs: parent before/after snapshots verify the whole frozen
  source/build closure instead. Fixed ESM graph/file provenance is not a loader
  trace, filesystem lease or defense against hostile host mutation.
- `evidence/*.json` preserves exact parent records before the next row, child
  loaded-path proofs, full before/after hash snapshots, and final audit/cleanup.
  `claims/` preserves ten one-shot invocations. Frozen source/build hashes stayed
  stable; final measured live-source and separately observed shell/docs drift
  lists were both empty. This is scoped sequential evidence, not whole-source
  stability, a clean global worktree, or validation of later live changes.
- The original child measurement body and parent watchdog/five-event machinery
  remain unchanged except compiled loading, provenance and durable scheduling.
  Child env explicitly supplies LANG/LC_ALL C; recorded actual Darwin env also
  has `__CF_USER_TEXT_ENCODING`. Flags, byte/IPC caps and timer limits remain as
  specified. Heap/stack flags are not RSS limits. No descendants, replacements,
  PID searching, timeout extension, production edits or broad tests were used.
- Focused checks: all six scripts passed `node --check`; sixteen-module tsc
  succeeded; audit validated all twelve outcomes, bytes/status/counts and
  five-event cleanup; frozen/history checks and owned diff checks passed.
  Build reconstruction without probes is documented in `README.md:55`.
  This single ordered, nonrepeated cohort has uncontrolled cohost load and no
  order balancing; it is not a throughput comparison or a complexity proof.

## Conditional zero-runtime-dependency directions

These are design rankings, not implementations or validated remedies. They use
the existing primary-source `../RESEARCH.md` R1–R5/R7–R8/R10–R11, not fresh web
claims; those historical document versions are not this installed Node profile.

1. **If preserving current JavaScript matching is required: pure matcher worker.**
   Keep grep's byte-string and rg's Unicode-mode selection/flags and return only
   match data; do not transfer live VFS objects or publish effects inside the
   worker. Builtin workers avoid runtime dependencies and separate the blocked
   matcher from the caller loop. Startup, copies/transfers, worker lifetime,
   asynchronous termination and non-total resource caps still need design/testing.
2. **If a specified byte BRE/ERE dialect is acceptable: reuse the existing
   budgeted engine.** `src/commands/text-programs/regex.ts:197` charges matching
   steps; `src/commands/text-programs/README.md:27` documents its byte profile.
   Resolve exact leftmost-first versus leftmost-longest/capture selection,
   Unicode/codepoint versus byte offsets, case folding, escapes, anchors, accepted
   backreferences and locale gaps before reuse. Existing charged backreferences
   are not rg compatibility. Step accounting is not a wall-clock promise; this
   is not a drop-in engine replacement or an authorized source change.
3. **If containing uncooperative host work is the requirement: external host
   isolation.** A host supervisor can own and terminate an execution process;
   deployment-specific OS resource policies, IPC, effect publication and exact
   cleanup are additional obligations. This matrix exercised only its own tiny
   child containment—not an application isolation API or deployed provider.

## Historical cohorts remain immutable

Original freeze/evidence `9653d91` / `b0ff710`, review `3d8f96e`, continuation
`8f5f185` / `6bd5594`, and documentation stop `29351b3` retain all original bytes.
The earlier matrix still has **2/4 completed controls**, the rg strip-only import
failure before ready, remaining control skip, and **all eight risky skips**;
its unloaded-shell-hash halt is not rewritten. The later URL retrieval failure
was documentation retrieval failure, not command approval denial; no URLs were
retried here. A transient concurrent Git index lock delayed only the freeze
commit; it was left untouched and the explicit-path commit then succeeded.

Static `0d625f3` still has zero executions; initial harness controls 1/2 and
corrected controls 2/2 remain separate, as does the single earlier 13-byte grep
invocation. This compiled cohort adds evidence, not retroactive historical
passes. No full parity, regex safety, superiority, deployed isolation, 72-hour
duration or whole-project completion claim follows. Bounded assignment complete.
