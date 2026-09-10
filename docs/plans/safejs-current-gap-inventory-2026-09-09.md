# SafeJS completeness inventory — September 9

This refresh supersedes presence claims in the September 8 inventory, not its
historical test evidence. The full JavaScript-completeness goal is unfinished.
The audit covers the working tree, including uncommitted implementations; it
does not describe the published package or only committed sources.

## Latest verification update

A fresh source-runtime own-name audit against temporal-polyfill 1.0.4
(61688c, Node 22.23.2) finds no missing static/prototype names for Instant,
PlainDateTime, PlainTime, Duration or ZonedDateTime. PlainDate still lacks
toPlainYearMonth/toPlainMonthDay. PlainYearMonth and
PlainMonthDay remain absent. This checks names only against the backend, not
descriptors, semantics, native engines or full standards conformance; it does
not supersede the unresolved full-suite failures below.

A new maintained package gate is running in session 63746, including the latest
ZonedDateTime locale and Duration owned-relativeTo changes. See
[the current gate record](safejs-post-zoned-integration-gate.md). No result is
claimed until that process finishes and its source fingerprint is rechecked.

A fresh full package gate after PlainDate/Intl integration finished; see
[the source fingerprint and live-run record](safejs-post-plain-date-full-gate.md).
Its 100 filesystem type contracts passed. Final results: 26,777 passed, four
failed and 41 skipped; the source fingerprint matched before/after. Two
failures concern native Promise property imports, and two are 5-second timeouts
in the completed-replay 128-draw case and PPR2 `co` continuation scenario.
This is a failing gate, not completed integration or JavaScript conformance.

After that gate, ZonedDateTime private storage and captured host-slot readers
were implemented and passed 19 focused tests on each of Node 18.18.2, 22.23.2
and 26.4.0. Subsequent working-tree integration adds copying, budgets, host
bindings, heap/replay codecs, public construction, 28 getters, from(), and
conversions to Instant/PlainDate/PlainTime/PlainDateTime, compare(), equals(),
withTimeZone(), withCalendar(), withPlainTime(), startOfDay(), getTimeZoneTransition(),
add(), subtract(), with(), round(), until(), since(), toString(), toJSON(), and
toLocaleString(). Calendar-taking methods also admit owned ZonedDateTime calendar
slots, and Duration compare/round/total accept owned zoned relativeTo values.
Broader semantic qualification remains incomplete. See the
[implementation record](safejs-temporal-zoned-date-time.md).

A source-runtime reflection check against Node 26.4.0 (153cde) now finds only
three missing PlainDate conversion names, the zoned conversions on Instant and
PlainDateTime, and the three missing constructors PlainYearMonth, PlainMonthDay
and ZonedDateTime. There were no mismatches in checked existing own string-keyed
descriptor attributes or method/getter names and lengths. This audit excludes
symbol keys, caller/arguments, algorithm behavior and Now; see the linked record.

The post-PlainDateTime full package gate completed with 26,614 passed, two failed
and 41 skipped tests (13effb), plus 100 passing filesystem type contracts.
Both failures concern native Promise property imports. The source fingerprint
matched before/after (9c7089); exact evidence is in
[the integration report](safejs-current-integration-gate.md). The prior timing
failure did not recur, which is not proof of a performance repair. This is a
failing package gate, not complete JavaScript conformance or delivery.

The post-offset/time-zone integration full package run completed with 26,420
passed, three failed and 41 skipped tests (765f71). Failures were the two native
Promise property-import expectations and the adversarial corpus exceeding its
750 ms budget at 997.2 ms. An unchanged isolated corpus rerun passed at 272 ms;
the full-run timing failure remains unresolved. See the exact fingerprint and
saved-log hash in [the integration report](safejs-current-integration-gate.md).

