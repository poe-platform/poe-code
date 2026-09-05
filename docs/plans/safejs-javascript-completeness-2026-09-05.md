# SafeJS JavaScript completeness

## Objective and working window

Improve SafeJS toward complete JavaScript support, identify remaining semantic
gaps, and work through them for the requested four-day window: September 5,
2026, 02:05 UTC through September 9, 2026, 02:05 UTC (September 4–8, 21:05
CDT). This is an ongoing goal,
not a claim that a few green compatibility tests establish completeness.

Each atomic improvement gets its own tests, commit, push to main, and release
verification. Continue investigating the next gap while publication runs.
Preserve unrelated user changes. Do not add README content without permission.

## Evidence and completion criteria

- Reproduce each gap on current main before editing implementation.
- Compare language behavior with the published ECMAScript 2026 specification
  and bounded native-JavaScript controls where applicable.
- Use memory-only regression tests; no LLM calls or large resource probes.
- Cover parser, runtime, lint, realm, host boundary, budgets, and checkpoint
  implications where the change reaches them.
- Run focused tests first, then maintained workspace tests and appropriate
  lint/build checks before each push. Verify exact remote-main delivery and
  successful publication separately.
- Maintain an explicit inventory: verified defect, implemented/not delivered,
  delivered/not released, released, intentional capability restriction, or
  not yet investigated. Never count untested areas as conformant.
- Full completion requires an evidence-backed disposition for every identified
  gap, broad regression coverage, and no unresolved delivery or release work.

## Initial inventory

Baseline: main `848ca91a9`, integrated without changing user-staged Bash work.

| Area | Initial evidence | Next action |
| --- | --- | --- |
| Binary `in` | Parser accepts it; interpreter rejects ordinary guest values, but has a host-object special case | Implement and test property existence across the supported guest object model |
| Classes, inheritance, fields, private members | README says user-defined classes are unavailable | Reproduce syntax/runtime boundaries and implement incrementally |
| Async generators and iteration protocols | README excludes async generators | Audit generator, iterator, async completion, and cleanup semantics |
| Symbols, primitive wrappers, BigInt | README excludes symbols/boxing; numeric breadth not audited | Build bounded differential inventory, then extend value and property models |
| Accessors and prototype graphs | README excludes inherited accessors and full callable/exotic chains | Audit descriptors, receivers, prototype mutation, and isolation |
| Built-ins | Selected APIs only; Float32Array is the documented typed array | Inventory standard constructors and methods, including collections, buffers, reflection, errors, promises, strings, numbers, Date, and Math |
| Regular expressions | Only g/i/m/s; documented exclusions include lookaround, backreferences, named groups, Unicode properties | Audit grammar/semantics and preserve bounded execution while expanding support |
| Modules | Dynamic import and automatic multi-file resolution are absent | Separate ECMAScript module semantics from host-controlled resolution authority |
| Syntax and coercion | Not comprehensively audited | Cover operators, evaluation order, bindings, strictness, early errors, and abrupt completions |
| Recovery and realms | Explicit portability and replay restrictions | Validate new features across persistent evaluations, copy/checkpoint boundaries, cancellation, and recovery |
| Host APIs, browser delivery, isolation | No ambient DOM/Node access, browser build, eval, or Function constructor | Evaluate capability-safe implementations; do not silently expose native authority or pretend OS isolation |

The README is a discovery source, not sufficient proof that every listed
limitation still exists. The bounded probes below validate specific instances;
the remainder still needs investigation. Intentional restrictions are still
tracked, not silently removed from the requested completeness audit.

### Bounded native comparisons on September 5, 2026

Each source below ran in a fresh native VM (one-second ceiling) and through the
built SafeJS core. These are open defects/feature gaps, not completed fixes.

| Reproducer | Native result | SafeJS result |
| --- | --- | --- |
| `class Item { value() { return 7; } } return new Item().value();` | `7` | Identifier `class` is not defined |
| `async function* items() { yield 1; } return typeof items;` | `function` | async function* is not supported |
| `return typeof Symbol;` | `function` | `undefined` |
| `return String(1n + 2n);` | `3` | BigInt not supported |
| `return new Uint8Array([1,2]).length;` | `2` | Identifier `Uint8Array` is not defined |
| `const object = { get value() { return 7; } }; return object.value;` | `7` | Getter shorthand methods are not supported |
| `return typeof [].toString;` | `function` | `undefined` |
| `const key = { toString() { return "x"; } }; return ({ x: 7 })[key];` | `7` | Computed property access requires a string or number key |
| `const object = { null: 7 }; return object.null;` (also `true`, `false`, `undefined`) | `7` | Unsupported static property node for the literal kind |

## Atomic work log

### 1. Binary property existence — delivered, scoped release complete

Source evidence: `evaluateBinaryExpression` only special-cases host objects;
`applyBinaryOperator` otherwise raises UNSUPPORTED_NODE for `in`.

Required checks: own/inherited/missing/undefined-valued properties, array holes,
guest function properties, supported exotic members, non-object rejection,
operand/coercion order, non-reading host membership, no native metadata leakage,
and bounded prototype traversal. ECMAScript reference: section 13.10.1 (`in`)
and OrdinaryHasProperty (10.1.7.1).

Validation is complete below; commit, verified push, and release will be
recorded separately. No completeness or release claim yet.

Initial RED: 18 failed, 1 passed. One failure independently exposed static
literal property-name handling (`{ null: 1 }` throws Unsupported static property
node NullLiteral); the membership test now uses quoted keys to isolate `in`.
The unquoted keyword-key defect remains queued as its own atomic improvement.

Implementation validation so far: 29 focused membership cases; 119 tests across
membership, function properties, lint/replay parity, and realms; the normal
workspace/root build; eight built root/core entrypoint checks; the maintained
SafeJS suite (10,133 passed, 41 skipped). Full root lint passed: 9,710 configured
files linted, zero errors or warnings, plus root TypeScript and workflow checks.
Skipped cases are not counted as passes. The one-step-under-budget regression
correctly expects the public runner to reject with its fatal budget error.
Committed and verified on remote main as
`cb1de216639fca088b61de1b1374c8c72c05fc09`. Scoped release workflow
`33938517813`, publisher job `101231110596`, succeeded; its log confirms
`@poe-platform/safe-js@0.1.85` published September 5, 2026, 02:19:02 UTC
(the shared SafeFS and Safe Bash packages also published 0.1.85).
CLI release workflow `33938517919` was canceled by the next push. Its change
is included in the successful descendant CLI release recorded below.

Existing restrictions still apply to members absent from the guest object
model (for example full exotic prototype graphs), symbols, and general
exotic-to-string coercion. These remain in the completeness inventory; this
atomic change does not pretend to implement those separate subsystems.

### 2. Keyword property names — delivered and released

Native controls and built SafeJS probes reproduce failures for literal-word
keys (`null`, `true`, `false`, `undefined`) and reserved words such as `return`,
`const`, `for`, and `in`. Object literals and both destructuring parsers use
different handling for keyword tokens; literal words become expression AST
nodes that the property evaluators cannot interpret as static names.

Treat property names as IdentifierName without widening binding/reference
grammar. Cover literals, binding/assignment patterns, parameters, defaults,
rest, escapes, lint, and completed replay. Keep existing string/numeric keys
and keyword method definitions unchanged. ECMAScript reference: 13.2.5.4,
LiteralPropertyName : IdentifierName.

RED: 39 failed, 15 passed. The fix uses identifier-name AST nodes for keyword
data keys and keeps shorthand/binding rejection separate. Focused coverage:
155 passed. The normal build and twelve built public-entrypoint checks passed.
The first full suite found one historical expectation that `{ return: 1 }`
must fail. Native compilation confirms it is valid; that assertion now checks
the accepted property AST while retaining reserved binding/shorthand failures.
Final full-suite rerun passed: 10,187 tests, 41 skipped. Full root lint passed:
9,711 configured files, zero errors or warnings, plus root TypeScript and
workflow checks. Committed and verified on remote main as
`00bfb59310ce57c0156f362b4328bab076a75449`. Scoped workflow `33938935424`
and publisher job `101232337963` succeeded: SafeJS 0.1.86 published
September 5, 2026, 02:27:48 UTC. CLI workflow `33938935543` and publisher
job `101233757704` succeeded: `poe-code@14.0.40` published to latest
September 5, 2026, 02:35:38 UTC. This CLI release includes both atomic changes.

### 3. Restored function execution kind — delivered, scoped release complete

While investigating computed-key coercion through restored methods, a bounded
serialized-closure probe reproduced `target() + 1` returning
`"[object Object]1"` instead of 8, followed by a compilation-owner reentry error.
The restore path marks every closure async and retains the restore-time owner
instead of using the active caller's owner. This is a distinct internal defect,
not part of computed-key coercion.

Initial regression suite: seven failed, one passed. Preserve source async
metadata, guest exception identity, caller compilation ownership, nested
execution, and returned compiled values. Keep synchronous internal execution
promises separate from guest async promises. Six historical test cases expected
the incorrect guest-promise wrapper; their result assertions now match source
function kind. Eleven focused regressions cover declarations, arrows, named
expressions, return identity, thrown identity, recursion, constructors, genuine
async results, async ordering, thenable adoption, and fatal recursion limits.
The focused restore/async cohort passes 97 tests.

The additional async-ordering control passed without a new async-prefix helper.
The proposed extraction was removed from this synchronous-function fix.
The normal build passed, as did six built-module checks including returned
regular expressions and default/destructured parameters. The maintained
SafeJS suite passed 10,198 tests, with 41 skipped. Full root lint passed:
9,712 configured files linted, zero errors or warnings, plus root TypeScript
and workflow checks. Committed and verified on remote main as
`a1d6a0ba6588db8e07f7b6d063b5eb30a458da35`. Scoped workflow `33939788191`
and publisher job `101234818953` succeeded: SafeJS 0.1.87 published
September 5, 2026, 02:45:18 UTC. CLI workflow `33939788323` was canceled
by the next push; it is not counted as a successful CLI release.

### 4. Restored async completion — delivered, scoped release complete

A stronger built-module probe found a separate defect after the synchronous
fix: a restored async function with four pushes before its first await produces
`[1, "caller", 2, 3, 4, "after"]`; native JavaScript produces
`[1, 2, 3, 4, "caller", "after"]`. Inspecting the restored async promise
directly also reveals that returning a guest thenable resolves to the object,
not its adopted value 7. The earlier await-based control masks this because
the caller's await adopts the thenable. These are validated follow-up work;
the preceding change does not claim complete restored async semantics.

RED: two failures and ten passes after strengthening the prefix test and
checking the async promise directly. Extract the established async execution
machinery and use it for restored async closures, preserving fresh-function
signal handling, allocation accounting, thenable resolution, and job behavior.
Pass the first-suspension notification through nested body interpretation.
The focused restore/async cohort passes 102 tests, including expanded checks
for async declarations, arrows, named expressions, and return/throw completion
before any await. Build the explicitly selected SafeJS workspace dependency
closure, then run its maintained full suite and full root lint. No unrelated
root build stages need changes for this package-internal fix.

Final validation: the selected workspace build closure and four built-module
checks passed. The maintained suite passed 10,203 tests, with 41 skipped.
Full root lint passed: 9,712 configured files linted, zero errors or warnings,
plus root TypeScript and workflow checks. Committed and verified on remote
main as `f4a63397fc13365b696f03284be03ae868cf2782`. Scoped workflow
`33940132473` and publisher job `101235786601` succeeded: SafeJS 0.1.88
published September 5, 2026, 02:53:11 UTC. CLI workflow `33940132599` and
publisher job `101236999980` succeeded: `poe-code@14.0.41` published to
latest September 5, 2026, 03:00:11 UTC, including both internal restore fixes.

Reachability correction: these two recovery fixes affect the maintained
internal `snapshot/restore.ts` reconstruction path. Public `run`/`restore`
uses replay and does not call that module. They must not be presented as fixes
to public replay behavior or prerequisites for public computed-key coercion.
Further internal reconstruction gaps are lower priority than reproduced public
language gaps.

### 5. Computed property coercion — delivered, scoped release complete

With `const key = { toString() { return "x"; } }; const object = { x: 7 };`,
native JavaScript accepts each of the following; built SafeJS rejects all seven
with "Computed property access requires a string or number key":

- `return object[key];` → 7
- `object[key] = 8; return object.x;` → 8
- `delete object[key]; return Object.hasOwn(object, "x");` → false
- `return { [key]: 8 }.x;` → 8
- `const { [key]: value } = object; return value;` → 7
- `let value; ({ [key]: value } = object); return value;` → 7
- `object[key]++; return object.x;` → 8

The regression suite initially had 31 failures and seven passes. Share the
property-key conversion used by `in` with member operations and all pattern
contexts. Evaluate member references before converting their keys: defer simple
assignment conversion until after its RHS, and retain the converted key across
compound/update reads and writes. Check null bases after evaluating index
expressions but before converting keys. Preserve optional short-circuiting.

The focused cohort passes 104 tests. It includes literal/method definitions,
member calls and constructors, binding/assignment/parameter/catch/loop patterns,
rest exclusions, primitive/array keys, inherited hooks, string-hint fallback,
async hooks without implicit adoption, abrupt completions, host capability
checks, recursion budgets, persistent realms, completed replay, and internal
restored parameter patterns. The selected maintained workspace build closure
passed. Sixteen built root/core entrypoint data checks passed, including an
awaited RHS, along with two fatal generated-string budget checks. Exported
record data is compared without assuming a host Object.prototype; an initial
strict-prototype smoke assertion was inappropriate for the safe export shape.
The full maintained SafeJS suite passed 10,252 tests, with 41 skipped. Full
root lint passed: 9,714 configured files, zero errors or warnings, plus root
TypeScript and workflow checks. Committed and verified on remote main as
`cb782e1ec46aa7000a11c2c2d4985c5352bb643b`. Scoped workflow `33940657073`
and publisher job `101237302063` succeeded: SafeJS 0.1.89 published
September 5, 2026, 03:04:47 UTC. CLI workflow `33940657200` and publisher
job `101238480840` succeeded: `poe-code@14.0.42` published to latest
September 5, 2026, 03:11:24 UTC.

This integrates the existing sandbox string-conversion model; it does not
claim complete Symbol support, exotic prototype graphs, callable source
stringification, or all built-in string tags. Those are separate existing
value-model/string-conversion gaps in the completeness inventory.
Standalone public `String(new Map())`, `String(new Set())`, and `String(/a/g)`
return `"[object Object]"` instead of their native tags/regex text. Likewise,
`String([Object.create({ toString() { return "x"; } })])` returns
`"[object Object]"` instead of `"x"`. Matching computed keys have the same
defects. These bounded probes confirm the conversion gaps independently of
computed-key syntax and make them the next conversion work, not inferred
limitations.

### 6. Shared string conversion and RegExp display — validated, delivery pending

Initial public regression suite: 32 failures, two passes. Current built code
confirms skipped inherited hooks, incorrect Map/Set/Generator tags, ignored
guest-function own hooks, and raw RegExp source/flag display. Cover ordinary
prototype traversal, explicit null prototypes, shadowing and hook mutation,
original receivers, guest exceptions, and existing opaque host capabilities.
Use the same conversion path for explicit String and computed property keys.

RegExp display must retain matching state while exposing escaped source and
canonical supported flag order. Native controls include empty patterns,
slashes, escaped slashes/backslashes, line terminators, and character classes.
The formatter traverses source with step and string-size limits; it does not
compile or execute a native regex.

The focused cohort passes 196 tests. It includes prior String/error conversion,
host digest/replay/cancellation, computed keys and `in`, plus the new cases.
A first replay fixture retained a custom prototype in a root binding, which
the existing portable format intentionally rejects. Keep an explicit rejection
test and separately exercise successful completed replay with temporary
prototype-backed values. Persistent-realm tests retain their prototype state.

The selected workspace build closure passed. Cross-version probes against the
pre-change build preserve the ordinary-object result; a prior Map conversion
checkpoint now produces the corrected Map tag during replay. Therefore this
change does not claim identical results when replaying prior buggy conversion
semantics. Snapshot portability and runtime-upgrade compatibility remain
separate inventory concerns; do not mistake corrected pure computation for a
newly validated replay defect.

Final validation: 16 built root/core entrypoint checks passed. The maintained
full SafeJS suite passed 10,287 tests, with 41 skipped. Full root lint passed:
9,715 configured files linted, zero errors or warnings, plus root TypeScript
and workflow checks. Committed and verified on remote main as
`cad3deeeb40c1da7acd94636a692b078ce5bc18c`. Scoped workflow `33941378185`,
publisher job `101239359387`, succeeded; its log confirms
`@poe-platform/safe-js@0.1.90` published September 5, 2026, 03:20:23 UTC.
CLI workflow `33941378321`, publisher job `101240740706`, succeeded; its log
confirms `poe-code@14.0.43` published September 5, 2026, 03:28:36 UTC.
The remote advanced
with a terminal-only repair before delivery; rebasing preserved the exact
SafeJS tree, and the selected terminal build plus 253 terminal tests passed.
Callable source text, full exotic prototype graphs, symbols,
accessors, and implicit-coercion integration remain separate inventory items.
Additional probes confirm failures in computed parameter/catch bindings,
method calls, and boolean/null/undefined/array keys. A null-base assignment
also skips RHS side effects which native JavaScript executes before throwing.
Check against ECMAScript 2026 sections 6.2.5.5, 6.2.5.6, and 13.3.3 rather
than treating the local Node v22.23.2 behavior as an infallible oracle: it
coerces compound/update keys twice, unlike the specified retained key. The
normative history is TC39 ecma262 issue 3295 and merged PR 3307.

### Additional validated findings (delivery status tracked below)

Original built public-entrypoint probes reproduced these built-in receiver
defects. Number receivers are now delivered in item 7; the remaining receiver
families are still open:

| Probe | Native JavaScript | Current SafeJS |
| --- | --- | --- |
| `[1].join.call([2], ",")` | `"2"` | `"1"` |
| Detached `[].push` called with a separate array and 7 | Receiver becomes `[7]` | Receiver remains `[]` |
| Detached `[1].join` called without a receiver | TypeError | `"1"` |
| `"abc".slice.call("xyz", 1)` | `"yz"` | `"bc"` |
| A map's `get` called with another map | Reads the supplied map | Reads the original map |
| Detached map `get` called without a receiver | TypeError | Reads the original map |

Additional current-code native comparisons extend that receiver audit:

- `[].map.call({ 0: 7, length: 1 }, value => value * 2)` returns `[]`, not `[14]`.
- `(1).toFixed.call(2, 1)` returns `"1.0"`, not `"2.0"`.
- `/a/.test.call(/b/, "b")` returns false, not true.
- `"abc".slice.call({ toString() { return "xyz"; } }, 1)` returns `"bc"`, not `"yz"`.
- `[].map === [].map` returns false, not true.
- `typeof new Map([["x", 7]]).keys().next` is undefined, not `"function"`.
- Object-literal getters are rejected by the parser; accessor descriptors
  are rejected by Object.defineProperty. Both bounded native controls return 7.

Receiver selection, generic array-like operations, intrinsic identity, and
accessor/prototype support are distinct requirements. Do not call the receiver
work complete merely by accepting a different array receiver while rejecting
the ordinary array-like object required by native methods.

The internal reconstruction path also loses argument 7 for
`function target(a) { var a; return a; }`, and for a return preceding `var a`.
With an outer `b = 9`, `function target(a = b, b = 2) { return a; }` returns
9 after reconstruction instead of throwing ReferenceError for the later
parameter's temporal dead zone. These are separately validated internal scope
gaps, not additional claims about public replay. Keep them queued while
prioritizing the public computed-key and built-in receiver defects.

A public catch-pattern probe originally confirmed inherited reads were missing:
`try { throw Object.create({ x: 7 }); } catch ({ x }) { return x; }` returns
undefined instead of 7. Catch binding currently uses separate property-read
logic from ordinary destructuring; that independently validated defect is
addressed in item 8 below.

### 7. Number-method receivers — delivered, releases monitored

