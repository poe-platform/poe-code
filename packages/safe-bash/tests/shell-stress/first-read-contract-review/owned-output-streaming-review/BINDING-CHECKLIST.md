# Binding checklist: no product API bound

Frozen intent is `FREEZE.md` at
`722c62f8a8e0795dc2c72509cc012a6017217c0d`. `case-plan.json` enumerates parameters,
not additional cases. `prepare.mjs` is a maintained preparation scaffold, not a
product test or simulated implementation. It imports Node builtins only, hashes
historical inert input bytes, checks manifest structure, and prints unrun records.
It has no candidate import, runtime adapter, server, timer, or child-process path.
`--execute` is deliberately unavailable, even if a ready marker exists.

## Preparation commands

From repository root:

```sh
node --check tests/shell-stress/first-read-contract-review/owned-output-streaming-review/prepare.mjs
node tests/shell-stress/first-read-contract-review/owned-output-streaming-review/prepare.mjs --check
node tests/shell-stress/first-read-contract-review/owned-output-streaming-review/prepare.mjs --plan
```

These are scaffold/integrity checks, **0 product executions**, not twelve passes.
Hashing source archives does not inspect their bodies for implementation design,
compile the source, or establish the candidate's consumer inventory.

## Root handoff and authenticated identity

- [ ] Root forwards only new declared public API/types after the freeze; record
  declaration timestamp, paths, hashes, and supplying immutable identity.
- [ ] Root authenticates author ACTUAL CLOSED, not a worker-written promise of
  closure. Record the root attestation and actual exit evidence separately.
- [ ] Authenticate and freeze the exact ready-marker bytes at
  `/tmp/safe-bash-owned-output-streaming-prototype.ready`; bind them to immutable
  candidate source/patch/manifest hashes. Never assume latest HEAD is candidate.
- [ ] Root launches a fresh executor after both gates. No preparation import or
  runtime. No polling or resumed dormant reviewer.
- [ ] Authenticate complete required copied source, test/helpers, dev-tool
  prerequisites and patches in unique reviewer TMP, not root dist. Capture code
  only as inert .data/.patch-data in this owned evidence directory. Report actual
  compiled/tested inputs if later compiled; this prep supplies no such proof.

## Declaration-only semantic map (all UNBOUND)

Fill actual declaration references, never guessed symbol names or fake methods:

| Needed binding | Declaration reference | Initial state |
| --- | --- | --- |
| Sink-bound owned-output creation and actual output-close notification | Not supplied | UNBOUND |
| Operation closed versus registered cleanup-settled observations | Not supplied | UNBOUND |
| Existing registerCleanup plus shared idempotent finally completion | Not supplied | UNBOUND |
| Explicit parent/child enrollment and acquisition-admission refusal | Not supplied | UNBOUND |
| Known cat/curl automatic enrollment versus custom explicit opt-in | Not supplied | UNBOUND |
| Honored request/upload cancellation signal and output destination lifetimes | Not supplied | UNBOUND |
| Legitimate context.invoke sharing or explicit borrowed scope with live owner | Not supplied | UNBOUND |
| Caller/IO error precedence and exact falsy reason handling | Not supplied | UNBOUND |
| Public result, whole-stage state, caller state, and owner finalization hooks | Not supplied | UNBOUND |

If a needed observation has no legitimate binding, record BLOCKED and ask root
privately. Do not invent a new lease API, weaken intent, inspect author private
notes/test bodies, or publish independent case details to shared coordination.

## Original five binding discipline

- [ ] Retrieve originals only from baseline-hashed inert archives and inspect
  their bodies only when needed for the later executor's explicit binding.
- [ ] Record exact commands, barrier semantics, original helper dependencies,
  1200ms inner/3000ms outer deadlines, and 1MiB output cap from those inputs.
- [ ] Keep original five fixtures, results, stage assertions and baseline 0/5 /
  previous 1/5 unchanged. New API-opt-in tests have distinct labels and bodies.
- [ ] Retain one-start behavior. Do not add demand-before-start, change commands,
  replace loopback fixtures to avoid their pending-read stage, or force old green.
- [ ] Map output-owned close/cleanup separately from public and stage outcomes;
  do not mechanically substitute a new expectation into old stage assertions.

## Observation and teardown discipline

- [ ] Record monotonic event order for acquisition, first read, request bytes,
  output close, caller abort, public result, operation closure, cooperative cleanup,
  input-owner finalization, and fixture teardown. Only observe actual events.
- [ ] Borrowed-input assertions occur while its independently responsible owner
  remains live. Count operation-side returns separately from permitted final owner
  cleanup. Top-level Shell.exec alone is not a borrowed-input scope.
- [ ] EOF stays gated until actual server body bytes arrive; timeout never opens
  the gate to satisfy the streaming assertion. Teardown release is labeled later.
- [ ] Mutate reused Buffer only on producer advance/finalization, assert full
  retained bytes, and identify awaited write/backpressure events without imposing
  arbitrary concurrent-mutation safety, a lease, or zero read-ahead.
- [ ] Mixed file/header/writeout/stderr variants assert positive bytes/effects;
  child-isolation variants demonstrate useful live parent/sibling behavior.
- [ ] Registration-before-IO and late-admission refusal are actual observations;
  overlapping cleanup/finally share completion. Drain only registered cooperative
  children and report opaque pending work separately.
- [ ] Observe exact reason 0 without truthiness fallback; authenticate rather
  than invent error precedence. Observe late rejections before fixture teardown.
- [ ] Bound all fixtures and output collection, propagate signals into honored
  work, track/reap only task-owned children/process groups/loopbacks. Opaque reads
  are released explicitly for teardown, never credited as product preemption.
- [ ] Use exactly 12 logical acceptance results; parameter totals are separate.
  BLOCKED/UNRUN/TIMEOUT are not passes. Optional sealed-v2 negative control stays
  outside acceptance and cannot modify historical rejected profiles.

## Readiness limit

This is ready for declaration handoff, not execution or release. The finite
preparer exits normally and leaves no fixtures or waiting process. Root verifies
actual exit; a report cannot certify the exit of the process still writing it.
