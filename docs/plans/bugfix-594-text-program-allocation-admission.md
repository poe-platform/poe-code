# Bugfix #594: text-program allocation admission

## Validated defect and scope

Small in-memory witnesses confirmed that sed transliteration expanded an admitted
byte string into per-byte JavaScript arrays without proportional work admission.
Awk field splitting similarly materialized intermediate arrays before its existing
100,000-field check, and print, record rebuilding and SUBSEP keys performed joins
before checking their resulting byte length. No large-memory or RSS claim was
reproduced or inferred.

Use the existing text-program step, buffer and field limits. No new public option,
dependency, global memory quota, formatter behavior, filesystem/input policy or
README change is included. The already guarded awk reader remains unchanged.

## Implementation

- Sed admits the full known byte length before allocating one byte buffer, then
  fills it with bounded checkpoints. Checkpoints do not charge those bytes again.
  Interpreter strings are Latin-1 byte strings, including NUL and invalid UTF-8.
- Awk admits scan/copy byte work, scans whitespace/empty/literal/regex separators
  incrementally, and admits each field count before slicing or constructing its
  scalar. Regex matching retains its separate execution charge. Paragraph and
  zero-width matching behavior remain unchanged. No intermediate string array is
  needed. Splitting and record assignment are awaited through all setter callers.
- One private bounded join admits component count before scanning, subtracts
  component/separator/suffix bytes before joining, and charges admitted byte-copy
  work. Empty components therefore still consume work. This does not change the
  separate allocation behavior of NF extension or the formatter internals.
- Print arguments retain left-to-right evaluation before conversion using final
  OFMT/OFS/ORS values; failed output admission precedes redirect evaluation.
  No-argument print does not convert OFS. Formatted print retains its existing
  branch behavior, including not appending ORS.
- SUBSEP indexes retain per-index evaluation and conversion before later index
  side effects, with the final separator read afterward. Builtin split resolves
  its target before separator evaluation and clears it only after successful
  splitting. Existing cancellation, input finalization and output backpressure
  remain required.

## TDD evidence

The first 12-test run had seven genuine work-admission failures, two passing
already-budgeted regex controls, and three test-spy setup errors. After correcting
the spy (Node's mock.method rejects Array.prototype), the unmodified product
baseline was **10 failing, 2 passing**: seven work-admission witnesses and three
oversized joins that executed before their limit error. Builtin work witnesses
were subsequently isolated in BEGIN with literal input so record splitting cannot
mask the builtin route.

A separate 128-empty-component join with maxSteps 64 passed before component-count
charging and failed its new expected-limit assertion; adding count admission made
it pass. A vertical-tab fixture initially used unsupported JSON Unicode-escape
syntax; changing the fixture to awk's supported backslash-v escape restored its
intended whitespace assertion without changing the interpreter.

Independent review found that the original cancellation fixture's unterminated
input had already reached EOF and closed before its abort checkpoint. Its prior
green result therefore did not prove cancellation cleanup. Adding an assertion
that input remains open immediately before abort produced **2 failing tests**
with the old input. Appending a newline keeps the producer open at that point;
both tests now require the open-before-abort to closed-after-rejection transition.
No product source changed for this fixture correction.

Focused controls cover exact 100,000 fields and the first excess field, all split
branches, byte identity, empty/paragraph/zero-width cases, join admission and
evaluation order, setters, falsey cancellation and backpressure. Boundary inputs
are bounded to about 200 KB; no time/RSS threshold is asserted.

## Verification

- New focused suite: 49 passing tests. The allocation suite plus maintained
  text-program owner and agent-command registration cohort: **155/155 passing**,
  no skipped or cancelled cases (serial Node execution).
- Maintained `scripts/integration-inputs.test.mjs`: **96/96 passing**, including
  exact literal registration of the new test.
- `npm run build:workspaces -- --workspace=virtual-bash`: passed the selected
  safe-fs and virtual-bash build closure. This is not a root public-bundle build.
- Strict NodeNext no-emit check of the new test and its imported source: passed.
  Initial test-only callback/overload typing errors were corrected before freeze.
- The no-argument print regression is covered with invalid CONVFMT and numeric
  OFS. The failed-split clear observer records state before mutation and includes
  a negative control proving that an actual clear is detected.
- `git diff --check`: passed.

Root owns independent review, integrated checks, consumer validation, lint, Git
and release delivery. No push or release is claimed by these local checks.