The public reproducer `(1).toFixed.call(2, 1)` returns `"1.0"` instead of
`"2.0"`. Each intercepted number member closes over the number from lookup
and ignores the call context's receiver. The issue is reproduced in 26
failing public-runner tests before implementation (five controls passed).

Number members now use the actual call receiver and reject non-number
receivers before converting formatting arguments. The lookup no longer
captures a number. This follows ECMAScript ThisNumberValue and the four
implemented Number.prototype formatting methods; boxed numbers remain
outside the currently supported value model, not an implemented feature.

Focused validation: 40 passing tests covering existing number formatting,
call/apply/bind (including rebinding), non-finite values and negative zero,
detached and incompatible receivers, argument evaluation before receiver
validation, no receiver coercion, persistent evaluations, completed replay,
and fatal string-budget enforcement. The selected SafeJS build closure passed
(23 dependency builds), followed by 16 built root/core entrypoint checks.
The maintained SafeJS suite passed 10,318 tests, with 41 skipped. An initial
overlapping build/test run hit three missing tiny-mcp-client dist imports;
rerunning the full suite after the build completed passed. Do not overlap
dependency-dist replacement with this suite's integration children.
Full root lint passed: 9,716 configured files linted, zero errors or warnings,
plus root TypeScript and workflow checks. Committed and verified on remote
main as `eac430cbb103fecd6adc41fa258501a9ce5e19eb`; scoped workflow
`33941942279` succeeded. Publisher job `101240971024` confirms
`@poe-platform/safe-js@0.1.91` published September 5, 2026, 03:32:49 UTC.
CLI workflow `33941942363` also succeeded; publisher job `101242287194`
confirms `poe-code@14.0.44` published September 5, 2026, 03:40:31 UTC.

This is one atomic part of the receiver audit, not completion of array-like
objects, string/collection/regex receivers, method identity, or number-object
boxing. Those remain separate inventory items.

A separate formatting-argument probe validates that
`(1.25).toFixed({valueOf(){return 2}})` throws rather than returning `"1.25"`;
argument numeric conversion is not repaired by the receiver change.

Further catch-pattern probes confirm that function rest bindings expose
internal `kind`, `call`, `name`, and `construct` keys instead of guest own
properties; RegExp rest includes internal `kind`/`flags`/`lastIndex` fields
instead of being empty. Map catch `{size}` returns undefined rather than 1.
String/number object catch patterns reject valid primitive values. These
failures were compared with bounded native controls; the next catch-property
fix must use guest property reads and guest enumerable entries, not raw
implementation objects. Primitive boxing and full accessor semantics remain
separate from fixing observable property reads.

### 8. Catch-binding guest properties — resolved and validated

Object catch patterns use raw implementation indexing and Object.entries,
unlike ordinary guest property reads. Bounded native controls and public
runner regressions reproduce 20 failures before implementation (four
controls passed). Named reads now use the interpreter's guest property
reader, and rest bindings reuse guest enumerable entries. Null and undefined
remain invalid, while implemented primitive properties are readable.
The redundant raw-indexing proxy function was removed.

The focused cohort passes 150 tests: catch properties, exceptions,
computed keys, guest function properties, and realms. Cases cover inherited/own/shadowed/default/nested/computed
properties, function properties and non-enumerable name/length, Map/Set size,
RegExp display, representation hiding for functions/regex/promises/generators,
primitive reads and rest, nullish rejection, abrupt defaults, realm reuse,
completed replay, and fatal traversal budgets. A live-host follow-up probe
and failing regression exposed duplicate reads of an excluded rest key:
`x,x,y` rather than `x,y`. The shared enumerable-entry helper now accepts
excluded keys and skips those host reads before they execute; catch rest
uses that option. This preserves the capability boundary's observable
access order instead of filtering only after fetching every value.
The first full suite passed 10,343 tests, with 41 skipped, before that final
edge fix. Its in-flight lint run was intentionally stopped. Final validation
passed: the selected SafeJS dependency build closure, 18 built root/core
entrypoint checks (including live getter ordering), 10,344 SafeJS tests with
41 skipped, and full root lint with 9,717 configured files linted and zero
errors/warnings, plus root TypeScript and workflow checks. Committed and
verified on remote main as `d7b307fc47e496f6fe26dd252fe5402a589ab051`.
Scoped workflow `33942502800` succeeded; publisher job `101242506103`
confirms `@poe-platform/safe-js@0.1.92` published September 5, 2026,
03:44:28 UTC. CLI workflow `33942503019` was canceled by the next push;
its changes remain on main and are included in the newer monitored release.

The first broad regression matrix also exposed two independent property
model gaps: `const fn=()=>7; return fn.name` produces `""`, not `"fn"`, and
`Object.keys(new Error("message"))` produces `name`, `message`, and `stack`,
not an empty array. Both were reconfirmed outside catch syntax. Named
function expressions and Error name/message reads isolate catch binding
behavior without pretending to fix function-name inference or Error
descriptor semantics. Those independent improvements need their own tests,
commits, and pushes; changing Error descriptors also requires checking the
separate public error projection contract.

This does not claim complete primitive boxing, accessor support, catch array
iterator semantics, full prototype graphs, or parity for every declaration
destructuring path. In particular, declaration object patterns still reject
primitives; they are a separately validated integration gap.

An additional bounded control isolates catch binding scope independently of
property lookup: with outer `b = 9`, `catch ({ a = b, b = 2 })` returns 9
instead of throwing ReferenceError. Catch parameter names are not all
predeclared before defaults execute. Keep that temporal-dead-zone repair
separate from this guest property integration.

The same live-host probe confirms that ordinary declaration rest still reads
`x,x,y`: its separate pattern helper does not yet pass excluded keys to the
shared enumeration helper. Declaration, parameter, and assignment object
patterns also reject `"ab"` where native `{0:first,length}` yields `["a",2]`.
These are next atomic integrations, not silently included in this catch fix.
Regular public function-parameter TDZ and var redeclaration controls pass;
do not conflate those with the separately recorded internal restoration gaps.

### 9. Ordinary rest-binding host reads — resolved and validated

Declarations, assignments, and function parameters use a different rest-copy
path from catch bindings. That path discards excluded keys only after reading
their values. Fresh regressions reproduced nine failures and two passing
controls, including an excluded host getter that throws on its second read.
The pattern helper now passes exclusions to the existing guest enumeration
helper before reads, preserving both the returned data and observable effects.

The focused cohort passes 78 tests across rest reads, catch properties,
patterns, and realms. Native observable-property controls use a transparent
Proxy: local Node v22.23.2 can itself reread an excluded getter on an ordinary
object declaration fast path. ECMAScript 2026 CopyDataProperties, section
7.3.25, excludes keys before inspecting descriptors or performing Get; the
transparent native control follows that order. Do not encode Node's duplicate
read as the expected language behavior.

Coverage includes declarations, assignments, normal/arrow/async parameters,
computed exclusions, all-excluded rest, intentional repeated named reads,
empty exclusions, unchanged object spread, and a throw-on-second-read getter.
Final validation passed: the selected SafeJS dependency build closure,
16 built root/core entrypoint checks, 10,355 SafeJS tests with 41 skipped,
and full root lint with 9,718 configured files linted and zero errors/warnings,
plus root TypeScript and workflow checks. Committed and verified on remote
main as `b1756fcec4dbac73a4d4a2ee8567b0cbc0ec5f81`. Scoped workflow
`33942895637` succeeded; publisher job `101243585832` confirms
`@poe-platform/safe-js@0.1.93` published September 5, 2026, 03:53:08 UTC.
CLI workflow `33942895740` was canceled by its successor; newer release
workflows include this delivered change.

Follow-up native controls also validate a separate catch-completion gap:
`try { throw null; } catch ({x}) {} finally { ... }` skips the finalizer
when binding throws TypeError. A computed catch key whose toString throws
also skips finally, while an explicit throw inside a default expression
does run it. The binding helper's own exceptions currently escape its
surrounding try evaluator. Separately, an unbound name in a catch default
produces an uncatchable UNBOUND_IDENTIFIER diagnostic rather than a
catchable ReferenceError. These require distinct exception-flow work;
they are not fixed by property enumeration or catch TDZ predeclaration.

### 10. Catch-binding temporal dead zones — resolved and validated

Fresh public-runner regressions reproduced 16 failures, with eight passing
controls. Catch bindings were declared only as each value was initialized,
allowing self/later defaults, computed keys, and assignments to resolve a
same-named outer binding. All bound names are now predeclared in the catch
scope before binding initialization, using the existing Scope machinery.
This follows ECMAScript 2026 CatchClauseEvaluation, section 14.15.2.

The focused cohort passes 91 tests across catch scope, catch properties,
exceptions, and Scope. It covers self/later reads, typeof, object/array/nested
and rest patterns, computed keys, deferred closures, async defaults, earlier
initialized bindings, mutable catch bindings, simple/no-parameter catches,
existing simple-catch var behavior, outer-state preservation, finally after
a TDZ default failure, persistent evaluations, completed replay, and fatal
budget failures. Final validation passed: the selected SafeJS dependency
build closure, 16 built root/core entrypoint checks, 10,379 SafeJS tests with
41 skipped, and full root lint with 9,719 configured files linted and zero
errors/warnings, plus root TypeScript and workflow checks. Committed and
verified on remote main as `4827e5fb4702a534d2753601856693d0c3b35799`.
Scoped workflow `33943228838`, publisher job `101244506042`, succeeded:
`@poe-platform/safe-js@0.1.94` published September 5, 2026, 04:01:03 UTC.
CLI workflow `33943228964` was canceled after another worker's Safe Bash-only
source-index repair advanced main to `a31e6943baf46d88e27c9ae33a934dbd16e6ba39`.
Its descendant scoped/CLI workflows are `33943450152` and `33943450283`.
Both descendant workflows succeeded: SafeJS 0.1.95 published September 5,
2026, 04:07:21 UTC, and poe-code 14.0.45 published at 04:14:23 UTC.

The separately reproduced direct binding/coercion failure path that skips
finally remains open. A TDZ default failure already travels through normal
expression completion handling; fixing its scope does not silently solve
the different direct-helper exception path or general unbound diagnostics.

### Broader receiver and array-like follow-up audit

Fresh bounded native/public-entrypoint controls confirm these remaining gaps:

- `a.call.call(b, null)` calls `a`, not `b`, when the functions return different
  values. Function.call/apply/bind members also capture the function at lookup
  instead of using their own actual receiver.
- `f.apply(null, {0:7,length:1})` throws TypeError instead of passing argument 7.
- `Array.from(values, mapper)` eagerly copies an array before mapping: changing
  `values[1]` from 2 to 9 in the first callback yields `[1,2]`, not `[1,9]`.
- `Array.from(Object.create({0:7,length:1}))` yields `[]`, not `[7]`, because
  its native fallback does not read the guest prototype graph.
- `Array.from.call(Output, {0:7,length:1})` ignores the supplied constructor;
  the result is not an Output instance even though the native result is.
- Function.call member identity is unstable; Array.prototype and the Function
  intrinsic are absent. These are prototype/intrinsic-model gaps, not repaired
  merely by accepting one more receiver type.

These findings extend the open generic array-like and built-in receiver work.
They require active guest property/coercion/call operations, live iteration,
and constructor semantics; do not substitute native-object copies for the
guest model or present a partial receiver patch as full JavaScript parity.

### 11. Finally after catch-binding failures — delivered, release monitored

The catch evaluator awaited binding initialization outside the path that
turns ordinary errors into throw completions. Thus binding TypeErrors,
computed-key coercion failures, and live host-property failures escaped
before finally could run. The initial regression suite reproduced 23
failures, while two fatal-error controls passed.

Ordinary catch-binding errors now use the same throw-completion construction
as expression evaluation. The original thrown value, identity, span, and
stack metadata are preserved; finally can complete normally or override the
pending failure with return/throw/break/continue. Existing fatal sandbox,
interpreter-diagnostic, and host-resumability classifications are preserved.
The shared classification helpers were moved, not broadened.

The pending normalized value remains a budget root during finalization and
is released afterward. A targeted control removing that root made the new
data-budget regression fail by incorrectly succeeding at a 5,000-unit limit.
With the root restored, that run fails the data budget, while a 10,000-unit
limit succeeds; an unbounded measurement reported a peak of 8,008 units.
The otherwise equivalent finalizer without a pending value succeeds at 5,000.

The focused cohort passes 116 tests, including native completion ordering,
primitive/object/Error identity, nested and async finalizers, live named/rest
host reads, compiled RegExp survival, fatal reentry/budget controls, replay,
and data/deadline budgets. Final validation passed: 10,405 SafeJS tests with
41 skipped, the selected SafeJS dependency build closure, the full maintained
root build, 16 built root/core checks, and full root lint (9,723 configured
files, zero errors/warnings), including TypeScript and workflow checks.
General unbound diagnostics and fatal catch-time deadline policy remain
separate concerns; this fix does not silently change their classifications.

Remote main advanced with unrelated Safe Bash source-index changes during
this work. The local implementation checkpoint was rebased onto
`a31e6943baf46d88e27c9ae33a934dbd16e6ba39` before final validation, preserving
the user's staged cut changes. The initial focused source-index check could
not load the root safe-fs bundle, which the selected SafeJS build does not
produce; the maintained full root build supplied it, and all 26 source-index
integration tests then passed. This was a build prerequisite, not a source
regression. Commit `266f25a8dc6910c6e4f702a60c09fda5cb35ceab` was pushed and
verified against remote main. Scoped workflow `33944139708`, publisher job
`101247040198`, succeeded: SafeJS 0.1.96 published September 5, 2026,
04:21:11 UTC. CLI workflow `33944139971` is monitored separately and was
still running at this checkpoint.

### 12. Function call/apply/bind receivers — delivered and released

Native/public-source probes confirmed that the three method closures captured
the function used for lookup. For example, `a.call.call(b, null)` invoked a
instead of b; detached methods invoked their former target rather than
throwing TypeError. This also affected borrowed binding, construction, async
functions, and generators. ECMAScript 2026 sections 20.2.3.1–20.2.3.3 specify
the actual this value as the callable receiver.

All three methods now validate and invoke their actual callable receiver,
leaving argument passing, bound state retention, construction, and ordinary
invocation on the existing paths. The 24 new regressions failed before the
fix. A corrected control restoring only the old captured-receiver dispatch
again failed all 24. The focused cohort passes 119 tests across six files,
including own-property precedence, arity, restored-function metadata,
construction, identity, async/generator results, realm evaluations, completed
replay, and fatal step budgets.

Older direct-helper tests now supply the receiver in their call context;
the old detached-method test now requires TypeError. The first broad focused
attempt was stopped because a new infinite-loop control incorrectly used
`steps` instead of the declared `maxSteps` option. The corrected bounded
control passes. A separate test parser setup needed one statement per parse
call; the completed cohort includes that correction, not the interrupted run.

Final validation passed: the selected SafeJS dependency build closure, 18
built root/core checks, 10,429 SafeJS tests with 41 skipped, and full root
lint (9,724 configured files, zero errors/warnings), including TypeScript
and workflow checks. A further public-source realm check preserved stored
borrowed methods and bound regex-using functions across evaluations.
Committed, pushed, and verified on remote main as
`92b9b026fe10bdc8dc9723a14e87870a24be4581`. Scoped workflow `33944509803`,
publisher job `101248057977`, succeeded: SafeJS 0.1.97 published September 5,
2026, 04:29:05 UTC. CLI workflow `33944509925`, release job `101249320723`,
succeeded: poe-code 14.0.46 published at 04:37:41 UTC. This descendant release
also includes the catch/finally fix; its original CLI workflow `33944139971`
was canceled by the newer push rather than failing validation.
Generic array-like apply arguments, stable method identity, missing function
intrinsics, and other built-in receiver families remain separate open gaps.

### Collection-construction follow-up audit

Bounded native/public-source probes reproduced these separate current gaps:

- Array.from drains iterables before mapping. Array replacement, append,
  truncation, and Set insertion from callbacks are missed; generator next,
  mapper, and finally ordering differs. A noncallable mapper is rejected only
  after an ordinary generator has already run. A throwing generator finalizer
  can replace the mapper's intended failure because it runs before mapping.
- Array.from deep-copies ordinary items and mapper results: returning an
  existing object through either path loses identity. Its array-like fallback
  also eagerly reads later indices before earlier mapping callbacks.
- Object.fromEntries bypasses guest key conversion and inherited entry
  fields: a guest toString returning "name" is not called, and entries with
  inherited 0/1 fields do not produce the expected named property. Both array
  and generator entry sources reproduce the inherited-field mismatch.

These are validated open findings, not included in the function receiver fix.

### 13. Registered retained roots counted twice — delivered and released

The Array.from work exposed an independent interpreter accounting defect.
reconcileDataBudget explicitly appended budget.retainedValues, then called
reconcileCompiledValues, which appended the same registered roots again.
Object identity deduplication concealed the duplicate traversal for object
roots, but primitive string roots were charged twice. A public realm with a
single 100-unit retained string failed a 150-unit limit with reported usage
200. Distinct 100/25-unit roots and two distinct registrations of equal
50-unit strings similarly exposed the duplicate accounting.

The interpreter now leaves registered-root collection to the existing shared
reconciler. Scope/transient roots, compiled ownership, and genuine repeated
primitive registrations remain intact. The three realm cases now report
peaks of 100, 125, and 100 respectively. The over-limit interpreter control
still rejects at 100 against a 99-unit limit. Its first realm-based fixture
also exercised poisoned-realm cleanup and produced an AggregateError, so the
negative control was moved to the interpreter to isolate accounting rather
than lock unrelated cleanup behavior into this regression.

The four-file focused cohort passes 57 tests, including existing data budgets
and finally retention. The selected SafeJS dependency build closure passes.
Final integrated validation passes: 10,433 SafeJS tests with 41 skipped,
six built public root/core checks, and full root lint (9,726 configured
files, zero errors/warnings), including TypeScript and workflow checks.
Remote main advanced with unrelated filesystem-output and private-network
repairs; the checkpoint was rebased onto
`01267b14ea7604c127e26b16b2c1c3ef23f991cf`, preserving the user's staged cut
changes. The maintained full root build and 261 affected Safe Bash integration
tests also pass. Array.from changes are preserved separately and are not
included in this prerequisite commit; they will resume after its atomic
push. Committed and pushed as `107fb94c6add617c05f2e3c935ca23c2e02e10b5`,
verified against remote main. Scoped workflow `33945998128`, publisher job
`101252076877`, succeeded: SafeJS 0.1.99 published September 5, 2026,
05:03:37 UTC. CLI workflow `33945998235` succeeded, but release-stable job
`101253169060` skipped publication because remote main had advanced. That is
not a new CLI release; the newer descendant workflow is monitored separately.

### 14. Array.from guest construction — delivered and released

The initial native/public regression suite reproduced 32 failures with nine
passing controls. Array.from now maps while consuming its input, preserves
guest identity, reads array-like fields through the guest property model,
converts length with number-hint guest hooks, and invokes a supplied
constructor through the active sandbox invocation path. Iterable constructors
receive no arguments; array-like constructors receive the clamped length.
Own element creation and final length assignment retain their distinct rules.

The shared invocation helper preserves active context, construction, fallback
call-depth checks, and synchronous async-function prefixes without awaiting
guest promise results. String and number conversion share the existing guest
prototype/hook traversal, with the appropriate hint order and Date valueOf
default. This does not route arbitrary guest objects through host coercion.

Mapping/element-definition failures close iterators and preserve the original
throw against ordinary cleanup throws; fatal cleanup budgets cannot be hidden
by an earlier ordinary mapper throw. Iterator advancement failures are not
mistaken for mapper failures. Incremental work/allocation checks and retained
partial results keep resource accounting active during callbacks and cleanup.
Removing the partial-result root made the targeted data-budget test incorrectly
succeed at 5,000 units. With retention restored, it rejects at 5,000 and succeeds
at 7,000; a one-element control succeeds at 5,000. Measured unbounded peak: 6,049.

