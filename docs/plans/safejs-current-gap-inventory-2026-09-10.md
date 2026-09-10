# SafeJS completeness: September 10 checkpoint

This supersedes older inventory status claims, not their historical evidence.
The original JavaScript-completeness objective remains active. Source presence,
focused test success, local commits, remote delivery and publication are separate.

## Current local evidence

Newest completed full gate, runtime d4891dd09: **28,319 passed, 14 failed,
47 skipped across 1,249 files**, plus 100 filesystem type contracts passed.
Session 69114 is terminal. The prior regex cursor failure did not recur;
the two Promise-property and twelve locale failures remain. See
[the completed post-parser gate](safejs-post-loop-parser-qualification.md).
This supersedes the earlier broad totals below and predates the catch repair.

The newest completed gate, runtime 8cab804a9, reports 28,379 passed, 14 failed,
47 skipped across 1,252 files; its 100 filesystem contracts passed. Session
52427 is terminal. It covers the catch/import changes and has the same two
Promise-property and twelve locale failures as the earlier gate. The separate
snapshot selection passes 2,193 tests across 160 files. Earlier table statements that the latest
full gate predates template, optional-chain, enumeration or loop-parser repairs
are historical: the d4891dd09 gate above includes those repairs.

Error cause Proxy reflection is now under main integration after isolated
validation: 25 regressions cover public replay, cleanup and cross-realm cause
identity. Main reproduced 22 failures and three passing controls before the
repair. See [the repair record](safejs-error-cause-reflection.md). This change
postdates the completed full gate and is not delivered remotely.

Skipped-case qualification: the 13 host-feature-dependent skips execute on
Node 26.8.1, with all 86 tests in their four files passing. The opt-in parser
fuzz harness exposed a stale expectation that intentional regex flag-budget
rejections have syntax coordinates; its narrowly corrected classifier passes
3,100 generated inputs without changing runtime guards or deadlines. The other
33 skips are named memfs reference differences. See
[the qualification](safejs-opt-in-fuzz-qualification.md).

Latest gate update at runtime 3cd9fad79: **28,271 passed, 15 failed, 47 skipped**
across 1,247 files; all 100 filesystem type contracts passed. This supersedes
the older full-gate counts and coverage statements below: template, optional
chain, enumeration and loop-header repairs are now covered. Fourteen failures
match the Promise/locale findings; an additional regex cursor runner failure
requires investigation. Its 12-case focused rerun passes, which does not make
the full gate green. See [the completed gate](safejs-post-loop-header-integration-gate.md).
The literal-member assignment-target repair is now integrated locally with
1,539 parser tests passing, one skipped, and clean lint/TypeScript checks. See
[its regression record](safejs-literal-member-assignment-targets.md).
The sloppy-let statement-body repair is also integrated; the combined parser
selection passes 1,559 tests with one skipped. See
[its regression record](safejs-sloppy-let-statement-bodies.md).

At 9d2eeb443, the Temporal namespace includes Now and all eight constructors.
Temporal replay/heap support, originating intrinsic prototype parents and weak
graph snapshots are locally committed. Earlier statements that Now is absent
or those integrations are wholly uncommitted are obsolete.

The latest snapshot-directory run passed 2,134 tests across 157 files, including
mixed-realm iterator and mixed-source/template tests. This is
not a full-package result. The latest completed full package gate passed 28,077 tests,
failed 14 and skipped 47; all 100 filesystem type contracts passed. See
[the full gate record](safejs-post-raw-integration-gate.md). Its failures are two
Promise-property admission cases and twelve ISO month-formatting cases.
No timeout failures were reported. Earlier 34- and ten-failure totals are historical.

After the weak-constructor descriptor and CLI import fixes and the Date,
boxed-accessor and legacy-regex test reconciliations, a focused failure-set
rerun reports 160 passes, 14 failures and one skip (df1c30). The remaining
failures are two Promise-property admission cases and twelve ISO month-formatting
cases, including six newly added standalone/range regressions. Buffer and camera
tests pass in that selection; this does not establish full-suite timing
reliability. The newer full-package result above now supersedes that selection
as the broad result. It includes the JSON, Date and Iterator setter repairs,
and the Proxy index-key and string argument-coercion repairs through concat.
It includes Proxy locale-list membership, direct collation, and direct String.raw.

The maintained full-package run at runtime 246946605 is terminal, with 1,237
files represented in its report. It predates the raw-template line-ending and
template diagnostic-position repairs. Their focused checks are separate evidence.

