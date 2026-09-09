# Guest dynamic functions and eval

## Mapped arguments follow-up (September 8)

Reproduced the six current dynamic-runtime failures before changing implementation.
Non-strict simple-parameter calls now use an internal mapped arguments object,
with data descriptors backed by parameter cells. Duplicate names map only the
last formal occurrence, and deleting or making an index non-writable disconnects
its mapping. The callee is the guest closure, never a native function.

Native comparisons cover freezing after parameter assignment, accessor conversion,
failed deletion, and Reflect.set with a different receiver. The focused runtime,
strict arguments, and low-level mapped arguments run currently has 58 passes and
one snapshot failure. A separate failing quota test demonstrated that the retained
scope was missing from data measurement; that scope is now traversed.

This remains uncommitted implementation work, not a completed runtime release.
Snapshots currently reject the mapped callee as a replaced strict accessor; they
need explicit mapped-object state and scope references, as well as the outstanding
dynamic AST source identity work. Host-boundary argument copying also still uses
the strict-object allocation path and needs coverage before delivery.

The maintained 23-workspace build and four fresh-process import checks pass, as
does focused lint. All 216 existing function/generator regression tests pass.
Built Node 18.18 and Node 24.14 each match native execution for 32 mapped-arguments
cases across all four constructor kinds.

An explicit deepCopyFromSandbox test now reproduces a host-export failure:
`Unsupported proxy sandbox value`. The earlier run-return test did not exercise
that boundary and has been renamed accordingly; it is not export evidence.
Low-level mapped-arguments tests currently have three passes and this one failure.
The expanded dynamic-runtime suite has 42 passes and the snapshot failure.
No runtime commit or push has been made while these boundary failures remain.

## Mapped arguments snapshot and export integration

The internal mapped proxy is now explicitly admitted for host export without
admitting arbitrary proxy wrappers. Unrestricted arguments copy into a matching
data-callee allocation, preserving deleted callee properties and cycles while
disconnecting copied values from parameter aliases. A failing symbol-property
copy regression was fixed by copying non-internal symbol data descriptors too.
A replaced callee accessor is rejected under the existing data-copy policy;
it must not be silently discarded or invoked during copying.

Mapped arguments now have a dedicated guest heap record containing their scope,
parameter map, and full property-descriptor state. The native default iterator
uses an explicit validated marker, not a serialized native function. Restoration
reconnects parameter cells after scope hydration. Native iterator descriptors,
symbol properties, frozen/deleted/read-only indices and scope cycles are tested.
Seven forged-record tests cover bad bindings, duplicate mappings, invalid indices,
read-only mappings, invalid scopes and scope references exposed as guest data.

The full snapshot suite passes: 1,474 tests in 91 files. The maintained build
passes 23 workspace builds and four fresh-process import checks. Scoped lint
passed before the last small host-copy edits; a focused follow-up is running.
The public dynamic-function snapshot regression is separate and still fails on
dynamic AST identity. No complete dynamic-runtime delivery is claimed.

## Dynamic source ownership

Dynamic functions now retain a shared private source record and node namespace.
Snapshot records reference that source for functions, classes, generator frames,
and cached template arrays. Both public restore validation and direct heap restore
parse each source namespace independently of the original script. Source records
cannot be exposed as guest data, and forged kinds, syntax, references and node IDs
are tested. The direct closure-restore test invokes the restored closure itself,
not just a replayed script.

Expanded public snapshot cases cover independent sources with colliding local IDs,
nested closures, async functions, generator frames, classes, regex literals, cached
templates and async generators. A retained-source quota regression initially
measured zero additional bytes for a 16,384-character comment; source text and
node counts are now included once per shared source record in retained data.
The focused source/runtime run reached 59 passing tests before additional
non-strict assignment comparisons were added. Those comparisons exposed unresolved
identifier assignment incorrectly throwing in non-strict dynamic functions; the
implementation now carries strictness into function execution and creates the
global property for plain non-strict assignment. Expanded verification is running.

Remaining pre-delivery checks include compilation lifetime/accounting, additional
non-strict assignment forms and failed writes, direct suspended-frame restoration,
the broader maintained package tests, and clean surgical staging that excludes
the unrelated weak-collection work. This is still uncommitted runtime work.