The latest focused nine-file cohort passed 257 tests before the retained-root
prerequisite. Callback-free construction now checks data growth incrementally,
including known-size constructor allocation. Primitive writes use bounded
growth estimates between exact reconciliations; object graph writes force an
exact check. A mutation control removing that shortcut caused 5,011 scans for
5,000 primitive elements, failing the regression's fewer-than-100 bound.
Earlier build, full-package, and lint checks preceded these latest accounting
changes and were not treated as final validation. The integrated string-input
control now succeeds for 400 characters within 1,500 data units, without
double-charging its retained input. Final review removed an unnecessary Budget
accessor in favor of the existing read-only limits; its in-progress lint run
was canceled and validation restarted against the final source.

Final validation passes: the selected SafeJS dependency build closure,
10,491 package tests with 41 skipped, 24 built root/core checks, and full root
lint (9,728 configured files, zero errors/warnings), including TypeScript and
workflow checks. An additional bounded native comparison matrix passed 144
construction combinations, and nine mutation/cleanup controls also matched
native behavior. Atomic push and release are tracked separately from these
local checks. Committed and pushed as
`f4e4189fa81dd0cc93cf4168c4cf3ec26353b1af`, verified against remote main.
Scoped workflow `33946434003`, publisher job `101253261047`, succeeded:
SafeJS 0.1.100 published September 5, 2026, 05:13:16 UTC. CLI workflow
`33946434242` was canceled. Its changes are included in descendant CLI release
14.0.48, published September 5, 2026, 05:26:50 UTC.

An initial implementation used the public descriptor helper for ordinary
element creation, incorrectly marking arrays as custom-descriptor objects and
breaking realm export. Existing live-host tests caught it; internal standard
data-property creation fixes it without relaxing export restrictions. A Date
override fixture failed before Array.from because Date own-property assignment
is unsupported; it was replaced by an ordinary Date length-conversion control.
Date overrides remain an explicit separate gap, not a claimed Array.from fix.
Symbols/custom guest iterator protocols, missing Array/Function intrinsic
prototypes, Date own state, and Object.fromEntries remain open broader work.

### Additional constructor audit — validated open findings

Bounded native/public built-entrypoint probes confirmed these separate gaps:

- Map(null) and Set(null) reject instead of constructing empty collections.
  Map from Set entries and Set from Map entries also reject supported iterator
  families. Calling Map without new already throws correctly and needs no fix.
- Object.fromEntries misses inherited and function-entry 0/1 fields and guest
  key conversion. Entry values must be read before key conversion can mutate
  them. A throwing key hook currently never runs, changing cleanup/error order.
- Map drains a generator past an invalid entry before rejecting it: its later
  body runs where native execution immediately closes the generator.
- Object.fromEntries, Map, and Set omit previously accumulated values from
  generator-time data accounting. A retained 2,000-character value, a live
  2,000-character temporary, and the next 2,000-character value coexist, but
  measured peaks are only 4,028/4,028/4,026 respectively; all incorrectly fit
  a 5,000-unit limit. Corresponding compiled-regex retention probes pass and
  are controls, not claimed defects.
- Number() returns NaN instead of zero. Number(object) bypasses guest own and
  inherited valueOf/toString hooks, changes thrown-value identity, and misses
  async-hook prefix ordering. Date and primitive conversion controls pass.

These findings are not included in the Array.from implementation. Each repair
requires its own failing regressions, focused implementation, checks, and push.

### 15. Number guest conversion — delivered and released

The new native/public-source suite reproduced 21 failures with five passing
controls. Number now uses the existing number-hint guest conversion helper,
preserving active invocation context and the valueOf-before-toString order.
The no-argument call supplies zero, while explicit undefined remains NaN.
The redundant Date special case is removed because the shared helper already
preserves Date value conversion. No new coercion API or helper is added.

The six-file focused cohort passes 217 tests, including the 26 new conversion
cases, existing String and Array.from behavior, numeric receiver tests, and
promise ordering. The new suite covers inherited hooks, function/array hooks,
falsey primitives, negative zero, thrown-value identity, async prefixes without
adopting guest promise results, realm evaluations, completed replay, and fatal
step/call-depth budgets. Static Number predicates remain non-coercing. Boxed
Number objects, BigInt/Symbol conversion, arithmetic operators, numeric method
argument coercion, and parseInt/parseFloat remain outside this focused fix.
Final validation passes: the selected SafeJS dependency build closure, 10,517
package tests with 41 skipped, 18 built root/core checks, and full root lint
(9,729 configured files, zero errors/warnings), including TypeScript and
workflow checks. Four queued-microtask controls pass, as do direct-helper
fallback/call-depth cleanup and compiled thrown-value controls. Atomic push
and release remain separate from these local checks. Committed, pushed, and
verified on remote main as `458d1a95d2582ca887114d2ef87b71a8306306b6`.
Scoped workflow `33946697934`, publisher job `101253986926`, succeeded:
SafeJS 0.1.101 published September 5, 2026, 05:18:58 UTC. CLI workflow
`33946698029`, release-stable job `101255176100`, succeeded: poe-code 14.0.48
published September 5, 2026, 05:26:50 UTC (GitHub release at 05:26:51 UTC).

Further bounded native/public probes confirmed guest-coercion gaps in global
parseInt, Number.parseFloat, Math.abs, String.fromCharCode, array slice indices,
and Number.prototype.toFixed precision arguments. They are not fixed by
changing Number itself. Intrinsic function arity is also absent: Number,
String, Array.from, Object.fromEntries, parseInt, and Math.abs expose undefined
lengths rather than native lengths 1/1/1/1/2/1. These are explicit follow-up
findings, not silently included in this repair.

### 16. Remaining duplicate retained-root callers — delivered and released

Object.fromEntries development exposed an unexpected extra 2,000-unit charge
at closure completion. Initial fixture adjustments did not remove it. A trace
identified executeClosure passing registered roots to reconcileCompiledValues,
which already collects them. The complete caller audit found the same defect
in final run reconciliation, initial snapshot restoration, and restored-function
completion. Only the shared reconciler now collects registered budget roots;
scope, return-value, pending-promise, and compilation ownership roots remain.

Ten new regressions validate all four callers. Closure cases cover arrows,
named/async functions, and conversion hooks; restored functions cover both
synchronous and asynchronous forms. A 300-unit root incorrectly produced
600–618-unit closure charges before the fix. Public-run fixtures register
their 2,000-unit root through a host callback after setup (run setup resets
earlier registrations); before the fix, final charges were 4,977–4,982 units
against a 3,500-unit limit. Fixtures allow the unrelated initialization and
snapshot bookkeeping costs rather than treating those costs as this defect.

The eight-file focused cohort passes 265 tests. The existing distinct-root,
equal-primitive registration, and genuine over-limit controls remain intact.
Source audit finds registered-root collection only in the shared reconciler.
Final validation passes after fast-forward integration of remote main
`eaa2f5aec955016ad338afb302467a5c44a846fc`: the full root build, 10,527 SafeJS
package tests with 41 skipped, 20 built-entrypoint/restoration checks, and full
root lint (9,732 configured files, zero errors/warnings), including TypeScript
and workflow checks. Integrated upstream changes also passed 288 terminal-pilot
tests and all 20 focused SafeBash substitution-admission tests with no skips.
The earlier lint run was canceled for integration and is not final evidence.
Atomic delivery remains separate from these local checks. Object.fromEntries
changes are preserved separately and are not part of this prerequisite commit.
Committed and pushed as `e219cd412f95cbbd67787d382a4d8be6a9673743`, verified
against remote main. Scoped workflow `33947671901`, publisher `101256602322`,
succeeded: SafeJS 0.1.103 published September 5, 2026, 05:40:55 UTC. CLI workflow
`33947671974` was canceled and its release-stable job was skipped. The newer
descendant CLI workflow is monitored; this scoped publication is not a CLI release.

### 17. Object.fromEntries guest construction — delivered and released

The initial native/public-source cohort reproduced 25 failures with 18 passing
controls. Guest execution now reads inherited and function-entry fields through
the sandbox property model, reads both entry fields before converting the key,
and uses string-hint guest conversion. It preserves supplied value identity and
consumes arrays, collections, and generators live rather than precollecting them.
Entry/conversion failures close the iterator and retain the original thrown
value against ordinary cleanup failures; fatal cleanup budgets remain fatal.

The partially built output and already-read entry value remain registered roots
during generator advancement and key conversion. Removing either root made its
targeted test incorrectly succeed at 5,000 data units. With both restored, the
cases reject at 5,000 and succeed at 7,000 (built peaks 6,041 and 6,050). These
checks required the separately delivered retained-root accounting prerequisite.

Bounded per-property growth estimates reuse Array.from's checkpoint helper;
Array.from's behavior is unchanged. An intermediate implementation forced 1,012
full scans for 1,000 already-rooted object entries. Its regression now passes:
built primitive and object-value cases each perform 12 scans. Unlimited data
budgets do not incur the added-value graph measurement. Existing work, allocation,
and fatal-cleanup controls remain active.

The first full suite exposed 15 adapter regressions and an unhandled rejection:
an unconditional async path changed direct host helper timing and native hooks.
The existing context-free synchronous adapter is preserved, while active guest
calls use the sandbox-aware path. All 210 tests in the affected six-file cohort
pass after that correction; no existing assertions were weakened. The earlier
lint run was canceled and is not final evidence.

Final validation passes: selected SafeJS dependency build closure, 10,571 package
tests with 41 skipped, and full root lint (9,733 configured files, zero errors or
warnings), including TypeScript and workflows. Built checks cover 48 native key/
iterator combinations through root and core exports, four accounting-scan cases,
six retention/work/realm checks, and five nested/microtask/cleanup controls. A
separate recursive-key check verifies maxCallDepth; an earlier probe misspelled
that option and only exercised its maxSteps fallback. Atomic delivery and release
remain separate from these local checks. Symbols and custom guest iterators are
still broader open gaps, not claimed as fixed here.
Committed and pushed as `1ff9cce1c65b6660f14eccd30ca5140ee430c808`, verified
against remote main. Scoped workflow `33947960223`, publisher `101257356294`,
succeeded: SafeJS 0.1.104 published September 5, 2026, 05:48:18 UTC. CLI workflow
`33947960350` was canceled; the newer descendant workflow is monitored separately.

Read-only follow-up validation confirms Map(null) and Set(null) reject in both
public runs and realms, while undefined and empty-array controls pass. Array.from
also still performs 210 full reconciliations for 200 object values versus 10 for
200 primitive values. These are separate repairs, not part of this commit.

### 18. Null collection inputs — delivered and released

Native comparisons reproduced TypeError for new Map(null) and new Set(null)
instead of empty collections, both in public runs and persistent realms. Six
new regressions failed before the fix, with 11 existing tests passing. The two
input readers now treat null like undefined. Other non-iterable values are not
accepted, and the direct constructors keep their synchronous return behavior.
The tests also verify that the new empty collections remain mutable across
realm evaluations. Broader collection-entry and iteration gaps remain separate.

Final validation passes: 197 tests in the focused four-file cohort, selected
SafeJS dependency build closure, 10,577 package tests with 41 skipped, and full
root lint (9,733 configured files, zero errors/warnings), including TypeScript
and workflows. Built root/core checks pass 24 null/undefined/empty-array and
invalid-input cases. Both direct constructors also pass with arrayLength zero,
and both collection types pass completed snapshot replay after mutation.
Atomic delivery and successful publication remain separate from these checks.
Committed and pushed as `4c260abe87a3fdd73dc532872e2b94570c71fc57`, verified
against remote main. Scoped workflow `33948175146`, publisher `101257918770`,
succeeded: SafeJS 0.1.105 published September 5, 2026, 05:52:40 UTC. CLI workflow
`33948175200` was canceled. Its changes are included in descendant CLI release
14.0.49, published September 5, 2026, 06:06:31 UTC.

### 19. Array.from object-value accounting scans — delivered and released

Three new regressions reproduced 210 full reconciliations for 200 object values,
covering distinct objects, shared objects, and array-like input. All 58 existing
Array.from tests passed before the repair. Object values now contribute a bounded
graph-size growth estimate, as in the separately delivered Object.fromEntries
fix, instead of forcing a full-root scan after every write. Closure-valued output
containers retain their explicit exact-check path. Unlimited data budgets skip
the graph measurement. No constructor, mapper, iterator, or identity behavior is
changed by this focused repair.

The focused four-file cohort passes 157 tests. Final validation passes: selected
SafeJS dependency build closure, 10,580 package tests with 41 skipped, and full
root lint (9,733 configured files, zero errors/warnings), including TypeScript
and workflows. Ten built root/core checks confirm 10 scans instead of 210 for
each object-input form, plus retained mapped-output rejection at 5,000 data units
and success at 7,000. Atomic delivery and release remain separate from these checks.

Further native comparisons confirm Map precollection loses earlier entries when
a generator reuses its entry array. Invalid entries also lose their original
TypeError to a later generator or cleanup string throw. Empty-string Map input
is incorrectly rejected, and borrowed Map.get still captures its lookup receiver.
These are follow-ups, not part of this performance repair. A separate array-entry
prototype probe failed at Object.setPrototypeOf before reaching Map construction;
it is evidence of the existing prototype limitation, not a validated Map defect.
Committed and pushed as `9cba49861ac1455b6a61adfd3572c425b84e95d7`, verified
against remote main. Scoped workflow `33948412618`, publisher `101258546896`,
succeeded: SafeJS 0.1.106 published September 5, 2026, 05:58:37 UTC. CLI workflow
`33948412741`, release-stable job `101259694275`, succeeded: poe-code 14.0.49
published at 06:06:31 UTC, with its GitHub release at 06:06:32 UTC. This descendant
CLI includes sections 16–19; canceled older workflows are not separate releases.

### 20. Map live iterable construction — delivered and released

The corrected initial 34-case cohort reproduced 22 failures with 12 passing
controls. Map now consumes each entry before advancing, supports the existing
sandbox iterable types, and reads ordinary, inherited, and function-entry fields
through the guest property model. Keys and values retain identity; keys are not
coerced. Synchronous inputs still construct synchronously. Guest generators use
their asynchronous interpreter bridge without changing observable job ordering.

Entry errors close the iterator and preserve the original throw against ordinary
cleanup throws, including falsey values. Fatal cleanup budgets remain fatal.
Iterator advancement errors remain distinct from entry-processing errors. Five
direct synchronous host controls match native next/done/value/field error order.
The partially built Map and current entry fields stay rooted during advancement
and cleanup. Removing the Map root made the retention regression incorrectly
succeed at 5,000 data units; restored retention rejects at 5,000 and passes at 7,000.

Traversal and unique-key capacity are checked incrementally. A built old-code
probe processed 1,000 duplicate-key entries under a 100-step budget with only five
recorded node visits; the new regression rejects that run. Repeated keys do not
consume additional collection capacity. The capacity fixture allows each two-item
entry array so that it exercises constructor admission, not fixture allocation.
The existing bounded data-checkpoint helper is shared with Array.from and
Object.fromEntries without changing their behavior; object insertion takes ten
full reconciliations for 1,000 object-valued entries in the built checks.

Final review caught an introduced output-budgeting regression: recursive value
traversal invoked properties of stored keys and values. Four regressions reproduced
that extra read with and without a data limit. Removing the redundant traversal
preserves opaque stored values while keeping exact final data reconciliation.
The first lint run was canceled; builds and tests were rerun after the correction.

Final validation passes: 45 Map construction tests, 340 tests in the focused
seven-file cohort, selected SafeJS dependency build closure, 10,625 package tests
with 41 skipped, and full root lint (9,735 configured files, zero errors/warnings),
including TypeScript and workflows. Twenty-six final built checks cover root/core
behavior, job ordering, compiled values, retained data, scan counts, and opaque
stored properties. Atomic push and publication remain separate from these checks.
Broader prototype, Symbol/custom-iterator, and borrowed-method gaps are not claimed
as fixed here.

Separate Set probes confirm rejection of Map and Float32Array inputs, uncharged
duplicate-value traversal, and collection-capacity checks after the generator's
later body has already run. Set also reports only 4,026 data units while three
2,000-character values coexist, incorrectly passing a 5,000-unit limit. These
validated Set defects are the next independent repair.
Committed and pushed as `cca5631a14c62e73baa7f0d7955d6ba9eb65bcf2`, verified
against remote main. Scoped workflow `33949133351`, publisher `101260479055`,
succeeded: SafeJS 0.1.107 published September 5, 2026, 06:15:21 UTC. CLI workflow
`33949133459` succeeded, but release-stable job `101261600301` explicitly skipped
publication at 06:22:04 UTC because its checkout was behind remote main. This is
not a new CLI release.

### 21. Set live iterable construction — delivered and released

The initial 38-test cohort reproduced 14 failures with 24 passing controls.
Set now accepts the existing sandbox iterable types, including Map and Float32Array,
without collecting all values first. Values retain identity and are not coerced
or recursively inspected. Synchronous inputs remain synchronous; generator job
ordering, original iterator throws, completed replay, and realm state are covered.

Set and Map now share their collection-population loop, retained-root lifetime,
iterator cleanup, and bounded data checkpoints. Their insertion rules remain
separate: Map reads entry fields; Set stores each value directly. Unique capacity
and traversal work are checked before insertion, including duplicate-heavy inputs.
This removes Set's unbudgeted collection pass and redundant backing-set creation.
The original fatal capacity error is preserved if cleanup also exhausts a budget.

Removing the shared collection root made both Map and Set retention tests
incorrectly pass their 5,000-unit limits. Restoring it makes both reject at 5,000
and succeed at 7,000. Built peaks are 6,038 for Set and 6,041 for Map. The newly
added Set case previously reported only 4,026 units. Opaque-property controls keep
the Map fix's non-observation guarantee intact for both collection constructors.

Final validation passes: all 38 new Set tests, 378 tests in the focused eight-file
cohort, selected SafeJS dependency build closure, 10,663 package tests with 41
skipped, and full root lint (9,736 configured files, zero errors/warnings), including
TypeScript and workflows. Twenty-eight built checks cover root/core behavior,
identity, job ordering, retained data for both constructors, synchronous opaque
values, and ten full scans for 1,000 Set object values. Atomic delivery and release
remain separate from these local checks.

Further native probes confirm eight receiver mismatches across Map and Set:
borrowed getters and mutations act on the lookup object, detached methods succeed
instead of rejecting an absent receiver, wrong collection brands are accepted,
and borrowed forEach callbacks receive the wrong collection. These method-receiver
defects remain a separate next repair; intrinsic method identity, live method
iterators, and broader prototype/Symbol support are not claimed as fixed here.
Committed and pushed as `d61e1eabcd7f491596eb86e8acac411a45e35022`, verified
against remote main. Scoped workflow `33949605980`, publisher `101261760211`,
succeeded: SafeJS 0.1.108 published September 5, 2026, 06:25:44 UTC. CLI workflow
`33949606140` was canceled; it is not a successful CLI publication.

### 22. Map and Set method receivers — delivered and released

The 54-case receiver cohort reproduced 52 failures with two passing ordinary-call
controls before implementation. Saved Map/Set methods captured the collection
used for lookup instead of honoring the call receiver. Both member factories now
validate the supplied collection brand and dispatch using that receiver. Ordinary
direct and optional calls retain their existing behavior. Detached or wrong-brand
calls throw TypeError; call/apply/bind, mutation return identity, borrowed forEach,
callback thisArg, callback-driven mutation, and async-prefix ordering match native
JavaScript in the focused comparisons.

All 54 regressions and 185 tests in the five-file cohort pass. A selected SafeJS
build, full package suite (10,717 passed, 41 skipped), and root lint passed before
integration. Twenty built root/core comparisons and completed replay pass. Two
additional pending-checkpoint probes preserve saved Map.get/Set.has methods and
use their replacement receivers after restore. Those probes do not substantiate
the suspected stored-method snapshot defect, so no speculative snapshot change
was made.

