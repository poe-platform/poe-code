# CW-F01 TYPE Output Correction Specification

Status: Proposed additive harness correction; different review pending; no execution GO

Implemented Through: Not applicable

Purpose: Close the frozen indented-output acceptance defect in one future assembled TYPE worker without changing product or fixture policy.

## Normative Language
MUST and MUST NOT identify mandatory behavior and prohibitions.

## Problem Statement
Reviewer commit `9189eb71d6cc16e028793318543fd2c0437c3a4d` freezes CW-F01 against worker commit `c0353685540288d504b93f206735fe4c448268ef`. The private classifier discards arbitrary indented lines after a parsed diagnostic. Its matching TS2554 plus indented warning can therefore select accepted compile rejection despite TYPE-04. This is static source evidence, not an executed result. Both the original worker component and reviewer defect remain immutable.

## Goals and Non-Goals
Replace only that classifier's continuation/framing acceptance with a bounded declared structure. Do not modify core, build, product, CARRY, fixture sources, expected diagnostic code/line/file, allowed negative compiler statuses, raw capture, process aggregation, public exports or budgets. Do not create a GO, execute a classifier/compiler/worker/control/product or claim reviewer acceptance.

## Domain and Configuration
`ASSEMBLY.json` binds the exact reviewer input, immutable parent source/blob, parent seal, preimage and fresh postimage mode/hash/size/path. Its single replacement maps this directory's `type-worker.mjs` to the intended new compound path `workers/type-worker.mjs`. The module has no new API, imports, CLI or standalone execution mode. Its unchanged relative helper import resolves only after independently authorized assembly.

The continuation literals are execution-controlling inputs embedded in the freshly sealed replacement source. They MUST NOT be loaded from mutable compiler output or a dynamically updated golden. `DEFERRED-CONTROLS.json` is separately sealed data, not an executed control or an automatically authorized worker input. The exact reviewer witness is preserved inside its first control.

## Output Contract
The worker MUST retain its existing UTF-8, stderr, process/deadline and positive-empty-output handling. Negative compile statuses remain1 or2; the same single diagnostic code, fixture file, line and positive column checks remain required. Diagnostic header message wording is not newly golden-bound by this correction.

For negative output, the classifier MUST split using the existing LF/CRLF convention and remove at most one terminal empty split element. Zero or one terminal newline is allowed. Leading, interior or additional trailing blank lines, whitespace-only lines and unrecognized output MUST NOT be ignored.

All fixtures except `replace-undefined` with declared code2379 MUST have exactly one diagnostic content line and no continuation. That specific fixture/code MUST have exactly three content lines: the diagnostic header followed, in order, by these exact strings:

```text
  Types of property 'replace' are incompatible.
    Type 'undefined' is not assignable to type 'boolean'.
```

The classifier MUST compare the entire continuation strings including indentation, punctuation and trailing bytes. Missing, reordered, repeated, changed or additional lines MUST fail. A continuation permission MUST NOT follow arbitrary indentation, arbitrary fixture names, other diagnostic codes or compiler-supplied text. Additional diagnostic headers still fail the unchanged exactly-one-diagnostic check.

These two permitted lines are declared from static TS5.9.3 message templates/formatting and the unchanged fixture, not an observed compiler capture. Future actual emission remains UNRUN. A different emission MUST fail closed and be reviewed; it MUST NOT update these expectations automatically.

## State, Capture and Failure Semantics
All code outside the exact replacement hunk MUST be byte-identical to the immutable parent. In particular the full worker MUST durably publish raw compiler return/argv/tool/provenance and raw stream evidence before invoking classification, and preserve the subsequent guard/reap rules. Unrecognized output reaches the existing FAIL classification; this correction introduces no new result enum or expected-nonzero worker waiver. Any actual worker/parent nonzero, signal, timeout, overflow or unsafe integrity/reap condition retains the original aggregate failure semantics.

## Assembly and Authority
Root MUST route this overlay only after independently reviewing it and stopping the current core author naturally; no coordination wait or core edit is performed here. Before replacement, the assembler MUST authenticate the parent source/seal from the exact commit, create a fresh regular assembly, and verify its parent preimage identity/mode. After replacement it MUST verify the exact new descriptor and complete compound membership. It MUST NOT overlay live HEAD, modify original workers or pretend the original final/source seals certify the changed assembled worker.

The29 unchanged component inputs are explicitly bound in ASSEMBLY. Core MUST freshly project every execution-controlling input from those immutable sources and guard mode/kind/hash/size/path and added entries. Listing those inputs is not admission. Parent seals are preserved historical records; root MUST generate and independently bind a new complete compound seal and worker binding before execution. Original409 fixture POSIX mode remains ORIGINAL_MODE_UNATTESTED; fresh mode420 requirements are not retrospective attestation.

## Test and Validation Matrix
- Static: authenticate reviewer/parent identities and show exactly one source-hunk replacement, with every other source byte unchanged.
- Static: check projection syntax and unchanged import graph without importing authored modules or resolving the absent local helper.
- Static: verify exact reviewer control bytes,24 deferred records, unchanged fixture references, fresh file modes and source/assembly/seal membership.
- Deferred: the exact CW-F01 witness, nearby warnings/extra headers/blanks/whitespace and malformed continuation boundaries MUST fail.
- Deferred: existing single-line code1/code2 rejections and declared complete LF/CRLF/no-terminal-newline chains must satisfy all unchanged surrounding checks before acceptance.

All24 control outcomes remain UNRUN. Static checks MUST NOT execute this classifier or a duplicate/shadow acceptance predicate. Author checks are not independent acceptance, actual compiler proof or YQ semantic success.

## Conformance Criteria
This component is eligible for different review only after exact source, assembly mapping, deferred data and static evidence are sealed. Root compound integration, fresh authorization and separately permitted dynamic verification remain necessary for execution conformance. Public export gaps and all prior dynamic-proof gaps remain unchanged.

## Open Questions
The precise future compiler emission and whole-worker control behavior remain unobserved. Core may still bind the old component until root explicitly routes a new assembly. This overlay makes no complete-compound or execution-authorization claim.
