# SafeJS completeness inventory — September 9

This refresh supersedes presence claims in the September 8 inventory, not its
historical test evidence. The full JavaScript-completeness goal is unfinished.
The audit covers the working tree, including uncommitted implementations; it
does not describe the published package or only committed sources.

## Fresh runtime evidence

Probe 302398 compared the built guest runtime with native Node 26.4.0 over 79
named paths. For each path it checked typeof, own string/symbol keys, and own
prototype keys where a constructor prototype exists. It evaluated reflection
inside SafeJS through run(), rather than inferring presence from source files.
The build used here was qualified in the Instant-difference work (702af5).

Coverage included the ordinary constructors, all twelve numeric typed arrays,
collections, buffers, Atomics, errors, disposal stacks, Iterator, Reflect,
Promise, JSON, Math, URI/numeric functions and eval; ten Intl constructors;
and all eight Temporal constructors plus Temporal.Now. This is a bounded
name-presence audit, not an algorithm, descriptor, grammar or recovery test.
It does not compare inherited typed-array methods or anonymous intrinsics.

| Surface | Fresh observation | Meaning |
| --- | --- | --- |
| Proxy, WeakMap, WeakSet, WeakRef, FinalizationRegistry | Constructor bindings exist | Older absence claims are stale; semantic and lifetime gaps remain |
| SharedArrayBuffer and Atomics | Constructor/object bindings exist | Presence does not prove concurrent behavior or recovery |
| Temporal.Instant | until/since now present; toLocaleString and toZonedDateTimeISO absent | Partial, uncommitted implementation |
| Temporal.Duration | compare, round and total absent | Partial, uncommitted implementation |
| Temporal.PlainDate, PlainTime, PlainDateTime, PlainYearMonth, PlainMonthDay, ZonedDateTime, Now | Absent | Remaining Temporal implementation work |
| Map.prototype | getOrInsert and getOrInsertComputed were absent in probe 302398; subsequently implemented locally | See [focused qualification](safejs-map-upsert.md); newer compatibility work, not a full conformance claim |
| WeakMap.prototype | getOrInsert and getOrInsertComputed absent | Newer native compatibility gap; classify separately from finalized requirements |
| RegExp constructor | Native legacy capture/context properties absent | Compatibility difference requiring standards classification before a fix |
| Error constructor | Native captureStackTrace, prepareStackTrace and stackTraceLimit absent | Engine-specific compatibility surface, not automatic proof of a language defect |

No other missing names were observed in this selected comparison. That does
not mean all other JavaScript behavior is correct. Native Node is an additional
oracle, not the normative definition: it includes extensions and can itself
have implementation defects.