Remote main advanced with nonoverlapping SafeBash IFS and documentation changes.
Fast-forward integration to `8484a9cca2e2541a1666430d5648368b74831da0` preserved
the unrelated staged cut edits. The maintained complete root build then passed
(70 declared builds across 71 workspaces; the workspace without a build is not a
passing build). Integrated SafeJS validation passes again: 10,717 tests, 41
skipped, 284 passing files and one skipped file; root lint covers 9,738 configured
files with zero errors/warnings, followed by passing type and workflow checks.
Twenty built root/core comparisons and completed replay pass on the rebuilt
tree. Delegated read-only incoming-IFS verification passes 164 adjacent tests,
12 selected security tests, and one registration test. The latter checks literal
registration/serial forwarding, not execution of all registered files. These
focused integration checks are not a full SafeBash suite or release qualification.
Atomic commit, verified push, and publication remain separate delivery steps.

Seven further native comparisons confirm the independent live-method-iterator
gap: keys/values/entries return eager arrays, have no next method, miss later
additions/deletions/value updates, and can be consumed repeatedly. A correct
repair needs real single-use iterator state plus retained-source accounting and
snapshot/restore coverage; adding next to arrays is not native iterator parity.
Canonical method identity and broader prototype/Symbol support remain separate.

Receiver delivery is complete: commit `e29ff3ceb424a0e3b02361407e1318e3256f1213`
was pushed and verified against remote main. Scoped workflow `33950308439`,
publisher `101263700253`, published SafeJS 0.1.111 on September 5, 2026,
06:40:24 UTC. CLI workflow `33950308628`, release-stable job `101264967768`,
published poe-code 14.0.50 at 06:49:14 UTC and its GitHub release at 06:49:15 UTC.
The descendant CLI also includes the preceding Map and Set constructor repairs.

### 23. Live collection method iterators — delivered and released

The initial 39 native-behavior tests reproduced 35 failures with four passing
controls. Map/Set method iterators now have separately branded, hidden cursor
state rather than eager arrays. Native backing iterators preserve additions,
deletions, reinsertion, value updates, and permanent exhaustion. Iterator next
honors its receiver and distinguishes Map versus Set brands. Supported consumers
include spread, for-of, destructuring, generator delegation, Array.from,
Object.fromEntries, collection constructors, and Promise helpers. Iterator
creation is lazy; entry-pair capacity is charged on advancement. The old
getSpreadIterator proxy was removed while threading budgets through consumers.

Initial high-level checkpoint controls all passed (112 tests), so those alone
did not establish persistence correctness. Eighteen new low-level snapshot/replay
tests failed because iterator brands, cursor positions, source references, and
aliases were lost. Dedicated heap/replay records now retain them. Restore defers
native cursor initialization until source collections are populated, preserving
cycles. Adding internal clone coverage reproduced three failures with 24 passing
controls; cloning now preserves source identity and independent live cursors.

The first complete SafeJS package run reported 13 failures, 10,778 passes and 41
skips. Twelve failures depended on the former eager-array behavior. Consumers
now use next().value or explicit materialization without dropping their identity,
cancellation, clone, or ordering assertions. The formerly passing shared-identity
test had compared two missing indexed iterator values; it now compares actual
yielded values. Native checkpoint comparisons no longer rewrite methods into
Array.from. The remaining failure was a budget fixture: yielding a 2,000-character
Set value added another retained primitive occurrence and correctly needed 8,024
units. The fixture now inspects the next method without yielding, isolating source
retention: rejection at 5,000 and success at 7,000. This was not a budget defect.

Two added in-operator tests reproduced missing inherited next admission; the
property check now recognizes iterator members. A selected build found two
introduced typing errors, which were corrected; the subsequent maintained root
build passed all 70 declared builds (the 71st workspace has no build task).
The bundled skill's eager-array claim was corrected using skill-creator guidance,
then npm run sync-skills updated six installed copies with 27 others unchanged.
The skill validator passed through an isolated uv/PyYAML environment because the
system Python did not have PyYAML. No invocation policy or unrelated guidance was
changed.

Further review reproduced acceptance of iterator values by guest structuredClone;
native JavaScript rejects them. Internal snapshot cloning remains supported, but
the guest API now rejects direct/nested collection iterators using its existing
TypeError policy. Native DOMException/DataCloneError parity is not claimed.
Additional tests reproduced an internal clone accepting custom prototype links
and graph-depth checks missing hidden iterator/source edges. Copy admission now
keeps the existing prototype/descriptor boundary, and graph-depth traversal
follows iterator sources and branded Map/Set contents. The corrected native
baseline explicitly supplies structuredClone to the VM; the earlier baseline's
missing host global is not used as evidence. Six boundary regressions failed with
102 passing controls before these corrections; the six-file follow-up cohort
passes 219 tests.

The initial broad npm test run was intentionally canceled after this review, not
reported as passing. Its exact owned runner was stopped; the separate worktree's
runner was left untouched. A new root build, complete maintained unit route,
lint, built API checks, and relevant CLI validation remain required before atomic
commit/push. Iterator helpers, canonical method identity/arity, full prototype
graphs, and custom Symbol/iterator protocol overrides are not included in this
repair or claimed complete.

CLI validation plan: create a temporary no-spawn harness pair with a schema-only
import. Run the built SafeJS stub first, then the real harness command through
the maintained screenshot route. Confirm the first Map key is a, later keys
include b and newly added c, and a second Set iterator consumption is empty.
Inspect the PNG for readable, complete result output. Grant no filesystem, MCP,
environment, or agent-spawn capabilities. Temporary fixture/output files are
manual validation artifacts, not unit-test disk writes or committed source.

The raw .safejs stub produced the expected first/remaining/once/twice values.
The paired real harness passed with zero spawns and a readable screenshot after
correcting the temporary fixture to declare its required frontmatter parameter.
The first screenshot's signature rejection was fixture feedback, not an iterator
defect. The maintained screenshot helper also ran its existing predev preparation;
that does not replace the uncached maintained root-build gate.

A separate, validated skill-documentation follow-up remains: the standalone CLI
does not consume schema-based harness pairs as the skill's stub instructions
claim. Passing the Markdown pair to it fails parsing, and passing the paired
.ajs fails because the stub registry has no schema module. Its raw .safejs route
works. Correct that guidance in a separate atomic commit after this runtime fix.

Final value-type integration review reproduced nine additional failures with 58
passing controls: capability rebinding through iterator sources, a capability
path collision with a guest property named <collection>, accepting iterators as
input-section records, cancellation registration for retained promises, and
String/Object type tags. Replay now distinguishes source paths from encoded own
property paths; input-section validation excludes iterator exotics. Cancellation
traversal follows the retained source, and built-in type tags distinguish Map
Iterator and Set Iterator. The cancellation fixture was corrected to use a truly
pending promise: its original Promise.resolve control could legitimately settle
before abort. The five-file corrected follow-up cohort passes 166 tests. These
last source changes still need fresh broad gates before delivery.

A fresh native ESM process then exposed an introduced import-order cycle:
graph-depth imported values, which could reach snapshot validation before
MAX_DATA_DEPTH initialized. Ordinary root/core imports passed; importing the SDK
together with snapshot helpers without preloading value modules failed. New
maintained built-import tests reproduced one failure with three passing public
entry controls. Collection brands/guards now live in a type-only-dependent module,
and SafeJS postbuild runs the four fresh-process checks; all pass after the change.
The second broad unit attempt was canceled rather than qualifying the earlier
tree. A selected maintained SafeJS closure build passes, including the new checks.

Forty built native comparisons, four codec checks, and four data-retention checks
passed before that dependency-only correction. Correct public-SDK pending probes
also restore a saved iterator next method and a suspended generator across an
await checkpoint. An initial probe incorrectly supplied internal SandboxClosure
objects as public SDK host bindings and failed before reaching the checkpoint;
that fixture misuse is not a runtime defect. Native function bindings fix the
probe. Ordinary user prototypes and instanceof also work in a concrete built
probe, making the skill's blanket prototype/generator limitations further
validated documentation follow-ups rather than missing runtime features.

Final maintained gates pass: the complete root build ran all 70 declared builds
across 71 workspaces, including four fresh-process native ESM import checks.
The complete uncached npm test route finished successfully: 30,673 shared Vitest
tests passed with 43 skipped; SafeBash passed 279 tooling tests and 19,964 native
tests with 63 skipped; Python passed 29 tests, the postinstall suite passed 288,
and the root posttest lint-stress suite passed two. These skips and workspaces
without declared tests are not counted as passes.

Remote main advanced with the nonoverlapping MCP stdio-input repair. Fast-forward
integration to 34a025dcbdcfdb60fe18005aa99c2b50a4ac1c20 preserved the unrelated
staged SafeBash edits. The selected maintained MCP build closure passed both
declared builds, and all 749 focused MCP tests passed on the integrated tree.
Final root lint then passed for all 9,747 configured files with zero errors or
warnings, followed by successful type and workflow checks. The CLI screenshot,
built API/codec/budget probes, skill sync, and skill validator described above
also passed. This qualifies the iterator repair for its own commit and push;
remote delivery and publication remain separately verified steps.

Iterator commit c6b726f9651263fa34205ea1fc0157f1accc772e is pushed and verified
on remote main. The implementation finding is closed after delivery, without
waiting for publication. Scoped release 33952547645 and CLI release 33952547762
are monitored separately; their initial running state is not release success.

### 24. SafeJS skill accuracy — delivered and released

Actual CLI probes and current loader/registry source contradict the skill's claim
that the standalone stub validates schema-based Markdown/JavaScript harness pairs.
The Markdown pair failed parsing; its paired JavaScript failed the absent schema
module check. An isolated raw .safejs probe passed, and the real harness runner
validated and executed the pair with zero spawns. The template now distinguishes
those routes and makes clear that the real runner is not a dry-run.

Concrete built-runtime probes also showed ordinary user-constructor prototypes,
instanceof, and suspended synchronous generator checkpoint restoration working.
The blanket unsupported claims were removed, while built-in prototype coverage,
copy/snapshot restrictions, and pending-effect reconciliation remain explicit.
No speculative runtime repair or wording-only regression test is added for these
already-working behaviors. Skill synchronization, the skill validator, focused
CLI/harness tests, and diff checks qualify this separate documentation commit.

Validation passed: npm run sync-skills updated the six installed SafeJS copies;
the skill validator passed; 122 maintained focused sync/harness-command tests
passed. Fresh built CLI checks again passed for the standalone .safejs probe and
the paired real harness with zero spawns. The correction changes Markdown only;
the preceding integrated full build, unit, and lint gates cover unchanged runtime
code. Diff checks pass, and the skill's invocation policy is unchanged.

Documentation commit 0907b00b3cf11f34988b0298a190b1e1a4388e34 is pushed and
verified on remote main, closing the documentation finding before publication.
Scoped release 33952613841 and CLI release 33952613932 are monitored; the latter
supersedes the iterator commit's canceled CLI validation, so that canceled run
is not claimed as a release. Publication still requires terminal publisher proof.

Publication is now verified in terminal publisher logs. The iterator scoped run
published SafeJS 0.1.112 on September 5, 2026 at 07:30:50 UTC. The documentation
descendant's scoped run 33952613841, publisher 101270522661, published SafeJS
0.1.113 at 07:35:01 UTC. Its successful CLI run 33952613932, release-stable job
101271199994, published poe-code 14.0.52 at 07:38:29 UTC and the GitHub release
at 07:38:30 UTC. That descendant CLI contains both atomic improvements.

### 25. Array method receivers — validated repair

Built comparisons reproduced borrowed push, map, and slice acting on the lookup
array instead of the supplied receiver, beside two passing direct-call controls.
A new native-comparison cohort covers all 33 exposed Array methods: ordinary
arrays, sparse array-like records, null/undefined receivers, and direct calls.
Before implementation, 125 of 165 tests fail and 40 pass. Additional cases cover
call/apply/bind, detached invocation, callback thisArg/receiver identity, shadowed
method names, inherited elements, length coercion, and readonly/deletion failures.

The member factory captures the lookup array. Several operation bodies also call
array instance methods directly, assume a numeric array length, or access raw
properties instead of the guest property model. A receiver-only substitution is
therefore insufficient for generic array-like records. Repair must preserve
callback identity, holes, mutation effects and partial failures, budget accounting,
and snapshot/replay behavior. Validate those with native comparisons before
claiming the repair. Primitive boxing and complete built-in prototype graphs
remain explicit broader language gaps, not assumptions of native parity.

The expanded native cohort reproduced 136 failures with 41 passing controls.
The implementation now honors the supplied receiver. Generic array-like reads,
presence checks, assignments, and deletion use an internal view of the guest
property model; callbacks and returned values retain the original guest object,
not that internal view. Length is converted once for the operation. Mutation
helpers no longer call potentially shadowed receiver methods. Primitive boxing
is still unsupported rather than represented by a fake ordinary-object wrapper.

The first focused implementation passed 197 tests. Six additional admission/read
order regressions then failed with 178 controls passing. Two argument-coercion
regressions extended that evidence to eight failures with 179 passing controls.
Slice and copying methods now check output capacity before element access,
preserve captured length across coercion, skip removed toSpliced elements, and
read toReversed elements in reverse order. Four callable/typed-receiver failures
then showed where raw host property operations missed guest state; those paths
now use the interpreter's property operations, including callback identity and
partial deletion before readonly-length failures.

The first package run found an introduced with regression: a raw inherited host
entry became visible. Its existing quarantine test was preserved and the boundary
restored, while generic guest-prototype reads remain supported. Two new missing-
property probe tests reproduced uncharged indexOf/lastIndexOf scans; reverse was
a passing control, not another reproduced failure. The combined three-file
cohort now passes 256 tests. An early TypeScript build exposed the array-like
type's missing explicit numeric index signature; that is fixed, and a subsequent
23-workspace selected build with four native ESM checks passed. Fresh final
build/package gates are running after the last safety corrections.

Manual CLI validation plan: use a temporary schema-only harness pair with no
agent, filesystem, MCP, or environment capabilities. Borrow map/push/pop onto a
sparse record, assert the lookup array remains unchanged, and return a readable
JSON summary. Run the maintained screenshot route, verify zero spawns and success,
and inspect the PNG. Temporary fixture files are manual QA artifacts, not unit
test disk writes. Final lint, built API/replay checks, atomic commit/push, and
release qualification remain required; this Array finding is not closed yet.

The first final gates passed: 23 selected builds, four fresh-process import tests,
11,029 package tests with 41 skipped, and root lint over 9,748 configured files
with zero errors/warnings plus type/workflow checks. The no-spawn screenshot
passed and was visually inspected. Built root/core comparisons passed 24 cases;
two pending replays, two completed replays, and two capacity/step checks passed.
The first pending probe incorrectly requested capture mode during a host call;
the existing reentry guard correctly rejected it. Explicit replay mode fixed
that probe without a runtime change.

Subsequent live-data review reproduced a retained-receiver accounting gap for
both arrays and generic records: clearing the guest binding during a callback
left the method's still-live source uncounted. Four new tests failed with 195
controls passing. A per-call retained root now holds the receiver across coercion
and callbacks and is released in finally on success or failure. The three-file
cohort passes 260 tests, including rejection at dataSize 7,000 and success at
10,000. The earlier broad gates do not qualify this final source change; fresh
build, package, screenshot, and lint gates are required before delivery.

Fresh final gates after the retained-root change pass: all 23 declared builds in
the selected SafeJS closure, four fresh-process ESM checks, and the full package
suite with 11,033 passed tests and 41 skipped. The rebuilt no-spawn harness again
passed and its screenshot was visually verified. After screenshot preparation
finished, built root/core probes passed 12 native comparisons, four live-data
checks, and a pending async-callback replay with its receiver retained after the
guest binding was cleared. Final root lint passed all 9,748 configured files with
zero errors/warnings, followed by successful type and workflow checks. These
qualify the Array receiver repair for its own atomic commit and push; delivery
and publication remain separate steps. Primitive boxing below is not included
or claimed complete.

The initial push of 79cb29afd was rejected because main had advanced through
e4b4c185b. The incoming child-dispatch cleanup was merged without changing the
user's staged three-file SafeBash patch (its binary-patch SHA-256 remained
e9c7047e5ec094d9e142a8115773da7849c2c19c45a418bdc61f61498875523d).
Post-merge qualification passed: all 70 declared workspace builds and root
suffix stages; 11,033 SafeJS tests with 41 skipped; 114 focused cleanup/array
tests plus one exact registration test, all passing without skips; and root
lint over 9,749 configured files with zero errors/warnings, then type/workflow
checks. The cleanup cohort is scoped evidence, not a full SafeBash gate or
closure of the separate heredoc issue. The integrated Array fix is ready for
a normal push; remote delivery and publication still require verification.

Delivered: a normal push and independent ls-remote confirmed main at
2fab41597c6fd5e449e19705ade8fe2dc9f08962, containing the atomic Array repair
79cb29afd and the integration commit. The Array finding is fixed and closed
at remote-main delivery, without waiting for release. Scoped run 33954384092
and CLI run 33954384170 are monitored separately; publication is not yet claimed.

Scoped publication is verified: run 33954384092 and publish job 101274907273
succeeded, publishing @poe-platform/safe-js 0.1.115 on September 5 at
08:11:14 UTC. Bulk log download timed out; the job-specific API log succeeded
and contains the publication receipt. CLI validation remains separately monitored.

CLI run 33954384170 succeeded, including all validation jobs and release-stable
job 101276302770. That job explicitly skipped publishing because its local main
was behind remote main. There is no standalone CLI publication from this run;
verify a published descendant containing the Array commit instead.

### 26. Primitive boxing — qualified locally; main delivery pending

Eight built native comparisons fail: Object boxing of number/string/boolean,
new Number/String/Boolean wrappers, Array.map on a string primitive, and
Array.slice on a number primitive. Ordinary Object identity and the three
primitive conversion calls pass as two controls. Wrapper construction and
boxing are therefore a concrete next capability, not a speculative limitation.
The repair must preserve boxed value identity, coercion, string indexing and
readonly properties, method receivers, budgets, and snapshot/host boundaries;
an ordinary record pretending to be a boxed primitive is not a complete repair.
Implementation is now in progress; no delivery or completion claim is made yet.

After §47 delivery, begin the full boxing capability. The first broad TDD matrix
reported 48 failures and three apparent receiver controls; move method lookup
outside those controls' try blocks so missing prototypes cannot impersonate
correct brand checks. Add generic Array ToObject cases and a primitive-conversion
identity control. The resulting 56-case suite reports 54 failures and two
controls. No runtime boxing implementation has been changed yet. Tests cover
Number/String/Boolean constructors and Object conversion, private payload and
borrowed methods, string UTF-16 indices/read-only descriptors, prototype identity,
generic array receivers, JSON/structuredClone, host copies/aliases, checkpoint
restore and fatal constructor-conversion budgets.

Current-code audit: Object's constructor/valueOf explicitly rejects primitives;
the three primitive constructors lack construct hooks; Number methods reject
boxed receivers; String lacks its toString/valueOf intrinsic methods, and
Boolean member lookup returns undefined. Host copying rejects unsupported
objects or explicit guest prototype state. Heap dumps, interpreter snapshots
and replay-data graphs each have separate value encoders/decoders. Implement a
genuine boxed payload with controlled guest prototypes, preserve data-boundary
identity and encoded payloads, and account for budgets/cleanup across all these
paths. Do not substitute ordinary records for actual wrapper semantics.
The implementation uses genuine native wrapper slots with detached host
prototypes, a private sandbox brand and budget-owned guest prototypes. Two test
fixture defects were identified and corrected: the native VM needs an explicit
structuredClone binding and deepCopyFromSandbox comes from values, not core.
The six affected initial failures are not evidence of runtime defects. The
other reproductions and the original built/native probes validate this gap.
Frozen ECMAScript 2026 constructor sections are the normative reference.

The first runtime implementation passes the basic 66-test storage/behavior cohort.
Additional tests reproduce and repair primitive Object.assign/getPrototypeOf and
unwanted coercion during null/undefined equality. Broader package validation
exposes budget overhead and duplicate String receiver retention: keep unchanged
intrinsic methods on maintained fast paths, use shared prototypes for overrides,
and exclude implicit prototype graphs from constructor accounting. The focused
627-test regression cohort passes without increasing budget limits. Explicit
prototype mutations remain budget roots and are cleared on realm close.
New boundary tests preserve special numeric payloads, alias cycles, host wrapper
brands, checkpoint replay and malformed-payload rejection; one real failure
shows boxed host strings bypassed stringLength. Apply the existing budget check
before copying their payload. Full build/test/lint and real CLI QA remain pending.

