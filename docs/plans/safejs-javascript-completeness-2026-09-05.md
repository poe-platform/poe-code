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

### 26. Primitive boxing — validated open gap

Eight built native comparisons fail: Object boxing of number/string/boolean,
new Number/String/Boolean wrappers, Array.map on a string primitive, and
Array.slice on a number primitive. Ordinary Object identity and the three
primitive conversion calls pass as two controls. Wrapper construction and
boxing are therefore a concrete next capability, not a speculative limitation.
The repair must preserve boxed value identity, coercion, string indexing and
readonly properties, method receivers, budgets, and snapshot/host boundaries;
an ordinary record pretending to be a boxed primitive is not a complete repair.
No implementation or completion claim is made for this gap yet.
