# Intl.NumberFormat compatibility work

## Validated gaps

Intl.NumberFormat is absent from the guest Intl namespace. The existing
number-locale.ts converts guest options but delegates final formatting and some
rounding validation to native Intl.NumberFormat.

Read-only probes on September 8, 2026 confirmed a supported-runtime difference:
Node 18.18.0 formats 1.9 as `2` with roundingMode floor and maximumFractionDigits
zero, while Node 24.14.0 produces `1`. Node 18 also lacks formatRange and
formatRangeToParts. Its resolvedOptions omits modern rounding properties.
Exposing the native constructor through guest wrappers alone would therefore
leave substantive behavior incomplete on the supported Node 18 runtime.

## Required implementation

- Reuse maintained guest option conversion, preserving getter/coercion order and
  immediate validation. Do not send guest objects or closures into host ICU.
- Cover constructor/call behavior, supportedLocalesOf, fresh resolvedOptions,
  stable bound format, formatToParts, formatRange and formatRangeToParts.
- Preserve exact decimal string input, BigInt, negative zero and special values;
  enforce standard range conversion/error ordering.
- Support current rounding modes, increments, priority, trailing zeros, grouping
  and sign display across supported runtimes, not only the development Node.
- Keep private state metered, methods branded, function identities reconstructible
  and guest descriptors/prototypes/cycles preserved through snapshots.
- First reproduce missing APIs and Node 18 rounding behavior with failing tests.
  Use independent native/current-standard controls and supported-Node probes.
- Complete broad SafeJS and downstream validation, then commit and push this
  atomic API separately while monitoring previous releases.

## Backend investigation, not a dependency decision