Further fidelity tests validate boxed String iteration (Unicode code points and
guest toString overrides), immutable Number constants, and frozen/non-enumerable
wrapper metadata. A hidden cyclic property originally overflowed heap indexing;
index all boxed data descriptors and share the boxed heap encoding/validation.
Private interpreter restore tests verify payload, aliases, frozen state and
hidden descriptors, independently of public replay. Iteration conversion occurs
before consumption while preserving Array.from's construct-before-conversion
order; an incorrect initial ordering assumption was corrected against native
execution. Converted text is retained during iteration and released with its
consumer. Public checkpoint tests show conversion executes once, and step
failures remain fatal. The maintained SafeJS suite now passes 12,688 tests with
41 skipped. A suspected intrinsic-assignment budget issue is disproved by the
ordinary-record control: both peak at roughly twice the retained string during
assignment, consistent with existing accounting; do not add a speculative fix.

Manual boxing QA uses the schema-only primitive-boxing.md/.ajs fixture with zero
capabilities/spawns. Validate constructor coercion, UTF-16 length versus Unicode
iteration, Boolean wrapper truthiness, alias identity, structuredClone payload,
immutable String indices and frozen negative zero. Run it via the real CLI and
inspect its screenshot, then run full npm test and root lint on frozen sources.

The normal build and real CLI fixture pass; the inspected screenshot shows
7/8/3/2/false/true, preserved identity, copied payload, readonly indices and zero
spawns. Built public probes pass eight fatal-budget recoveries without repeating
completed effects, a suspended delegated-generator checkpoint, twenty realm
cleanup cycles, twenty canceled-iteration cleanup cycles, and three boxed host
result replays. Cancellation preserves AbortController's AbortError reason; an
initial probe incorrectly expected a budget error code and was corrected without
changing runtime behavior. A converted-text retention probe rejects the larger
live state while its small-input control succeeds at the same limit.

Before delivery, a direct public-restore probe validates a new metadata flaw:
omitted boxed extensibility is rejected normally but accepted when inherited
from Object.prototype. Stop the owned lint process (exit 143, not a passing
check) before editing. Two failing tests reproduce inherited extensibility and
properties; require own fields throughout the boxed schema, including descriptor
flags, and share this validation with replay data. Five inherited-metadata tests
cover the repair. Rebuild and rerun the full gates on the corrected sources.

That rebuild passes. The metadata preflight passes 211 tests; polluted-prototype
tests capture failures before making assertions so the test framework itself is
not affected by inherited writable flags. Public restore also rejects inherited
payload metadata. Root lint passes 9,778 configured files, zero errors/warnings,
TypeScript and workflow checks. The following full npm test is deliberately
stopped through its owned runner after a further concrete budget reproduction;
its partial run is not reported as passing.

The reproduction converts a temporary left Number wrapper to a 4,000-character
string, then runs a right-hand conversion with a 3,000-character host argument.
The former binary root retained the original wrapper but not its converted
operand; four tests show the oversized live state reaching a host effect. Retain
the current left operand as it is converted. Compound operators have the same
conversion interval: four more failing tests show either no rejection or a
rejection only after the host effect. Retain their converted left value until
the right conversion completes, without double-registering primitive inputs.
The 536-test interpreter/budget cohort passes, including the smaller-input
control. Requalify this corrected tree before its atomic commit and main push.

Final qualification passes on the corrected sources: the maintained SafeJS
workspace suite has 12,702 passing tests and 41 skips, including 144 additional
regressions/controls. The normal build, full npm test and root lint all exit zero.
Full tests include the 32,562-pass shared cohort, 29 Python tests, 279 Bash-runner
tests, 19,981 Bash tests (63 skips), 288 shell-stress tests and two lint-stress
tests. Root lint covers all 9,778 configured files with zero errors or warnings,
followed by successful TypeScript and workflow checks. The rebuilt zero-spawn
CLI harness passes and its screenshot is inspected. Four final built/native
comparisons also confirm that String-wrapper iteration conversion does not run
guest promise jobs before Promise.all, Set, spread or Array.from completes its
synchronous prefix. Public budget-recovery probes retain converted binary and
compound operands before host effects and replay completed effects only once.
This is ready for its own commit and push; publication is not yet claimed.

### 27. Number formatting coercion — delivered and released

Built comparisons exposed guest valueOf/toString hooks bypassed by raw host
Number conversion. Separate controls reproduced incorrect RangeError results
for Infinity.toExponential(101) and NaN.toPrecision(101); primitive ordinary
formatting, invalid receiver ordering, and ignored extra arguments passed.
The 84-case native comparison regression cohort fails 70 cases with 14 passing
controls before implementation, across four methods, call/apply/bind, inherited
and async hooks, thrown values, receiver identity, and non-finite validation order.

Route the formatting argument through sandboxNumber with the current call
context, then let the native Number method perform its own numeric validation
in its specified order. This removes duplicate range/integer conversion logic.
Preserve undefined and synchronous primitive results; await guest coercion in
the interpreter's direct-call path. Existing low-level object/array comparisons
must await potentially asynchronous coercion without weakening their assertions.
Qualify budgets, built entrypoints/replay, maintained build/package/lint gates,
and a zero-spawn screenshot before this improvement's own commit and push.
This does not implement boxed primitive values or claim full Number parity.

The first focused gate passed 93 tests. A further guest-data probe showed that
clearing the argument binding in an arrow valueOf hook could hide its payload
while the fallback toString still needed the argument. Three new tests fail
with 85 passing controls; step exhaustion remains fatal. Retaining that argument
for object coercion and releasing it in finally closes this reproduced gap.
The combined formatting cohort now passes 97 tests. Synchronous primitive calls
remain synchronous. Fresh maintained build and full package qualification follow.

Manual CLI QA: use a temporary schema-only .md/.ajs pair with no agent or other
capabilities. Assert guest digits conversion, borrowed hexadecimal formatting,
non-finite exponential formatting and hook order, return a compact JSON summary,
then run the screenshot route and visually inspect the success/zero-spawn output.

The selected 23-workspace build and four native ESM checks passed. Built root/core
probes passed eight native comparisons, four live-data checks and a pending
coercion-hook replay. The first full package run found one introduced regression
with 11,120 passing tests and 41 skipped: native RangeError wording differed from
the existing interpreter contract. Keep that test unchanged; normalize only
native formatter range failures to the existing messages after native validation,
leaving guest-thrown error identity and messages untouched. Four new hook-error
controls and the original interpreter tests verify that boundary. Fresh final
gates are required after this correction.

Final qualification passed: 578 focused tests, all 23 selected workspace builds
and four fresh-process ESM checks, then 11,125 package tests with 41 skipped.
The maintained screenshot route rebuilt successfully; the zero-spawn formatting
harness passed and its PNG was visually inspected. After that rebuild, root/core
probes passed ten native comparisons, four retained-data checks and one pending
coercion replay. Root lint covered 9,750 configured files with zero errors or
warnings; types and workflows also passed. This qualifies the Number repair
for its own atomic commit/push, not a claim of remote delivery or publication.

Delivered: commit 8dfbd443e02b28d9c4660147f3f9e65132de4ac7 was pushed normally
and independently matched remote main. The Number formatting finding is fixed
and closed at that delivery, without waiting for publication. Scoped release
33954902467 and CLI release 33954902599 are monitored separately. The user's
staged SafeBash patch hash remains unchanged.

Scoped run 33954902467 and publish job 101276325399 succeeded, publishing
@poe-platform/safe-js 0.1.116 on September 5 at 08:22:23 UTC. The job-specific
publication log verifies that result. CLI run 33954902599 remains separately
monitored; scoped publication does not prove a CLI release.

CLI publication is now verified: run 33954902599 and release-stable job
101277565743 succeeded, publishing poe-code 14.0.53 on September 5 at
08:30:44 UTC. The GitHub release was published in the same second, and a remote
tag check maps v14.0.53 to 8dfbd443e02b28d9c4660147f3f9e65132de4ac7.
This published descendant includes both the Array and Number improvements.

### 28. String method receivers — delivered and released

Built native comparisons show borrowed slice and toUpperCase using the lookup
string, includes ignoring a guest object receiver's toString, and slice accepting
null rather than throwing. Direct slice is a passing control. The member factory
captures the lookup string. Fix separately with receiver/coercion-order tests,
budgets, async callback and replay checks; do not fold it into Number formatting.

A broader built comparison now reproduces the guest-object receiver/coercion
failure for all 31 exposed String methods, with matchAll materialized only to
compare receiver-dependent output. This is not a claim of iterator protocol
parity. No String source has been changed while qualifying Number formatting.

The initial 259-case receiver cohort failed 210 cases with 49 passing cases.
The first receiver implementation leaves six failures with 275 passing tests
across the new and existing method files. All six use a string search argument,
including the direct-call control: search currently explicitly requires a regex.
Those six failures are not all receiver failures. Correct the new receiver-only
fixture to the supported /t/ argument and track string-pattern construction as
the independent capability below, rather than bundling it into this improvement.
The receiver fix uses the actual call context, sandbox string coercion, nullish
rejection and the normal callback invocation path. Further safety and delivery
gates remain required.

The corrected receiver cohort plus existing String tests passes 281 tests.
Three additional retention tests then fail with 261 passing controls: clearing
the guest binding during toString can hide the receiver while valueOf fallback
still needs it. Retain the receiver across coercion and method execution and
release it in finally after success/failure. The combined suite now passes 286
tests, including fatal step exhaustion in coercion and replacement callbacks.
The selected 23-workspace build and four fresh-process ESM checks pass; the
full SafeJS package gate is running.

Manual CLI QA: use a temporary schema-only zero-capability harness pair. Borrow
trim and replaceAll onto an object, check coercion/callback order and callback
this/input, verify null rejection, and return a compact summary. Run the maintained
screenshot route and inspect the readable success and zero-spawn output. Also
verify built root/core comparisons, retained-data checks and pending coercion/
replacement replay after the final build. Lint and its own commit/push follow.

The first full package run found 29 failures with 11,360 passing tests and 41
skipped. Native probes confirm that detached String methods and unbound String
replacement callbacks throw; explicit binding works. Older ownership/stack and
well-formed fixtures assumed automatic binding. Supply explicit receivers/binds
while preserving their ownership, diagnostic and arity assertions, and assert
native detached/nullish behavior separately. Low-level localeCompare calls now
await the intrinsic and supply thisValue; preserve exact work/deadline charging,
fatal identity, accessor rejection and native-call boundaries. The nine-file
focused contract suite passes after those fixture corrections.

A built replay probe initially expected every host call to reissue. Inspection
showed that unawaited pause() calls let later replacement effects complete before
the snapshot: only the coercion-emitted effect was pending in that case. The
replacement-emitted case had two pending effects. Replaying consumed effects
without reissuing them is correct; no replay implementation change is justified.
The corrected probe must assert the snapshot lifecycles and reissue only pending
effects, rather than claim an ignored promise suspended the guest hook body.

Final qualification passed: 417 tests in the nine-file focused cohort, the
23-workspace selected build and four fresh-process ESM checks, then the full
package suite with 11,389 passed tests and 41 skipped. Corrected built probes
pass eight native root/core comparisons, four retained-data checks and two
pending-effect replays with explicit journal lifecycle assertions. The maintained
zero-spawn harness screenshot route rebuilt successfully and its PNG was visually
inspected. Root lint passed all 9,751 configured files with zero errors/warnings,
then types and workflows passed. This qualifies the receiver repair for its own
atomic commit/push; delivery and release require separate verification.

Delivered: e1695d1487a48a89460b4f67b5438b26eda0e518 was pushed and matched
remote main. The receiver finding is fixed and closed at that delivery. Scoped
run 33955601971 and publish job 101278260658 succeeded, publishing
@poe-platform/safe-js 0.1.117 on September 5 at 08:39:11 UTC. CLI run
33955602097 and publish job 101279507328 also succeeded: poe-code 14.0.54
was published on September 5 at 08:46:19 UTC. The remote v14.0.54 tag resolves
to the exact delivered commit. The next goal turn revalidated main and the
unchanged user staging before starting pattern construction.

### 29. String search pattern construction — delivered; release monitored

Native ' Otter '.search('t') returns 2; SafeJS throws its explicit regex-only
TypeError. This also affected five borrowed receiver fixtures before their input
was narrowed to the supported regex form. Implement native pattern construction
for supported non-regex inputs as its own atomic improvement, with failing tests,
coercion order, regex admission/budgets and invalid-pattern tests. This gap remains
open; changing the receiver fixture does not fix or close it.

Twelve further built comparisons reproduce the same unsupported construction
across search, match and matchAll: string, undefined, numeric and guest toString
inputs. Treat this shared pattern-construction capability as one subsequent
atomic improvement. Materializing matchAll output for these comparisons does
not qualify its iterator protocol, which is separately validated below.

The 90-case pattern regression cohort initially failed 78 cases with 12 passing.
Three supposed regex-input controls used the unsupported sticky y flag; those
are not pattern-construction regressions. Use supported g/i modes for those
controls and retain sticky matching as a separate open language gap. The first
implementation passes 376 tests across three focused files. Pattern inputs now
use sandbox string coercion with the call context, then compile through the
existing guarded regex engine. Undefined creates an empty pattern; matchAll
construction supplies g. Existing regex inputs retain their original path.

Four further tests fail with 94 passing controls: the pattern can become hidden
from live-data accounting after its binding is cleared during coercion, and the
internal matchAll path can exceed its output array limit. Retain the pattern
through coercion, clean up retained roots and temporary compile ownership in
finally, and check match-array growth before appending. The focused suite now
passes 384 tests, including compile length/syntax failure cleanup and fatal step
exhaustion. A separate haystack-retention probe already enforced its data limit;
do not invent an additional repair for that passing boundary.

The selected maintained build passed before the full package gate. Manual CLI
QA will use a schema-only zero-capability pair: search a coerced pattern, match
capture groups, materialize matchAll output, verify hook order and invalid-pattern
rejection, then inspect the screenshot. Built root/core native comparisons,
retained-data/array admission, and pending-effect replay must pass before lint
and this improvement's own commit/push. Iterator protocol, constructor input
semantics, unsupported regex flags, and primitive boxing are not claimed fixed.

Those gates passed: 23 selected workspace builds and four fresh ESM import
checks; 11,487 package tests with 41 skips; the paired CLI harness and visual
screenshot inspection; 12 built root/core comparisons, four retained-data checks,
two array-admission checks and one pending-effect replay; and root lint across
9,752 files with zero errors/warnings plus types and workflows. However, a final
low-level ownership probe then showed one guest coercion hook running before
foreign-owner rejection. Three new tests reproduced that ordering defect with
98 passing controls. Acquire compile ownership before coercion, then release it
and retained roots in finally. All 387 focused tests pass, including foreign,
stale and missing owner rejection. Re-run final build/package/built/CLI/lint gates
for this correction before the pattern-construction commit and push.

Final correction gates: 23 selected builds and four ESM import checks passed;
the SafeJS package passed 11,490 tests with 41 skips. Built root/core passed
12 native comparisons, four retained-data checks, two array-admission checks,
three pre-coercion ownership checks and one pending-effect replay. The repeated
schema-only paired CLI run passed after 70 uncached builds; its screenshot was
visually inspected again. Final maintained root lint is the remaining gate.

Final root lint passed all 9,752 configured files with zero errors/warnings;
types and workflows also passed. The final source is qualified for its atomic
commit and main push. Delivery and publication are verified separately.

Delivered and closed: f54dbc1b6cb6162f7452fbe725d6a778fcecc50f was committed,
pushed and verified against remote main. Scoped release run 33956590050 and
CLI release run 33956590155 are monitored while the next constructor repair is
implemented. User SafeBash staging remains unchanged.

Scoped run 33956590050 and publish job 101280918830 succeeded, publishing
@poe-platform/safe-js 0.1.118 on September 5 at 09:00:24 UTC. CLI publication
from run 33956590155 remains separately monitored.

### 30. RegExp constructor input semantics — delivered and released

Three built native comparisons fail: null becomes an empty pattern instead of
the string 'null'; guest pattern/flags coercion throws rather than running the
hooks in order; and RegExp(existingRegex) loses identity/source/flags while new
RegExp(existingRegex) also loses source/flags. Ordinary string pattern/flags is
a passing control. Keep constructor call-versus-new behavior, explicit flags,
lastIndex reset, coercion, compile ownership, budgets and snapshots in scope
when repairing this separately. No implementation has been made yet.

Further native comparisons validate null flags being accepted incorrectly,
explicit flags losing a cloned regex's source, ordinary RegExp.call losing
identity, and guest flags coercion failing before its hook can run on an invalid
pattern. Empty construction is another passing control. Preserve owner rejection
before guest effects when adding constructor coercion; the pattern-method repair
above exposed why this order matters.

The 94-test native constructor matrix failed 52 cases with 42 passing controls.
Implement constructor input semantics through sandbox string coercion and the
guarded regex engine, preserving ordinary-call identity, clone cursor reset,
explicit flags, undefined defaults and pattern-before-flags coercion. Share the
caller Budget explicitly instead of coercing guest records with host String.
Compile ownership is acquired before any guest hook or identity shortcut.
The first four-file cohort passes 277 tests.

Ten admission tests then fail with 100 passing controls: inputs needed by
fallback coercion and a produced pattern needed during flags coercion disappear
from live-data accounting. Retain input arguments and the produced source until
finally; check success/failure cleanup, pre-hook owner rejection, fatal steps,
compile syntax and string limits. All 293 tests in the four-file cohort now pass.
The selected maintained build and full package gate follow. A schema-only paired
CLI fixture will check cloning, coercion order and null flags; built root/core
comparisons, data admission, pending-effect replay and root lint must pass before
this repair's own atomic push. Missing RegExp intrinsic properties, overridden
constructors, unsupported flags, and method receivers are not claimed fixed.

The selected build passed all 23 workspace builds and four fresh ESM import
checks. The full SafeJS package passed 11,600 tests with 41 skips. Built root/core
passed 16 native comparisons, 12 retained-data checks, four ownership checks and
two pending-effect replays (one each in pattern and flags coercion). The paired
CLI run and screenshot inspection precede the final maintained root lint gate.

The schema-only zero-capability CLI pair passed after 70 uncached builds and
the resulting screenshot was visually inspected: successful harness output,
coherent layout and zero spawns. Final maintained root lint runs with source
and build outputs frozen; commit and push only this constructor improvement.

Final root lint passed all 9,753 configured files with zero errors/warnings,
then types and workflows passed. An additional 48 built comparisons passed for
empty/escaped/slash/line-terminator sources, flag combinations, identity and
clone cursor behavior. This constructor repair is qualified for its own commit
and main push; remote delivery and publication remain separate checks.

Delivered and closed: b939a8af594418e90d2650b6bc7b0ee75f47d48e was committed,
pushed and verified on remote main. Scoped run 33957033340 and CLI run
33957033522 are monitored. The previous String-pattern CLI run 33956590155
was cancelled during unit validation and its release job was skipped: do not
claim CLI publication for it. Release validation uses cancel-in-progress on
main, so follow the constructor descendant for delivery of both changes.

Scoped run 33957033340 and publish job 101282112459 succeeded, publishing
@poe-platform/safe-js 0.1.119 on September 5 at 09:09:34 UTC. The CLI release
remains separately monitored; scoped publication is not proof of CLI publication.

### 31. String matchAll iterator protocol — validated open gap

Two built native comparisons fail: native matchAll returns a non-array with a
next method, but SafeJS returns an array without next; consuming the same native
iterator twice yields lengths [2,0], while SafeJS yields [2,2]. The receiver fix
does not repair this. A future iterator implementation needs lazy consumption,
regex cursor ownership, budgets, snapshots and all iterator consumers, not just
a next wrapper around an eagerly materialized array.

### 32. RegExp flags beyond g/i/m/s — validated open gap