After the string repairs through `e62c4290d`, a combined selection of
`interp/methods/string`, `interp/globals/string-`, run.string-coercion and
string-coercion-retention passed 2,563 tests in 43 files (c1d9c1). This checks
the accumulated changes together; it does not supersede the full-package
failure count. Legacy substr is also repaired; see
[its validation record](safejs-string-substr-coercion.md).

## Remaining verified gaps and verification work

Dynamic import attribute reflection is repaired locally: Proxy key/descriptor/
get traps and live enumerability now use the shared enumerable-property helper.
Eight regressions failed before the fix; 1,285 related tests pass, with clean
lint and TypeScript checks. Nonempty attributes remain unsupported by the
registered-module host. See [the repair record](safejs-import-attribute-reflection.md).

Catch destructuring's array-only binding, omitted Proxy object-rest reflection
and lost parameter-default checkpoint bindings are now repaired on local main
using the shared binding implementation. Main validation passes 73 focused
tests and all 2,193 snapshot tests, plus lint, TypeScript, the maintained build
and three Node18 built-runtime probes. Public async-function dump/restore and
old catch-body snapshot compatibility are covered. See
[the repair record](safejs-catch-iterator-protocol.md). These results do not
resolve the 14 Promise/locale failures in the completed post-parser full gate.

The subsequently reproduced `sort`/`toSorted` comparator-order defect is fixed
locally in `d8e21fdfb`: 614 focused array tests and 21 pinned Test262 `toSorted`
cases pass. See [the regression record](safejs-array-sort-validation-order.md).
Additional bounded [array, grouping and Set probes](safejs-test262-copy-and-group-behavior.md)
pass unchanged; neither result supersedes the full-package failure count.

| Area | Evidence and remaining work |
| --- | --- |
| JSON reviver traversal and writes | Locally repaired: 268 focused tests and all 77 pinned JSON/parse cases pass in the main checkout. See [the repair record](safejs-json-reviver-proxy-gap.md). Included in the latest full-package result. |
| Date JSON hooks and primitive receivers | Removed-hook serialization repaired in `95a991445`; generic BigInt/Symbol receiver boxing separately validated and repaired. See [hook removal](safejs-json-date-hook-removal.md) and [primitive boxing](safejs-date-json-primitive-boxing.md). Both repairs are included in the latest full-package result. |
| Proxy internal numeric read keys | Repaired locally in `987bc7274`: 1,024 focused tests pass, including 29 regressions. See [the repair record](safejs-array-proxy-index-keys.md). Included in the latest completed full-package result. |
| String argument coercion | Search predicates, index searches, repeat, character access, slice/substring/substr, normalize, padding, ignored arguments, concat and direct String.raw repairs are included in the latest completed full gate. See [raw conversion](safejs-string-raw-direct-coercion.md). Other string behavior still requires audit. |
| Locale-list and direct collation conversion | Proxy locale-list membership (`6e32b7851`) and direct collation conversion (`c15f7bcff`) pass focused checks and are included in the latest completed full gate. |
| Template line endings | Raw-text CR/CRLF normalization is repaired locally in `3e3338622`. Diagnostic source-position correction has a separate regression and repair record. See [raw values](safejs-template-raw-line-normalization.md) and [diagnostics](safejs-template-escape-positions.md). Neither repair is covered by the latest completed full gate. |
| Tagged-template constructor precedence | Upstream constructor-invocation failure is locally repaired with 17 regressions and 1,618 broader parser/template/replay passes. See [the repair record](safejs-new-tagged-template-precedence.md). The latest completed full gate predates this change. |
| Optional-chain propagation | Validated continuing-chain and parenthesis-boundary failures are locally repaired in `46df79a5a`; 4,197 selected tests pass with one skip. The pinned top-level probe reports 19 runtime passes, 12 parse rejections, six async exclusions and one eval context mismatch, not an eval defect. See [the chain repair](safejs-optional-chain-short-circuit.md). Missing closure/generator calls found by the follow-up probe are separately repaired with 32 regressions and 638 related test passes; see [method calls](safejs-optional-missing-methods.md). The latest full gate predates these changes. |
| Async optional chains | The six previously excluded fixtures are now qualified: five pass, and one differs because SafeJS reports an intentionally unhandled rejection. Across all 38 top-level fixtures: 24 runtime passes, 12 parse rejections, one Script-context mismatch and one rejection-policy difference. All 72 selected optional-chain regressions pass. See [the async qualification](safejs-optional-chain-async-qualification.md). |
| Logical assignment | All 78 pinned top-level fixtures qualify: 66 runtime passes and 12 parse rejections, with no exclusions or native-unqualified cases. Twenty-seven independent suspension comparisons and 18 new JSON checkpoint-restore tests pass without runtime changes. See [the qualification record](safejs-logical-assignment-qualification.md). This is not exhaustive conformance. |
| For-in enumeration and headers | Built-in enumeration and primitive boxing are repaired in `a2bccef6c`; 562 related tests pass. Header lexical bindings are separately repaired for for-in/of/await-of with 26 regressions/checkpoint cases and 2,748 broader test passes. The repeated top-level for-in probe reports 51 runtime passes, 26 parse rejections and nine exclusions, with no failures; five corresponding for-of cases pass. See [enumeration](safejs-for-in-builtin-enumeration.md) and [header scopes](safejs-for-head-lexical-scope.md). The full gate predates both repairs. |
| Loop parser gaps | Literal-member assignment targets and sloppy statement-body `let` ASI are repaired locally in separate improvements. The combined isolated probe of all 119 for-in fixtures reports 57 runtime passes and 62 parse rejections, with no failures or exclusions. Main parser checks pass 1,559 cases with one skip; a new full integration gate remains required. See [literal targets](safejs-literal-member-assignment-targets.md) and [sloppy let](safejs-sloppy-let-statement-bodies.md). |
| Full-suite reliability | The latest full gate reports no timeout failures. Prior buffer/camera timeouts were not reproduced; repeatability remains unproven. |
| Host Promise properties | Two full-gate failures concern omitted own properties. Define safe admission without copying private async-hook symbols; do not equate arbitrary host metadata with guest data. |
| ISO locale month names | Twelve full-gate failures concern standalone/range and PlainMonthDay/PlainYearMonth month names on Node 22.23.2. Preserve calendar semantics rather than substituting Gregorian output. |
| Older-runtime weak symbols | Native Node 18.18.2 rejects a symbol WeakRef target. Node 18.20.8 accepts it and passes all 42 selected weak snapshot tests. The supported version range is not uniformly covered. |
| Mixed-realm transport | Intrinsic graphs, same-source closures, classes and generators preserve originating prototypes in tested checkpoints. Async-generator and pending guest-promise function tests pass, including settled-result recapture; see [the async record](safejs-mixed-realm-async-qualification.md). Mixed-source closures, external host-operation resumption, broader async behavior and public admission/replay boundaries still need further work. |
| Temporal portability and extremes | Fixed-offset Intl zones on older runtimes, reversed PlainTime ranges, extreme Intl dates and skipped civil-day semantics remain tracked separately. Focused Temporal passes do not settle them. |
| Broad conformance | Parser, evaluation order, exotic objects, modules, recovery, host boundaries and resource limits still require broader evidence. No exhaustive JavaScript conformance result exists. |
| Delivery | Release hold remains active. No new remote-main or publication claim follows from these local commits. |

