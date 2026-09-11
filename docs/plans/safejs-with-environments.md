# With environment implementation

## September 8 independent candidate regression follow-up

The completed candidate unit run found strict global-object assignments
recreating bindings deleted by their RHS, a changed undeclared compound-write
diagnostic, and unresolved identifier calls rejecting instead of producing the
structured UNBOUND_IDENTIFIER result. The local interpreter now rechecks
HasProperty before strict object-environment writes, preserves the existing
compound-write diagnostic and returns the structured error for unresolved
calls. The four focused files (global-object, interpreter, dynamic-with and
dynamic-assignment) pass 604 tests in the relocated private-dependency
candidate. Remaining full-suite failures are not declared fixed.

The non-strict Function body `with({x:7}){return x}` is a validated missing
feature. `dynamic-with.test.ts` compares complete native and sandbox runs,
including strict rejection and runtime errors rather than treating every
exception as equivalent.

Required behavior includes inherited properties, Symbol.unscopables and its
guest getters, object receivers on identifier calls, nested closures, updates,
destructuring, delete, primitive boxing, var initializers and ordinary this.

The current Scope.lookup is synchronous. It cannot execute guest unscopables
accessors safely. Add a guest-aware asynchronous binding-resolution path for
language operations, keeping internal declaration bookkeeping separate. Resolve
a reference once and preserve its scope or object base through evaluation; do
not resolve it again after the right-hand side mutates the environment.

Current identifier-assignment continuations retain only the previous value.
With support requires preserving the resolved reference across yield/await too,
with validated snapshot references and retained-data accounting. Identifier
calls must use the with object as receiver, unlike ordinary lexical bindings.

Add WithStatement syntax only with strict-context rejection and integration
into var-hoisting, legacy block-function traversal, lexical scope restoration
and the interpreter. Do not ship syntax acceptance as a substitute for these
semantics. Verify native differential cases, async getters, snapshot replay and
resource limits before claiming this gap closed.

## Local binding-reference foundation

Scope now has a guest-operation-driven asynchronous resolver returning lexical,
object or unresolvable references without eagerly reading binding values.
Five initial tests pass for inherited properties, awaited unscopables lookup,
missing names, lexical shadowing and object-base stability after deletion.
A sixth test exposed missing retention of the with object; including it in
scope data roots fixes that. Resolver plus existing retained-root coverage
passes 17 tests.

This is not yet interpreter support. The with-environment marker must still
be serialized and validated, and language operations must use these references
with continuation-safe retention. Current synchronous lookup remains unchanged
for existing callers while that integration is incomplete.

Snapshot frames now carry withObject separately from the restricted canonical
global objectEnvironment. The new field preserves the with marker on hydration
and retains the object for accounting. Validation rejects primitive/internal
scope targets, root/function-boundary with frames and simultaneous global and
with environments. Roundtrip/unscopables and forgery tests plus existing global
and scope-frame controls pass 16 tests. Interpreter integration and assignment
continuation references remain pending.

WithStatement is now parsed only in non-strict dynamic contexts, traversed by
var/legacy-function hoisting and understood by exhaustive lint visitors. The
interpreter boxes primitive inputs, rejects nullish ones, creates the object
scope and resolves reads/call receivers through binding references. Initial
15 native comparisons and retained-root controls pass 26 tests; TypeScript
passes. Expanded unscopables write/delete/typeof tests are the next gate, since
those older paths still use synchronous lookup. Do not treat the initial passing
cases as evidence that those paths or generator continuations are complete.

Expanded tests reproduced six mismatches. Identifier typeof, delete and update
now resolve through the object-environment reference. The original suite moves
from six failures to three (assignment, destructuring, assignment lookup count).
TypeScript and focused interpreter/test lint pass. Additional typeof/delete
getter-count and lexical-TDZ controls pass.

Do not use Node as the sole oracle for update reference stability. Node 22 calls
the unscopables getter twice for x++ and redirects its write if ToNumeric deletes
the original property. JavaScriptCore (via Swift JSContext) returns [2,1] for
the getter-count probe and [9,2] for the deleted-property probe, agreeing with
ECMA-262 13.4.2.1's retained lhs reference and 9.1.1.2.5's SetMutableBinding.
Those two tests use explicit spec-derived expectations, not Node's divergent
results. Sources:
https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-postfix-increment-operator-runtime-semantics-evaluation
https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-object-environment-records-setmutablebinding-n-v-s

The expanded with/reference/assignment gate has 56 passes and three remaining
failures. Separate delete, dynamic-delete, assignment and data-budget regressions
pass all 109 tests. These changes remain local with the unfinished dynamic
runtime; no new remote delivery or publication is claimed.