The parser accepts only global, ignore-case, multiline and dotAll flags. Existing
rejection tests and a fresh literal probe confirm sticky y is rejected before
execution; native accepts it. Unicode u is likewise explicitly rejected by
existing parser tests. Full flag/Unicode/index-mode coverage needs its own native
matrix and engine work, not relabeling these unsupported modes as passing controls.

### 33. RegExp method receivers and input coercion — delivered and released

Built native comparisons show /a/.test.call(/b/,'b') returning false instead of
true; a detached /a/.exec accepts a call that native rejects with TypeError; and
a guest toString input to test throws rather than invoking the hook and matching.
Keep receiver branding, extracted invocation, cursor ownership and input coercion
as subsequent repairs, separate from String pattern construction and RegExp
constructor inputs.

Further native probes distinguish the two methods: test can dispatch to an
ordinary object's custom exec, passes it the string input with the correct this,
and rejects a primitive exec result. SafeJS instead uses the original regex and
skips that hook. For an ordinary receiver without exec, native test coerces the
input before failing; native exec rejects that receiver before coercion. Three
comparisons fail and the exec rejection-order control passes. Do not implement
a blanket regex-brand check for test: that would preserve another real gap.

Fresh native comparisons on delivered main reproduce the failures. The 87-case
method matrix fails 62 cases with 25 passing controls. Repair actual receiver
selection, once-only sandbox input coercion, custom exec lookup after coercion,
custom receiver/argument dispatch, object-or-null result validation, and async
custom exec object results without awaiting their guest promise. Keep exec's
regex brand check distinct from test's object requirement. The behavioral matrix
then passes all 87 cases.

Budget probes reproduce loss of a receiver or fallback-coercion input when the
guest clears its binding. Retain receiver and arguments through method execution
and release them in finally. The produced-input budget already works and remains
a passing control. The admission cohort initially has five failures with 89
passes; one of those failures was an incomplete expected match-array shape in
the new success-cleanup fixture, not a runtime defect. Correct that fixture to
include index/input/groups metadata. Existing low-level fixtures now supply the
actual receiver and Budget, and await the coercion-capable internal call; their
cursor and metadata assertions are unchanged. The five-file focused cohort
passes all 512 tests. Build, package, built replay/budget checks, paired CLI
screenshot QA and maintained root lint precede this repair's own atomic push.

The maintained selected build passed 23 workspaces and four fresh ESM import
checks. The full SafeJS package passed 11,694 tests with 41 skips. Built root/core
passed 16 native comparisons, 16 data-admission checks and two pending-effect
replays (input coercion with an extracted exec, and a custom exec callback).
The schema-only zero-capability CLI pair validates actual receivers, once-only
input coercion, custom exec dispatch and detached-call rejection before visual
inspection and final maintained lint.

The paired CLI run passed after 70 uncached builds. Its screenshot was visually
inspected: readable successful result, expected capture/index/custom result and
detached-call rejection, with zero spawns. Run final maintained root lint with
source and build outputs frozen before this method repair's commit and push.

Final maintained lint passed all 9,754 configured files with zero errors or
warnings, then types and workflows passed. Four further built comparisons pass
for Array callbacks with explicit regex receivers, global cursor transitions,
nested custom exec and bound receiver precedence. The method repair is qualified
for its own commit/push; publication remains a separate monitored outcome.

Delivered method repair d01c3b97f1007f6a2560fd627587509080f64bf1 to verified
remote main. Scoped run 33957559841 published SafeJS 0.1.120 at 09:21:10 UTC
on September 5. CLI run 33957559857 published poe-code 14.0.56 at 09:29:10 UTC;
its remote tag resolves to that exact commit. Close this finding at delivery,
with publication independently confirmed. Constructor b939a8af and String
pattern f54dbc1b are also covered by poe-code 14.0.55, published at 09:16:33 UTC;
that tag resolves to b939a8af594418e90d2650b6bc7b0ee75f47d48e.

### 34. RegExp intrinsic properties — validated open gaps

For /a/gims, global, ignoreCase, multiline and dotAll are undefined instead of
true. Its constructor is undefined instead of RegExp. RegExp.length is undefined
instead of 2, and RegExp.prototype is absent. Defining a regex's own constructor
also throws, whereas native allows it and makes RegExp(pattern) clone. This
intrinsic/object-model work remains distinct from supported constructor inputs.
The separate flag reads/existence repair is described in section 36; prototype
and constructor reflection here remain open.
RegExp.escape was undefined in both this Node runtime and SafeJS: that probe is
not evidence of a native-parity failure.

### 35. RegExp lastIndex storage and deferred coercion — delivered; release monitored

Native lastIndex assignment stores an object unchanged without invoking its
valueOf; execution coerces that cursor later. SafeJS calls host Number during
assignment and throws for the guest object. Two built comparisons reproduce
the storage and execution failures. A third shows a string cursor becoming a
number immediately, while native retains the string. Numeric clone reset is a
passing constructor control, not a repair for arbitrary cursor storage. This
requires separate coercion, retention, regex value types and snapshot work.

A fresh Infinity cursor comparison also fails: native /a/g with lastIndex set
to Infinity produces no match and resets to zero; SafeJS instead matches from
zero and ends at one. Include ToLength saturation in the deferred-coercion work.
A public negative-cursor run and snapshot restore passed, so do not label that
path broken based only on the legacy snapshot validator's numeric restrictions.
Audit graph traversal, copying, legacy and replay snapshots when adding object
cursors, rather than changing assignment alone.

The initial runtime matrix reproduced 166 failures with 107 passing controls;
the graph/copy matrix reproduced 35 failures with 12 controls. Store arbitrary
sandbox values, defer sandbox-number conversion until execution, saturate
ToLength at MAX_SAFE_INTEGER, and preserve each String consumer's cursor phase.
Global match/replace reset before conversion; search restores the raw cursor;
matchAll converts its copied cursor; split and structuredClone ignore the old
cursor. This does not repair matchAll's eager-array result or unsupported flags.

Regex cursor data now participates in data accounting, graph copies, host
exports and replay encoding. Snapshot regex-object heap entries preserve aliases,
cycles, closures and special numeric cursors; ordinary unshared numeric snapshots
retain their legacy representation. Host exports deep-copy cursor data and reject
unregistered closures. Native structuredClone creates a fresh regex with cursor
zero and preserves graph aliases without inspecting discarded cursor contents.

The first full package run had three legacy assertions expecting raw host-mutated
cursor objects to remain shared after export. Update those identity expectations
to the isolated copy boundary, retaining source/flags, native descriptors, regex
aliases and no-coercion assertions. A host-only Symbol.toPrimitive property is
not silently exported as a guest capability. Do not special-case that fixture.

Two additional RED probes found replacement cursor retention and an unowned
structuredClone compile scope bypass. Retain regex/cursor/replacement through
coercion and callbacks; select an owned compile scope before cloning. The focused
four-file cohort then passed 375 tests. Four further capability/reference and
pending-effect replay checks pass: callable cursor data requires explicit replay
capabilities, dangling cursor references reject, and snapshots taken with one
running effect before/inside coercion retain cursor closure and object aliases.
The selected maintained build passes 23 workspaces plus four native ESM imports.
Final package, paired CLI/screenshot and maintained root lint gates follow before
this improvement's separate commit and push.

The full SafeJS package passes 12,024 tests with 41 skips. Built root/core
pass 16 native comparisons and 16 budget checks; five malformed cursor snapshot
cases reject (missing cursor, dangling heap/scope/promise references and invalid
numeric tag). The manual comparison's initial VM control lacked structuredClone;
supplying the native function to that context fixed the control, not runtime code.
The real schema-only CLI pair passes after 70 uncached builds, with zero spawns.
Its inspected screenshot shows stored identity, index 2, Infinity saturation and
isolated cloning. Freeze source/build outputs for final maintained root lint.

Final maintained root lint passed all 9,756 configured files with zero errors
or warnings, followed by types and workflows. The cursor repair is qualified
for its own atomic commit/push; remote delivery and publication remain separate
receipts. The unrelated staged Safe Bash patch hash remains unchanged.

Committed and pushed 6d523173db34fb2142f4c3847cc649849ee5cf03; remote main
independently resolves to that exact SHA. Close the cursor finding at verified
delivery. Publication is being monitored while flag-property work proceeds.

Scoped run 33958730407/job 101286685090 published SafeJS 0.1.121 at 09:46:47 UTC
on September 5. The CLI run 33958730542 remains in validation; scoped publication
is not a claim that the CLI version has shipped.

The next atomic main push superseded cursor CLI validation: run 33958730542 is
cancelled and release-stable job 101287507305 was skipped. Do not call that a
successful CLI publication. Continue monitoring the descendant release that
contains the cursor repair.

### 36. RegExp flag reads — delivered; further object/engine gaps open

Across all 16 supported g/i/m/s flag combinations, the eight native boolean
properties (hasIndices, global, ignoreCase, multiline, dotAll, unicode,
unicodeSets and sticky) return undefined and fail property-existence checks.
The 16 controls for existing flags strings, read-only assignment and empty
enumeration pass. Repair reads/existence independently from the absent intrinsic
prototype graph; false for unsupported flags does not implement those flags.

Further built/native probes reproduce three separate failures: named capture
groups are rejected during parsing, /a/.toString() throws instead of returning
the slash-delimited source, and deleting inherited global throws instead of
returning true. RegExp own-property reflection also rejects the receiver.
Record these as open work, not as functionality delivered by cursor support.

The flag-read unit matrix reproduces 16 failures with 16 passing controls.
Map the standard property names to their flag characters in getRegexMember;
existing existence checks then see both true and false values, while assignment
and own-property/enumeration rules remain unchanged. The focused cohort passes
362 tests across flag reads, cursor behavior and cursor graph/replay boundaries.
This small read/existence repair does not implement prototype descriptors,
deletion, toString, named groups or unsupported matching flags. Run maintained
build/package/CLI screenshot/root lint gates for its own atomic delivery.

The selected build passes 23 workspaces and four native ESM import checks. The
full SafeJS package passes 12,056 tests with 41 skips. Built root/core pass 32
native comparisons and two completed-effect replay checks without repeating the
effect. The real schema-only pair passes after 70 uncached builds with zero
spawns; its inspected screenshot shows gims, enabled/disabled flag groups,
inherited existence and read-only assignment. Freeze source/build outputs for
the final maintained root lint gate.

Final maintained root lint passed all 9,757 configured files with zero errors
or warnings, followed by types and workflows. Flag reads/existence are qualified
for their own commit/push. Other object/engine gaps in this section remain open.

Flag reads/existence were committed and pushed as
0363303a4a759ffd63876770966e3e5b992a36d8, independently verified on remote main.
Close that read/existence finding at delivery. Scoped run 33959023752 and CLI
run 33959023817 are monitored separately; neither is yet a publication receipt.

Scoped run 33959023752/job 101287476034 published SafeJS 0.1.122 at 09:54:08 UTC
on September 5. The CLI validation is still monitored independently.

### 37. Converted matching input retention — delivered and released

After input coercion produces a 4,000-character nonmatching string, a cursor
valueOf hook allocates another 4,000-character temporary. With dataSize 6,000,
exec, borrowed match, matchAll and replace incorrectly complete; test correctly
rejects. All five pass with dataSize 14,000. Use nonmatching input to avoid
confounding matchAll's eager output allocation with cursor-time admission.
The live converted input must survive cursor hooks even when it is not retained
by the original argument/receiver. Prioritize this separate follow-up over the
toString method gap; do not bundle it into the completed flag-read repair.

Further toString probes reproduce ordinary and borrowed calls, inherited source
and flags, and source conversion that changes flags. String(regex) and the
Object.prototype.toString RegExp tag already pass and remain controls.

The cursor regression matrix fails seven tests with 280 passing controls.
Direct and coerced String pattern inputs also reproduce the same admission
failure during match/matchAll/search pattern conversion. The expanded cohort
has 13 failures and 381 controls before the fix. Retain matching input in the
three asynchronous String matching helpers; retain newly converted exec input
through cursor coercion. Existing string arguments are already retained, and
test's delegated exec owns its argument, so avoid charging duplicate roots.
An initial unconditional input root broke two success controls through duplicate
charges; adjust the implementation, not those controls' budgets. The corrected
three-file focused cohort passes all 426 tests, including fatal-budget behavior
and dataSize 14,000 success controls. The selected maintained build passes 23
workspaces and four native ESM import checks. Broader qualification follows.

The full SafeJS package passes 12,072 tests with 41 skips. Built root/core pass
24 budget checks and ten low-level success/error retention-cleanup checks. Four
public failure-checkpoint recoveries pass at a raised budget without repeating
completed effects. The initial recovery probe mixed a private unbundled dump
module with bundled public run; it could not see that run's controller. Use the
public dump/restore exports shared with root/core instead. This is a QA fixture
correction, not evidence of a runtime recovery defect.

The real zero-capability pair passes after 70 uncached builds. Its inspected
screenshot confirms the 4,000-character input, executed cursor hook and no match.
The same freshly built CLI rejects the pair at dataSize 6,000 (reported usage
8,850), exit 1. Freeze source/build outputs for final maintained root lint before
this retention repair's separate commit and push.

Final maintained root lint passed all 9,757 configured files with zero errors
or warnings, then types and workflows passed. This fix is qualified for its
own commit and push. The unrelated staged Safe Bash patch remains unchanged.

Committed and independently verified on remote main as
3cc1173d3e8d95683b5619d4aca91bd04973233b. Close this finding at delivery.
Scoped run 33959496560/job 101288757999 published SafeJS 0.1.123 at
10:04:27 UTC on September 5. CLI run 33959496680/job 101289833660 published
poe-code 14.0.57 at 10:11:33 UTC; its remote tag points to that exact commit.
This CLI release also contains the cursor and flag-read fixes in sections 35–36.
The flag-read CLI workflow succeeded without publishing because main had moved;
do not count that green run as a separate release.

### 38. Receiver retention before member operations — delivered and released

Temporary String receivers disappear from accounting while argument expressions
run (match and indexOf), as do Array receivers (includes and join). Computed
member-key evaluation also loses a String or ordinary-object receiver. Initial
4,000-character receiver plus 4,000-character temporary probes incorrectly pass
dataSize 6,000 and have successful dataSize 14,000 controls.

Some whole-operation Object/Map probes reject at 6,000 in a later or construction
phase, so those results do not establish correct argument-time retention. A
phase-isolated probe uses a 2,000-character receiver and an argument function
that allocates 5,000 characters, then throws a catchable marker. String, Array,
Object and Map all return the marker at dataSize 6,000, proving the allocation
completed while the live receiver was unaccounted for. The Object method body
reads this.payload, so do not infer that its receiver can be discarded early.
Address this interpreter-level lifetime separately from matching-hook retention.

The phase-isolated regression matrix reproduces 21 failures across String,
Array, Map, Set and ordinary-object argument evaluation, computed-key
evaluation/coercion, optional access/calls, assignment RHS, compound/logical
assignment, update and deletion. Keep the evaluated receiver and raw key rooted
through one member-access consumer callback, including abrupt completion; do
not alter coercion order as part of this lifetime fix. All five member-operation
callers use that lifetime. Low-budget failures remain fatal and high-budget
controls reach the catchable allocation marker; both release their roots.

Generator lifecycle tests exposed a regression in the initial implementation:
a generator abandoned while suspended inside a member operand never reaches
its finally block, leaving its receiver rooted after run end or realm close.
Two initial realm fixtures used an invalid zero cleanup quota; correcting them
to a positive quota with its sole slot occupied by an extension isolated three
actual cleanup failures. An initial signal-based release registry cleared those
roots and passed 474 focused lifecycle/generator/realm/matching checks, but the
broader cancellation suite subsequently invalidated that design: cancellation
is intentionally catchable, and catch/finally code must retain its normal guest
semantics while new host effects remain forbidden. The full shared stage
reported 16 failures across four files. The strengthened low-budget catch
regression and identity cohort reproduced three failures with 101 controls.

Use an internal reference-release set owned by run/realm resources instead.
Normal member completion unregisters its reference; actual run/realm disposal
releases abandoned references. Do not use cancellation listeners or consume
the public cleanup quota. The realm owns the same set across evaluations and
callback invocations. Paused references remain live until resume or disposal,
including while a caught cancellation evaluates more guest code. The new catch
allocation test must fail on dataSize, not because member access itself rejects
the cancellation. The corrected cancellation/lifecycle cohort passes 262 checks.

The first full maintained npm test route passed, but its shared stage preceded
the lifecycle refinement; it is not the final qualification of that refinement.
The normal maintained npm run build passed afterward. That attempted final
full route found the cancellation regression described above; rebuild and rerun
after the disposal correction before qualification. Before that correction,
built root/core passed 12 low-budget failures, 12 raised-budget checkpoint
recoveries without repeating completed effects, and eight native behavior
comparisons. An initial native comparison JSON-normalized undefined array
entries into null; use structuredClone for the native oracle instead. This
was a probe-fixture error, not a SafeJS mismatch.

After the disposal correction, all 311 checks in the expanded nine-file cohort
pass, including all four files that failed the attempted full route. The normal
maintained build passes. The real schema-only CLI pair passes after 70 uncached
predev builds with zero spawns; its inspected screenshot shows result 2001 and
argument-before-method order. The same built CLI rejects dataSize 6,000 with
reported usage 7,855 and exit 1, using a temporary failure snapshot path.
Fresh built root/core again pass 12 budget failures, 12 raised-budget checkpoint
recoveries without repeated effects, eight native comparisons and two
cancellation controls (allowed catch/finally and budget enforcement inside
catch). A fresh full npm test is running against this corrected code.
Its shared stage passes 31,966 tests with 43 skips across 1,169 passing files
and three skipped files; the Python checks and all 279 native runner prechecks
also pass. Remaining maintained workspace/native tasks are still running.
Forty additional built sequential success/failure runs with abandoned generators
pass disposal and budget-reset/reuse checks. With builds finished and source
outputs frozen, maintained root lint passes all 9,758 configured files with
zero errors or warnings, then types and workflows pass. No source/build edits
were made during that gate; the remaining native unit stage is still running.
The final maintained npm test route subsequently completed successfully:
19,981 native Bash tests pass with 63 skips, terminal-pilot passes 288 tests,
and both root posttest lint-stress checks pass. Its declaration-derived receipt
reports 71 workspaces, two required builds, 40 unit tasks, no exclusions and
uncached execution. Missing optional comparator cases remain pending and
workspaces without declared tests are not counted as passes. This receiver
lifetime fix is qualified for its own commit and push; the staged Safe Bash
patch remains byte-for-byte unchanged.
Committed and independently verified on remote main as
cc107c1ebed22b46ccdbbd2ecf88ec145f1acf5a. Close the receiver-retention finding at
delivery. Scoped run 33961246877 and CLI run 33961246976 are monitored separately;
neither is yet a publication receipt. Continue the validated operand-retention
work while those releases run rather than waiting idle for publication.
Scoped run 33961246877/job 101293388961 subsequently published
@poe-platform/safe-js 0.1.124 at 10:43:31 UTC on September 5. The CLI release
is still monitored separately.
CLI run 33961246976/job 101294636857 published poe-code 14.0.58 at 10:52:39 UTC
on September 5. Its independently checked remote tag points to cc107c1eb.
Receiver retention is delivered and released through both publication routes.

### 39. Repeated object-valued member-key conversion — disproved; already conforms

Historical observations and initial interpretation (withdrawn below):

A native comparison with an object key whose toString records calls shows
three conversions across o[key]++ followed by delete o[key], but SafeJS performs
two. The update path caches its first normalized key for the later write. The
receiver-retention cohort initially included this independent semantic mismatch;
replace that control with an explicitly called string-returning key function to
test expression evaluation order without claiming the object-key gap is fixed.
Before implementation, expand validation to keys that change between conversions,
conversion failures, compound/logical assignment, prefix/postfix updates and
short-circuit controls. Deliver any correction as its own atomic commit/push.