[FormatJS NumberFormat documentation](https://formatjs.github.io/docs/polyfills/intl-numberformat/)
describes v3 rounding, range methods and exact decimal string support. Registry
metadata currently reports version 9.4.0 with bigdecimal and intl-localematcher
dependencies. It is a candidate, not yet installed or validated here.

Before selecting it, inspect the actual source, supported Node syntax, locale
data registration and loading. The guest API is synchronous after construction;
do not introduce hidden network access or mutate the host Intl globals to load
data. Do not silently restrict supported locales to English. Determine bundle,
startup and resource-budget consequences before choosing an integration.

This preparation was read-only with respect to runtime/tests while Collator's
full suite 74446 remained active. No NumberFormat implementation is claimed.

Inspection of the published 9.4.0 source confirmed that its exported constructor
has private package localeData/availableLocales and an __addLocaleData entrypoint,
but the shipped locale-data/en.js calls global Intl.NumberFormat.__addLocaleData.
Importing that file without replacing host Intl does not populate the separately
imported constructor. A clean data-loading integration remains necessary; simply
copying the documentation's global polyfill imports is not suitable here.
The constructor also delegates plural selection to native Intl.PluralRules, so
supported-runtime rounding interactions need direct verification, not reliance
on the package's compliance claim.

## Initial TDD and isolated backend experiment

Run 33478 on the new intl-numberformat.test.ts finished with 26 failures and four
coincident error-only passes in 30 tests. Missing constructor/API behavior is now
reproduced, including exact string formatting, parts, ranges, bound function
identity, subclassing, explicit modern rounding expectations and public replay.
The four passes do not prove support. No new test exclusion was added.

Installed FormatJS 9.4.0 only in a task-created temporary directory:
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-numberformat-backend.lOottlsbb8`.
The repository package manifest and lockfile are unchanged. An isolated probe
loaded trusted package locale scripts in a temporary VM namespace, never changing
host Intl; this is an experiment, not an approved production loading design.

The same nine cases ran on Node 18.18.0 and 24.14.0. Modern floor rounding, exact
30-digit string input, half-even increments, trailing-zero removal and rounding
priority worked in the candidate on Node 18, unlike native Node 18. Locale data
version differences exist (for example Arabic's default numbering system).

Concrete candidate defects also appeared on both runtimes:

- formatRangeToParts includes an extra enumerable `result` index string on every
  part. Its published source explicitly constructs that nonstandard property.
- Collapsed German EUR suffixes and French unit suffixes retain `endRange` rather
  than `shared` source attribution. Native current engines provide the expected
  shared attribution; inspect CollapseNumberRange before adopting this backend.

Do not expose these defects through SafeJS or call the backend verified merely
because its modern rounding cases pass. Keep output projection, attribution,
locale loading, resource costs and replay reconstruction in the acceptance gate.

Collator is verified on remote main as f5f9558132f9add39276ff87b8b0704267a849c6.
Its scoped release 34215984008 and CLI release 34215984379 are active. The prior
CLI 34214636979 was cancelled after main advanced; no new CLI publication claimed.

A third backend defect is now directly reproduced: English equal-rounded ranges
format as `1~`, whereas native current ICU produces `~1`. The implementation
appends the approximation sign unconditionally. Added independent expected-value
controls for approximation placement and standard range-part fields/shared
currency attribution. Updated baseline run 13246 has 28 failures and four
coincident passes in 32 cases. The implementation must satisfy these controls,
not copy the candidate's output into expected fixtures.

## Guest API implementation in progress

Extracted the existing number-locale option conversion into readNumberFormatOptions
and reused it from a private-state NumberFormat constructor. Native ICU sees only
converted primitive arguments. Added bound format identity, ordinary methods,
range conversion order, branded receivers, Intl registration and private-state
memory measurement. This is a native-backed first implementation, not the final
supported-runtime backend and not a delivery claim.

Run 68524 passed the initial 32 NumberFormat cases plus 63 existing number-locale
cases. A stronger repeated low-level heap test then failed in run 61856 because
ordinary object serialization lost the NumberFormat brand. Added a dedicated
guest-numberformat node with resolved primitive options and the cached format
reference. Validation requires canonical complete options and the correct bound
function owner/target; restoration preserves the brand and aliases. Run 72498
then passed all 96 tests across both files.

Initial maintained build 38439 caught missing TypeScript range-method declarations.
Capturing those methods by their property descriptors avoids requiring newer
ambient Intl types. Build 53323 then passed all 23 selected workspace builds and
four fresh ESM imports. Focused lint 80836 passed. No Node minimum changed.

Built-package probes now explicitly demonstrate the remaining Node 18 gap:
all six controls fail there (floor rounding, exact decimal strings, ranges,
approximation, stripIfInteger, min2 grouping), while the same six pass on Node
24.14.0. Do not commit/push this unfinished API or describe it as supported on
Node 18. A complete backend, additional coercion/resource/snapshot adversarial
coverage, builtin-catalog updates and broad regression checks remain required.

Collator scoped workflow 34215984008 published SafeJS 0.1.449 at
2026-09-08T10:36:39.0576257Z. Its CLI workflow 34215984379 remains active.

## Portable backend and locale data work

Added pinned FormatJS 9.4.0 to the SafeJS manifest and refreshed the lockfile;
the lockfile diff contains only its four new dependency records and workspace
dependency entry. No host Intl global is replaced. Native-capable runtimes keep
the native path; older runtimes load the portable implementation through an ESM
dynamic import during module initialization, so synchronous snapshot restoration
can reconstruct formatters without an asynchronous locale-data fetch.

numberformat-data.mjs parses the dependency's locale registration scripts using
TypeScript, extracts only JSON, and emits lazy JSON.parse factories for all 766
shipped locales. The generated module is about 28 MB, with locale objects created
only on demand. Generated files live in ignored src/intl-data/dist and are copied
to the corresponding built path; they must not be committed. The generation step
is included in maintained package builds and native pretest/pretest:unit hooks.
The generated module includes the dependency's MIT notice as a retained legal
comment. Packaging size, inclusion and startup still require release-artifact QA.

Generator tests first failed with the missing module, then passed eight tests;
a ninth license-preservation test was added. Portable backend tests first failed
with the missing module, then verified modern rounding, precision and the three
range corrections. The backend strips nonstandard fields, fixes surviving
collapsed-part attribution, and prefixes the approximation sign. Additional
locale/range conformance remains necessary; those tests are not universal proof.

Directly importing all generated data through Vitest took 12.33 s. Modern-runtime
tests now avoid loading the portable module, and focused portable tests mock the
loader with the same real dependency data for their four declared locales, parsed
through the maintained generator. Assertions were not removed or weakened. The
focused run fell below one second; real built-data probes remain separate.

Two new failing tests demonstrated StringIntlMV overflow being incorrectly
expanded by the dependency. The adapter now converts string overflow, underflow
and invalid literals to the corresponding Number special values before decimal
processing, while retaining finite nonzero exact strings and BigInts. This follows
[ToIntlMathematicalValue](https://402.ecma-international.org/#sec-tointlmathematicalvalue).
Explicit binary/octal/hexadecimal, whitespace and underflow controls also pass.
A further failing test caught resolvedOptions placing roundingPriority after
trailingZeroDisplay; the adapter now preserves the standard property order.

Build 30435 passed 23 workspace builds and four fresh native imports after backend
integration. Lint 40310 passed before the final license/property-order changes.
The original six built probes now pass on Node 18.18.0, 20.0.0 and 24.14.0.
Combined run 31191 passed 120 tests in four files. No broad gate or push yet.

## Newly validated numbering-system gap

A built Node 18 probe constructed and formatted all 623 locales in the
intersection of native support and packaged locale data. Strengthening that probe
to compare floor(1.9) against native formatting of 1 yielded 622 matches and one
failure: Arabic produced Latin `1` instead of Arabic-Indic `١`.

Inspection confirms that the dependency's generic ar dataset has only latn data,
while ar-EG has arab and latn. More generally the en dataset ignores supported
non-default numbering systems. Added three failing unit controls for en with
arab, deva and mathbold; do not downgrade the expectation to Latin digits or
restrict the public API to dataset-default numbering systems. Complete this
numbering-system support before considering NumberFormat deliverable.

## Numbering-system corrections in progress

Added numberformat-numbering.ts. Missing numbering-system data is derived from
native ICU's primitive formatToParts probes: symbols and positive/negative decimal,
currency/accounting and percent patterns. Existing locale language data remains
in use, and host Intl is unchanged. Six expanded tests initially failed; the first
correction enabled Arabic/Devanagari but exposed UTF-16 grouping corruption for
supplementary mathematical digits and unlocalized scientific exponent digits.

The adapter now reads the already-rounded backend parts, rejoins split integer
digits before iterating code points, and uses native ICU to group that exact
integer. It localizes fraction/exponent digits without rerounding. Explicit always
and min2 grouping retain their modern rules even on older native ICU.

Build 8158 caught the dependency declarations omitting two resolved-options fields;
an explicit primitive option-record type fixes the declaration mismatch. Build
63432 then passed 23 workspace builds and four native import checks; lint 84627
passed. The strengthened Node 18 locale probe 77049 matched all 623 localized
floor-rounding results, including Arabic.

A separate built probe across all 78 current native numbering systems, standard
and scientific notation, found 302 matches and ten failures. Two involved bidi
marks around negative exponents; eight revealed the dependency's incorrect Lepcha
and Vai digit mappings. Added failing controls in run 38500 (six failures, 20
passes), then corrected source-digit decoding and native exponent-sign parts.
Run 69265 passed all 26 backend tests in 618 ms. Build 18027 and combined tests
97640 were started for the updated source. The full built numbering-system matrix
must be rerun on that build before claiming it passes.

CLI workflow 34215984379 finished unsuccessfully: two camera cases exceeded the
unchanged 5,000 ms timeout, with 37,171 tests passing and 38 skipped. This is not a
CLI publication. SafeJS 0.1.449 remains published. Camera performance still needs
work; do not raise its timeout or weaken/exclude its trace assertions.

Build 18027 completed successfully: 23 workspace builds and four fresh native
imports. Combined run 97640 passed 131 tests in four files; focused lint 29928
also passed. The rebuilt portable numbering-system matrix now passes all 312
cases on current Node (78 systems) and all 276 on Node 18 (69 systems), covering
standard/scientific notation and positive/negative-exponent samples. These are
bounded matrix results, not a claim of complete Intl conformance.

No local NumberFormat commit or push yet. Remaining delivery gates include
adversarial resource/snapshot checks, further range/option behavior, builtin
catalogue updates, broad SafeJS/downstream checks and actual packaged-artifact
verification (including the generated locale module and license). All local
processes from these focused runs are terminal; no full suite is currently active.

## Snapshot, resource and packaging gate

Expanded guest tests to cover derived-prototype selection order, private option
memory, output parts-array limits, exact-input step charges, BigInt output string
limits and forged options/cached format ownership. Run 41109 passed 42 tests.
The foreign-format case was strengthened to use another real cached bound
formatter, not merely a wrong heap node kind.

Run 30962 reproduced two legacy catalogue failures caused by the added Intl
constructor. Added NumberFormat explicitly to both maintained expected builtin
lists; no historical fixture/hash/graph checks changed. Run 39655 then passed 86
tests with one existing skip. Packaging unit tests 44031 passed both cases.

An initial artifact attempt 41764 after a selected workspace build failed with a
private tiny-mcp-client dependency in the root declarations. The release workflow
requires the full npm run build before packaging, so this was not taken as proof
of a new packaging-code bug. Its partial temporary output remains at
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-numberformat-package.FZL9FYnGT5`;
use a fresh output directory for the next attempt.

Full build 88336 completed 70 declared workspace builds and root type/schema
stages, then the bundle policy correctly rejected the new external FormatJS
dependency as undeclared in the root CLI manifest. Added the same pinned runtime
dependency there and refreshed the lockfile. Full maintained build 6037 is active;
do not restart it just because a polling call yields. No root build success or
packaged-artifact success is claimed yet.

## Additional exactness findings

Run 94756 reproduced loss of BigInt precision in Russian unit plural selection:
10000000000000000001n printed the correct digits but the wrong word. For standard
integral unit/currency-name output, the adapter now asks native ICU to inflect the
already-rounded exact BigInt rather than a floating approximation. Run 16542
passed all 27 backend tests. Fractional and scientific plural selection still need
their own evidence; do not infer universal correctness from this integral fix.

A separate isolated Node 18 dependency probe found another remaining gap:
maximumFractionDigits 20 works, but 21 and 100 throw RangeError because the
dependency initializes native Intl.PluralRules with those limits. Current
NumberFormat permits up to 100. Do not clamp the user's requested precision,
replace host Intl globally, raise the Node minimum, or call this API complete
without resolving that supported-runtime failure.

Full build 6037 completed successfully, including all 70 declared workspace builds,
root schema/type stages and CLI bundle publication-policy checks. A fresh artifact
preparation 80515 then succeeded for SafeFS, SafeJS and SafeBash; the SafeJS artifact
contains 297 files. Output directory:
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-numberformat-package.tjJAPYXa1Z`.
This is a local prerelease-named validation artifact, not a published package.
Installed tarball behavior still needs checking, and the Node 18 precision-limit
failure remains unresolved. No NumberFormat commit or push yet.

## Private plural engine resolves the Node 18 precision limit

Installed the earlier local tarballs into an isolated consumer at
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-numberformat-consumer.jAvAMgE5nd`.
Installation 50896 succeeded, and all six original probes passed from that
installed package on Node 18 and 24. That artifact predates the following fix.

An isolated @formatjs/intl-pluralrules 6.3.13 probe accepted 21 and 100 fractional
digits on Node 18. Added a private plural service and generated a copy of the
pinned NumberFormat engine with a lexical Intl import pointing to that service.
The host Intl object and its constructors are not replaced. Native-capable hosts
continue using their native NumberFormat path.

The generator parses the engine and verifies its plural dependency before adding
the private binding. It removes the stale source-map comment using parsed trailing
comments and preserves the dependency license. Plural locale registration scripts
are parsed; only their data/rule-function expressions become lazy factories, never
their global registration or fallback side effects. All 224 published plural
locales, including valid legacy aliases, are retained. Generated engine/data files
remain ignored build products, not files to commit.

Both package/root manifests declare the pinned plural package and the copied
engine's direct bigdecimal/localematcher dependencies. Initial generator and
private-service tests failed before implementation. Alias and actual trailing-map
checks caught two generator assumptions, which were corrected. Run 70222 passed
44 tests, then expanded run 71677 passed 151 tests in five files. Lint 57313 passed.

Build 71270 passed the 23 selected workspace builds and four native import checks.
The actual built guest API now produces exactly 21 and 100 fraction digits on
Node 18.18.0 and 24.14.0, with assertions that host Intl.PluralRules is unchanged.
The rebuilt Node 18 numbering matrix still passes all 276 cases.

A new full npm run build is active for the updated private engine. Previous full
build/artifact successes must not be reported as verification of this newer
implementation. Broad SafeJS/downstream tests and a fresh installed artifact are
still required before commit/push.

## Fresh build, installed precision checks, and fractional-plural evidence

Full build 56953 completed successfully, including root bundle output. Downstream
harness run 90105 passed all 163 tests in 13 files. Fresh artifact preparation
75174 succeeded; its SafeJS artifact contains 298 files. Tarball installation
10333 succeeded in the isolated consumer
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-numberformat-consumer.uNjvnF8Xwl`.
Installed Node 18 and Node 24 probes (84772 and 94765) both passed exact 21/100
fraction-digit output and unchanged host Intl.PluralRules identity checks.

Broad SafeJS run 56631 is active, with its source/test tree frozen. It has reported
5000ms timeouts in input-error-projection.test.ts; its terminal result is pending.
Repository lint 95307 is also active. Do not report either gate as passing.
The user's staged SafeBash patch remains unchanged (zero-context patch ID
69df99c443cea05ae0f9e88dae5d20292332d8b8).

Read-only differential probes uncovered a concrete remaining portable-backend bug:
Arabic meter formatting returns only the unit for 1.1 and 1.2, whereas native ICU
retains the fractional number. The private plural service itself selects `one`
for 1.1 rather than `other`. Dependency inspection explains this: GetOperands
includes the decimal point in its fraction substring, then PluralRuleSelect
interpolates that fractional number after another decimal point, producing
`1.0.1`. The locale rule parses that as 1. Add failing fractional/leading-zero/
trailing-zero plural regressions after the broad run terminates, and preserve
the already-formatted decimal string through rule selection instead of rebuilding
it through lossy numeric fraction operands. Do not clamp precision.

A nine-locale range comparison also found negative/currency range spacing and
collapse differences, plus Arabic ranges losing numeric endpoints. Separate
implementation-dependent ICU/CLDR presentation differences from numeric loss;
the latter is a correctness failure, not an acceptable locale-data difference.
No NumberFormat commit or push has been made.

CLI release 34215984379 is now terminal failure: two float32-camera tests exceeded
5000ms (37171 passed, 38 skipped). Scoped release 34215984008 remains successful.
Continue work without waiting for publication, but do not label the CLI released.

## Source-bundle startup evidence

A read-only esbuild/subprocess experiment used the same package-externalization
strategy as the failing integration fixture. The current source bundle is
29,432,930 bytes and three fresh imports took 2070/1904/1689ms. A diagnostic-only
virtual omission of the numeric locale module reduced it to 1,803,376 bytes and
251/256/256ms. This omission is not an implementation or test change and must not
be shipped: all 766 locales remain required. It isolates embedded data size as a
substantial startup cost even on hosts whose native NumberFormat skips the fallback.

Read-only lossless representation experiments retained every locale: deduplicated
object subtrees encode in 6,380,391 bytes; interning primitive values and property
names as well reduces the representation to 4,967,816 bytes (155,478 nodes).
Prefer testing a deterministic interned graph with lazy JSON decoding and fresh
per-locale object expansion. Preserve arrays, numeric primitives, `__proto__` data
keys, Unicode, and mutation isolation; do not silently share mutable locale data.
Prove round-trip equality for all 766 locales, measure the actual generated bundle,
and rerun the original timeout cases without changing their limits.

## Lossless compaction and corrected plural selection

Broad run 56631 completed with 20448 passed, 37 skipped, and eight failures, all
the input-error-projection 5000ms timeouts. It covered 692 files in 468.22s.
The repeated-data regression failed first (29695: 6645 bytes versus 5191), then
passed after interning graph nodes (98968: 15 generator tests). The generated
module is now 5,118,016 bytes, including its license and expansion code. Probe
49359 compared all 766 generated records against the original parsed dependency
data and every record matched exactly. Factories reconstruct independent mutable
trees, preserve array/primitive types, and retain `__proto__` as a data property.

Fractional plural tests failed for Arabic 1.1 in 12828. A generated private copy
of the plural engine now passes its already-rounded decimal string directly to
the CLDR rule, avoiding lossy operand reconstruction. The parser validates the
pinned selector/call shape and preserves licensing; node_modules is not patched.
That exposed another real error at Arabic 3.14 (12620): generated CLDR n-range
comparisons incorrectly admitted non-integers. Unicode TR35 Relations specifies
that a..b enumerates integers, not fractional values:
https://unicode.org/reports/tr35/tr35-numbers.html#Relations
The locale extractor now adds integer guards only to parsed n/modulo-n inclusive
range pairs; existing negation and boolean grouping remain intact. Tests include
Akan and French so integer-only ranges are distinguished from integer-part rules
that legitimately include fractional quantities.

Focused run 15226 passed 55 tests, including Arabic fractional unit/range output,
six-language plural comparisons, precision 21/100, generator behavior and guards.
A direct generated-engine probe matched native plural selection in all 6244
comparisons, using native-resolved locale names and default/three-fraction options.
Initial diagnostic loops using raw legacy aliases hit dependency registry lookup
errors; those are not passes and do not model the service's resolved-locale path.

Most importantly, unchanged input-error-projection tests passed all 11 cases in
22964 (27.57s total) with the original timeouts. No fixture reduction, exclusion,
timeout increase, or test-source change was used. A new full build is running for
the compact data and corrected private engine. Broad regression, current lint,
and newly prepared installed artifacts remain required before push.

## Unit-only range endpoints

Full build 70601 completed successfully. Repository lint 95307 also completed
with zero errors/warnings (10341 ESLint subjects, plus types and workflows).
Focused lint 58473 passed for the latest generator/plural changes.

Range review distinguishes implementation-defined collapse/spacing from a proven
quantity-loss defect. Two regressions failed in 31356 for Arabic meter ranges
1–5 and 5–1: the dependency treats the unit-only expression for one as a removable
affix, or replaces its singular label through whole-range plural correction.
When either endpoint has no numeric part, the adapter now preserves the two
complete independently localized endpoint expressions and the locale separator.
This does not impose ICU's particular collapsed spelling. It preserves the
quantity encoded by the unit-only singular/dual phrase.

Focused run 6049 passed 99 tests in four files after the fix. Its extra requested
number-locale.test.ts path did not exist and was not counted; the maintained
existing suite is globals/number-locale-formatting.test.ts and is being run
explicitly. Build 20767 is rebuilding this latest small range correction.
No broad test run is currently live, and no NumberFormat commit/push exists yet.

## Current build and installed artifact verification

Build 20767 passed all 70 declared workspace builds and the root bundle stages.
The explicitly selected existing number-locale-formatting suite passed all 63
tests (25813), and lint 37124 passed the latest range adapter and tests.
The rebuilt Node 18 fallback passed precision 21/100 and all 276 numbering-system
comparisons. Updated source-bundle import measurements were 774/659/568ms for
7,996,311 bytes, versus the earlier 29,432,930-byte bundle's 2070/1904/1689ms.

Fresh artifact preparation 5932 and installation 30569 passed. Current directories:
- Artifact: `/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-numberformat-package.g9DVRlFYRM`
- Consumer: `/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-numberformat-consumer.rKS0Er5yXB`

Installed-package checks passed on Node 18.18.0 and 24.14.0: exact 21/100 fraction
digits, unchanged host Intl.PluralRules identity, and dump/restore replay retaining
the formatter, cached bound format identity, and owner aliases.

The full maintained `npm test` route is active as session 43555, with no test or
workspace exclusions. Log:
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-numberformat-full.NOnuhsmTzG`.
It includes the exploratory Promise/weak-collection gap tests; do not hide their
results or equate them with a newly introduced NumberFormat regression. Source
and test files remain frozen during this run. No NumberFormat commit/push yet.
User staging still has zero-context patch ID 69df99c443cea05ae0f9e88dae5d20292332d8b8.

Full run 43555 terminated in its shared stage: 20239 passed, two skipped, one
Maestro mixed-driver ordering assertion failed. Later workspace stages, including
SafeJS, did not execute. The scheduler prepares workers independently, so either
agent may start first. The separate test correction preserves exact call
multiplicity and all per-task ordered events. Its 373 Maestro tests and lint
passed; commit 734619a933dc5f075b32bbb8e85d9dcb0cf60088 was pushed separately.

Full unexcluded `npm test` is now running as 88870, log
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-numberformat-full.CbQQaALsCs`.
NumberFormat remains local and its source/test tree is frozen during this run.

## Additional installed-package release fixtures

Installed the prepared SafeBash tarball alongside SafeJS/SafeFS in the same
isolated consumer. An npm ls diagnostic initially rejected relative file entries
created by --prefix across macOS's /var versus /private/var paths. Reinstalling
all three local tarballs from the consumer working directory corrected those
scratch-manifest paths; npm ls --depth=0 then succeeded with all three expected
0.0.0-numberformat-check versions (84579). This was not a repository/package
source change.

The maintained public TypeScript fixtures passed with the release workflow's
NodeNext/ES2022 compiler options (43575). The unchanged browser fixture bundled
with the workflow's esbuild flags and ran successfully under Node. Both unchanged
safe-packages-smoke.mjs runs passed: Node 77367 and Bun 55204, covering realm and
callback behavior, retained references, object/date/indexed/named capabilities,
console overrides, curl output, shell integration, and canonical filesystem
identity. Fixture copies and generated browser output exist only in the isolated
consumer. No test-source or runtime changes were made during full run 88870.

Full run 88870's shared stage passed all 20240 tests (two skips), followed by
29 passing Python unit tests. The virtual-bash stage is active; later workspace
results remain pending. A separate read-only built-backend matrix compared
1296 outputs against Node 24.14.0: all nine rounding modes, auto/morePrecision/
lessPrecision, fraction limits 0/2, significant limit 4, English/German, ordinary
numbers, negative zero, exact decimal strings, and BigInts. All matched.

Full run 88870 terminated in virtual-bash: 22275 passed, 86 skipped, one failed.
The failure is the committed S3 export qualification prerequisite at
tests/integration/s3-http-exports/verify.mjs:118: HEAD's package-lock.json does
not equal the live NumberFormat dependency lock. This is not evidence of a shell
runtime defect. Preserve the committed-input check; establish matching candidate
metadata before claiming this gate passes. SafeJS and terminal-pilot did not run.

The unexcluded maintained SafeJS workspace unit route is running separately as
67163, with output at /tmp/safejs-numberformat-current-unit.log. Runtime and test
sources remain unchanged during this regression run. The protected staged patch
still has ID 69df99c443cea05ae0f9e88dae5d20292332d8b8.

Workspace regression 67163 finished with exit 1: 20467 passed, 37 skipped,
six failed; 691 files passed, one skipped, two failed, 437.96 seconds. All six
failures are in the separately tracked exploratory weak-collections (four) and
promise-import-properties (two) files. No NumberFormat or timeout failures were
reported. This is explicitly not a passing full suite. Preserve those failing
assertions and their unresolved implementation/admission work.

The unchanged committed export route has no WORKTREE mode: its selected revision
must resolve to a commit and its peer metadata must match the checkout. Prepare
the atomic NumberFormat local commit before this check; do not confuse that
local qualification prerequisite with a verified push or publication.