The latest public dynamic-function suite passes 55 tests, and the direct source
heap tests pass six. The broader snapshot/function regression run passes 1,696
tests in 97 files. TypeScript no-emit passes after the non-strict assignment change;
the preceding maintained workspace build and scoped lint also passed. The full
maintained SafeJS workspace unit route has now been started for broader coverage.
SafeJS 0.1.479 was published from the separate safe-bash artifact-cleanup commit
f43a72a1; it does not contain this uncommitted dynamic runtime implementation.

## Non-strict assignment follow-up

Native comparisons reproduced seven additional failures: unresolved identifiers
in array/object destructuring and for-of assignment, plus rejected writes to
read-only, non-extensible, getter-only and frozen-array targets. Pattern binding
now receives the canonical global assignment target only in non-strict execution.
Property assignment carries an explicit throw-on-failure flag; language writes
can fail silently while built-in mutation operations retain their throwing rules.
Setter exceptions still propagate, and strict-mode assignments still throw.

Further native cases cover update-result values, inherited descriptors, immutable
array length, partial array truncation, primitive receivers, Object.assign and
Array.push. Three class initializer cases then exposed inherited non-strict
execution in instance fields, static fields and static blocks. Class evaluation
and constructor field contexts now explicitly retain strict semantics.
The constructor/assignment suites now pass 80 tests, including snapshots taken
inside active async functions and async generators. Existing class/pattern tests,
final lint and the full maintained package unit run remain under verification.

The existing class, private-element, accessor, default-name/export, for-of and
pattern suites pass 269 tests in seven files. The maintained 23-workspace build
and four fresh-process import checks also pass. Final lint is still running.
The full workspace unit run remains active and has emitted failure indicators;
its terminal failure summary must be inspected before delivery.

Runtime delete comparisons exposed rejected non-strict identifier deletion and
throwing non-configurable property deletion. Those runtime cases now pass, using
binding lookup for identifier results and explicit non-throwing property deletion.
The separate strict-delete parser rule was committed and verified on remote main
as 5fb116b1c39163bcd2b80fa8724c356ab26b1d80; its scoped and CLI releases are running.
Static-import grammar was then independently reproduced and is being verified as
another atomic parser change. Neither parser commit includes the runtime WIP.

## Revalidated gap

The installed NumberFormat candidate returns `undefined` for typeof Function and
typeof eval. Function("a", "return a + 1")(2) and eval("1 + 2") both fail with
UNBOUND_IDENTIFIER. This confirms the existing gap audit against current code;
neither is implemented by the NumberFormat work.

## Boundary to preserve

Any implementation must parse and execute guest code through SafeJS. Never expose
host eval, host Function, or an indirect native function-constructor chain. The
existing realm evaluation API is not automatically a correct implementation of
direct eval: it has different entry, scope, and authorization semantics.

## Evidence required before implementation

- Function constructors resolve free bindings in the guest global environment,
  not the caller's local lexical scope. Direct eval and indirect eval have distinct
  scope semantics and require separate tests.
- Validate ordered parameter/body coercion and separate grammar validation; test
  comment and delimiter boundary injection rather than trusting concatenation.
- Cover defaults, destructuring, rest, strict-mode restrictions, newTarget,
  constructor/prototype identity, and exact function-source presentation.
- AsyncFunction, GeneratorFunction, and AsyncGeneratorFunction constructor paths
  must not bypass the same guest compiler, grants, and resource limits.
- Account for source text and compilation before allocating parsed state; preserve
  execution budgets and source/AST identities across repeated snapshot restore.
- Negative tests must prove that dynamic code cannot obtain process, require, host
  globals, filesystem access, or capabilities absent from its guest environment.

## Current implementation evidence

The public dynamic-function regression suite now has 17 failing tests against the
current worktree, covering construction, metadata, global scope, this binding,
argument coercion, grammar boundaries, guest regexes, fatal budgets, and closure
snapshot replay. Function is still absent; these tests are not a delivered feature.