A built/native probe confirms observable wrong writes, not just hook counts:
with a key returning x on its first conversion and y on its second, postfix,
prefix, += and truthy &&= all write x in SafeJS but y in native JavaScript.
Non-taking ||= and ??=, plain assignment and deletion remain passing controls.
The expanded native/built matrix has 40 mismatches and five short-circuit
controls across all 15 compound/logical operators and initial values 0, 2 and
null. Throwing on the second key conversion also shows prefix, postfix, += and
taking &&= incorrectly write instead of throwing without a write.
After intermediate retention reached remote main, the next TDD cohort
reproduces 48 native-key-conversion failures with 90 passing controls, including
both delivered retention suites. The write-key semantic fix is not yet applied;
do not combine it with the already delivered lifetime changes.

Correction: the preceding classification was wrong. These comparisons used
Node v22.23.2 as a normative oracle, but its repeated conversion does not match
ECMAScript 2026. Sections 6.2.5.5 GetValue and 6.2.5.6 PutValue require caching
the converted ReferencedName and reusing it for the write. The frozen standard
is `https://tc39.es/ecma262/2026/multipage/ecmascript-data-types-and-values.html`.
The existing computed-property-keys.test.ts explicitly records that requirement
and warns about Node v22. Its four failing cases in the attempted package run
exposed the erroneous candidate. The candidate was removed before any commit
or push; production interpreter.ts is unchanged from delivered b2e90f90.

The 48 earlier differential failures are not 48 SafeJS bugs, and the changed
key, second-hook throw and second-hook allocation claims above are withdrawn.
Close this finding as a false positive, not as a runtime fix. Keep the earlier
observations here to explain the correction rather than silently rewriting
the investigation history. Strengthen conformance coverage for all compound
and logical operators, key/receiver mutation, numeric-hook mutation, prefix and
postfix results, and absence of a second allocating or throwing hook. Native
fixed-key arithmetic is a control only; conversion count and cached target
expectations come from the specification. Existing conformance tests stay intact.

For subsequent findings, a native differential is evidence to investigate,
not sufficient proof of a defect. Check existing conformance regressions and
the relevant specification before changing behavior that differs from Node.
The corrected 63-case conformance matrix passes without a production change.
The maintained SafeJS package route passes 12,218 tests with 41 explicit skips;
all existing computed-key and retention tests remain intact. Maintained root
lint passes 9,760 configured files with zero errors/warnings, followed by types
and workflows. This is a test/documentation correction, not a runtime fix;
it has no CLI-visible change requiring a new screenshot or production build.
Committed and independently verified on remote main as
53db37dd833ddb3c680e7b025c64f5431ae94f80. The false-positive finding is closed.
Scoped run 33962961941 and CLI run 33962962127 are monitored separately;
neither is yet a publication receipt. Proceed with section 41 while they run.
Scoped run 33962961941/job 101297955623 published
@poe-platform/safe-js 0.1.126 at 11:22:41 UTC on September 5. The CLI route is
still monitored separately.
CLI run 33962962127/job 101299019949 completed successfully. At 11:28:21 UTC
semantic-release reported no release-relevant changes for this test-only
commit, so no new CLI version was published. Do not count green as publication.

### 40. Intermediate operand retention — delivered and released

Separate built probes show three more live values disappear from data accounting:
an assignment RHS while its object-valued key is coerced, an earlier call
argument while a later argument runs, and an earlier array-literal element while
a later element runs. In each case the first value is a temporary 2,000-character
string and the later operation allocates 5,000 characters before throwing a
catchable marker. Both dataSize 6,000 and 14,000 incorrectly reach that marker.
Binding the first value to a named const makes all three reject at 6,000, while
allocating only the 5,000-character temporary succeeds at 6,000. These controls
isolate missing intermediate roots rather than an intrinsically oversized
allocation. This is not receiver retention and is not fixed by section 38.
Add focused failing tests and investigate related argument/literal/operand
lifetimes before a separate correction; preserve cancellation, generator,
resource-disposal and snapshot behavior established by section 38.
Additional built low/high-budget probes reproduce the same marker escape for
an earlier object-literal field, binary left operand, template substitution,
computed object-literal key, spread call argument, spread array element and
constructor argument. These observations expand the investigation; none is
claimed fixed by the receiver-only change.
The next TDD cohort reproduces ten failures with 38 passing controls, including
all delivered receiver-retention tests. Further built probes reproduce earlier
tagged-template substitutions and accumulated values from generator spreads
(array and argument spread), with successful raised-budget controls. The
expanded regression cohort has 13 failures and 38 passing controls. No runtime
fix for these intermediate lifetimes has been applied yet. Investigate shared
run/realm disposal ownership for partial arrays/objects, argument lists,
template values, binary operands and assignment values, and preserve the
cancellation/generator behavior validated for receiver retention.

Revalidate all 13 failures on the current worktree before implementation.
Additional probes reproduce the right-hand object of `in` during key coercion,
the old compound-assignment value after its property is removed, the compound
RHS during left coercion, and a converted compound member key during RHS
evaluation. The expanded matrix contains 17 concrete budget failures.
Retain partially built arrays/objects, accumulated call/template/spread values,
binary operands, and phase-appropriate assignment values through later guest
evaluation. Retain computed object keys while their values are evaluated.
Reuse run/realm disposal ownership established in section 38; normal completion
unregisters roots, and disposal clears abandoned suspended roots.

The initial asynchronous retention wrapper passed 204 focused checks, but the
full SafeJS package exposed a snapshot scheduling regression (one failure with
12,126 passing tests and 41 skips). Reproduce it in isolation: extra async
wrapper layers let a dump request observe a different yield. Replace the
wrapper with synchronous registration and ordinary try/finally at evaluation
sites; preserve the existing snapshot test without relaxing its assertions.
The corrected eight-file cohort passes 263 tests, including snapshots, receiver
retention, run/realm suspension and disposal, catchable cancellation, native
order/results, and async ordinary/tagged-template suspension. Broader build,
CLI, full-unit and lint qualification remains before atomic delivery.
The normal maintained build passes. The actual schema-only pair passes after
70 uncached predev builds, with zero spawns; its inspected screenshot shows
total 7,000 and the expected argument event. The same built CLI rejects at
dataSize 6,000 with usage 7,850 and exit 1, using a temporary snapshot path.
Fresh public root/core pass 18 low-budget failures and 18 raised-budget
checkpoint recoveries without repeating completed effects. Full npm test is
running against the final synchronous-lifetime code. Finish the required build
phase before freezing source/build outputs for maintained root lint.
Twelve additional built root/core native comparisons pass. An attempted built
next-yield capture during an active host callback hit the explicit reentry
guard in assertDumpAllowed; that probe was not a runtime regression. Two public
capture-guard/replay-mode controls pass. Existing next-yield unit tests remain
unchanged and passing, alongside the completed-effect recovery checks above.
The final full route's shared stage passes 32,015 tests with 43 skips in 1,170
passing files and three skipped files; Python and all 279 native runner
prechecks also pass. With source/build outputs frozen, maintained root lint
passes all 9,759 configured files with zero errors or warnings, followed by
types and workflows. The remaining native workspace unit tasks are running.
Twenty-four built fatal-budget cleanup/reset/reuse cycles pass. Six public
root/core suspended-generator recoveries preserve partial array, object and
binary state, with the original run stopped and pending host effects explicitly
reconciled; neither completed effects nor the pending operation are repeated.
The initial probe captured an earlier generator yield before the host call was
dispatched. Select the current replay-mode checkpoint at the host await and
use the recorded running call's proof, rather than assuming every first dump
already contains hostCalls. This was a probe-position correction, not a
snapshot-retention defect.
The full maintained npm test route completed successfully: native Bash passes
19,981 tests with 63 skips, terminal-pilot passes 288 tests, and both root
posttest checks pass. The declaration-derived receipt confirms 71 workspaces,
two required builds, 40 unit tasks, uncached execution and no exclusions.
Unavailable optional comparator cases remain pending, not passes. Together
with the successful build, CLI, replay and maintained root lint gates, this
qualifies intermediate operand retention for its own commit and push. The
unrelated staged Safe Bash patch remains byte-for-byte unchanged.
Committed and independently verified on remote main as
b2e90f90be9777fa297eb28225e4e55f53982a3d. Close this finding at delivery.
Scoped run 33962313424 and CLI run 33962313552 are monitored independently;
neither is yet a publication receipt. The proposed next member-key conversion
fix was subsequently disproved in section 39; do not change correct runtime
behavior to match that Node v22 differential. Continue the independent template
findings while monitoring releases.
Scoped run 33962313424/job 101296205103 published
@poe-platform/safe-js 0.1.125 at 11:07:13 UTC on September 5. The separate CLI
run has reached release-stable/job 101297560669 and is still monitored.
CLI run 33962313552/job 101297560669 subsequently published poe-code 14.0.59
at 11:17:31 UTC on September 5. Its remote tag independently resolves to
b2e90f90. Intermediate retention is now delivered and released through both
publication routes.

### 41. Generator context inside template substitutions — delivered and released

The new lifecycle matrix exposed eight failures before runtime: yield inside
ordinary and tagged template substitutions is rejected as outside a generator.
Native JavaScript suspends and resumes both; the already delivered cc107c1eb
build rejects both, confirming this is independent of intermediate retention.
Keep this parser-context fix separate. Remove those unsupported forms from the
current generator-lifecycle fixture and validate template suspension using
supported async substitutions instead; do not claim synchronous template yield
is covered or fixed. Add focused parser/runtime regressions before its own fix.

Specification revalidation: ECMAScript 2026 section 13.2.8 passes ?Yield into
each template substitution, including tagged and nested templates. Source:
`https://tc39.es/ecma262/2026/multipage/ecmascript-language-expressions.html`.
Seven built/native parser mismatches confirm five valid forms are rejected
and await in ordinary/tagged templates incorrectly bypasses the synchronous
generator restriction. Seven boundary controls pass, including nested ordinary
functions/arrows and generator parameter defaults. This is not based solely
on a Node differential: the grammar explicitly requires context propagation.

The failing test cohort confirms 27 failures and 15 controls before the fix.
Carry the existing generatorBody flag through template parsing into the
embedded-expression Parser. Preserve normal nested-function resets, token
rebasing, compilation budget and AST node-id assignment; remove the obsolete
single-call proxy instead of adding a new wrapper. No runtime evaluator changes
are needed. The five-file cohort now passes 138 tests, including ordinary,
tagged and nested substitutions, bare/delegated yields, multiple substitution
order, injected throw/return, run/realm disposal, retained prefixes and replay.

Manual QA: run the actual schema-only pair
`/tmp/poe-safejs-generator-templates.Rd7fJP/generator-templates.md` with the
adjacent .ajs, zero capabilities and zero spawns. Assert the ordinary result
hello world!, tagged result [1:2], and tag invocation only after both yields.
Inspect its CLI screenshot. Build before package checks and freeze source/build
outputs for maintained root lint; deliver this parser correction independently.
The normal maintained build and real CLI pair pass. The inspected screenshot
shows hello world!, [1:2], the single tag event and zero spawns after 70 uncached
predev builds. The expanded five-file cohort passes 140 tests. Checkpoint tests
assert the generator is suspended and pendingAwaits points to the first template
yield before restoring it. Low/high-budget realm controls preserve the suspended
prefix. Their initial fixture kept its temporary in a top-level binding and hit
a later serialization budget; use a local allocation followed by a catchable
numeric marker to isolate allocation-time retention. No runtime correction was
needed for that fixture error. Run the maintained SafeJS package route and root
lint against frozen source/build outputs before the separate parser commit.
That first package route passes 12,256 tests with 41 skips, and root lint passes
9,761 configured files plus types/workflows. A subsequent boundary audit found
that nested function parameter initializers inherit generator-body permission;
the initial template-context fix exposes that existing weakness in templates.
Do not qualify the first candidate as final merely because those gates passed.

The expanded TDD matrix confirms 18 parameter-boundary failures and 48 passing
controls: nested function/arrow/method/generator defaults and destructuring keys
admit yield, while ordinary/async/arrow/generator defaults admit direct await.
ECMAScript 2026 function grammar and sections 15.3.1/15.5.1 prohibit these direct
suspension expressions in formal parameters; nested function bodies remain
separate contexts. Source:
`https://tc39.es/ecma262/2026/multipage/ecmascript-language-functions-and-classes.html`.
Use one three-state function context (normal, generator, parameters), shared by
embedded template parsers, rather than independent booleans. Parameter parsing
enters/restores its own context, and nested bodies enter their normal/generator
context. Direct await in parameters receives a targeted error. This boundary
guard is necessary to avoid shipping the newly exposed template regression.
The seven-file cohort passes 274 checks, including positive nested generator/
async-function parameter values. Rebuild and rerun the real CLI pair, package
checks and maintained root lint before delivering this final parser version.
The final normal maintained build passes. The actual CLI pair passes after
70 uncached predev builds; the inspected screenshot shows hello world!, [1:2],
the allowed nested generator result and zero spawns. Its intentionally single-
substitution fixture produces the expected informational AS-NEEDLESS-TEMPLATE
diagnostic, not a failure. Built root/core reject all 26 invalid-context checks
and pass two recoveries from checkpoints verified at the first template yield.
Final maintained package checks pass 12,278 SafeJS tests with 41 explicit skips
and all 163 agent-harness consumer tests. Maintained root lint completes all
9,761 configured files with zero errors/warnings, then types and workflows pass.
No source/build changes occurred during that final lint gate. This qualifies the
parser-context change, including the required parameter-boundary guard, for its
own commit and push; unrelated staged Safe Bash changes remain unchanged.
Committed and independently verified on remote main as
c9b2457e1b0db1fe2cd7bb1601247be52f0bef0b. Close the parser-context finding at
delivery. Scoped run 33963669685 and CLI run 33963669839 are monitored
independently; neither is yet a publication receipt. Start section 42's focused
coercion regressions while releases run instead of waiting idle.
Scoped run 33963669685/job 101299848983 published
@poe-platform/safe-js 0.1.127 at 11:38:10 UTC on September 5. CLI publication is
still monitored separately.
CLI run 33963669839/job 101300966831 published poe-code 14.0.60 at 11:45:20 UTC
on September 5. The remote tag independently resolves to c9b2457e1. Both
publication routes are verified for the parser-context fix.

### 42. Ordinary template substitution coercion — closed; released in CLI 14.0.61

Built/native probes show plain-object substitution rejects instead of producing
[object Object], and a sandbox toString hook is not invoked. Returning an object
from toString then a primitive from valueOf also fails instead of honoring the
string-hint fallback order. RegExp, Map and Set substitutions produce
[object Object] instead of their native strings; a custom array toString hook
fails instead of running. Ordinary array substitution and tagged-template
object identity are passing controls. evaluateTemplateLiteral currently calls
host String on sandbox values; investigate the maintained sandboxString path
with prefix/input retention and hook order/error/budget tests. Keep this
semantic correction separate from the intermediate-retention change.
Fresh built probes after the parser work confirm ten failures and four controls,
including inherited hooks, thrown-value identity and left-to-right hook order.
Invalid Date, ordinary arrays, primitive values and tagged substitution identity
are passing controls. ECMAScript 2026 sections 13.2.8.6 and 7.1.17 require ToString
with string-hint ToPrimitive for ordinary substitutions; this agrees with the
native differential rather than relying on it alone. No coercion fix is applied
as part of the parser-context change.
Additional contrasts with explicit String confirm the helper already handles
ordinary objects, fallback hooks, generator instances and Error values while
ordinary templates do not. Promise conversion and null-prototype rejection are
passing controls. An initial object-shaped error comparison differed only in
host/sandbox prototypes; comparing error.name confirms matching TypeError, not
a runtime defect. Function display is independently unsupported as section 43
records; merely wiring the helper into templates does not fix that broader gap.
After the parser fix reached remote main, the focused template-coercion TDD
cohort reproduces 13 failures with 71 passing controls, including the delivered
generator-template and intermediate-retention suites. No coercion runtime fix
has been applied or pushed yet.
The expanded semantic matrix adds async-prefix/fallback, non-primitive failure,
thrown identity and coercion-before-next-expression cases. Reuse sandboxString
with the existing coercion context; preserve the synchronous primitive path
instead of adding a new await for every template value. Tagged substitutions
are unchanged. Five phase-isolated budget checks expose three missing current-
input roots through Array and Error coercion. Retain the current input alongside
the prefix, then clear it as soon as conversion completes, before the next
substitution. Low-budget failures remain fatal and raised-budget controls reach
the allocation marker. No shared string-helper behavior is changed.

The final five-file cohort passes 165 checks, including 35 template tests,
existing receiver/intermediate retention and snapshots. Async hooks are not
adopted, generator hooks remain lazy, sent generator values coerce correctly
after a verified suspended-template checkpoint, and realm evaluations release
their roots. Two initial post-error cleanup probes exceeded their quota even
without a preceding template; no large retained input remained after catch.
Replace their length-access probe with a pure allocation marker to isolate
cleanup rather than treating that fixture assumption as a runtime defect.

Manual QA: build and execute the schema-only pair
`/tmp/poe-safejs-template-coercion.IqBShC/template-coercion.md` with its adjacent
.ajs, zero capabilities and zero spawns. Inspect the screenshot; assert guest
string/value fallback order, RegExp/Map text and tagged input identity. Validate
built public entrypoints and recovery, then maintained package and root lint
routes against the final source before this change's own commit/push.
A deeper validation found a shared-helper prerequisite (section 44): freshly
coerced array prefixes and Error names are unaccounted for during the next hook,
even with explicit String. Keep its delivery separate. Temporarily restore only
this uncommitted template runtime patch, and hold the 35-case template test file
at `/tmp/poe-safejs-template-coercion.IqBShC/template-coercion.test.ts` while the
shared lifetime fix is delivered. Reapply the template wiring/input root and
restore that file afterward; the template issue remains open, not abandoned.
After prerequisite 7266ab29f reached remote main, restore the template suite and
reconfirm its failures: the maintained SafeJS route has 27 failures, all in the
restored file, with 12,293 passing controls and 41 skips. Two added integration
cases cover freshly produced array-prefix and Error-name text; the isolated suite
then has 29 failures and eight controls before the runtime change. Reapply only
the sandboxString wiring/current-input lifetime. All 37 template tests pass; the
five-file template/shared-prefix/intermediate/receiver/snapshot cohort passes 158
tests. Build, actual CLI/screenshot and final maintained checks remain required
before this semantic fix's separate commit and push.
Final maintained checks pass: SafeJS 12,322 tests with 41 skips; agent-harness
163 tests; root lint 9,763 configured files with zero errors/warnings, followed
by TypeScript and workflows. The normal build and actual schema-only CLI pair
pass; the inspected screenshot confirms expected text, hook order, tagged value
identity and zero spawns. Fourteen public root/core budget rejections recover
from checkpoints at an explicitly raised quota without repeating completed
effects. Two public suspended-template checkpoints restore exact values; forty
persistent-realm cycles release all temporary roots. Thirteen additional built/
native controls cover primitive hook results, inherited hooks, cycles, mutated
fallback methods and thrown null. RegExp/Map own toString assignment fails
before both explicit String and template conversion; those separate intrinsic/
object-model gaps are not folded into this semantic correction.
Delivered as f9e49d88477cd7f4d42366a5f6baef25f079ad20, independently verified
on remote refs/heads/main September 5. Close this finding at delivery. Scoped
run 33965139974 and CLI run 33965140098 are monitored while the next validated
issue is addressed; publication is not yet claimed.
Scoped run 33965139974/job 101303819940 succeeded and published
@poe-platform/safe-js 0.1.129 on September 5 at 12:11:44 UTC. The CLI workflow
remains separately monitored for actual publication and inclusion of the prior
retention fix.
CLI run 33965140098 subsequently completed canceled; it did not publish a CLI
version. Track both the template and preceding retention changes through the
descendant concat CLI workflow 33965571630.

### 43. Function stringification — closed at verified main delivery; release pending

