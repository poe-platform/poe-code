# Issue 634: ERE copy admission and linear history comparison

## Scope and evidence

Implement only the validated matcher mechanisms on base
`a4a53ff99898ea7cb1d5f435139b6bf2e56055c4`. The original matcher SHA-256 is
`89aa1e08536cd30ea77b5a488a5e1374813a55787d4738aca80d4f4fa341362a`.
Capture copies are allocation-charged but not size-proportionally work-charged;
oldest-first history comparison repeatedly traverses already charged links.
No subsecond, calibrated CPU-pricing, unabortable-stretch or heap claim follows.

Exclusive production scope is `packages/safe-bash/src/commands/regex-execution/ere/matcher.ts`.
Add `packages/safe-bash/tests/commands/ere-work-accounting.test.ts` and optionally
`packages/safe-bash/src/contracts/ere-work-accounting.md`. Root owns integration
registration. Do not alter limits, other source, README, branches or Git delivery.

## TDD sequence

1. Add failing deterministic copy-size/admission and linear-history work-bound
   tests, alongside the existing 50 reference and 12 native-visible capture
   fixtures. Preserve the distinction between recorded fixtures and live oracles.
2. Admit capture initialization, copying and result materialization work before
   allocation, preserving existing allocation/state admission and limits.
3. Materialize each nonempty history once in local, ledger-admitted scratch
   arrays. Charge initialization, each link visit/store and each comparison;
   checkpoint all loops. Compare oldest-first with unchanged span ordering,
   group priority and count tie-break. No mutable cross-comparison cache.
4. Verify work/allocation rejection, history-loop cancellation identities,
   repeated-invocation isolation and maintained ERE semantics with small inputs.
5. Run focused checks and one externally supervised unchanged 100-byte pattern
   after the candidate. Report timing separately from deterministic counters,
   exact RED/GREEN results and before/after hashes; no full-gate claim.

## Admission and semantic constraints

Scratch capacity is admitted from actual history counts against the existing
cumulative allocation ledger before allocating. Extra work and scratch charges
can move profile-limit boundaries; limits are not raised or lowered. Empty
history comparisons need no scratch. Match selection must not collapse histories
to final spans or deduplicate states by position. Inputs denied by the current
grammar remain denied. Registered shell CPU/caller-abort plumbing stays with root.

## Results — September 5, 2026

- RED before matcher edits: 72 tests, 62 existing reference cases passed and all
  10 new mechanism tests failed. Copy-size accounting failed at four groups;
  old work=322 incorrectly allowed 32 empty groups; repeated histories exhausted
  work=20,480 at eight bytes and work=94,208 at ten bytes. Scratch admission and
  scratch-loop cancellation probes were absent in the old matcher.
- A preliminary fixture adapter treated native-visible N12 as a success despite
  its recorded status=2. Corrected the new test adapter before the RED run above;
  no fixture or product change was used to resolve that harness error.
- GREEN: all 72 tests pass, including allocation refusal before scratch storage,
  repeated invocation without scratch reuse, and exact object/zero cancellation
  identities during materialization. The normal focused Node test runner also
  passes (its reporter aggregates this file as one passing child).
- Existing author suite: 66/66 groups pass, including literal/class properties
  and budget controls. Existing independent suite: 24/24 groups pass. Both run
  current TypeScript through TSX using read-only in-memory adapters changing
  only their `.js` file/import bindings to `.ts`; assertions and fixture bytes
  are unchanged. No historical runner writes, build output or source copies.
- Selected maintained public cooperative ERE and shell ERE tests pass via
  `--test-name-pattern`, one selected test in each of two files.
- No guarded lint, full typecheck/build, shared dist mutation or full gate ran.
  Root owns registration of the new test, frozen-checkout lint/type/build gates,
  integration qualification and any later Git delivery. No source edit overlaps
  the other workers' `find.ts`/`join.ts` scope.

### Timing context, not an acceptance threshold

The unchanged read-only `probe.mjs repro 100` from the validation evidence
directory ran on Node 22.22.0 with disabled TSX cache, a 256-MiB old-space cap
and a 30-second external timeout. The sandbox initially refused its Git identity
subprocess; an approved unchanged retry completed. An approval-review timeout
before that retry did not execute the probe.

| Metric | Original matcher | Candidate matcher |
| --- | --- | --- |
| Total work | 43,327,275 | 2,284,255 |
| States | 65,536 | 65,536 |
| Allocation units | 677,536 | 1,550,984 |
| Elapsed milliseconds | 2,783.450 | 127.897 |
| Process user + system CPU milliseconds | 2,879.214 | 212.643 |
| Outcome | states limit, status 3 | states limit, status 3 |

One observation per version, separately executed on a concurrently used host;
not a calibrated speedup, billing claim or time guarantee. The state cap still
fires. New scratch allocation is explicitly charged rather than hidden.

Candidate matcher SHA-256:
`3bf0548c9870f15a7efaf23222a9f28a9e7cfb7d3ad4ac9e8b9ffdfba5aa7525`.
Limits, syntax, error and type source hashes remain identical to the validation
baseline. The new test and contract did not exist at the base revision.

### Focused reproduction

```sh
TSX_DISABLE_CACHE=1 timeout --signal=TERM --kill-after=2s 30s \
  node --import tsx --test --test-concurrency=1 \
  packages/safe-bash/tests/commands/ere-work-accounting.test.ts
```

For individual assertion counts in this environment, execute the same test file
with `node --import tsx` without `--test`; its node:test definitions emit all 72
results. Existing corpus sources are
`tests/compatibility/bash-ere-engine-author-20260829/suite.mjs` with
`r01-v1/cases-v2.json`, and
`tests/compatibility/bash-ere-engine-independent-20260829/r01-v1/novel.mjs`,
relative to `packages/safe-bash`. Source adapters bind only the existing ERE
TypeScript files; this is focused current-source validation, not a compiled,
packed-consumer or release gate.
