# Timeout module author handoff

Status: author-scoped reconstructed checks pass; independent Raman review is
still required. This is not whole-product, native, or superiority acceptance.

## Reconstructible candidate

- Coherent baseline: `5137a74ec855a32d8a8860eb66b62eb44d11e290`, tree
  `48e5ae39ce98e1c8e416bae77da40d88b75e1db5`.
- Source implementation: `6cf34b63e396d14ee1c687f3f6892e71c12317df`;
  file-ending correction: `9ed9a0f14d12758713a8dc42be1ff75f0c87a36f`.
- Final module consists only of four regular `100644` files under
  `src/commands/timeout/**`. `evidence-v2/SOURCE-MANIFEST.json` binds each Git
  blob, SHA-256, byte length, mode, baseline input, and module overlay.
- Deterministic 268-entry source archive: SHA-256
  `1a7f280f4f309af3dcc8f3a7ec629b95dddbc65d180bc45c9911ff64523d6ded`.
  Its before/after hashes match, so the post-run check detects both mutation and
  appended bytes. No symlink, non-regular input, or instruction file entered it.

The leaf API is exactly three interfaces (`TimeoutScheduler`,
`TimeoutCommandOptions`, `TimeoutCommandsOptions`) and three factories
(`createTimeoutCommand`, `createTimeoutCommands`, `timeoutCommands`). Existing
`CommandInvoker`, `CommandDefinition`, and `VirtualShellPlugin` types are reused.

No root export, package export, default registry, aggregate option, runtime,
shell, contract, cleanup, input/output helper, or other command changed. The
default registry remains exactly 77 commands and contains no `timeout`.

## Actual author results

- Initial regression freeze `6b7c77b218ba5015b6d6dd9552c1e9626977232e`:
  the one preserved failure is the expected missing-module chronology control;
  zero semantic assertions ran.
- Corrected author cohort `c332a17f09dfe17fd8fa29252a48db729c83c67d`:
  14/14 pass, including three cooperative child-closure gates, both required
  same-sentinel priority edges, and actual `Shell`/registry literal invocation.
- Reconstructed neighbors: sleep 27/27, shared invocation cleanup 38/38, and
  owned output 12/12. Total runtime tests are 91/91.
- Reconstructed `tsconfig.build.json` build and strict source/harness typecheck
  pass using the recorded existing compiler and explicit recorded Node type root.
- Packed package SHA-256:
  `32e2bef5eafbb00e9b6704e2765f55e36514eda0da0fe84ea78367813c756630`;
  857 entries and no instruction files. Local offline install, runtime load, and
  strict positive consumer pass before and after moving the installed consumer.
- Installed internal leaf JS and declaration hashes are unchanged by the move.
  Root import and `virtual-bash/commands/timeout` negative controls fail as
  expected; readonly options mutation fails with `TS2540`.
- Internal leaf runtime keys are exactly the three factories. It remains an
  intentionally unpublished internal path for root integration.

The first sealed reconstruction attempt, `evidence-v1`, is retained. It stopped
at `TS2688` because the dependency-free materialization lacked an explicit Node
type root. Protocol correction `07dd21f5` added that authenticated development
input without changing source or expectations; unique `evidence-v2` then passed.
The evidence seals are SHA-256
`9807640ed20dd390d509728a19f2e0e61b85936dc2ba923378cdeb2e0a17cffa`
and `015bc9fbd1abffe1b16b8096a06e3b7b7e15592d369e2af1f1cff5cf8f72938a`.

## Holds and limits

- Raman's independent 32 families and 70 numeric vectors were not executed or
  edited by the author. Independent acceptance is not claimed.
- The sealed GNU 9.7 Darwin arm64 timeout identity matches its expected 95,240
  bytes and SHA-256 `36fc11af...`; all 12 native rows remain prospective and
  executions remain zero.
- SafeJS was not rerun. The `dc7ed138` 25/25 result is a prior root-reported
  record only.
- The wrapper is cooperative. It cannot preempt a blocked event loop, ignored
  signal, opaque host work, stalled conforming clock, or nonsettling cleanup.
  It makes no arbitrary-host-error provenance or native process-group claim.

No timeout-scope product bug remains known from the author checks. The successful
capture removed its guarded temporary reconstruction, installed consumer,
timers, and child processes; no author temporary root remains.