The [ECMAScript 2026 global-object specification](https://tc39.es/ecma262/2026/multipage/global-object.html)
provides the core classification reference. The [get-or-insert proposal](https://tc39.es/proposal-upsert/)
was still labeled Stage 2.7 / May 6, 2026 when checked; its presence in Node 26
must not be confused with proof that it is a finalized ECMAScript requirement.
Temporal is audited against its [separate specification](https://tc39.es/proposal-temporal/).

## Behavioral and integration work still open

- Temporal requires the missing classes and methods above, calendar/time-zone
  conversions, and replay-aware Now behavior. Duration total has a recorded
  exact-rounding discrepancy in both the selected backend and native Node;
  do not substitute approximate comparisons. See safejs-temporal-gap.md.
- Temporal host copying currently recognizes captured native/backend prototypes
  and tracked null-prototype exports. Arbitrary subclasses, foreign realms and
  untracked null-prototype hosts remain unsupported. Symbol-keyed host binding
  properties require an explicit capability path.
- Weak references/collections remain experimental. Older Node 18 runtimes
  lack the native weak-symbol behavior used by the current implementation;
  Node 18.18.2 remains the supported floor. Cleanup ownership and recovery
  need integration validation, not just constructor presence.
- Native Promise property admission remains unresolved. Settlement-only import
  avoids copying private async-hook state; arbitrary own-symbol copying is not
  a safe compatibility fix. See safejs-host-promise-import-policy.md.
- Shared-memory concurrent visibility, timeout replay, host effects and pending
  wait recovery are not fully qualified. Synchronous Atomics.wait cannot block
  the host event-loop agent under the current architecture.
- Proxy, realm/prototype, dynamic-evaluation and snapshot work have extensive
  focused evidence but no complete conformance proof. Host object transport
  and guest-language semantics must be evaluated separately.

## Qualification and delivery boundary

Recent bounded evidence includes 384 Temporal tests with four native-only skips,
23 native/backend interoperability checks, and 72 subsequent Instant-difference
checks. Actual built guest difference results matched native fields in 648
cases. These selections overlap and must not be added as independent coverage.
The maintained selected build and scoped lint passed for those changes.

The separate ESM initialization fix is committed as 83d854ab8. Its clean
candidate reproduced the baseline crash, then passed 138 focused tests,
the selected build, scoped lint and all five import checks on Node 18 and 22.
See safejs-replay-data-esm-initialization.md.

There is no passing full-current-tree gate to report. The historical full-run
log referenced in earlier notes at
`/tmp/safejs-prototype-current.iGitfF/candidate/full-package.log` was unavailable
on this refresh (5cbadf), so this audit does not elevate its historical counts
to fresh evidence. The package manifest declares no Test262 task; selected
native comparisons are not a substitute for an upstream conformance harness.

The README now identifies the partial Temporal work explicitly. All unfinished
implementation stays local. Pushes and releases remain held; neither local
tests nor commits establish remote delivery or publication.

## Repeating the audit

1. Build the selected SafeJS workspace through the maintained build route.
2. Run the same named-path reflection inside run() and natively on the specified
   Node version. Record own string/symbol keys and types separately; do not
   execute arbitrary accessor properties while collecting names.
3. Check each native-only name against the relevant specification before
   calling it a required missing feature.
4. For behavioral repairs, add a failing regression with an independent
   expected result before changing production code.
5. Reconcile the inventory after changes. Preserve prior evidence as history,
   not as claims about newer code or publication.


## Earlier September 9 evidence (retained history)

The record below predates this refresh. Its test results and unresolved findings
remain historical evidence, not fresh qualification of the Temporal work.

## SafeJS completeness inventory — September 9

This supersedes the presence/status claims in the unpublished September 8
working inventory, not its historical evidence. The full objective and completion criteria remain in
[the original plan](safejs-javascript-completeness-2026-09-05.md). The requested
four-day window has elapsed; completeness has not been established.

### Current evidence

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

### Remaining work

The later isolated intrinsic-prototype candidate's full run (46858) completed
with 25,018 passes, three failures and 37 skips. Two camera batches exceeded
the 5,000 ms test timeout; an async retained-root accounting test exceeded its
fixed ceiling. The accounting test was subsequently corrected to measure the
exact added root cost and reject a one-byte-short budget; its focused selection
passed 57 tests (36198). Camera tests passed a focused repeat but the full-run
timeouts remain unresolved. No later green full-package result is established.

| Area | Current disposition | Evidence still needed |
| --- | --- | --- |
| WeakRef and FinalizationRegistry | Public bindings, job retention, owner cleanup, budgets and heap support are implemented locally; integration remains uncommitted | Full-package regression results, hostile snapshot/rollback audit, and portable unique-symbol lifetime support on older Node 18 |
| WeakMap and WeakSet | Experimental work exists separately in the working tree | Verified integration and older-runtime symbol handling; do not silently include unrelated staged changes |
| Symbols across boundaries | Public symbol bindings are rejected before guest execution | Audit other admitted/internal paths before claiming a cross-realm weak-key defect |
| Native Promise properties | Two tests require own-property admission; settlement-only import remains the implementation | Resolve explicit property-selection policy without copying async-hook or AsyncLocalStorage metadata |
| Shared memory | Integer Atomics, managed shared buffers, async waits and bounded replay/recovery cases are implemented | Arbitrary intermediate async visibility, deterministic timeout recovery, host boundary and concurrency audits |
| Internal wait restoration | Local committed heap restorer exposes explicit activation | Do not confuse this with the public SDK's source-replay path |
| Mixed-realm intrinsic snapshots | A built-runtime probe combined distinct Number prototypes from two runs; low-level restoration collapsed their identities | Establish supported transport boundaries and preserve realm-qualified intrinsic graphs; see [the reproduction](safejs-mixed-realm-snapshot-identity.md) |
| Intrinsic prototype ownership | An uncommitted repair preserves originating realm parents and intrinsic identity through low-level replay | Complete independent integration checks and resolve full-suite camera timeouts before committing |
| eval, Proxy and general language semantics | Many focused implementations and comparisons exist | An exhaustive conformance disposition is absent; presence and historical green tests are insufficient |
| Ambient host APIs | No implicit DOM, Node, filesystem or network authority | Preserve capability boundaries; language completeness does not authorize exposing host privileges |
| Repository-wide delivery checks | Focused/package evidence exists, not a current green repository gate | Appropriate maintained lint/build/test routes before eventual delivery |

The unpublished `safejs-weak-reference-job-lifetime.md` working notes contain
reproducers, rejected suspicions and rollback tests. The full-run fingerprint
over 1,343 source/test files is
`1972e4c97fe92b4596684f54fe381eaf85c0dad28e550e99353ddf963d70a4bb`.
A public cross-run symbol probe (510a76) failed at input
admission, so it did not validate the suspected registered-symbol WeakRef bug.

### Delivery boundary

Subsequent local commits preserve buffer object state in public dumps
(`ec097d454`), make DataView/SharedArrayBuffer prototype bindings nonwritable
(`7f3af9922`), share per-realm numeric parser functions (`0b3e4d7c0`), and correct
32 other built-in function lengths (`fa654e3fc`). The parser candidate passed
1,896 isolated tests and the later metadata candidate passed 179 focused tests;
both passed the maintained selected build and scoped lint. See the
[parser record](safejs-numeric-parser-identity.md) and
[metadata record](safejs-standard-builtin-metadata.md) for exact scopes. These
fixes do not resolve the pending work listed above or prove full conformance.

Recent local commits include background-job error reporting (556f723ff),
detachable cleanup registration (461cd5bb6), keeping detach handles internal
(0fca5e260), README status (9d957ef04), and job-owned weak-target retention
(8deb1d36d). The latter passed an isolated 74-test selection, TypeScript and
scoped lint. These are local commits, not verified remote-main delivery.

The user's release hold remains in force. Main pushes publish automatically,
so no pushes, tags or release workflows are authorized. Do not close issues
based solely on local fixes. Continue implementation and isolated validation;
keep local commits, remote delivery and publication status separate.
