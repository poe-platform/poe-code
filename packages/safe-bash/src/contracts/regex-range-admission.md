# Regex Match-Range Admission Specification

Status: Accepted

Implemented Through: Not applicable

Purpose: Bound retained candidate ranges and their reconstruction across the
legacy regex worker protocol without truncating results.

The inspected baseline `c657333d005e4e4243df9ae3889a88b3ee91346a` does not
implement this #596 extension in full.

## Normative Language

`MUST`, `MUST NOT`, `SHOULD` and `MAY` identify required, prohibited, recommended
and permitted behavior respectively.

## 1. Problem Statement

Input-length bounds and worker heap/time limits do not independently bound the
number of grep candidate objects or reconstructed reply ranges. Producer and
consumer admission need explicit count ceilings at their allocation boundaries.

## 2. Goals and Non-Goals

The goal is bounded retained candidate ranges and bounded reconstruction for the
legacy grep, rg and glob worker request/reply path. This is not a total process
memory, heap, input-size, output-size or CPU-time guarantee. Already received
transport allocations cannot be undone by consumer validation. Separate expr
and ERE protocol operations retain their existing independent contracts.

## 3. Domain and Configuration

A candidate range is one retained start/end byte-offset pair accepted by a
matcher. Counts include overlapping, duplicate and zero-length candidates, even
when later command output suppresses them. A row is one matcher input record;
a reply contains the row vectors for one worker request.

The fixed ceilings are 100,000 candidate ranges per row and 100,000 across a
reply. Existing input-relative range bounds, byte-offset validity, ordering and
first-match restrictions remain independent. No new public option is introduced;
raising a timeout, worker heap or queue limit does not raise these count ceilings.

Exactly 100,000 otherwise valid ranges MUST remain admissible. A larger request
or row with few or no matches MUST NOT be rejected merely for its byte length by
this policy. Existing input and transport limits still apply.

## 4. Producer and Serialization Admission

The grep matcher MUST count accepted candidates cumulatively across its patterns
for one row. It MUST refuse candidate 100,001 before creating or appending that
range. Rejected word boundaries do not consume candidate slots. Existing rg
admission MUST retain the same row ceiling, including its empty-pattern path.
First-match mode MUST retain its early-return semantics.

The worker MUST check cumulative reply ranges before allocating or filling the
next typed reply vector. It MAY hold one provisional matcher row bounded by the
per-row ceiling. Admission failure MUST NOT publish a partial successful reply.
Each new request receives a fresh count; previous failures MUST NOT leave quota
charged against subsequent requests.

## 5. Consumer Validation and Failure Model

The consumer MUST preflight the reply envelope and all row vector shapes,
input-relative lengths, first-match restrictions, per-row counts and aggregate
count before reconstructing Match objects or allocating the mapped result rows.
Fail-fast rejection during preflight is permitted. Per-range bound and ordering
validation follows successful shape/count admission and MUST remain enforced.

Reconstruction MUST use the vector lengths admitted during preflight, not live
lengths that a shared-buffer producer can subsequently increase. Observed length
drift before or during copying MUST be rejected as a protocol error; copying
MUST never exceed the admitted counts, even under concurrent growth. Stable
shared-backed vectors remain supported. These requirements do not promise an
atomic snapshot of concurrently mutated payload values; each copied range still
undergoes the existing bound and ordering checks.

Producer limits use the existing worker match-error reply route. The per-row
diagnostic remains `matches per line limit exceeded`; aggregate producer refusal
identifies the per-reply limit. An excessive or malformed successful reply is a
protocol error, not a partial success or silently truncated result.

Caller cancellation MUST retain its existing priority and exact reason identity,
including falsey reasons. Validation MUST continue checking cancellation while
processing admitted input. Existing worker cleanup, transfer and reuse behavior
MUST remain intact. This policy does not sandbox arbitrary host callbacks.

## 6. Compatibility and Integration

Normal maintained command batching and exact-limit rows remain supported.
Direct-executor batches that previously returned more than 100,000 total ranges
are intentionally rejected by the new reply policy. The row and reply ceilings
are independent of printed output limits; count-only output does not bypass them.

This extension MUST NOT change byte offsets, word filtering, accepted-range
ordering or downstream overlap/empty-match output suppression. It does not repair
or relax separate pre-existing duplicate-pattern/input-bound inconsistencies.

## 7. Test and Validation Matrix

| Requirement | Required evidence |
| --- | --- |
| Row ceiling | Exact and over-limit grep/rg cases; cross-pattern totals, empty matches and non-all controls. |
| Reply ceiling | Exact and over-limit multi-row replies and worker serialization, with no partial publication. |
| Allocation ordering | Excess later rows are refused before consumer reconstruction; worker vectors are admitted before allocation. |
| Mutable storage | A genuine worker growing shared backing storage cannot increase copied counts; observed length drift rejects and stable shared vectors succeed. |
| Existing validation | Malformed shape, byte bounds, ordering and first-match restrictions still reject. |
| Cancellation and lifecycle | Falsey pre-abort identity, cleanup/listener controls and a successful request after a refusal. |
| Public integration | Actual built Node worker and standard command factory, including count-only output; current consumers and maintained adjacent tests. |

## 8. Conformance Criteria

All required behavior and validation categories must hold before this extension
is marked implemented. Instrumented worker-body evidence alone does not establish
actual Node-worker/public-command conformance or measured memory usage.
