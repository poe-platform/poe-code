# SafeJS completeness: September 10 checkpoint

This supersedes older inventory status claims, not their historical evidence.
The original JavaScript-completeness objective remains active. Source presence,
focused test success, local commits, remote delivery and publication are separate.

## Current local evidence

At 9d2eeb443, the Temporal namespace includes Now and all eight constructors.
Temporal replay/heap support, originating intrinsic prototype parents and weak
graph snapshots are locally committed. Earlier statements that Now is absent
or those integrations are wholly uncommitted are obsolete.

The latest snapshot-directory run passed 2,134 tests across 157 files, including
mixed-realm iterator and mixed-source/template tests. This is
not a full-package result. The latest full package gate passed 27,619 tests,
failed 14 and skipped 48; all 100 filesystem type contracts passed. See
[the full gate record](safejs-post-array-fixes-gate.md). Its failures are two
Promise-property admission cases and twelve ISO month-formatting cases.
No timeout failures were reported. Earlier 34- and ten-failure totals are historical.

After the weak-constructor descriptor and CLI import fixes and the Date,
boxed-accessor and legacy-regex test reconciliations, a focused failure-set
rerun reports 160 passes, 14 failures and one skip (df1c30). The remaining
failures are two Promise-property admission cases and twelve ISO month-formatting
cases, including six newly added standalone/range regressions. Buffer and camera
tests pass in that selection; this does not establish full-suite timing
reliability. The newer full-package result above now supersedes that selection
as the broad result. JSON regressions added after its launch are checked separately.

## Remaining verified gaps and verification work

The subsequently reproduced `sort`/`toSorted` comparator-order defect is fixed
locally in `d8e21fdfb`: 614 focused array tests and 21 pinned Test262 `toSorted`
cases pass. See [the regression record](safejs-array-sort-validation-order.md).
Additional bounded [array, grouping and Set probes](safejs-test262-copy-and-group-behavior.md)
pass unchanged; neither result supersedes the full-package failure count.

| Area | Evidence and remaining work |
| --- | --- |
| JSON reviver traversal and writes | Locally repaired: 268 focused tests and all 77 pinned JSON/parse cases pass in the main checkout. See [the repair record](safejs-json-reviver-proxy-gap.md). This fix is not included in the latest full-package result. |
| Date JSON hooks and primitive receivers | Removed-hook serialization repaired in `95a991445`; generic BigInt/Symbol receiver boxing separately validated and repaired. See [hook removal](safejs-json-date-hook-removal.md) and [primitive boxing](safejs-date-json-primitive-boxing.md). Neither repair is included in the latest full-package result. |
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

Typed-array source contains accessor rejection in its legacy allocation path,
but normal guest object inputs use the iterator/property-aware allocator.
A source-text restriction alone is not proof of a public constructor defect.

Do not close the overall goal, remove failing tests, increase deadlines, or
raise the Node version floor to turn this inventory into apparent completion.