The shared parser has an independently reproduced prerequisite defect: non-simple
parameters with a use-strict directive were only rejected for setters. The fix and
its own verification are tracked in safejs-function-strict-parameters.md.

Inspection confirms that guest-function snapshots currently resolve astNodeId only
against the original root source. Dynamic compilation needs a source identity that
also survives for nested closures and generator frames; adding a constructor alone
would leave replay broken. Scope lookup already supports a guest global object
environment, but dynamic functions must not capture the caller's local frame.

Use the CreateDynamicFunction algorithm at
https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-createdynamicfunction
for separate parameter/body parsing and constructor/global-environment semantics.

The uncommitted parseDynamicFunction entry point now uses three guest-parser passes:
parameters, body, and the combined function expression. It preserves the canonical
source range, permits guest regex literals, rejects import.meta, and checks source
length/work against a supplied compilation owner. It is not wired to a global.
Eight initial compiler tests pass (covering all four kinds and boundary cases),
but duplicate simple parameters remain incorrectly rejected. Expanded contextual
grammar comparisons also expose await/yield identifier handling, ordinary-function
await acceptance, and strict eval/arguments parameter errors. These are required
compiler work, not grounds to weaken the native comparisons or publish the feature.

The parser's existing parameter context replaces the enclosing function kind;
dynamic grammar needs explicit Yield/Await parameter flags. Its ordinary-function
context also permits SafeJS await syntax, which is not valid Function-constructor
grammar. Preserve existing script behavior while adding the correct dynamic-source
grammar rather than using import.meta permission as a proxy for all these rules.

After expanding contextual cases into individually reported tests, the compiler
suite is 31 passing and 18 failing. Non-strict nested ordinary functions with
duplicate parameters must also be accepted, including inside async/generator
dynamic functions; inherited strictness must reject them. These failures remain
visible. No runtime constructor, snapshot format, or native-execution permission
has been changed by the compiler work so far.

## Grammar follow-up

Explicit Yield/Await/strict grammar state now distinguishes dynamic source from
the existing SafeJS script grammar. It is scoped across functions, arrows, and
classes. Directive prologues update inherited strictness without leaking out of
an inner function, and empty statements end the prologue. Dynamic statements now
enforce required separators while retaining valid automatic semicolon insertion.

A 360-case built comparison on both Node 18 and Node 24 disproved an initial test
assumption: non-strict async/generator functions also accept duplicate simple
parameters. The test now verifies that expectation against native constructors
instead of asserting a guessed restriction. The same matrix exposed strict local
eval bindings, now rejected along with other strict binding names. These changes
remain part of the uncommitted compiler work until its checks finish.

## Runtime integration in progress

The parser stage was committed and pushed as db72de23d. The new runtime bridge is
uncommitted: Function now delegates to the guest parser and createInterpretedClosure,
and an explicit Scope globalEnvironment marker selects granted bindings without
capturing caller locals. The marker is captured, validated, allocated, and hydrated
in scope-frame snapshots. Standalone interpreter scopes fall back to their root.

Parsed dynamic functions carry strictness metadata separately from their source
ranges. Non-strict calls use the realm's original global object for null/undefined
receivers and guest boxes for primitives. Duplicate simple parameters initialize
one cell in order. Coercion retention uses live root callbacks, not arrays passed
where callbacks are required.

The original public suite reached 16 passing cases and one failing dynamic-closure
snapshot case. Expanded tests retain the unfinished requirements: mapped arguments
(including descriptor/delete behavior), arguments parameter shadowing and callee,
all three async/generator constructor paths, and snapshot dynamic AST identities.
Do not publish this partial runtime bridge as complete Function support.

The expanded runtime suite currently has 20 passing and seven failing cases.
An async constructor test now checks constructor name, source prefix, Promise
identity, and absence of an own prototype property: merely awaiting a numeric
result was an insufficient oracle and had hidden the ordinary-Function fallback.
Arguments-parameter shadowing is fixed. The maintained 23-workspace build and
focused lint pass; all 1,462 existing snapshot tests across 90 files pass. The
new dynamic-closure snapshot test still fails as expected from missing dynamic
AST source identities, and remains a required implementation gate.

## Constructor-family follow-up

