# CMD-22 Read-Path Domain Successor Preseal Specification

Status: Accepted preparation-only addendum; implementation and fixtures unexecuted

Implemented Through: `7add5d2c0a3acb27483ba0bb5dd52385812d8ed7`

Purpose: Bind one frozen literal-operand read expectation to its declared virtual
filesystem path domain without changing the command, product or other assertions.

## Normative Language

MUST and MUST NOT identify conformance requirements. This August 28, 2026
addendum narrows the runtime-v2 specification to the CMD-22 path comparison only.
Implemented Through identifies the inspected predecessor, not execution or
validation of this new adapter. The source preseal and later independent review
MUST distinguish authored code, static inspection and future runtime evidence.

## Problem Statement, Goals and Non-Goals

F-ACTUAL-02 at `4b219eae180fcd2fd15ea864c9bc5226c54cda04` records a harness
domain mismatch, not a product filesystem bug. The immutable command has argv
`["--output-format=json","--compact-output","--",".","-name"]`, one literal
file `-name` containing `false\n`, and virtual context cwd `/v`. Its historical
capture has status 0, stdout `false\n`, empty stderr and a signal-forwarded
`/v/-name` read. The original expectation lists `-name`. The old FAIL, input,
expected tuple, output bytes, operation order and raw evidence MUST remain intact.

This work MUST NOT execute any harness control, proposed fixture, product,
private runtime, native YAML, dependency installation or materialized-import
validation. Static data/hash inspection and syntax/specification checking are
the only preparation checks. Old candidate `35da18547ca82a67be9ca22b4adc21e3b8060780`
MUST NOT be rerun; its authorization is consumed. A fresh candidate GO can exist
only after a new preseal and separately authenticated source/package bindings.

## System Boundary and Domain Model

The **literal operand** is the exact source spelling from argv, fixture files
and the frozen `expected.reads`. The **resolved VFS path** is the argument
recorded by the fixture's `fs-read` event. The fixture normalizes its backing
map using `posix.resolve('/v', filename)`, but records the original FS method
argument before lookup. These roles MUST NOT be conflated.

The only accepted resolver profile is `frozen-fixture-posix-resolve-v1`, bound
to the unchanged v2 context SHA-256
`b4827ee8656e9d2a88a23176c9b61b757bf9d4c79f8c46463c5cb579e42e7821` and baseline
`5137a74ec855a32d8a8860eb66b62eb44d11e290:src/contracts/path.ts`. That contract
validates string/NUL-free paths and an absolute cwd, then uses Node's POSIX
resolver. The profile fixes virtual cwd `/v`; it MUST NOT use `process.cwd()`,
environment state, platform-native path rules or `job.cwd`. The latter is the
host child launch directory, not the command's virtual context cwd.

This profile is lexical fixture behavior, not symlink containment, real
filesystem trailing-slash rules, namespace authority or deployed-provider proof.
Absolute, relative, dot, dotdot and trailing-separator examples are deferred
resolver-only controls, not new command inputs or authorized product executions.

## Binding and Assertion Contract

Only `recordId === 'CMD-22'` receives the new path-domain predicate. The predicate
MUST require the exact sealed binding, source reference, argv, input bytes,
literal file names, stdin provenance, expected tuple and other original job
fields. Host-added launch metadata MAY coexist, but MUST NOT supply virtual cwd.
Missing or changed binding/profile/input/expected fields MUST produce INCOMPLETE
and fail; equivalent-looking rewritten argv or file names are not new fixtures.

The predicate MUST resolve the bound literal expected operands with the declared
profile, producing exactly `['/v/-name']`, and compare the entire ordered
observed read-path array by exact equality. It MUST NOT normalize observations,
strip basenames, use suffix matching, accept another cwd or admit extra reads.
The literal expected tuple MUST remain unchanged in both memory and evidence.

The v2 assertion MUST retain raw-byte publication and its complete obligation
audit before this predicate. Byte/status/stderr checks, cleanup/rejection checks,
read-only effects, signal forwarding, unexpected-operation refusal, diagnostics
and pre-input operation checks MUST remain unchanged. The predicate adds only
`cmd22-path-domain.json`: a bound literal/resolved mapping or an INCOMPLETE
binding refusal. It MUST NOT mutate input, receipt bytes/status or event order.
A bound projection MUST NOT be reported as a semantic full-record PASS.

