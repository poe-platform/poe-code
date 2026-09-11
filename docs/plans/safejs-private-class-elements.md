---
title: Private class elements
---

# Private class elements

## Validated gap

On remote main e24f4b4cc, seven native-oracle runtime cases all fail during
tokenization with Unexpected character '#'. Coverage includes instance fields,
updates, methods, getter/setter pairs, static fields, private-in brand checks,
wrong-receiver rejection and independent base/derived private names. Baseline:
seven failures in 1.27 seconds, private-class-elements.test.ts.

## Required implementation

- Tokenize private identifiers (including identifier escapes) and represent them
  explicitly in the AST; never rewrite them into public strings or symbols.
- Validate lexical private-name declarations, forward references, duplicate
  declarations (except matching getter/setter pairs), nested class lookup,
  forbidden #constructor, undeclared access, delete and super misuse.
- Bind fresh private identities for each class evaluation. Private names are
  lexical, not prototype properties. Each receiver owns its private slots;
  static private members require the declaring constructor's brand.
- Initialize private methods/accessors and fields in specification order,
  retaining base/derived and returned-object constructor behavior. Support reads,
  writes, calls, updates, compound assignment and private-in checks with correct
  error and evaluation ordering.
- Capture the private lexical environment in closures, generators and class
  field initializers. Charge retained values and accessor/method captures to the
  data budget without exposing them to Reflect/Object enumeration or copying.
- Encode private identities, lexical environments and receiver slots in guest
  snapshots; validate malformed states and actually execute restored instances,
  closures and constructors. Preserve cycles and distinguish repeated class
  evaluations with identical AST origins.
- Update lint traversal and AST consumers explicitly; no lint suppression or
  reduced validation as a shortcut. Keep SDK and CLI behavior aligned.

## Validation and delivery

Start with tokenizer/parser regressions and maintain the seven failing runtime
reproductions until implementation is complete. Expand native comparisons for
initialization order, nested lexical scopes, callable private accessors, brands,
constructor returns and async/generator captures. Add budget and snapshot tests,
then maintained package/root checks and a real paired CLI harness with inspected
screenshot. Each independently complete improvement gets its own main commit
and push; release publication must not block the next validated issue.

Primary reference: https://tc39.es/ecma262/multipage/ecmascript-language-functions-and-classes.html

## Progress

Added explicit private-identifier tokens using the existing Unicode-aware
identifier scanner. Four valid-token cases first failed (plain, keyword-shaped,
Unicode and escaped names); four malformed cases already rejected. After the
scanner change, all 33 tests in the new private-identifier file and existing
tokenizer file pass in 259ms. Parser/runtime cases remain incomplete, so no
commit or push yet. Audit expression-ending/regex token context when private
member parsing is added; a private identifier is not an ordinary lexical binding.

Initial parser coverage: eight native-valid forms first failed, ten invalid
forms rejected. Added explicit PrivateIdentifier AST nodes for class keys,
member access, optional access, constructor member references and private-in.
Added an iterative lexical validation pass on completed parse results, with
class-body predeclaration, nested environments, duplicate/accessor-pair checks,
forbidden constructor/delete/super checks. Corrected the super guard after its
regression exposed the AST spelling is Super (not SuperExpression).
All 63 private-token/private-parser/existing-class-parser tests now pass.
Package type checking identified two exhaustive async-lint expression visitors;
they now explicitly classify PrivateIdentifier as not containing await.
Still pending: broader precedence/regex/template tests, AST traversal audits,
runtime private environments/slots, budget/snapshot integration and final gates.

Expanded syntax probes confirmed two additional failures before fixes: division
after this.#x was lexed as regex, and #x in object < 1 failed relational chaining.
Private identifiers now count as expression-ending tokens; relational parsing
continues through its existing operator loop after the initial private-in node.
Template interpolations, nested class heritage and arrow captures also pass.
All 93 tests across private parser/tokenizer and existing class/tokenizer files
pass in 656ms. Runtime member references currently always coerce to public
PropertyKey; private references must be represented separately and routed through
all read/write/update/call/destructuring/tagged-template paths. Scope captureFrame
and hydration must carry lexical private identities, not ordinary bindings.

Release receipt verified for preceding lazy helpers: workflow 34152008823,
2026-09-07T18:36:04.0393577Z + @poe-platform/safe-js@0.1.390.
Wrapper clone fix workflow 34152091542 is now in progress.

Runtime probes now reach the interpreter instead of failing lexical parsing.
They expose unsupported PrivateIdentifier member/AST handling. The wrong-brand
test initially passed for the wrong reason (unsupported access also throws
TypeError); strengthened it to prove valid access first, then check wrong-brand
rejection. Do not count that earlier accidental pass as private support.

