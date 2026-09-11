# Undefined identifier semantics

## Current evidence

The built runtime rejects `let undefined = 7; return undefined` and a function
parameter named undefined. Native strict JavaScript returns 7 for both.
Assigning the unshadowed undefined binding should throw a catchable TypeError;
safe-js instead rejects the source as an invalid assignment target.

The tokenizer classifies undefined as a keyword and the parser emits an
UndefinedLiteral. This prevents identifier binding and lexical lookup.
The normal builtin installation does not currently supply an undefined slot;
low-level interpret also relies on literal evaluation to supply this value.

## Implementation and verification requirements

- Reproduce the three native comparisons in failing tests before implementation.
- Tokenize undefined as an identifier, including escaped identifier spelling,
  shorthand properties, destructuring, parameters and lexical shadowing.
- Preserve the readonly unshadowed value, TDZ and nearest-binding assignment.
- Preserve ordinary run, persistent realms and low-level interpret behavior.
- Add undefined to known runtime globals so lint accepts unshadowed reads.
- Keep UndefinedLiteral support for array elisions and legacy parsed inputs.
- Verify existing completed and suspended snapshots whose source refers to
  undefined: reparsing old source must not lose access to the default value.
- Do not add implicit cells to every Scope without checking snapshot hydration
  and exact frame-shape compatibility. Choose the binding installation point
  after testing the low-level and restored-scope paths.
- Keep this separate from writable built-in bindings and globalThis semantics.

No implementation has been made. The writable-global full regression inputs
remain frozen while its second full run is active.

## Restored-scope investigation

allocateGuestScopes creates empty Scope instances; hydrateFrame explicitly
rejects instances containing any binding. Therefore unconditional constructor
insertion would break existing restoration. Both typeof and update-expression
evaluation already consult Scope.lookup, and assignment resolves the nearest
real binding before checking const/TDZ. A root lookup fallback for unbound
undefined, paired with readonly assignment behavior only when no real binding
exists, is a candidate that preserves empty frame allocation and legacy scopes.
It still needs red/green tests for direct Scope use, lexical TDZ, updates,
compound assignments and round-trip restoration before adoption.

An expanded native-versus-built probe confirmed eight additional parsing
failures: escaped binding spelling, object shorthand after shadowing,
destructured binding, shadowed increment, TDZ read, unshadowed increment,
unshadowed compound assignment and a defaulted arrow parameter. Native
results were respectively 7, 7, 7, 8, ReferenceError, TypeError, TypeError
and 7. Existing typeof and sparse-array behavior passed as controls. Retain
these controls alongside the new failing cases in the eventual test suite.

## Candidate implementation

The corrected baseline 48961 reproduced 13 failures with three passing
controls. The initial test draft used a nonexistent parseModule export; that
test-only mistake was corrected to parse before recording this baseline.

Undefined now tokenizes as an identifier. Scope supplies a readonly virtual
default only after exhausting real lexical bindings; assignment to that
unbound default throws TypeError. This preserves empty snapshot frame
allocation, lexical TDZ, shadowing and low-level interpreter use. Lint now
recognizes undefined as a runtime global. UndefinedLiteral evaluation remains
available for array elisions and legacy parsed values.

Run 63040 passed 53 focused binding and lint cases. Repeated JSON closure
round trips passed for both the default and a shadowed undefined binding
(19562). The initial parser/scope run passed 847 tests and found one assertion
requiring the old UndefinedLiteral node. It now requires Identifier with the
same exact span; a rerun is in progress. Broader validation remains before
commit/push.

The parser/focused rerun 7527 passed 824 tests, with one existing skip.
Full safe-js run 38060 is now active with frozen source/tests and only the
two previously documented exclusions. Build 46999 and ESLint 48220 are also
in progress.

Remote main advanced to 1ae8f83e2 through three safe-bash delivery commits;
fetch and merge-base verified it contains 06e36f887 and c18d71b44. Their
superseded release runs were cancelled. Track replacement CLI 34190587993
and scoped 34190587931. Do not fast-forward the local working tree while the
current full run is reading it.