Direct assignments now capture binding targets before RHS evaluation, and
identifier-assignment continuations encode the object or lexical scope target.
Validation checks the target shape and restricts internal scope references to
the dedicated field. Destructuring identifier writes use the same resolver.
The focused with/assignment/generator-assignment gate passes 87 tests; three
new dynamic-with snapshot roundtrips pass, including object-expression call
counts and deletion of the target property during the suspended assignment.
TypeScript passes. Destructuring-default reference order and snapshot forgery
coverage still need explicit validation before delivery.

JavaScriptCore also confirms that direct assignment must keep the selected with
object when its RHS deletes the property (result 2); Node 22 returns undefined.
That test now has an explicit specification-based assertion rather than using
Node's differing result as an oracle.

Snapshot forgery tests exposed two actual holes: the reference-target denylist
used guest-symbol although serialized symbols have kind symbol. Both assignment
objects and withObject accepted symbol references. The two failing tests now
pass after correcting the kind; 16 relevant snapshot tests and TypeScript pass.

Destructuring defaults remain incomplete. ECMA-262 2026 13.15.5.5 evaluates a
non-pattern assignment target before iterator access and the initializer.
The new explicit regression expects [9,2] after the default deletes o.x; SafeJS
returns [2,undefined], confirming late target resolution. JavaScriptCore also
returns [2,undefined] here, unlike its conforming direct-assignment behavior.
Do not use that engine result to override the specification. The current
dynamic-with suite is 27 passes and this one failure. Fix bindPatternValue's
identifier reference preparation and carry it through pattern continuations.
https://tc39.es/ecma262/2026/multipage/ecmascript-language-expressions.html#sec-runtime-semantics-iteratordestructuringassignmentevaluation

Destructuring identifier references are now prepared by bindPatternValue before
iterator reads/defaults. Array/object pattern continuations carry lexical scope
or unresolvable markers alongside the existing object/key reference fields;
capture/restore, scope-reference validation and retained roots cover them.
The failing default test now passes. With semantics plus existing array/object
pattern and pattern-default snapshot tests pass 106 cases. Six dynamic-with
roundtrips (including suspended defaults and changing unscopables) plus six
assignment-reference forgery controls pass 12 more tests. Broader delivery
validation remains required; these are still local changes.

Broader integration now passes the maintained 23-workspace SafeJS build and
four fresh-process import checks. The complete snapshot suite passes 1,521 tests
in 97 files. Focused lint passes. Built direct-assignment and destructuring-default
reference probes pass on both Node 18.18.0 and Node 24.14.0. An isolated delivery
candidate is being prepared at /tmp/safejs-dynamic-delivery.HGBojy from HEAD;
unfinished weak-collection changes must be excluded and the candidate retested.

The isolated candidate contains 59 selected runtime/test files. Before exclusions,
every selected file matched the working tree byte-for-byte. Weak-only symbol and
serializer files were not copied; weak globals, data accounting, heap branches
and related expected-global entries were removed only from the candidate. No
weak-collection imports remain there. Its maintained workspace unit route is
running after the required NumberFormat generation. An initial concurrent TS
check preceded generation and reported missing intl-data outputs; a post-generation
check is running. Main-workspace build and TS remain verified separately.

The post-generation candidate TypeScript check passes. Its full maintained unit
run is still active (session 1607); do not restart it on observation timeout.
CLI release 34264322217 finished cancelled on September 8 at 19:20 UTC, but logs
show SafeJS unit failure preceding cancellation: 14 failures across five files
(camera, completed replay, PPR2 integration, input-error projection and snapshot
mutation). SafeJS scoped publication 0.1.491 is separate and remains successful.
Remote main still resolves to 2ca4b78239602a94b008ac1f8e2fe3a549c975e5.

While the candidate unit run continues, a focused failing check reproduced
unnecessary asynchronous results for lexical-only binding resolution. Scope now
returns lexical references synchronously and keeps effectful object-environment
resolution asynchronous. A 50,000-lookup, 12-parent benchmark dropped from roughly
30–38 ms CPU per batch to 5–12 ms, with wall time falling from 44–49 ms to 19–23 ms
on this machine. This is lookup evidence only, not proof of a camera timeout fix.
The candidate has not yet been updated with this subsequent Scope change; wait
for its existing unit process before changing the tested candidate contents.

Candidate run 1607 was deliberately stopped (exit 130), not completed: inspection
proved package self-imports resolve to its missing dist/index.js. Several
maintained tests require those built exports, so the run cannot establish a
valid full-suite gate. This was candidate setup error, not a timeout-based
restart. The candidate now includes the later Scope/if-clause fixes and remote
414f42ef9's proof-test repair; its maintained workspace build is running before
another full unit attempt. Main was fast-forwarded to 414f42ef9 with all local
runtime work and the protected SafeBash staged patch preserved unchanged.