After that full run, local commit `ea35d7e77` repaired regex boundaries inside
template substitutions. Its parser/template/regex selection passed 1,616 tests
with one skipped; scoped lint, the maintained 23-task build and five fresh ESM
checks passed. All 19 upstream PlainTime.from argument-string fixtures passed
in both script modes (38/38), resolving the prior helper-parsing failures.
See [the regression record](safejs-template-regex-boundaries.md). That change is
outside the full-run fingerprint, and neither selection proves full conformance.

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
| Temporal.Instant | until/since, toLocaleString and toZonedDateTimeISO present; input operations admit private zoned epochs | Partial, uncommitted implementation; full conformance remains unproven |
| Temporal.Duration | total, compare and round now present | Uncommitted implementation; broader calendar conformance remains open |
| Temporal.PlainTime | Constructor, six field getters and all named prototype methods now present, including toLocaleString, with owned data copying and heap/replay codecs | Uncommitted public integration; direct Intl format/parts/ranges now accept PlainTime and Instant, with requested-options snapshot preservation; legacy snapshots use resolved fallback |
| Intl fixed-offset zones on Node 18 | Strict offset validation and PlainTime.toLocaleString now pass focused Node 18 regressions | Numeric Date/Instant and direct Intl offset formatting remain incomplete; backend also fails all nine offset/type controls on Node 18 (d83fb6); see [offset-zone investigation](safejs-intl-offset-zone-portability.md) |
| Temporal.PlainDateTime | Present with getters, from/compare/equals, with/withCalendar/withPlainTime, add/subtract, until/since, round, toPlainDate, toZonedDateTime, locale/ISO formatting and private copy/replay integration | Public integration remains uncommitted; direct Intl format/parts/ranges now accept owned PlainDateTime values; broader conformance remains unproven |
| Temporal.PlainDate | Constructor, calendar/date getters, from/compare/equals, add/subtract, until/since, with/withCalendar, toPlainDateTime, toZonedDateTime, locale/ISO and direct Intl formatting, private copies, host bindings and heap/replay now exist in the working tree; input readers accept private zoned slots | Year-month/month-day conversions remain unfinished; see [PlainDate integration](safejs-temporal-plain-date.md) |
| Temporal.PlainYearMonth, PlainMonthDay, Now | Absent | Remaining Temporal implementation work |
| Temporal.ZonedDateTime | Constructor/getters, from/compare/equals, zone/calendar/time replacement, startOfDay, transition lookup, add/subtract, with, round, until/since, plain/instant conversions and ISO/JSON/locale formatting exist with owned copying and snapshots | No missing own static/prototype names in audit 61688c; broader conformance remains unfinished |
| Map.prototype | getOrInsert and getOrInsertComputed were absent in probe 302398; subsequently implemented locally | See [focused qualification](safejs-map-upsert.md); newer compatibility work, not a full conformance claim |
| WeakMap.prototype | getOrInsert and getOrInsertComputed were absent in probe 302398; experimental implementation now exists | [WeakMap integration](safejs-weakmap-upsert.md) remains uncommitted and inherits older-Node weak-symbol limitations |
| RegExp constructor | Native legacy capture/context properties absent | Compatibility difference requiring standards classification before a fix |
| Error constructor | Native captureStackTrace, prepareStackTrace and stackTraceLimit absent | Engine-specific compatibility surface, not automatic proof of a language defect |

No other missing names were observed in this selected comparison. That does
not mean all other JavaScript behavior is correct. Native Node is an additional
oracle, not the normative definition: it includes extensions and can itself
have implementation defects.

A fresh built-runtime audit against Node 26.4.0 (ca8de4) checked all eight
Temporal constructors and their own static/prototype string names. It confirms
PlainDateTime was present, with eight prototype names still missing at that
time; Instant still lacked toZonedDateTimeISO. Duration and PlainTime had
no missing names in that comparison. The four date/zoned constructors remain
absent. This probe used the build qualified in the required-rounding-unit fix
(e4c482), before the latest relativeTo calendar-bag adapter change. It does not
establish behavioral or symbol/descriptor conformance, and it did not recheck Now.

A subsequent source-runtime reflection check (f0a87e), compared against native
Node 26.4.0, found only toPlainDate and toZonedDateTime missing from
PlainDateTime's own prototype string names. Instant still lacks
toZonedDateTimeISO; Duration and PlainTime have no missing names in this bounded
comparison. PlainDate, PlainYearMonth, PlainMonthDay and ZonedDateTime remain
absent, as does Now. This supersedes the earlier eight-method absence claim;
it does not establish complete behavior, descriptors, symbols or delivery.
That check predates the owned PlainDate integration and PlainDateTime.toPlainDate.
The latter now passes all eight pinned upstream fixtures in both modes (16/16,
bc79c9), plus focused private-slot, intrinsic-prototype and replay regressions;
see safejs-temporal-plain-date.md. PlainDate remains partial, and the three other
date/zoned constructors and Now remain unimplemented.

After that reflection check, the PlainDate private core was committed locally
as e7a984670. Constructor/getters, copying, host bindings and snapshot/replay
integration now exist in the working tree, with seven public construction and
host-result replay tests passing (ac537d). The earlier PlainDate absence result
is historical; this partial implementation is not complete date interoperability.

Recent upstream evidence at Test262 revision
419d3e0a2273ba01a3bfcbec423f2801425b8e93: add/subtract passed all 168 runs;
until passed 188 of 196 runs, with eight failures in fixtures requiring missing
date/zoned types; since passed 182 of 190 runs, with the same eight missing-type
failures. All fifteen intl402 PlainDateTime
toLocaleString fixtures passed in both modes (30/30) after reproducing and
fixing direct Intl admission of private PlainDateTime values. That latest
locale result used current source, not a rebuilt artifact. See
[the implementation and verification record](safejs-temporal-plain-date-time.md).
These changes postdate the last full-package fingerprint, remain uncommitted,
and have not been pushed or released.

