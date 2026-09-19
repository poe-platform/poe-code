# Row and argv admission user edge validation

This is a focused continuation of the existing uncommitted csvkit suite. The
released source/profile and captured observations were preserved; no fresh native
reference or service qualification is claimed.

## Reproduced defects

An original regression with zero output allowance reproduced `Runtime.row`
calling `String.split` before output denial. Serialization now scans virtual
normalized/escaped fragments and validates native writer errors before admitting
UTF-8 bytes and assembled UTF-16 retained storage. The admitted row is then
constructed and encoded. Missing escape and timedelta overflow retain their
native ordering ahead of output-byte denial. Surrogate pairs spanning field
delimiters or terminators count as four bytes, including empty fields/fragments.
Serializer scans consume invocation work and preserve awaited sink writes.

An independent agent reproduced actual Shell argv limits returning status 1 with
`shell: line 1: internal error` instead of a named divergence. Two original direct
engine cases also threw RangeError. The registration passes denied argv metadata
without copying payloads; the actual shared engine selects status 78 before argv
reads or input acquisition. Invalid limit configuration remains a host error.
An existing preflight test was updated to assert the required named denial while
preserving its zero-copy assertion; it had explicitly expected RangeError.

## Verification

- Final maintained domain tests: 91 files, 4,233 passing tests; one skip and five
  TODOs excluded. These counts include capability/policy refusals.
- Maintained domain lint passes ESLint and strict product/test TypeScript checks.
- Selected uncached safe-bash build closure passes 11 declared workspace builds,
  including the csvkit engine, guarded Shell build and postbuild stage.
- Selected actual Shell registration, new raw-resource stress, writer stress and
  byte-ownership tests pass 95/95, without skips or TODOs.
- Independent new regression files pass 2/2 domain and 10/10 Shell cases. Four
  raw tools await sink backpressure and drain delayed cooperative named-source
  cleanup before budget-failure settlement. Later invocations use fresh counters.
  Backpressure allows the existing CPython-compatible 8192-byte decode window.
- Exact-file ESLint for registration, new Shell tests and integration inventory
  tests passes. The maintained normal-runner discovery check includes the new
  literal test path and passes.
- Maintained safe-bash typecheck passes source/tests and 26 current consumer
  groups, including expected negative-consumer rejection. Compile-only evidence.
- Actual compiled Shell CSV output and the named argv denial were rendered with
  the maintained screenshot tool and visually inspected: readable, no clipping.
  The owned temporary screenshot was purged after this record was written.

QA procedures: docs/plans/csvkit-row-admission-edge-qa.md and
docs/plans/csvkit-raw-resource-user-stress-qa.md.

## Remaining blockers

This does not establish full csvkit compatibility or a complete allocation/RSS
bound. Typed `pythonValueText` conversions still allocate before row admission,
and line-number arrays allocate under the column limit before text admission.
The retained model is cumulative, not peak memory. Other schema, SQL, interpreter,
workbook dependency and codec/regex/reference gaps remain as recorded in
implementation-status.md and resource-admission-continuation-20260918.md.
Cancellation cannot undo completed effects or forcibly preempt opaque host work.
The prior repository unit and external peer-admission blockers were not qualified
by this selection; no full repository unit/release gate pass is claimed.

No README content, staging, commit, push or publication was performed.
