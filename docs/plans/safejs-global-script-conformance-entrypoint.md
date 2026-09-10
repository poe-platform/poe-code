# Global Script execution for conformance

The pinned [Test262 interpretation contract](https://raw.githubusercontent.com/tc39/test262/419d3e0a2273ba01a3bfcbec423f2801425b8e93/INTERPRETING.md)
requires fresh realms and global Script evaluation by default. It separately
specifies harness order, strict/non-strict modes, raw files, negative error
phases, module dependencies and asynchronous completion signals.

Before building a maintained corpus route, establish a faithful entry point.
The SDK currently parses executable modules and gives their execution scope a
function boundary. Indirect guest eval instead creates eval scopes and hoists
declarations as deletable. Neither source wrapping nor indirect eval should
be assumed equivalent to global Script evaluation.

## Admission probes

The isolated `src/script-entrypoint-admission.test.ts` compares strict/sloppy
global var descriptors and persistent lexical declarations against indirect
eval. It is a validation-adapter probe, not a claimed SafeJS runtime defect.

The first probe failed in its native control: ordinary `node:vm` contextified
globals report newly declared var properties as configurable (82add4). A
standalone check comparing that context with `vm.constants.DONT_CONTEXTIFY`
confirmed true versus false (ef3857). The corrected probe uses the latter for
its global Script descriptor oracle. This correction is not a runtime repair
or permission to reinterpret corpus failures.

Current main remains fixed under full package run 28827. All probe changes are
isolated. A future entry point needs nondeletable global var/function bindings,
persistent global lexical bindings, Script completion and appropriate parse
rules, independently of existing eval semantics and module execution. Its
behavior, realm isolation, asynchronous lifetime and error phases must be
qualified before upstream cases can count as conformance evidence.

The corrected three-case probe passed (54139, terminal 1efdc9), report
`/tmp/safejs-script-entrypoint-admission-corrected.json`. Non-strict Script var
properties are nonconfigurable, unlike indirect eval; strict Script var exists
on the global while strict eval var does not; Script lexical declarations
survive subsequent Script evaluation while separate eval calls do not retain
them. SafeJS matches native eval in these probes. Preserve that behavior and
implement/qualify a distinct global Script route rather than changing eval to
make an invalid conformance adapter appear to work.

## Isolated implementation contract

Start with an internal interpreter Script mode, distinct from the module SDK
and eval paths. A conformance host owns fresh builtin bindings and a reusable
global lexical scope; the mode supplies parsed Script strictness and completion
semantics. This is not a published new SDK/CLI API or a completed corpus runner.
Before implementation, `interp/global-script-execution.test.ts` probes strict
and sloppy var/function attributes, top-level this, unresolvable assignment,
statement completion and lexical persistence. Declaration conflict ordering,
realm ownership, error phases and async lifetime require subsequent controls.

All eight initial Script acceptance cases failed on the baseline (44940,
terminal 4c8867). The isolated candidate adds `InterpretOptions.script`
strictness/completion and tracks the Script scope for nondeletable top-level
functions. Global var creation honors the existing `deletable` option instead
of always creating configurable properties. No main runtime files changed.
The initial three-file selection passed 38 cases and failed top-level this
(78248, terminal a56a26). Review found a host setup error: builtin binding maps
do not expose the realm global as `bindings.globalThis`; it lives in the
private builtin global table. The test host now binds this through the existing
`getRealmGlobalObject(budget)` API and keeps its identity assertion unchanged.
The corrected selection is running; broader Script declaration validation and
existing eval compatibility still need qualification before integration.

The corrected initial selection passed all 39 tests (80157, terminal af75bc),
including the eight new Script cases and existing eval declaration/completion
tests. This is only initial execution coverage, not a complete Script host,
upstream runner, or public SDK feature. The candidate remains isolated.

Six declaration-conflict controls found five candidate failures. After using
the interpreter's existing surfaced-error option, the authoritative baseline
still has five failures and nine passes (28330, terminal 325a5b): four invalid
declarations incorrectly succeed, and a rejected function leaves an earlier
global var behind. One native Node control reports SyntaxError where
[GlobalDeclarationInstantiation](https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-globaldeclarationinstantiation)
requires TypeError; the test records that native difference but retains the
normative TypeError expectation for SafeJS. The unmodified nonextensible-global
control already passes.

The isolated candidate now checks lexical/restricted-global conflicts and
global declaration eligibility before hoisting. A five-file Script/eval
selection is running. No main changes or publication follow from this work.

The five-file selection passed all 76 tests (21398, terminal 68e3a8), including
all six conflict controls and existing eval declarations/completions. This
repairs the validated initial conflict cases only. Legacy block functions,
declaration initialization ordering beyond these cases, realm/callback
ownership, error-phase reporting, async lifetime and broader compatibility
still require qualification. The candidate is not integrated or committed.

Legacy-function probes reproduced three candidate failures and seventeen
passes (9797, terminal 860cfd): executed/unexecuted sloppy block declarations
did not create their extra global vars. A nonextensible-global control found
another native discrepancy: Node 22 throws, whereas the specification's legacy
CanDeclareGlobalVar check skips that extra binding. The test records the native
TypeError while requiring SafeJS to keep the function block-local.

The isolated shared helper now accepts an explicit deletion policy. Script
mode prepares nondeletable legacy vars and checks global eligibility; eval
keeps its previous deletion policy. The five-file selection passed all 83
tests (83412, terminal 1933e6), including strict/shadowing/repeated-function
controls. Broader eval/snapshot compatibility and scoped lint/TypeScript are
running. No main runtime changes, commit or release of Script mode occurred.

The broader eval/snapshot selection passed all 360 tests across 32 files
(64485, terminal 686a8f), report `/tmp/safejs-global-script-eval-compatibility.json`.
Scoped eslint and TypeScript also passed (79895, terminal 325760). The reviewed
delta is opt-in internal Script mode plus declaration-policy support, not a
replacement for the module SDK or existing eval. Persistent realm ownership,
pending async work across successive Scripts, and a maintained Test262 host
remain unqualified; these passes do not establish a complete conformance route.

Four additional lifetime checks cover earlier functions observing later lexical
writes, cross-realm function ownership, ready Promise reactions, and a pending
async function resolved by a later Script. The initial host passed 24 cases and
failed the last with the reentry guard (37335, terminal dfe6c6): each evaluation
attempted independent execution ownership while the earlier function remained
pending. The host now retains one explicit compile owner and job queue per
realm, passes that owner to parsing/evaluation, and releases it at teardown.
The reentry guard is unchanged. All 25 Script tests pass with that ownership
(99181, terminal b126b4), report `/tmp/safejs-global-script-owned-lifetime.json`.
Timeout/cancellation cleanup and a maintained upstream host remain outstanding.

The pending-work cancellation check now passes in the isolated candidate: an
aborted Script async function runs its `finally`, rejects with the cancellation
reason, and releases its compile ownership so a new owner can be acquired after
realm teardown. All 26 Script tests pass (12869, terminal c9d4ce), report
`/tmp/safejs-global-script-cancellation.json`. This required only adding signal
support to the test host and a regression, not changing cancellation or reentry
guards. It does not qualify every timeout path or supply the maintained upstream
conformance host. Scoped lint and TypeScript passed (67285, terminal d255a9).

Error-phase checks distinguish parse rejection (no preceding assignment runs)
from runtime rejection (preceding assignment remains visible to the next Script).
The first run passed 79 cases and failed the strict-mode native control
(39300, terminal 09b827): prepending an assignment moved `"use strict"` out of
the directive prologue. The corrected fixture keeps its directive first; no
runtime changes were made to accommodate that test-host mistake. The corrected
Script/parser selection passed all 80 tests and test lint passed under 84982
(terminal c87cd8), report `/tmp/safejs-global-script-error-phases-corrected.json`.

Five additional native-controlled initialization probes cover a later lexical
binding left uninitialized after a throw, an accessor preserved by `var`, an
accessor replaced by a global function, an inherited property shadowed by a
new global var, and a lexical binding shadowing a configurable global property.
The standalone native controls completed (dea429); all 39 isolated Script
tests passed (36426, terminal add49c), report
`/tmp/safejs-global-script-initialization.json`. These qualification probes
found no additional defect and required no runtime edits.

The expanded Script/parser/eval/snapshot compatibility selection passed all
424 tests across 33 files (65173, test output a89059), report
`/tmp/safejs-global-script-final-compatibility.json`. Its chained test lint
passed (terminal df19f0). The earlier suspected strict global var assignment issue was
not established: `assignVar` is used for legacy block-function propagation;
ordinary declarations use `bindPattern`, which propagates execution strictness.
Do not repair the legacy helper on that mistaken premise.

Repository inspection still finds targeted Test262-style examples, not a
maintained upstream corpus route. The next host layer must keep parsing,
declaration instantiation, execution, and asynchronous completion distinct;
load harness files in order in the same fresh realm; preserve strict/raw/module
metadata; and report unsupported host capabilities and excluded cases instead
of counting them as passes. These obligations remain open after the internal
entrypoint's focused qualification. No Script runtime changes are on main yet.

## Main integration

Main's preceding full gate finished (28827, terminal 6f88d7): 28,864 passes,
13 failures confined to the known ISO locale and Promise symbol gaps, and
47 skips. Source/tests were held fixed through completion. The new Script
regression then reproduced 32 failures with seven passing controls on main
(37309, terminal 9a9670), report `/tmp/safejs-global-script-main-red.json`.
The reviewed four-file implementation was applied afterward. Main
Script/parser/eval/snapshot qualification is running under 23450, report
`/tmp/safejs-global-script-main-integration.json`; scoped lint followed by the
maintained workspace build closure is running under 53739. No commit, push,
release, or full conformance claim follows until the relevant checks complete.

Main compatibility passed all 424 tests across 33 files (23450, terminal
3c303f). Scoped lint passed and the maintained build closure reached the
SafeJS build. The maintained closure subsequently completed all 23 builds and
all five fresh-process import checks (53739, terminal d0a0d3). Main's internal
Script entrypoint is qualified for its scoped commit; complete corpus execution
and the two independently unresolved full-suite failure categories remain open.
