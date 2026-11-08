# Deferred YQ Executor Preparation Protocol v1

Status: Proposed preparation protocol — presealed before synthetic execution

Implemented Through: Not applicable

Purpose: Authenticate and exercise a bounded executor without authorizing a
product candidate or changing accepted YQ semantics.

## Normative Language

MUST and MUST NOT identify executor obligations. This protocol governs only
the harness, not a competing product contract. Date: August 28, 2026.

## Problem Statement, Goals and Non-Goals

The frozen 194 IDs include observable commands, private counterexamples,
admission/lifecycle assertions, data, types and package infrastructure. The
executor MUST retain all IDs and eight final overlays without calling every
record executable. Pending proof bindings are gaps, never passes. The executor
MUST NOT load product/private code, build, typecheck or invoke native oracles
during preparation. Synthetic Node children are the sole authorized execution.
No new YQ policy cases, public limits, DI, query instrumentation or runtime hooks
are authorized. Three factories remain createYqCommand(), createYqCommands(),
yqCommands({replace?: boolean}); fixed P1 private charge/measure/stringifyJson/
reserve and beforeUnit/finish/abandon roles remain private source evidence.

## Domain Model and Integration Contracts

- A record is an original frozen ID with immutable source/input/default hashes,
  current overlay references, a primary proof role, secondary roles, prepared
  observable jobs and explicit missing proof bindings.
- A job is an exact ID/variant, input bytes, expected-data reference and asserted
  observable projection. Fragmentation variants do not create new original IDs.
- A later authorization binds an exact committed candidate identity, accepted
  source manifest/hash and baseline composition attestation, materialized source
  and compiled tree membership/content/modes, exact API entry/hash/import proof
  role, selected jobs/hash, immutable recipe tree/hash, Node executable/hash and
  bounds. Hashes authenticate against root-supplied trusted hashes, not a
  self-declared PASS string. No implicit HEAD, live path, package lookup or
  network fallback exists. Source provenance/build mapping attestation is a
  host trust boundary, not something output hashes prove by themselves.
- Compiled entry invocation uses only createYqCommand().execute with the
  declared CommandContext. A harness byte-only, read-only fixture FS is not a
  deployed adapter. Direct-module evidence MUST NOT be called public package
  export evidence. Public/materialized/type bindings await the consumer owner.
- Evidence MUST be outside every candidate/source/compiled/recipe guard root.
  New evidence uses an exclusive unique directory and exclusive files; each
  publication is a same-filesystem atomic no-clobber link from an owned temporary
  regular file. Existing captures MUST NOT be overwritten or removed.

## Configuration and Admission

Missing or mismatched candidate authorization MUST refuse before candidate
imports or evidence/output creation. Preparation controls have a separate
synthetic-only entry, a preseal Git commit and exact protocol/fixture hashes.
The recipe admits only bounded job lists, byte payloads and Node children.
Environment is explicit, without ambient NODE_OPTIONS or credentials. Host FS
access belongs to the harness for named guarded inputs/output only; command
contexts receive no implicit host files or network. Host JS is not sandboxed.

Tree guards MUST enumerate directories and regular files, hashes and POSIX mode
bits including newly added/removed entries; symlinks and special nodes refuse.
No broad hidden exclusions exist. Before and after each child, exact guarded
trees MUST match the authenticated manifests. Root path binding is checked.
These are point-in-time checks, not transactions or proof against transient
modify-and-restore. New files and empty directories are within the check.

## State Machine, Capture and Failure Recovery

Authorization -> integrity -> unique evidence -> child admission -> bounded
capture -> known-child reap -> after-integrity -> raw publication -> assertions.
Raw stdout/stderr bytes, command result/rejection, VFS effects/events and child
exit/signal/timeout/reap metadata MUST be saved before semantic assertions or
receipt interpretation. Byte caps stop collection and fail the job; truncation
is explicit. A child emits one newline-delimited JSON receipt for its exact job.
Duplicate, missing, malformed, unknown or extra receipts MUST fail closed.

Each child has an owned PID and fresh POSIX process group. The host MUST use
only those known identifiers, issue bounded TERM/KILL escalation, wait for child
close and prove its known group absent before admitting another job. A deadline,
signal, spawn error, output overflow, assertion failure or nonzero child exit
MUST fail aggregate status, even when stdout contains only PASS receipts.
Ordinary failures MAY continue independent jobs only after BOTH unchanged
integrity and known-child/group reap are proved. Integrity/reap uncertainty MUST
stop admissions and force aggregate FAIL. No name-based foreign kill, opaque
host preemption guarantee or escaped-descendant proof is claimed. A simulated
reap-proof failure deliberately withholds evidence after an actually reaped
bounded child; it MUST NOT create an escaped/runaway process.

## Test and Validation Matrix

`controls.json` freezes deterministic controls before execution:
normal pass; PASS plus exit 7; ordinary failure followed by independent pass;
raw capture followed by assertion failure; candidate add/content/mode mutation;
deadline and actual reap; withheld reap-proof gate; malformed/duplicate/missing/
wrong receipts; signal termination; bounded output overflow. Mutations touch
only owned fixture copies, never candidate/product/history. Children create no
descendants or network work. Each run records admitted jobs, receipts, raw files,
aggregate, integrity, known PIDs, reap status and active children.

Static checks MUST verify 194 unique original references, all eight overlays,
role totals, selection denominators, input/expected-data bindings and recipe
membership. Controls are framework tests, not YQ semantic passes. Failed
preparation attempts MUST remain identified with their evidence and correction.

## Conformance Criteria and Open Questions

Preparation completion requires source/fixture preseal, bounded static and
synthetic results, final selected-file recipe seal, and exact owned atomic
commits. It grants no candidate acceptance, type/package proof, superiority or
global GO. Consumer integration and actual candidate authorization are pending
handoffs, not unresolved product policy. No further policy expansion is allowed.