Added the runtime identity/slot foundation with tests before implementation:
Scope declares fresh class-private identities separately from normal bindings,
resolves through lexical parents, and allocates its private map only when needed.
Receiver WeakMap slots distinguish field/method/accessor state, reject duplicate
installation, reject primitive receivers, and never follow public prototypes.
New private-state tests plus existing scope tests: 37 pass in 1.23 seconds.
These structures are not yet wired into class/member execution or snapshots;
the feature remains intentionally uncommitted until integrated and verified.

Integrated initial class/runtime paths: class evaluation predeclares private
identities; private methods/accessors install before fields, separately for
constructor and instance receivers. Fields install receiver slots instead of
properties. Member references carry private identities without public-key
coercion; reads, calls, assignments, updates and private-in use brand-aware access.
All seven original runtime cases now pass. Together with private-state, existing
classes and class-accessors: 192 pass in 3.02 seconds. Package tsc passed.

A private-field budget regression then failed (1 rather than >=200), before
adding private slot/name/value traversal in measureSandboxData. Focused private
state/runtime tests now pass. Still audit early-return brands (closures, boxes,
collections) so private state attached to exotic receivers is counted as well,
and add mutation checkpoints. Lexical names and uninstantiated private method
captures also need retention. Snapshot encoding/restoration, destructuring,
tagged templates and generator continuation records remain incomplete.

Three new runtime regressions proved array/object destructuring wrote public
properties instead of private slots, and private tagged templates failed calls.
Pattern assignment references now retain a private-name marker and route writes
through lexical private resolution; tagged templates read private values with
the original receiver. Ten cases passed after fixes. Two additional native
generator/destructuring-default probes also pass (12 total runtime cases).
Portable generator continuation encoding still needs an explicit private marker;
do not infer snapshot correctness from these in-memory generator passes.

A boxed-receiver private budget test failed (9 rather than >=200). Moved private
slot traversal ahead of boxed/other type-specific early returns. Combined private
state/runtime and existing class/accessor tests: 199 pass in four files.

Wrapper clone release receipt: workflow 34152091542,
2026-09-07T18:40:16.2968803Z + @poe-platform/safe-js@0.1.391.

Snapshot regression work first exposed lost lexical private names in a directly
restored static-field closure, plus rejected instance private field keys. Added
optional private-name references to scope frames, private element records to
guest object state, and private field/method metadata to class heap nodes.
Restoration shares the encoded private-name object identities across scopes,
receiver slots and constructors. Validation checks private slot shapes, callable
accessors/methods, duplicate names and private/public field AST correspondence.
The first combined private/class-constructor snapshot run passes 16 tests in
2.08 seconds; package tsc passes. Expanded direct-restoration cases cover
instances, method blueprints and accessor pairs as well as static fields.
Still incomplete: malformed private identity ownership checks, exotic receiver
serialization routes, generator continuation private references, full budget
retention/checkpoints, class-initialization edge cases and final broad gates.

Three directly restored generator regressions exposed lost private markers in
array/object destructuring defaults (returned 0 instead of 7/8), and private
compound assignment incorrectly rejected by continuation AST validation.
Private assignment names now survive expression-state capture/serialization/
restoration; runtime resolves them in the restored lexical environment. Member
assignment validation checks the exact source private name and disallows public
key/super metadata for private references. All 11 private snapshot tests pass
in 1.95 seconds. Pattern-marker source-ownership validation remains a required
audit, alongside exotic receiver state and budget checkpoints.

Retained-state regressions exposed two further omissions before fixes:
mutating a private method blueprint with 2,000 units of payload changed measured
constructor usage by zero; lexical private names likewise contributed zero.
Constructor retainedValues now traverses field identities and private method/
accessor blueprints; scope retainedValues includes declared private identities.
All 36 private state/runtime/snapshot tests pass in 1.83 seconds. Package type
check passes. No data limits or test timeouts were increased.

Four direct built-in subclass snapshot regressions failed: Map/Set lost private
slots; Number/Date rejected guest prototype serialization. Collection heap nodes
now retain private element records. Added guest-boxed and guest-date nodes for
guest-state objects, preserving native payload plus full property/prototype/
private state. Restored objects retain both native methods and private reads.
All 15 private snapshot cases pass. Combined with existing class-constructor,
collection properties/iterators and date property tests: 115 pass in 3.01 seconds.
TypeScript exposed a union-discriminant narrowing issue; split the two guest
payload node variants into separate discriminated union arms and rechecked.
Still audit typed arrays, buffers, promises, regex and generators carrying
private slots, malformed private identity ownership and broader gates.