All four constructors now share one guest-source factory. Async functions receive
their own intrinsic prototype; generator and async-generator constructors reuse
their existing intrinsic prototype graphs. Their constructor inheritance,
subclass newTarget behavior, source prefixes, and Promise/generator results have
native differential coverage. Constructor prototype properties must explicitly
be made non-writable because closure materialization already creates that property.

The five existing function/async/generator regression files pass 216 tests after
updating constructor-absence assertions to verify guest-realm isolation instead.
The minimal-step prototype-installation test exposed real installation charges;
trusted installation now uses the same uncharged prototype path as other
intrinsics, with no budget increase. A build caught use of Iterator.some in the
arguments-shadowing check; it now uses an array operation compatible with Node 18.

Expanded mapped-arguments cases leave six runtime failures and 32 passes: alias
reads/writes and descriptors, callee, duplicate-parameter aliasing, and dynamic
snapshot identity. Delete, freeze, non-writable descriptors, and non-simple
parameter controls are retained in the suite. These counts do not prove mapped
arguments semantics until the aliasing implementation is present.

After the constructor-family changes, all 1,462 existing snapshot tests still
pass. The maintained build closure and focused lint pass. Dynamic-source snapshot
coverage is separate and remains failing; existing snapshot tests cannot certify
that new behavior.

README's limitation paragraph is historical and needs a separately authorized
update; do not modify it without the user's permission.

## September 8 full-unit follow-up

The maintained full SafeJS unit run finished with 21,489 passes, 68 failures and
37 skips. This is not delivery evidence for the runtime changes.

- Reproduced three pristine-intrinsic retention failures. Constructor installation
  now finalizes the existing trusted initialization baseline after setting links;
  guest mutation assertions remain unchanged. The three affected files plus
  dynamic constructor coverage pass 130 tests.
- Reproduced ten regex-limit failures caused by importing the parser through
  source metadata during Budget initialization. Source records now live in the
  type-only-dependent function-source module. The original limit assertions pass.
- Legacy dump expectations explicitly enumerate the newly added guest Function
  binding; original checkpoint fixtures remain unchanged. Regex policy, legacy
  f16round checkpoints, dynamic constructors and source snapshots pass 108 tests
  with one existing skip. Package TypeScript checking passes.
- Suspended intermediate roots, generator templates and data-budget checks pass.
  A further seven-file accounting/policy run passes 148 tests but still fails two
  async retained-root cases (3718/3500 and 885/500). Keep those limits intact and
  investigate the new async prototype's retained graph before delivery.
- The independent static-import grammar fix is committed and verified on remote
  main as 0be58fe279641722072fb128942504bbf9f14e71. Its scoped and CLI release runs
  are still in progress; runtime changes above remain uncommitted.

The two async accounting failures are now fixed without changing the limits.
Ordinary async closures resolve their default intrinsic prototype through their
realm and origin, just like ordinary functions, instead of persisting an explicit
guest link to the whole intrinsic graph. Explicit prototype overrides still use
the existing stored-link path. Accounting and constructor/generator checks pass
129 tests. Three added snapshot controls cover default, custom and null async
prototypes; constructor and regex-policy coverage passes 114 tests, with package
TypeScript checking passing as well.

Nine reproduced security expectation failures concerned formerly absent guest
constructors and prototype access. Tests now verify the actual guest identities
and execute constructor probes that cannot access process, require or Buffer;
the closure escape gadget still rejects with ReferenceError. All 126 tests in
the five affected files pass. The fast adversarial corpus passes in a focused
run; its full-run timing failure still needs broad verification. Two experimental
host-promise property import tests remain failing and require an explicit safe
boundary policy, not indiscriminate copying of private host symbols.

Full snapshot-directory coverage plus retained-root accounting passes 1,491 tests
in 93 files after implicit async-prototype resolution. The maintained build passes
23 workspace builds and all four fresh-import checks. Four additional controls
verify that mutations to normal, async, generator and async-generator intrinsic
prototypes are charged and released after deletion (65 constructor tests pass).
The separate static-import parser commit is published as SafeJS 0.1.484 by scoped
release run 34257389885; CLI release run 34257390141 is still in progress.
