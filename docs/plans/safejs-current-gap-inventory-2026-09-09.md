# SafeJS completeness inventory — September 9

This supersedes the presence/status claims in the unpublished September 8
working inventory, not its historical evidence. The full objective and completion criteria remain in
[the original plan](safejs-javascript-completeness-2026-09-05.md). The requested
four-day window has elapsed; completeness has not been established.

## Current evidence

A fresh source-runtime probe (42245, Node 22.23.2) compared ten globals with the
host runtime. `eval`, `Function`, `Proxy`, `WeakMap`, `WeakSet`, `WeakRef`,
`FinalizationRegistry`, and `SharedArrayBuffer` returned `function` in both;
`Reflect` and `Atomics` returned `object` in both. This establishes name presence
only. It does not establish complete semantics, portability, or publication.

The isolated full-package run at 24ead3798 passed 24,961 tests and skipped 37;
it excludes the later cleanup/job changes and uncommitted weak-reference work.
The working-tree full-package run (99280) included those changes and completed:
25,116 passed, four failed, 37 skipped across 1,002 files in 924.25 seconds.
Its source/test fingerprint matched before and after. Two failures required
explicit new intrinsic names in historical checkpoint comparisons; those two
files now pass 44 tests with one skip. The other two concern native Promise
property admission. This is not a green full-package gate.

More recent bounded checks: 1,806 snapshot/job/weak-reference tests passed across
138 files before the rollback-error follow-up. After that follow-up, all 1,771
snapshot tests passed across 132 files. Its additional compile-owner reuse
assertion passed in the seven-test registry snapshot selection. These checks do
not substitute for the pending full-package result.

## Remaining work

| Area | Current disposition | Evidence still needed |
| --- | --- | --- |
| WeakRef and FinalizationRegistry | Public bindings, job retention, owner cleanup, budgets and heap support are implemented locally; integration remains uncommitted | Full-package regression results, hostile snapshot/rollback audit, and portable unique-symbol lifetime support on older Node 18 |
| WeakMap and WeakSet | Experimental work exists separately in the working tree | Verified integration and older-runtime symbol handling; do not silently include unrelated staged changes |
| Symbols across boundaries | Public symbol bindings are rejected before guest execution | Audit other admitted/internal paths before claiming a cross-realm weak-key defect |
| Native Promise properties | Two tests require own-property admission; settlement-only import remains the implementation | Resolve explicit property-selection policy without copying async-hook or AsyncLocalStorage metadata |
| Shared memory | Integer Atomics, managed shared buffers, async waits and bounded replay/recovery cases are implemented | Arbitrary intermediate async visibility, deterministic timeout recovery, host boundary and concurrency audits |
| Internal wait restoration | Local committed heap restorer exposes explicit activation | Do not confuse this with the public SDK's source-replay path |
| eval, Proxy and general language semantics | Many focused implementations and comparisons exist | An exhaustive conformance disposition is absent; presence and historical green tests are insufficient |
| Ambient host APIs | No implicit DOM, Node, filesystem or network authority | Preserve capability boundaries; language completeness does not authorize exposing host privileges |
| Repository-wide delivery checks | Focused/package evidence exists, not a current green repository gate | Appropriate maintained lint/build/test routes before eventual delivery |

The unpublished `safejs-weak-reference-job-lifetime.md` working notes contain
reproducers, rejected suspicions and rollback tests. The full-run fingerprint
over 1,343 source/test files is
`1972e4c97fe92b4596684f54fe381eaf85c0dad28e550e99353ddf963d70a4bb`.
A public cross-run symbol probe (510a76) failed at input
admission, so it did not validate the suspected registered-symbol WeakRef bug.

## Delivery boundary

Recent local commits include background-job error reporting (556f723ff),
detachable cleanup registration (461cd5bb6), keeping detach handles internal
(0fca5e260), README status (9d957ef04), and job-owned weak-target retention
(8deb1d36d). The latter passed an isolated 74-test selection, TypeScript and
scoped lint. These are local commits, not verified remote-main delivery.

The user's release hold remains in force. Main pushes publish automatically,
so no pushes, tags or release workflows are authorized. Do not close issues
based solely on local fixes. Continue implementation and isolated validation;
keep local commits, remote delivery and publication status separate.
