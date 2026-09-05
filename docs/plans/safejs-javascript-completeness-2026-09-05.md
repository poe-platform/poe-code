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
and workflow checks. Commit, verified push, and release validation remain
pending. Callable source text, full exotic prototype graphs, symbols,
accessors, and implicit-coercion integration remain separate inventory items.
Additional probes confirm failures in computed parameter/catch bindings,
method calls, and boolean/null/undefined/array keys. A null-base assignment
also skips RHS side effects which native JavaScript executes before throwing.
Check against ECMAScript 2026 sections 6.2.5.5, 6.2.5.6, and 13.3.3 rather
than treating the local Node v22.23.2 behavior as an infallible oracle: it
coerces compound/update keys twice, unlike the specified retained key. The
normative history is TC39 ecma262 issue 3295 and merged PR 3307.

### Additional validated gaps, not implemented

Built public-entrypoint probes reproduce built-in receiver defects:

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

A public catch-pattern probe also confirms inherited reads are missing:
`try { throw Object.create({ x: 7 }); } catch ({ x }) { return x; }` returns
undefined instead of 7. Catch binding currently uses separate property-read
logic from ordinary destructuring; keep that independently validated defect
in the queue.
