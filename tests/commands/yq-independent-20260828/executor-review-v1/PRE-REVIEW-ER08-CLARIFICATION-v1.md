# Independent Executor ER-08 Clarification Specification — Pre-Review v1

Status: Prepared authoritative-user alignment; author review and execution pending

Implemented Through: Not applicable

Purpose: Correct only ER-08's unconditional timeout-stop overstatement before inspecting executor authors, preserving the original seal and all failure guards.

Date: August 28, 2026.

## Normative Language

MUST, MUST NOT and MAY describe independent review predicates. This addendum
implements the current explicit root/user clarification, not a product-policy
change or an inference from author behavior. The controlling user line is:

> Independentfailurescontinueonlywithintegrity/reap, capturebeforeasserting, nonzerochildalwaysaggregatefailure evenallPASSreceipts.

## Problem Statement

Original seal `d7290477ea464928f02d790314eef6775fdf3c8d` contains ER-08's
unconditional expectation `remaining admission stops` for a child exceeding its
deadline. Its protocol also says `Deadline failure or unproven cleanup stops
admission, even if receipts say PASS.` These words are not already conditional.
They overstate the quoted user's continuation constraint.

The original files remain unchanged, including their raw overstatement:

- `PROTOCOL.md`, SHA-256 `835bdef49c605140321112a700e61fae1f61cf2db6d9c721ec81876c653336c6`.
- `FIXTURES.json`, SHA-256 `4384ea29a4c094798e43154e1c216e8bd2f750330903fa4c835526887b1b31f6`.

## Goals and Non-Goals

This separate pre-review addendum supersedes only ER-08's unconditional timeout
stop and the corresponding original protocol/handoff wording. It does not alter
the other 17 control families, add case breadth, relax integrity or cleanup,
waive runner status, reopen policy, or force an author implementation to pass.
No executor-author behavior was inspected to choose the corrected expectation.

## Corrected ER-08 Predicate

1. A timeout, signaled runner child or nonzero runner child MUST keep the aggregate
   FAIL, even with all PASS receipts, proven cleanup or subsequent passing jobs.
2. After such a failure, conservative STOP is acceptable. Independent continuation
   MAY also be accepted, but ONLY after both full required integrity and reaping
   of all known owned children are proven. Neither proof alone is sufficient.
3. Failed or unknown integrity, or failed or unknown known-owned reap, MUST stop
   remaining admission. Parent exit alone remains insufficient reap evidence.
4. Any permitted continuation MUST remain inside all original admission guards,
   process/output bounds and deadlines. A spent total review budget grants no
   further admission. This clarification does not extend any deadline.
5. Capture before assertion, primary/cleanup failure recording, owned-PID/group
   signaling only, and honest opaque escaped-process limitations are unchanged.

## Test and Validation Matrix

These are the existing ER-08 boundaries, not new fixtures or executed results.
For every timeout/signal/nonzero outcome, the aggregate remains FAIL:

| Full integrity proven | Known-owned reap proven | Acceptable next admission |
| --- | --- | --- |
| Yes | Yes | Conservative STOP or independent continuation under unchanged bounds |
| Yes | No or unknown | STOP only |
| No or unknown | Yes | STOP only |
| No or unknown | No or unknown | STOP only |

Preparation checks are static only: original seal/hash preservation, exact
single-new-path commit, and protocol format validation. No author/product import,
execution, build, typecheck or synthetic child is authorized or run here.

## Conformance Criteria

Future independent review MUST interpret ER-08 with this addendum and retain
the original wording as qualified raw history, not silently rewrite it. The other
17 families remain unchanged and unexecuted. Actual review remains INCOMPLETE
until root routes committed author seals for later inspection and bounded
synthetic control execution. This handoff ends prepared, without waiting.