The reproduced mixed-source body-substitution defect now passes focused tests
with explicit module-source records. Captured template provenance and cache
ownership also pass targeted checks, including separate realms using the same
source site. All 2,134 snapshot tests pass with this implementation, as do the
maintained build's 23 workspace builds and five import checks. See
[the source-identity record](safejs-mixed-source-closure-identity.md).

## Suspicions not established as defects


Four Error diagnostic accessor checks pass unchanged, including frozen errors.
A guest-captured thenable resolver works as a FinalizationRegistry callback and
restores successfully. Neither observation supports a runtime fix. Internal
adoption-resolver callback reachability was not established by that probe.

Context-free Math factory calls skip guest conversion closures, but calls with
an execution context pass the 35-method probe. An isolated candidate breaks
seven established native-object direct-call tests. This is an internal contract
inconsistency, not a proven ordinary guest-language defect; see
[the qualification](safejs-math-direct-coercion-qualification.md). No candidate
runtime change was integrated.

The bounded new-expression selection passes 58 fixtures; its one native-unqualified
cross-realm case passes an adapted internal guest-value probe. Public live-realm
callback transport is a different boundary: callbacks exported by one live realm
are rejected when injected into another realm or ordinary run bindings. See
[the qualification and admission evidence](safejs-new-expression-qualification.md).
Do not describe the internal result as transparent live-realm interoperability.

Typed-array source contains accessor rejection in its legacy allocation path,
but normal guest object inputs use the iterator/property-aware allocator.
A source-text restriction alone is not proof of a public constructor defect.

Do not close the overall goal, remove failing tests, increase deadlines, or
raise the Node version floor to turn this inventory into apparent completion.