Five built/native probes cover named, arrow, async, generator and builtin
functions. value.toString() rejects with Function#toString is not a supported
method, and String(value) returns [object Object]. Native guest functions return
their source text; the builtin returns native-function syntax. ECMAScript 2026
section 20.2.3.5 defines Function.prototype.toString, with source text when
available and native-function syntax otherwise. Source:
`https://tc39.es/ecma262/2026/multipage/fundamental-objects.html`.
This is distinct from ordinary template coercion: explicit String already
fails too. Validate source metadata, overrides, bound/builtin functions,
budgets, realms and snapshot/replay before its own implementation and delivery.
Do not expose host implementation source or add native eval as a workaround.
Parser/source inspection identifies a prerequisite for exact guest text: grouping
parentheses overwrite the function node's ordinary span, including functions
inside template substitutions. Six bounded parser probes cover grouped ordinary
functions, grouped arrows, async arrows, generators and computed/async methods.
Slicing the final node span includes unwanted grouping parentheses. Preserve
the function's own source range before that overwrite, retain comments/spacing,
and recover it from reparsed source on restore; do not pretty-print approximate
function source or expose host implementation details.
After concat delivery, the new 45-case function-string suite reproduces 34
failures and eleven controls. Record private source ranges when function nodes
are created, before grouping modifies ordinary spans; share the original source
instead of eagerly copying nested function bodies. Ordinary, async and generator
closures retain that range, and restored closures recover it from the reparsed
AST. Function#toString and default string coercion use the same formatter;
borrowed methods validate callable receivers and public calls enforce string
budgets. Bound/builtin functions use native-function syntax, not host source.
Three added host-label tests prevent non-identifier diagnostic labels from being
interpolated into that syntax; anonymous native text is used for those callables.
The six-file source-range/function-method/template/concat/snapshot cohort passes
164 checks, including 48 function-string cases and three parser range checks.
No runtime Function constructor, eval, ambient capability or prototype-graph
expansion is included in this change.
Two further controls confirm the private source range is not exposed by ordinary
guest reads/enumeration and cannot be replaced by a guest property of the same
name. The 50 function-string tests plus three parser-range tests pass. The first
normal build caught an import conflicting with the parser's existing FunctionNode
type; reuse that type and rerun the build. No delivery is claimed from focused
tests alone.
The first built harness passes and its screenshot is inspected. A stronger
built replay probe then finds a release-blocking consequence of the new feature:
changing /*aaaa*/ to /*bbbb*/ in a function body is accepted by the old semantic
hash even though restored toString output changes. Eight new hash/replay tests
fail before repair. Include observable function source in the semantic hash,
while still ignoring formatting outside functions. Hash an enclosing function's
text once; nested ranges already covered by that source are not redundantly
hashed, keeping source scanning linear rather than quadratic. Continue hashing
the semantic AST as well. A source-less cloned AST is now distinct because its
function display is no longer the same; ordinary span/raw/node-id mutation on
the original parsed AST remains hash-insignificant. The five-file hash/range/
function/snapshot cohort passes 182 tests. Rebuild and rerun qualification against
this final hash-aware implementation; earlier build/UI evidence alone is not
delivery evidence. The full maintained test gate then exposed 57 genuine legacy
checkpoint hash failures and one fresh host-display expectation. Preserve those
histories rather than requiring reset or changing fixture markers: new runs now
write jobs-v8, while restored v6/v7 runs retain their original hashes and opaque
default function conversion. Explicit guest hooks remain available in old modes;
explicit migration targets v8. The historical fixtures remain unchanged. The
targeted current-writer cohort passes all 250 tests after updating only fresh
writer expectations and moving the unsupported future marker check to jobs-v9.
The harness loader's fresh-writer assertion also fails specifically on v8 versus
v7, and the built SDK smoke probe confirms unchanged reference results and one
host read with the new marker. Update those two fresh expectations without
altering any historical fixture. The final normal build passes, followed by the
real schema-only harness and inspected screenshot after 70 uncached predev
builds. Packed-consumer smoke checks all pass. Built root/core probes pass six
observable-source-change rejections with outside-formatting restores, sixteen
fatal-budget checkpoint recoveries without repeated effects, and six genuine
v7 replays with unchanged journals, hashes, markers and no host effects. The
first ad-hoc v7 comparison used prototype-sensitive strict equality against JSON
fixture objects; normalize the returned sandbox object's prototype with
structuredClone for that value comparison, while comparing histories directly.
No runtime change follows from that probe mistake.
The full shared unit stage passes 32,284 tests (43 skipped). Native workspace
stages pass: Python 29, runner prechecks 279, Safe Bash 19,981 (63 skipped), and
terminal 288. Both root post-test stress checks pass, and the full maintained
npm test command exits zero with its uncached declaration-derived receipt.
Root lint completes successfully across all 9,769
configured files with zero errors/warnings, followed by TypeScript and workflow
checks. git diff --check passes; the staged Safe Bash patch checksum remains
e9c7047e5ec094d9e142a8115773da7849c2c19c45a418bdc61f61498875523d.
This atomic improvement is ready for its own commit and verified main delivery;
successful checks do not themselves claim a push or release.
Delivered as dbe9917a7c207c62f97082ae77e14e3cc8cea9aa and independently verified
on remote refs/heads/main September 5. The finding is closed at delivery;
scoped-package and CLI publications remain separately monitored.
Scoped run 33967405571/job 101309832582 succeeded and published
@poe-platform/safe-js 0.1.131 on September 5 at 12:58:49 UTC. CLI run 33967405694
remains separately monitored; no CLI publication is claimed yet.
That CLI run was subsequently canceled after the next atomic main push; its
watch exited nonzero. This is not a CLI publication. Descendant CLI run
33967858610 is monitored for delivery of both the function and parser fixes.

Manual QA: build and execute a schema-only function-string.md/.ajs pair with
zero capabilities/spawns. Assert exact grouped function/comment text, template
and concat parity, builtin native display and bound native display. Inspect the
real CLI screenshot; validate public entrypoints and checkpoint/budget recovery.
Run full maintained npm test and root lint after builds are complete because
the parser, closure representation and restoration are shared infrastructure.

### 44. Converted string-prefix retention — closed; released in CLI 14.0.61

Built low/high-budget probes show both explicit String and the candidate template
path lose newly produced array-prefix and Error-name strings. A first hook
returns 2,000 characters; the next allocates 5,000 and throws a catchable marker.
At dataSize 6,000 the marker incorrectly escapes, as it does at 14,000. The raw
input objects contain hooks rather than the produced text, so retaining only
the input cannot fix this lifetime.

The initial TDD matrix reports five failures and one control. Four are confirmed
retention failures (flat/nested arrays, Error names and property-key conversion).
The concat case instead raises TypeError before the allocator; it is not a
memory finding and is separated into section 45. Retain accumulated array text
and a converted Error name until message conversion completes. Move the existing
synchronous retainValues implementation unchanged into the resource module so
both interpreter and conversion helpers use the same disposal-owned registration.
Do not add an async wrapper, cancellation listener or public cleanup slot.

Low-budget failures, raised-budget controls, empty-prefix controls and continuation
after caught failures are covered. The template-wiring patch and its tests are
held out of this commit so this shared lifetime correction remains atomic.
Manual QA: run the schema-only string-retention.md/.ajs pair in the same temporary
directory, assert length 2,005 and Named: value with zero spawns, and inspect its
screenshot. Validate a 6,000-unit rejection with a temporary failure snapshot,
built entrypoints/checkpoint recovery and the broader maintained checks before
committing and pushing this prerequisite separately.
The nine-file cohort passes 264 tests. The normal maintained build and the
schema-only CLI pair pass after 70 uncached predev builds; the inspected
screenshot shows length 2,005, Named: value and zero spawns. The same built CLI
rejects dataSize 6,000 with usage 7,816 and exit 1, using an explicit temporary
failure snapshot path. Public root/core pass eight low-budget rejections and
eight raised-budget checkpoint recoveries without repeating completed effects;
both paths release retained roots. Full maintained npm test is running because
the shared resource registration is touched. Its required build phase is complete;
freeze source/build outputs before maintained root lint.
Maintained root lint passes all 9,762 configured files with no errors or warnings,
followed by types and workflow checks. Additional built controls pass 13 native
result/order/cyclic-array comparisons and two checkpoints captured at a verified
generator yield inside array/Error coercion. Twenty persistent-realm cleanup
cycles and twenty fatal-budget reset/reuse cycles pass. Number and RegExp input
conversion also reject at 6,000 and reach the marker at 14,000. parseInt rejects
before invoking the hook at either quota; that is its separately recorded input
coercion limitation, not evidence of a memory-retention failure.
Full maintained npm test finishes with exit zero: shared unit stage 32,145 passed
and 43 skipped; Python 29 passed; native runner prechecks 279 passed; native Bash
19,981 passed and 63 skipped; terminal-pilot 288 passed; root posttest lint-stress
two passed. The declaration-derived receipt records 71 workspaces, two required
builds and 40 declared test tasks, uncached, with no exclusions; workspaces without
declared tests are explicitly not counted as passes. git diff --check passes.
The user-staged Safe Bash patch checksum remains unchanged. Commit and push only
the five prerequisite files, then close this finding upon verified remote-main
delivery and monitor its actual publications separately.
Delivered in 7266ab29fc947f245b5f00da68c42903875738a1, independently verified
as remote refs/heads/main on September 5. This finding is closed at delivery;
publication is not yet claimed. Scoped run 33964754696 and CLI run 33964754790
are monitored while work resumes on the separate template-coercion fix.
Scoped run 33964754696/job 101302803347 succeeded; its log confirms
@poe-platform/safe-js 0.1.128 published September 5 at 12:03:07 UTC. CLI
run 33964754790 remains monitored; scoped publication is not treated as proof
of CLI publication.
CLI run 33964754790 subsequently ended canceled (unit job 101303198050 was
stopped at 12:07:22 UTC; release-stable was skipped). It did not publish a CLI
version. Track inclusion through the descendant template workflow 33965140098;
do not mislabel the canceled run as a passed release or a code-test failure.

### 45. String concat argument coercion — closed; released in CLI 14.0.61

The attempted retention probe `''.concat([{toString:first},{toString:last}])`
raises Cannot convert object to primitive value instead of reaching the marker.
It therefore does not prove missing prefix retention. Validate native behavior,
argument conversion order, error propagation and existing concat implementation
before any change; do not silently fold it into the shared-helper lifetime fix.
Seven subsequent built/native comparisons reproduce six semantic failures:
guest toString, string-hint valueOf fallback, left-to-right hook order, thrown
object identity, plain-object display and RegExp/Map display. Primitive/null/
undefined/ordinary-array concatenation is the passing control. The current
implementation applies host String to each sandbox argument. ECMAScript 2026
section 22.1.3.5 requires ordered ToString conversion and propagation of abrupt
completion, confirming these are genuine gaps independently of the native
comparison. Source:
`https://tc39.es/ecma262/2026/multipage/text-processing.html#sec-string.prototype.concat`.
No concat runtime change is included in the shared-prefix retention delivery.
Seven additional built/native probes confirm inherited/async/generator hooks,
short-circuiting after thrown conversion and nonprimitive hook order fail;
null-prototype TypeError and cyclic-array conversion are passing controls.
These remain validation evidence only until the template change is delivered.
After template commit f9e49d884 reaches remote main, the initial concat TDD
suite reproduces 27 failures and six controls. Guest-aware conversion corrects
the semantic failures, leaving two genuine missing-root failures for fresh
receiver text and accumulated argument prefixes. Use the delivered synchronous
retainValues helper around the result until conversion completes. Primitive-only
calls retain their original synchronous route; an initial all-async candidate
failed the maintained direct-method contract. A low-level allocation test first
used dataSize, which allocateString does not enforce without runtime reconciliation;
correct it to the actual stringLength contract rather than inventing a budget bug.
The final six-file cohort passes 395 checks, including 34 concat regressions,
receiver semantics, existing string methods, shared retention, templates and
snapshots. Async hook promises are not adopted, generator checkpoints restore
the exact hook order, caught failures release roots, and realm calls remain
reusable. Ordinary function source display is still the distinct section 43 gap;
custom function string hooks now run through the shared conversion path.

Manual QA: create a schema-only concat.md/.ajs pair in the existing temporary
validation directory. Use no capabilities or spawns; assert receiver/argument
hook order, valueOf fallback, builtin display and thrown-value identity. Run the
real harness via the screenshot route and inspect its output. Validate public
entrypoints, low/high-budget checkpoint recovery and maintained SafeJS/consumer
tests, build and root lint before a separate concat commit/push.
Final maintained checks pass: SafeJS 12,356 tests with 41 skips, agent-harness
163 tests, root lint 9,764 configured files with zero errors/warnings followed
by TypeScript and workflow checks. Normal build and schema-only CLI/screenshot
pass after 70 uncached predev builds; inspected output confirms R7:/a/g:[object
Map], receiver/string/value order, error identity and zero spawns. Ten public
root/core budget rejections recover at an explicitly larger quota without
repeating completed effects; two public generator-in-hook checkpoints restore
exact results; forty persistent-realm cycles release all temporary roots.
git diff --check passes and the user-staged Safe Bash checksum remains unchanged.
Delivered as e6247a2d53049ad0e69fa34fb7cb265f52f3153f, independently verified
on remote refs/heads/main September 5. The finding is closed at delivery. Scoped
run 33965571496 and CLI run 33965571630 are monitored separately; no publication
is claimed yet.
Scoped run 33965571496/job 101304973075 succeeded and published
@poe-platform/safe-js 0.1.130 on September 5 at 12:20:33 UTC. CLI run
33965571630/job 101306294841 succeeded and actually published poe-code 14.0.61
at 12:29:03 UTC September 5. The remote v14.0.61 tag independently resolves to
e6247a2d53049ad0e69fa34fb7cb265f52f3153f. This release includes the preceding
template (§42) and retention (§44) fixes; their own canceled CLI runs are not
misreported as publications. All three findings now have verified CLI delivery.

### 46. Numeric parser guest conversion — closed at verified main delivery; release pending

Six built/native probes reconfirm the open §15 finding in global parseInt,
Number.parseInt, parseFloat and Number.parseFloat. Guest toString/valueOf hooks
are not executed: valid values throw TypeError, the observed conversion log is
empty instead of string then radix, and a thrown guest marker loses identity.
ECMAScript 2026 §§19.2.4–19.2.5 requires ToString first, then ToInt32 of parseInt's
radix. Source: `https://tc39.es/ecma262/2026/multipage/global-object.html`.

The initial 72-case suite reports 68 failures and four primitive controls. Four
realm cases initially contain an incorrect cleanup call (dispose instead of the
public close method); correct the fixture, not the runtime. Remaining failures
reproduce guest conversion, ordering, thrown-value and budget defects. Share one
numeric-parser factory between the global and Number property implementations.
Use existing sandboxString/sandboxNumber conversion, preserve synchronous
primitive calls, and pass only converted primitives to native parsing. Retain
the generated input text while the radix hook runs, releasing it on success,
rejection and cancellation. No predicate conversion, primitive boxing, intrinsic
identity/arity or prototype-graph expansion is included.

The five-file focused cohort passes 167 tests, including 78 parser cases,
existing direct helper calls, Number conversion and promise ordering. Added
controls cover no early promise-job drain and data-budget retention across a
radix hook, with roots empty after rejection. Broader validation and delivery
remain outstanding.

Manual QA: run a schema-only numeric-parsing.md/.ajs pair with zero capabilities
or spawns. Check numeric prefixes, global/Number parity, string-before-radix
order, negative zero and thrown marker identity. Inspect its real CLI screenshot.
After the normal build, run maintained SafeJS and harness checks plus root lint,
then exercise public root/core checkpoint recovery and retained-root cleanup.

Qualification completed: 86 parser regressions/controls, full maintained SafeJS
workspace suite 12,510 passed with 41 skipped, and harness suite 163 passed.
The normal build and zero-spawn CLI fixture pass; its screenshot is inspected
after 70 uncached predev builds. Public root/core probes pass twelve fatal-budget
checkpoint recoveries with no repeated completed effects, twenty cancellation
cleanup cycles, and twenty persistent-realm close/reuse cycles with no retained
roots. Root lint passes all 9,771 configured files with zero errors/warnings,
followed by TypeScript and workflow checks. git diff --check passes and the
unrelated staged Safe Bash checksum remains unchanged. This package-local
change uses maintained package checks; the preceding shared-runtime change's
full repository gate is not misrepresented as a new full run for this change.
Ready for a separate atomic commit and verified main delivery; publication is
tracked separately.
Delivered as 280e1ffed106364653ed90cd4d5f7ba5ab1d55d8 and independently verified
on remote refs/heads/main September 5. The finding is closed at delivery. Scoped
and CLI workflows are monitored for actual publication, not merely green checks.
Scoped run 33967858498 and CLI run 33967858610 are active release watches.
Scoped run 33967858498/job 101311035454 succeeded and published
@poe-platform/safe-js 0.1.132 September 5 at 13:08:56 UTC. Its watch exited zero;
CLI publication remains separately monitored.
CLI run 33967858610 was canceled after the next main push; its watch exited
nonzero and it did not publish. Descendant CLI run 33968267176 is monitored for
publication including the function, parser and predicate fixes.

### 47. Global numeric predicate conversion — closed at verified main delivery; release pending

After §46 delivery, three fresh built/native probes reproduce missing guest
conversion in global isFinite/isNaN: valueOf is not called, valid custom numbers
throw TypeError, and thrown guest marker identity is lost. A fourth control
confirms Number.isFinite/Number.isNaN correctly remain non-coercing and invoke
neither hook. Preserve that distinction. Existing global implementations still
pass raw sandbox values to the host predicates; the numeric parser repair did
not modify them. Add focused failing tests before this separate implementation.

Four additional built/native probes reconfirm §26 primitive boxing remains open:
Object(3) rejects primitive boxing, and new Number/String/Boolean reject as
non-constructors. Do not claim boxing fixed by numeric conversion work. No
boxing or predicate runtime changes have been made in this follow-up validation.

Implementation begins only after a 48-case suite reproduces 40 failures and eight
controls. ECMAScript 2026 §§19.2.2–19.2.3 explicitly applies ToNumber in both
global predicates. Use the existing sandboxNumber path, then apply Number's
non-coercing numeric predicates to the resulting number. Keep primitive calls
synchronous and forward hook context, errors and budgets. Number.isFinite and
Number.isNaN are unchanged. Source:
`https://tc39.es/ecma262/2026/multipage/global-object.html`.
The five-file focused cohort passes 208 tests, including inherited hooks,
function/array overrides, fallback order, thrown marker identity, async-prefix
handling without promise adoption, realm reuse, completed replay, promise-job
ordering and fatal step/call-depth budgets with retained-root cleanup.

Manual QA: build and run a schema-only numeric-predicates.md/.ajs pair, with zero
capabilities/spawns. Check hook order, global-versus-Number distinctions and
thrown marker identity; inspect the CLI screenshot. Run the maintained SafeJS
and harness suites and root lint after builds finish. Probe public root/core
budget recovery, cancellation, realm cleanup and completed effects before the
separate commit/push. Primitive boxing remains a separate next capability.

Qualification completed: 48 predicate regression/control cases; maintained
SafeJS workspace suite 12,558 passed (41 skipped), harness suite 163 passed,
normal build and real zero-spawn CLI fixture passed. The inspected screenshot
shows true/true/false/false, value-before-string hooks and preserved thrown
marker identity. Public root/core probes pass eight fatal-budget checkpoint
recoveries without repeating completed effects, twenty cancellation cleanup
cycles, twenty persistent-realm cycles, and four generator-backed conversion
checkpoint restores. Low-budget instances can be reused after failure. Root
lint passes all 9,772 configured files with zero errors/warnings, followed by
TypeScript and workflow checks. This local fix is ready for its own commit and
verified main push, not yet a publication claim.
Delivered as a66cc1f327da9599dbac1039425d1869742e8bb9 and independently verified
on remote refs/heads/main September 5. Close the finding at main delivery;
scoped-package and CLI publication remain separately monitored.
Scoped run 33968267028/job 101312124507 succeeded and published
@poe-platform/safe-js 0.1.133 September 5 at 13:16:45 UTC. Its watch exited zero.
CLI run 33968267176 succeeded and explicitly published poe-code@14.0.62 to latest
September 5 at 13:24:44 UTC. The remote v14.0.62 tag independently resolves to
a66cc1f327da9599dbac1039425d1869742e8bb9, also covering the earlier function-source
and numeric-parser commits whose individual CLI runs were canceled.
