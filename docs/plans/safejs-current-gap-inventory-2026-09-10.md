# SafeJS completeness: September 10 checkpoint

This supersedes older inventory status claims, not their historical evidence.
The original JavaScript-completeness objective remains active. Source presence,
focused test success, local commits, remote delivery and publication are separate.

## Current local evidence

At 9d2eeb443, the Temporal namespace includes Now and all eight constructors.
Temporal replay/heap support, originating intrinsic prototype parents and weak
graph snapshots are locally committed. Earlier statements that Now is absent
or those integrations are wholly uncommitted are obsolete.

The latest snapshot-directory run passed 2,093 tests across 155 files. This is
not a full-package result. The last full package gate passed 27,437 tests,
failed 10 and skipped 48; all 100 filesystem type contracts passed. See
[the full gate record](safejs-post-temporal-full-gate.md).

## Remaining verified gaps and verification work

| Area | Evidence and remaining work |
| --- | --- |
| Full-suite reliability | Buffer compatibility and camera cases timed out in the full gate. Unchanged focused runs pass. Buffer cold imports consumed 2.43 seconds in one diagnostic; neither timeout is proved fixed. |
| Host Promise properties | Two full-gate failures concern omitted own properties. Define safe admission without copying private async-hook symbols; do not equate arbitrary host metadata with guest data. |
| ISO locale month names | Six full-gate failures concern PlainMonthDay/PlainYearMonth month names on Node 22.23.2. Preserve calendar semantics rather than substituting Gregorian output. |
| Older-runtime weak symbols | Native Node 18.18.2 rejects a symbol WeakRef target. Node 18.20.8 accepts it and passes all 42 selected weak snapshot tests. The supported version range is not uniformly covered. |
| Mixed-realm transport | Intrinsic snapshots preserve separate graphs, mutations and aliases; same-source closures preserve originating literal prototypes and dynamic Function globals through repeated checkpoints. All 2,093 snapshot tests pass. Mixed-source closures, classes, active generators and public admission/replay boundaries still need further work. See [the closure record](safejs-mixed-realm-closure-ownership.md). |
| Temporal portability and extremes | Fixed-offset Intl zones on older runtimes, reversed PlainTime ranges, extreme Intl dates and skipped civil-day semantics remain tracked separately. Focused Temporal passes do not settle them. |
| Broad conformance | Parser, evaluation order, exotic objects, modules, recovery, host boundaries and resource limits still require broader evidence. No exhaustive JavaScript conformance result exists. |
| Delivery | Release hold remains active. No new remote-main or publication claim follows from these local commits. |

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
