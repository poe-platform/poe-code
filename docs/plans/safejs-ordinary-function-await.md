# Await in ordinary functions

## Main integration

After full integration session 63590 became terminal, main reproduced 12
failures and 20 passing controls across the ordinary-await and restored-source
regressions (e094bf). The independently qualified await/restore changes are now
applied on main, without the separate module-source budget repair. README
documents diagnostic parsing versus executable validation.

Focused main execution/restore/lint verification passed all 172 tests across
seven files (57879d, session 47996 terminal). Targeted lint and TypeScript
passed (22a269, session 84518 terminal). Ready for its separate local commit.
No push or release occurred.

## Validated gap

A 288-case native/parser exponentiation grammar audit found seven mismatches
(including duplicate generated expressions), all involving await in ordinary
non-async functions. Isolated regressions reproduce six failures: declarations,
function expressions, concise/block arrows, object methods, and ordinary
functions nested in async functions. Class methods already reject await.
Five async-function controls pass; total initial result is six failures and
six passes (07b58f).

Separate unary/update runtime auditing found no mismatch in 60 comparisons
covering getter/setter order, primitive coercion hints and abrupt completion
(a940e1). This does not prove complete operator conformance.

## Candidate

`/tmp/safejs-ordinary-await.FLzjq2` is copied from main runtime a5919f095.
Main runtime/test files stay unchanged while integration session 63590 runs.
The candidate rejects an AwaitExpression when functionContext is normal,
after the existing generator/parameter restrictions. Contextual identifiers,
top-level await and async bodies retain their existing parsing paths.
The complete candidate parser selection is running in session 58391; inspect its result
before integration and investigate compatibility failures rather than deleting
tests or assuming all accepted syntax was an intended extension.

## Revised execution-only candidate

The isolated candidate now sets a requireAsyncAwait lexical flag only from
parseExecutableModule. Nested lexical contexts inherit it, and template
subparsers receive the same context. The ordinary-function guard checks this
flag; parseModule remains available for lint recovery. No new public parser
option or lint bypass is exposed.

The first focused run restored all 120 maintained lint checks and passed the
new syntax cases (133 passes total); one new assertion incorrectly expected an
async return value to be automatically unwrapped. The fixture now explicitly
awaits the autofixed function, preserving Promise semantics. This was a test
expectation correction, not a runtime change (178b3c).

Full candidate parser/lint validation passed 2,283 tests with one opt-in skip
across 122 files (eec4af, session 80076 terminal). Targeted lint/TypeScript
passed (0a24b4, session 21947 terminal). The candidate regression file
now checks parseExecutableModule, includes template substitutions, and tests
diagnostic parsing, autofix and public execution together.

## Restored module-source validation

Both public-run and low-level interpreter restoration accept an unreferenced
stored module containing an invalid ordinary-function await. Corrected paired
regressions reproduce two failures after valid async-source controls pass
(33a11c). The first low-level fixture had no heap; it now reuses the existing
captured-dynamic-function fixture so its failure reaches the source validator.

The candidate createModuleSource now uses parseExecutableModule, which is
shared by both restoration validators. This preserves diagnostic parsing for
lint but enforces executable syntax for stored module bodies. Focused source,
restore and dynamic-function verification passed 168 tests across five files
(3dae16). Targeted lint/TypeScript remains running in session 6879. Main remains
unchanged. Verify error classification before completion: ParseError extends
Error, while restoration currently wraps only SyntaxError as invalidValue.
The new rejection tests currently assert rejection, not its exact public type.

Follow-up error-type regressions fail twice (a63611): both restore paths leak
ParseError. The candidate now wraps ParseError alongside SyntaxError in the
existing source-record validators, leaving other failures untouched. The
initial focused set passes 57 tests (b09fcc).

Root-source restoration also bypasses the guard: a restored ordinary closure
containing await executes and returns 1 (722433). Two direct root-closure
regressions reproduce the acceptance (4b662b). Candidate low-level restore now
uses parseExecutableModule to index the root source, not diagnostic parsing.

Fatal-error controls now use a long regex literal to exercise the existing
module compilation work guard. A long comment and 2,000 empty statements did
not exhaust maxSteps=1,000; inspection confirms CompileScope meters regex
compilation, not ordinary source scanning. Do not claim general module-source
work accounting from these tests; that remains a separate resource audit.

The final focused source/root-restore/ordinary-await selection passes all 52
tests (75ad04), including the regex compilation-budget controls. Earlier
lint/TypeScript checks passed (b657ec), before the root-restore import change.
Expanded snapshot verification and fresh root-restore lint/TypeScript are now
running. No candidate change has been integrated on main.

Qualification correction: session 79184 started before the subsequent
source-error classification and root-restore changes. Its final result cannot
qualify the current candidate, because sources changed during that broad run.
Let it finish, then run fresh fixed-source snapshot verification. Session
85037 completed successfully on a later poll; repeat static checks for the final
candidate rather than extending that result to later edits.

Session 79184 is terminal with 2,283 passes across 162 files (3020f3), retained
only as exploratory evidence because sources changed. Fresh fixed-source
snapshot qualification is now running in session 45410. Do not edit the
ordinary-await candidate until that run finishes.

Fresh session 45410 is terminal: all 2,283 snapshot tests pass across 162 files
(d3b7bc), with candidate sources fixed throughout. This replaces the earlier
exploratory broad-run result for snapshot qualification.

A third isolated copy, `/tmp/safejs-await-module-combined.fQq7Bt`, combines this
candidate with the independent stored-module budget repair and its tests.
Parser, lint, snapshot and restore qualification is running in session 96601.
Keep that copy fixed for the run. The two original candidates remain separate;
do not copy the combined dynamic-source file into a single atomic commit.
Combined session 96601 is terminal: 4,560 passed, one opt-in skip across 284
files (584485). Its targeted lint/TypeScript checks also passed (b678e1).

## Earlier blanket-guard investigation details

The initial blanket guard is not suitable for integration. Its parser suite
passed 1,645 tests with one opt-in skip (7d8fee), and lint/TypeScript passed
(a509ad), but maintained lint behavior fails: 11 failures and 109 passes across
four lint files (e706dc). AS-MISSING-ASYNC intentionally uses parseModule's
recovery behavior to diagnose and autofix these invalid forms. Preserve that
workflow. Public execution really is affected: unchanged main executes both
an ordinary declaration and arrow containing await and returns 1 (2c523d).

A TypeScript-AST scan of existing static test source literals checked 1,716
parseable await-containing strings; 19 change acceptance under the blanket
guard, concentrated in missing-async lint tests and a dynamic-function invalid
case (34b328). This scan excludes interpolated/dynamically assembled source.
The candidate public API rejects three invalid forms and preserves top-level
await, async execution, and two dynamic contextual-identifier controls (95bc36).

Next repair should enforce the restriction at executable parsing while
retaining lint recovery, using the existing parseExecutableModule/parseModule
boundary rather than weakening or deleting diagnostic/autofix tests.

- Confirm parser regressions and contextual await identifier controls.
- Inspect runtime tests and documentation for intentional legacy acceptance.
- Run lint/TypeScript and relevant execution/checkpoint checks.
- Audit restoration and serialized dynamic-source entry points that use
  parseModule before claiming all execution paths enforce the restriction.
- Integrate only after the current main package run ends, with red/green tests,
  README update and its own local commit. No visual CLI change is involved.
- No push or release while publication is on hold.