Every non-CMD-22 read comparison MUST remain byte-identical to the v2 comparison.
In particular FS-05 already uses absolute `/v/a`, `/v/b`; its frozen unknown
natural-language obligation MUST remain INCOMPLETE. QUE-07/FS-01 file order and
read-only prose MUST NOT be converted into new predicates. Diagnostic displayed
source membership remains literal-name matching, while before/after namespace
effects remain normalized-path matching; neither receives this conversion.

## Configuration and Integration Contract

The predecessor is source `7add5d2c0a3acb27483ba0bb5dd52385812d8ed7`, evidence
`70fa3df66f9c8dc3f972cfa8c0c5862d77d7514e`, recipe seal SHA-256
`fc273904cf20f4a717bb7350bb46046bbee16617aee371bcfd03e38d98920f15`.
The CARRY contract remains `bd471ef682d768692a682d40009a874f51e3ad68`.

`adapter.mjs` exports `prepareCmd22AssertionAdapter({ assertCaptureSource,
contextSource, integritySource })`. After separate future permission, a caller
MUST authenticate this source preseal before import and supply exact predecessor
bytes. The adapter checks their declared hashes and returns only three assertion
artifacts: modified `assert-capture.mjs`, new `cmd22-read-paths.mjs` and new
`cmd22-binding.json`. It MUST NOT materialize/import a complete recipe, change
the context or create any execution authorization.

The future composition MUST bind the actual unchanged context module, all
unchanged guards, the new predicate/data files, and exact assertion output hash.
Passing source bytes alone does not prove the loaded callback/context identity.
Future review MUST authenticate fresh candidate commit, selected source/tree,
package/tree/entry, source-to-output evidence, complete recipe seal and a new root
execution envelope. Replacing the consumed candidate pin is separately owned,
separately authorized integration work; this adapter MUST NOT relax that pin,
deadlines, admission budgets, import fence or any other guard.

## Failure Model and Recovery

The unchanged v2 host MUST retain raw-before-assert ordering, nonzero/signal/
timeout/overflow failure and the integrity-plus-known-reap continuation boundary.
The additive predicate MUST fail for a missing binding, but MUST NOT erase
earlier v2 UNFULFILLED_OBLIGATIONS failures or reinterpret old capture results.
No failure here authorizes a retry of the old candidate, an author product fix,
an additional runtime probe or a wider unknown-obligation implementation.

## Test and Validation Matrix

The static audit covers all 194 original record references and the immutable
149 declared jobs. It identifies exactly two explicit read lists: CMD-22 is
affected; FS-05 is unchanged. Four file-bearing IDs and other path-predicate
roles are classified in `PATH-ASSERTION-AUDIT.json`, not broadly rewritten.
This audit is data/source inspection, not 194 tested cases or a current gate.

| Requirement | Frozen future controls; NONE RUN |
| --- | --- |
| Original versus successor contrast | Old literal comparison expects FAIL; corrected comparison expects a projection match on the same historical capture data |
| Exact VFS domain | Literal observation, wrong cwd, sibling basename, missing/extra read fail |
| Exact input/profile binding | Mutated argv/file path, missing reads/binding and wrong cwd binding remain INCOMPLETE |
| Preserved assertions | Wrong bytes/status/stderr, effects, extra operation and signal fail; unknown obligation stays INCOMPLETE |
| Unchanged non-target role | FS-05 remains INCOMPLETE, with its absolute path list and prose untouched |
| Resolver profile only | Relative/absolute/dot/dotdot/trailing/outside lexical cases; wrong/relative/missing cwd/profile and invalid operand refuse |
| No mutation | Every deferred case retains its prepared receipt/job/binding bytes and operation order after assertion invocation |

`DEFERRED-CONTROLS.json` freezes 31 cases. `deferred-fixtures.mjs` provides
explicit preparation/invocation functions without a top-level runner. A future
driver MUST authenticate real v2/successor modules, preserve raw inputs before
calling them, and obtain separate replay permission. Stub callbacks are not
framework verification. These fixtures MUST add zero original semantic IDs.

## Conformance Criteria and Open Questions

This deliverable conforms only as an authenticated, statically inspected,
unexecuted review preseal. Independent static review and any future synthetic
or fresh-candidate replay remain pending. The old failure is not rescored.
Unknown obligations, runtime coverage and source/package acceptance remain
separate. No unresolved path-policy choice is introduced; no control passes,
product passes, completion claim or GO are granted by this preparation.
