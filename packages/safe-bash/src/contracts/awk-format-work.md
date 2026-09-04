# Awk Formatting Work Admission Specification

Status: Implemented

Implemented Through: cf517239d1e96262c06d969ede71a1acf650b5e9

Purpose: Admit execution-time format scanning and size-dependent rendering work
against the existing awk invocation budget before carrying out that work.

The inspected baseline `38bc1402f817250f81fef4e4a38e7129e9af7b1a` does not
implement this formatter extension. Its sed transliteration and awk record-join
paths already have proportional work admission and are not changed here.

## Normative Language

`MUST`, `MUST NOT` and `MAY` denote required, prohibited and permitted behavior.
Implementation-defined accounting choices MUST be documented and tested.

## 1. Problem Statement

An interpreter statement can format many bytes while consuming a constant few
steps. Post-format buffer checks also allow rejected padding to be materialized
before refusal. Existing per-value and retained-state bounds do not replace
cumulative work admission.

## 2. Goals and Non-Goals

Execution-time formatting MUST share the invocation's existing step allowance
and configured buffer bound. This is proportional work accounting, not a hard
CPU-time deadline, an exact count of every native operation, a total heap bound
or a guarantee that synchronous native operations are preemptible.

Formatting remains synchronous. Queued cancellation is observed when the
surrounding interpreter reaches its existing cooperative checkpoints; this
extension does not create event-loop turns inside every conversion. Source
parsing and literal-format syntax validation are outside this execution ledger.

## 3. Domain and Configuration

Formats and rendered text use the existing byte-string representation. A work
charge consumes the existing invocation allowance; it is not refunded when
temporary text is retired or a later operation fails. The existing public
`maxSteps` and `maxBufferBytes` options retain their defaults of 5,000,000 and
32 MiB and their positive-safe-integer validation. No new public option is added.
The formatter's independent 32 MiB output ceiling remains in force: its effective
capacity is the lower of that ceiling and the configured buffer allowance.
Increasing the configurable allowance MUST NOT raise the independent ceiling.

All runtime formatting routes MUST use the same actual invocation budget:
formatted print, sprintf, OFMT/CONVFMT conversion, ordinary numeric-to-text
conversion and string comparison. A nested conversion MUST NOT create a fresh
allowance. Existing independently bounded numeric conversion primitives retain
their width and precision restrictions.

## 4. Admission and Rendering

The formatter MUST admit format scanning proportional to the format length
before scanning it. Size-dependent conversion, precision/padding and rendered
output work MUST receive proportional charges before the corresponding work.
Accounting MUST include literal and escaped-percent routes, not only conversion
specifiers. Repeating a conversion or formatting call MUST consume the shared
remaining allowance again.

The formatter MUST determine and check known large output/padding lengths before
materializing that padding or appending the part. A rendered part exceeding the
configured buffer's remaining capacity MUST be refused before that append;
truncation is not an acceptable substitute. Independently bounded small numeric
primitives may produce a temporary representation before its exact size is
known. This does not authorize input-sized padding before admission.

Implementation-defined charge categories and conservative estimates MUST be
explicit and have exact-boundary controls. They need not claim one charged unit
for every internal copy performed by the JavaScript engine.

The selected accounting is conservative, per operation:

- Charge the format byte length before scanning it.
- Charge a full source string before numeric coercion, including string-valued
  dynamic width and precision arguments.
- Check remaining output capacity and charge the known resulting length before
  selected string slices, precision padding, final width padding and output
  appends. Literal and escaped-percent appends charge their emitted bytes.
- Charge the current part length before transformations that scan or copy that
  part. Native numeric rendering charges one plus requested/default floating
  precision, or one for integer rendering, before conversion. Bounded numeric
  primitives may still precede exact output-size knowledge. The ordinary integer
  text fast path charges its resulting byte length after bounded rendering.

Repeated transformations may charge the same bytes more than once. This is not
an assertion about how many physical copies a particular engine performs.

## 5. Failure, Cancellation and Compatibility

Work and buffer refusals MUST use the existing text-program error routes.
Already-observed caller cancellation MUST retain priority and exact reason
identity, including falsey reasons. Admission MUST check cancellation between
formatting operations; cancellation observed during one conversion MUST prevent
later unadmitted conversions.

Otherwise-admissible inputs MUST retain existing byte output, flags, precision,
argument evaluation order and diagnostics. A formatter refusal MUST not evaluate
a later output destination or publish a successful partial formatted result.
Previously completed argument side effects and file writes are not rolled back.
Programs that formerly performed large uncharged formatting under a small step
allowance are intentionally newly rejected.

## 6. Test and Validation Matrix

| Requirement | Required evidence |
| --- | --- |
| Proportional work | Literal, escaped-percent, string, numeric, width and precision routes, including repeated calls. |
| Pre-materialization admission | Rejected large padding does not invoke the padding operation; rejected output does not append or publish a partial success. |
| Runtime enrollment | Public printf/sprintf, OFMT/CONVFMT, numeric conversion and comparison controls; no fresh nested allowance. |
| Compatibility | Exact bytes and existing formatting cases, argument side effects, destination ordering and configured buffer boundaries. |
| Cancellation | Deterministic already-observed falsey cancellation between operations; no queued-cancellation or CPU timing claim. |
| Integration | Maintained text-program tests, built public exports, current consumers and normal build/lint routes. |

## 7. Conformance Criteria

The extension is implemented only when all normative requirements and required
evidence categories pass against the delivered implementation. Small operation
counts do not certify historical large-input timing or heap reports.
