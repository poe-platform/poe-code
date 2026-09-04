# Sort Record Admission Specification

Status: Accepted

Implemented Through: Not applicable

Purpose: Bound sort's retained record count independently of payload bytes and
admit completed records before materialization.

## Normative Language

The key words `MUST`, `MUST NOT`, `REQUIRED`, `SHOULD`, `SHOULD NOT`, `RECOMMENDED`,
`MAY`, and `OPTIONAL` are to be interpreted as described in RFC 2119.
`Implementation-defined` means the implementation MUST document its chosen policy.

## 1. Problem Statement

Payload-only admission permits many empty or short records, each retaining a
typed-array object and vector entry. Stable merging also needs a reference
vector. Small actual-command witnesses establish that all records are retained
even in unique/check modes; historical heap and OOM figures are not established.

## 2. Goals and Non-Goals

Sort MUST independently bound completed-record count and preserve its existing
payload limit. Admission MUST precede completed-record copy/concatenation and
retention. Accepted inputs retain existing ordering, raw bytes and mode behavior.

This contract does not measure physical object sizes or establish a whole-process
heap/RSS bound. It does not redesign pending line fragments, shared line readers,
numeric caches, output buffering, native allocation, or check-mode streaming.
Those resources retain separate existing behavior and limitations.

## 3. Records and Limits

A record consists of bytes before a selected delimiter, or a nonempty final
unterminated sequence. Every encountered delimiter completes one record, even
with no payload. EOF after a delimiter and an empty input do not add a record.
Default delimiter is newline; NUL mode retains its existing delimiter semantics.

The selected fixed capacity is 100,000 completed records per invocation.
Sort MUST retain the independent fixed 32 MiB admission limit, charging each
completed record's payload length plus one delimiter byte, including a final
unterminated record. These limits are not new public configuration options.

All operands and all modes MUST share the same invocation ledger. Unique output
MUST NOT refund duplicate input records; check mode MUST NOT bypass admission.
The second merge reference vector MUST be limited to the admitted record count.
Existing numeric-cache limits remain separate and MUST NOT replace this ledger.

## 4. Admission and Processing

Before allocating/copying/concatenating a completed record or retaining it in the
record vector, sort MUST check whether both its count and byte charge fit.
Exactly 100,000 records MAY be admitted when their bytes also fit. The next
record MUST be refused before its completed representation is materialized.

Admission MUST update neither counter on failure. Neither a later operand nor a
different sorting mode may reset the ledger during the same invocation. Fresh
invocations MUST receive fresh allowances.

Source ownership MUST remain intact: retained records must not alias reusable
producer buffers. Early refusal or check-mode disorder MUST finalize the active
input iterator and avoid reading later operands. Existing cooperative comparison
and move checkpoints MUST remain; this is not native-operation preemption.

## 5. Compatibility, Failure and Recovery

Otherwise-admitted inputs MUST preserve raw bytes, stable/unique/reverse/key and
numeric semantics, NUL delimiters and final delimiter emission. Check mode MUST
preserve global record numbering, strict-unique disorder checks and early exit.
Admission occurs before comparison of the newly completed record, preserving
the existing byte-refusal precedence over disorder on that record.

Count or byte refusal MUST use the existing EFBIG sort-buffer diagnostic and
sort status 2. Check-mode disorder remains status 1. Already-observed caller
cancellation MUST preserve exact reason identity, including falsey reasons.
Refusal MUST NOT emit a successful partial sorted result or replace an output
destination with partial sort output. Earlier completed effects are not rolled
back, and unrelated failure details MUST NOT be swallowed.

## 6. Test and Validation Matrix

| Requirement | Required evidence |
| --- | --- |
| Exact count and byte admission | Counter-only count boundary, logical byte boundary, repeated failure and unchanged state after rejection. |
| Pre-materialization | Small actual-command observers with positive controls prove admission precedes completed-record allocation and retention. |
| Shared ledger | Multi-operand, unique, numeric, NUL and check-mode wiring; no per-file reset or output-dedup refund. |
| Compatibility | Empty/unterminated records, raw bytes, stable/key/numeric sorting, global disorder numbers and duplicate checks. |
| Ownership and cleanup | Reusable producer buffers, input finalization, falsey cancellation and unchanged destinations on refusal. |
| Integration | Maintained core-sort cohorts, normal build, built public imports, current consumers and maintained lint. |

## 7. Conformance Criteria

The extension is implemented only after all normative behavior and evidence
categories pass against an identified implementation commit. Tests using logical
lengths or counters prove admission arithmetic, not real allocation costs or
historical OOM claims.