Build 46999 passed its 23-workspace closure and four fresh imports. Candidate
ESLint 48220 passed. Node 18.18 built smoke checks passed shadowing, readonly
increment, defaulted parameters and the unshadowed default. The complete lint
test directory passed 551 tests across 43 files (28874).

Full run 38060 has emitted failure markers but has not produced its final
report. Do not infer the failing cases from those markers or push until the
actual failures are diagnosed. Source and test inputs remain unchanged.

## Full-run findings

Run 38060 completed with 19,939 passes, 11 failures and 41 skips (671 files,
428.80 seconds). Seven failures reproduced in the focused run 14445:

- Five preserved v6/v7 histories fail source-hash comparison. hashSource hashes
  the parsed AST, so replacing UndefinedLiteral with Identifier changes hashes
  despite unchanged source. Preserve genuine historical hashes without editing
  fixtures or relabelling their execution semantics. Property-name identifiers
  named undefined already existed, so blindly rewriting every such identifier
  during hashing would not reproduce the historical AST correctly.
- Two async-generator suspended/done snapshots fail guest heap reference-kind
  validation at heap entry 517. Their source does not mention undefined; the
  failure may relate to the preceding trusted-reaction replay change and needs
  separate concrete diagnosis. Do not weaken heap validation.

The other four failures are in input-error-projection child-process tests;
the visible errors report missing tiny-mcp-client build output. The build was
running concurrently with this full test run and rewrites dist directories.
Repeat those tests after builds finish, and sequence all future full test runs
after builds, not concurrently. The oversized child-process error output was
truncated; do not claim complete details of every child failure until rerun.

Scoped workflow 34190587931 succeeded and publication is verified from its log:
@poe-platform/safe-js@0.1.429 at 2026-09-08T05:31:02.8729241Z. That remote main
contains both previously delivered improvements. CLI 34190587993 remains under
monitoring. The undefined candidate remains uncommitted.

## Historical hash repair

The async-generator readiness regression was repaired and delivered separately
as adab431e452ea60eb218c6f066ee8c6ade494657, verified on remote main. Its scoped
release 34191392561 and CLI release 34191392777 are running.

Hash regression 54052 reproduced the changed undefined-expression hash while
property, method and import-name controls passed. Hash traversal now retains
the historical UndefinedLiteral encoding for the new undefined identifier
expression without altering the AST. Noncomputed property keys/member names
and import/export names retain identifier encoding. Run 66792 passed 109 tests,
including all five original v6/v7 history failures without modifying fixtures.

An additional unaliased-import control failed in 6759: historical parsing
already allowed the imported/local name undefined. The hash visitor now also
preserves ImportSpecifier.local. The expanded parser/history rerun is active;
lint, build and a new full run remain. Build must finish before full tests.

Expanded run 6708 passed 889 parser/history/binding tests, with one existing
skip. All preserved historical fixtures remained unchanged. Candidate lint
33357 is still active; the maintained build has started after the focused
tests finished. Do not begin full tests until that build exits successfully.

Build 55687 and lint 33357 passed. Node 18 built controls passed historical
hashes and shadowed undefined updates. Full run 56327 started only after the
build exited; its source/tests remain frozen. Verbose output is filtered to
omit successful per-test lines and oversized data-URL errors, while pipefail
preserves the test command's exit status and the final summary remains visible.

Generator readiness publication is verified: workflow 34191392561 succeeded,
publishing @poe-platform/safe-js@0.1.430 at 2026-09-08T05:42:37.6375251Z. Its
CLI workflow 34191392777 remains under monitoring.

## Final candidate gate

Frozen full run 56327 passed: 670 files passed and one skipped; 19,956 tests
passed and 41 skipped, in 485.44 seconds. Builds were complete before it
started. The two documented unrelated red-file exclusions remained unchanged;
no timeout, workload, assertion or historical fixture was weakened.

This gate includes the historical hash repairs and the separately delivered
generator readiness repair. Together with passing candidate lint, maintained
build and Node 18 smoke checks, the undefined identifier change is ready for
its own atomic commit and direct main push.
