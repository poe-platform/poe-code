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

### 13. Registered retained roots counted twice — validated prerequisite

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
push. Remote delivery and release are tracked separately from these checks.