Recent behavioral evidence includes all 71 rounding tests passing on Node
18.18.2 and successful reruns of the two formerly failing upstream rounding
fixtures in both script modes. The full upstream round directory's last result
was 86/90 before that error-type fix. A fresh complete-directory source-runtime
rerun now passes all 90 runs, with no exclusions (ffb0d5). Current Duration relativeTo integration passed 101 focused tests,
covering private PlainDateTime fields and calendar-bearing property bags.

The [ECMAScript 2026 global-object specification](https://tc39.es/ecma262/2026/multipage/global-object.html)
provides the core classification reference. The [get-or-insert proposal](https://tc39.es/proposal-upsert/)
was still labeled Stage 2.7 / May 6, 2026 when checked; its presence in Node 26
must not be confused with proof that it is a finalized ECMAScript requirement.
Temporal is audited against its [separate specification](https://tc39.es/proposal-temporal/).

## Behavioral and integration work still open

The backend's acceptance of overflowing offset minutes/seconds was reproduced
in Instant, PlainTime and Duration inputs. Local guards now reject these before
normalization or later option reads while retaining valid precise offsets and
clock leap seconds. See [component validation](safejs-temporal-offset-component-validation.md)
for focused evidence; the post-change full gate failed as recorded above.
The subsequently confirmed time-only, year-month and month-day time-zone input
gap now has a local parser and Instant/Duration integration with date and
annotation validation. See [zone-string conversion](safejs-temporal-time-zone-strings.md)
for focused evidence and explicitly classified native/specification differences;
the missing Temporal classes and full conformance audit remain open.

- Temporal requires the missing classes and methods above, calendar/time-zone
  conversions, and replay-aware Now behavior. The recorded Duration-total hour
  and calendar-fraction rounding discrepancies now have exact arithmetic fixes;
  broader conformance remains unproven. See safejs-temporal-duration-total.md
  and safejs-exact-duration-division.md; do not substitute approximate comparisons.
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

Later Duration integration passed 288 selected cases across sixteen files,
followed by 30 focused rounding cases. These overlap, not additive coverage.
The latest qualified build is 14b990. Fresh built reflection a7ab0a now finds
no missing own static/prototype string names on Duration versus Node 26.4.0;
Instant still lacks toZonedDateTimeISO. This two-constructor presence check
does not establish descriptors, symbol properties or behavioral conformance.
The post-Duration full-package run is recorded in safejs-current-integration-gate.md.

The recorded rerun has now terminated (b4c7fe): 25,954 passed, two failed,
41 skipped, with all 100 filesystem type contracts passing. Both failures are
the native Promise property-import expectations. Source/test fingerprint
`f2834179519887acd7b333cf145aea2812a0bd86a2a018e656fbbfd4eff7d65e`
matched before and after the run. The replay timeout did not recur; this does
not prove a performance repair. The saved log is
`/tmp/safejs-full-gate.sOX0Xu/full-test.log` (SHA-256
`a4da53e94e3ae89ab57aee61297626ef2f5bf2e4d90bfc8646687fc1ae840a4a`).
This is historical package-level evidence, not a passing gate or a release.

The newer post-PlainTime/direct-Intl full run completed (c4153e): 26,225 passed,
two failed and 41 skipped, plus 100 passing filesystem type contracts. Only the
same native Promise property-import expectations failed. The source fingerprint
`03b3b7f7e0461e053524257b84f84b8a6acf4357c81d70d3a9d85ab3f45258bc`
matched before/after (7b208c). Log: `/tmp/safejs-intl-gate.R8iePX/full-test.log`,
SHA-256 `e5b98177ad7ebc0205f1a7fa57b13181add7d4575587464f0136ef11ff4337e1`.
This remains a failing package gate, not completed delivery or conformance.

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

Read-only gate-time audit (320e4e) inspected the existing
`test/adversarial/test262-semantics.test.ts`: it contains seven handwritten
cases, not an upstream Test262 runner. Its additional skipped no-op still labels
proxies and weak references unsupported, despite their current experimental
bindings. That label is stale evidence, not a real pending conformance test.
After the frozen full-package run ends, replace the placeholder with meaningful
bounded regressions against the current implementation; do not count removing
the skip as adding language coverage. A separately maintained upstream corpus
runner and per-feature disposition remain needed for a systematic audit.

The skipped-test audit also distinguishes legitimate unavailable controls from
that stale placeholder. Native Instant interoperability uses four conditional
`runIf` cases; native `Math.f16round` comparisons are conditional on host support;
parser fuzzing is opt-in. Filesystem conformance skips declared reference gaps
and separately asserts fixture membership and exact gap reasons. These controls
must not be enabled by pretending missing host support exists, removed merely
to reduce skip counts, or reported as passes. This source audit classifies the
declarations; the saved full-run result must supply the actual execution counts.

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
