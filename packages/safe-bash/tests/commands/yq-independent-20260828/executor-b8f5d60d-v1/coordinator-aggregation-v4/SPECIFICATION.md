# Coordinator Failure Aggregation Correction Specification

Status: Proposed

Implemented Through: Not applicable

Purpose: Specify only the additive CC-F01 coordinator aggregation correction, pending separate review and future authorized dynamic evidence.

## Normative Language

MUST and MUST NOT identify required behavior within this narrow correction.
They do not authorize execution or replace any existing policy or admission gate.

## 1. Problem Statement

The frozen `cc6da0299760f26cdfcf0b77ad26d1e0b0b7c260` witness identifies
missing final aggregation of errors already captured in the coordinator's actual
receipt. A stream capture, fsync or close error can leave exit code zero while
setting `parent.spawnError`. The existing supervisor does not test that field.
This is a static source condition, not an observed all-green cohort or an
observed filesystem failure. Known four and other cohort gaps remain failures.

## 2. Goals and Non-Goals

The supervisor MUST independently reject captured coordinator errors and
incomplete or failed coordinator metadata publication. This correction MUST NOT
change receipt production, source/product policy, caller error identity, resource
ceilings, runtime cases, or any existing failure condition. It supplies one
supervisor replacement, not a combined assembly or an execution authorization.

## 3. Boundary and Receipt Fields

The authority is the actual `parent` returned by `await coordinator.done` after
the existing owned-process finalizer. No reconstructed, worker-reported, or
synthetic receipt substitutes for it. In that finalizer, absence of a captured
error is represented by `spawnError: null`; errors are described in that field.
Successful metadata publication sets `metadataComplete: true` and does not set
`metadataError`. A publication exception records `metadataComplete: false` and
`metadataError`; the existing finalizer also sets `spawnError` if still null.
These finalizer and classification implementations are read-only inputs.

## 4. Aggregation Contract

In addition to every existing final failure predicate, the supervisor MUST set
the final `status` to `FAIL` if any of these actual receipt conditions holds:

- `parent.spawnError !== null`, matching the existing classifier's error test.
- `parent.metadataComplete !== true`, requiring explicit metadata completion.
- `parent.metadataError !== undefined`, rejecting any defined metadata error.

The checks MUST be independent disjuncts. They MUST NOT depend on exit code,
signal, overflow, another error field, or row failures also indicating failure.
Missing `spawnError` or missing metadata completion cannot establish success.
`metadataError` is absent on the current producer's successful receipt; a defined
value, even a falsy one, is not treated as a successful publication. These are
local receipt conventions, not a new host-object admission API.

## 5. Preserved Invariants and Integration

The final aggregate MUST retain the original `parent` object and its code,
signal, reap state, error descriptors, paths, byte counts, hashes and timing.
This overlay MUST NOT wrap or replace caller reasons or mutate any receipt.
All existing deadline, reap, integrity, unsafe-stop, coordinator-final, row-count
and row-failure predicates MUST remain unchanged, as MUST collection and cleanup
ordering. No new fsync durability, hostile-host isolation or hard-preemption
guarantee is asserted.

The only assembly target is `core/supervisor.mjs`, with exact preimage SHA256
`7d33d4e0feba862a3bf3b5da3f6e41bd2217871c01d429207b4a47061682a126`.
Root MUST authenticate the replacement and separately seal the fresh union with
other approved overlays; this packet does not modify or compose that union.
No worker-api, phase, ledger, classifier or owned-process changes are supplied.
The existing matrix 336 / max334 / 18max, global cap 24165 seconds and per-job
32 MiB cap remain unchanged. All other existing capture and resource limits
remain unchanged. Original b1/946, current composing v3, frozen review, failures,
preparation captures and known cohort gaps MUST NOT be rescored by this packet.

## 6. Test and Validation Matrix

| Requirement | Static evidence | Future dynamic evidence |
| --- | --- | --- |
| Three independent failure disjuncts | Exact immutable preimage/postimage and one textual insertion | Deferred conditions D01-D08; all UNRUN |
| Existing predicates and receipt identity unchanged | All other source bytes identical | Deferred conditions D09-D13; all UNRUN |
| No unrelated targets or imports | One-target assembly mapping and exact membership seal | Fresh union review and admission; UNRUN |
| Source parses | Host `node --check` only; no target evaluation | Does not establish runtime correctness |
| History retained | Original seal bytes, modes and membership checked | No historical rescore authorized |

`DEFERRED-CONDITIONS.json` contains data-only expectations, not executable
controls, constructed runtime receipts, or observed passes. Static preparation
errors remain recorded separately in `PREPARATION-HISTORY.json`.

## 7. Conformance Criteria

Source delivery is limited to the single authenticated insertion and a sealed
handoff. Behavioral conformance remains unestablished until a different reviewer
accepts the correction, Root seals and admits the complete union, and future
explicit authorization covers the required dynamic checks. This packet MUST NOT
create RootGO, claim a control pass, infer a product failure, or mark the current
cohort green. No unresolved code dependency requires expanding this write set.