Three more native-subclass restoration probes failed: Uint8Array and ArrayBuffer
lost private slots, while RegExp rejected guest prototype serialization. Binary
storage state now captures/restores private records (including the shared
DataView route). A guest-regex heap node preserves regex property descriptors,
prototype and slots, restoring its source/flags with the existing guarded regex
compiler. All 18 private snapshot cases now pass in 2.11 seconds; package tsc
passes. Broader existing binary-storage and RegExp snapshot checks were run next.
Remaining serialization audit includes promises and private state stamped onto
generator/iterator objects, plus source-owned private identity validation.

Stamped receiver checks: a private field on an Array iterator already restored
correctly. A stamped generator failed private access after restore; its existing
objectState had serialized the slot but restore omitted installation. Added that
step. Stamped promises pass the maintained public dump/replay route. A low-level
serialize test failed on the host promise reference even without private fields;
kept an explicit unstamped control to document that separate preexisting API
limitation rather than claiming a private-state defect. Combined private and
existing generator/class snapshot checks: 63 pass in 2.67 seconds.

CLI release 34152091679 failed, independently of this uncommitted work:
float32-camera.test.ts has two 5,000ms timeouts (observed 6,603ms and 5,799ms).
Unit job otherwise reported 36,188 passes, 42 skips. Scoped SafeJS 0.1.391 is
published, but do not report successful CLI release. Keep the camera performance
issue active without increasing timeouts or reducing coverage.

Malformed snapshot regressions proved private identity descriptions could be
changed, replaced by numbers, or augmented with arbitrary fields without restore
rejection. Private references now require exact object/description records and
matching scope/field names. A forged array-pattern continuation redirecting #x
to #y was also accepted; source-ownership validation now derives private targets
from array/object patterns and checks markers only at the binding phase.
All 104 private snapshot and existing pattern continuation tests pass in 5.48
seconds; package type checking passes. Continue auditing remaining class/runtime
semantics and broad maintained gates before delivery.

Modifier-name regressions: native comparisons reproduced failures for private
fields named #static, #get and #set followed by another class element. Modifier
recognition now excludes private-identifier tokens. The combined parser/runtime
and snapshot suite passed 106 tests in 3.03 seconds.

A malformed snapshot regression substituted a field into the private-method
blueprint and restore incorrectly accepted it (one failure, 26 passes). Blueprint
validation now permits only methods/accessors, while receiver slot validation
continues to permit fields. All 60 private runtime/state/snapshot checks pass in
2.58 seconds. Broad lint and package validation remain pending before delivery.

Private instance arrays, static arrays, and repeatedly assigned strings all
trigger the existing 4,096-unit data budget while their unbounded controls pass;
no additional mutation checkpoint was necessary for those validated cases.
The private-state suite passes 16 tests in 1.79 seconds. Changed-file ESLint is
clean after correcting a this-alias in lexical lookup; package tsc is clean.
Started the maintained full package unit route with only the separately recorded
host-promise import policy probe excluded. No private-feature tests are excluded.

Full package route finished in 352.42 seconds: 19,486 passes, 41 skips, one
failure. The failure was an existing assertion that copied snapshot roots must
reject Date subclasses. The new guest-date representation now supports them.
Replaced that expectation with serialization, public restore and execution
assertions preserving subclass identity, timestamp and public fields; retained
the separate data-only-copy rejection tests. All 53 focused Date/private
snapshot tests pass in 2.11 seconds. Added direct DataView private-slot restoration
and Number/String/Boolean prototype identity checks; all 31 private snapshot
cases pass. Changed-file TypeScript diagnostics are now zero after adding explicit
test-result/heap narrowing and the required direct-invocation arguments.

Added the paired private-class harness for CLI validation. Build, real execution,
screenshot inspection and final delivery gates are still pending; no private-class
commit or push has occurred yet.

Delivery validation: changed-file ESLint and root lint:types pass. Normal
`npm run build` passed all 70 declared workspace builds and root suffix stages;
SafeJS's four fresh-process built-import checks passed. The built SDK on Node
18.18.0 executes private field updates and dump/replay with the expected [2,3].
The real paired CLI harness passed; inspected the generated screenshot at
screenshots/node-dist-bin.cjs-harness-run-docs-plans-safejs-private-class-elements.md.png
and confirmed the visible success and zero spawns. This is CLI/runtime evidence,
not model behavior evidence. Started a final full package unit run after the
Date expectation and test type-narrowing corrections, with the same one separately
documented host-promise policy probe excluded.

Final full package result: 612 files passed, one skipped; 19,487 tests passed,
41 skipped, zero failures in 344.64 seconds. The host-promise policy probe remains
the only explicit exclusion. All private-class implementation, snapshot,
budget, parser and runtime tests are included. Ready for the atomic private-class
commit and direct-main push; publication must be verified separately.
