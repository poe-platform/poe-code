# Additive root G4 choice A — 2026-08-28

Root reports private helper094d2ba1 only; parser/runtime/shell unchanged and no
integrated candidate/review GO. That is coordination metadata, not a source-body
inspection or fresh author-result acceptance here. Preparation remains data and
synthetic harness checks only.

The root-chosen boundary is now explicit:

- **P, private:** new array-owned storage, staging, watched/saved state, snapshot
  copies, aggregate joins, array-to-argv and shell-owned bridges **before transfer**.
  Keep simultaneous source/stage/join/argv owners charged until their actual
  release; transfer is not retroactive release of still-retained array storage.
- **E_input:** independently owned existing source/input/capture phase.
- **E_command:** existing registered-command formatting/escaping/encoding after
  admitted argv transfer, including the existing echo/printf/internal formatters.
  Their allocations can precede sink.write and are not made private by a sink
  wrapper. They retain existing command Budget/IO contracts and cancellation.
- Peak notation is **P + E_input + E_command**, with concurrent ownership shown,
  not a finite combined bound or RSS claim. Private W remains admitted logical
  work, not total CPU/preemption. No baseline command-budget reset or weakened IO
  accounting. No new src/commands/basic.ts, internal formatter, contracts or IO
  hook scope is authorized.

This supersedes an overbroad reading of earlier “all array-derived” wording, not
its historical bytes. `PEAK.json`'s declared2610/445 graph and prior arithmetic
check remain unchanged reference data. If an encoded-output owner in that graph
belongs to a post-transfer command, it is E_command in the new phase assignment;
do not assert that2610/445 is the candidate's private peak/work, or silently
recompute/rescore the old witness. If encoding is actually a newly owned shell
bridge before transfer, charge its owner in P. Bind the phase in the real trace.

## Executor/source-proof consequences

1. M19's private repeated-materialization charge applies inside P; it does not
   demand private charges for existing post-transfer printf/echo materialization.
2. M20 tests declared graph arithmetic and actual ownership/nonrefund invariants,
   not a forced candidate total. Its fixed historical input remains unchanged.
3. P09 checks UTF8/output-cap/backpressure/abort under existing Budget/IO. Split
   its evidence into pre-transfer private ownership and post-transfer command IO;
   a passing byte-cap check is not evidence that formatter allocations were
   pre-admitted privately.
4. Actual instrumentation must identify the argv handoff and retained owners.
   No sink wrapper alone proves a preallocation boundary. A command-side copy is
   E_command even if its characters originated in an array.
5. Source admission continues to reject changes to basic/internal command and
   contract/IO files. Mutation controls must not manufacture a private failure by
   lowering hidden caps or charging an E_command allocation to P.

No semantic vector changes are required: root's33 bare-name/splice vectors remain
unchanged. This qualification narrows resource claims and test phases, not command
behavior, source scope or error/cleanup precedence.
