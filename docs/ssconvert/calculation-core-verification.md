# ssconvert calculation-core verification

This records the current dirty workspace implementation, not full Gnumeric
equivalence or release delivery. No README, push or publication is authorized.
QA procedure: [calculation-core QA](../plans/ssconvert-calculation-core-qa.md).
The initial qualification below is historical; the current follow-up at the end
records subsequent repairs and the separately rebuilt native oracle.

## Initial reference evidence (historical)

The retained official Gnumeric 1.12.61 archive under `out` was rehashed before
and after implementation. SHA-256:
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
GOffice 0.10.61 archive SHA-256:
`558597fd9ca59b93ff562750218d1e7ea8ec3c8d0ed6a5cc096aa715ef909a15`.
Only task-owned GOffice inspection extracts were created under `out`.

The retained dependency/plugin/locale profiles in
[reference-profile.json](reference-profile.json) and
[lifecycle oracle QA](../plans/ssconvert-lifecycle-oracle-qa.md) describe distinct
native builds. The latter uses C/UTC, GLib 2.84.4, GTK 3.24.49, libgsf 1.14.53,
GOffice 0.10.61 and 47 installed plugin manifests; manifest presence is not
function activation coverage. Those captures were preserved. At initial qualification Docker
`colima` had no retained oracle container and no local native ssconvert was
available: that initial qualification had zero fresh native differential passes.
The later independent rebuild and fresh native controls are recorded below.

Primary source review covered `src/func-builtin.c`, `expr.c`, `value.c`,
`func.c`, `dependent.c`, `collect.c`, `rangefunc.c`, and GOffice
`goffice/math/go-rangefunc.c` / `go-accumulator.c`. Source-derived expectations
are distinguished from native differential measurements.

## Initial exercised scope (historical)

The engine and virtual command use the same package evaluator. It operates on
typed syntax trees and owned workbook data without eval, native subprocesses,
ambient filesystem access, or implicit formula networking.

| Behavior | Verification |
| --- | --- |
| Scalar types, blanks, numeric decimal text, boolean arithmetic, exact errors, left coercion/error priority | Original memory fixtures and independent source-derived cases; percent coercion is implemented but not directly measured |
| Comparisons, concatenation, power domains, finite overflow results, zero division | Exact typed result assertions |
| Range/sheet-span references, scalar implicit intersection, array dimensions/broadcasting and reference operators | Calculation fixtures plus maintained parser/workbook suites |
| Named dependencies, cached clean/dirty/manual/forced results, dependency visits and depth refusal | Original and independently authored graph/cache fixtures |
| Normally registered builtins SUM, PRODUCT, IF, GNUMERIC_VERSION, TABLE | Source registration reviewed; original scalar/group/table fixtures |
| SUM partial expansion/order and scaled PRODUCT intermediate overflow/underflow | Exact source-derived numeric regressions; no tolerance |
| Shared/array formulas, group caches and clean import round-trip preservation | Maintained memfs round-trip test and independent array/shared cases |
| Circular current stored values, maximum iteration count, strict numeric/text tolerance and final convergence pass | Source-derived memory fixtures and injected-source call counts; broad native cycle-order equivalence unmeasured |
| Volatile cells, named volatility, cached group members and TABLE headers | Injected deterministic sources with exact call/result assertions |
| External references | Explicit injected resolver only; absent/unresolved capability returns #REF! |
| Resource/cancellation/ownership | Workbook admission, accessor refusal, bounded visits/depth/areas and injected-source cancellation |
| Command/SDK parity | Real Shell invocation, memfs byte I/O, exact output/status/diagnostic/namespace assertions |

`NUMBER_MATCH` and `DERIV` are present in `func-builtin.c` but are registered
only when `gnm_debug_flag("testsuite")` is true. That flag is absent from the
retained ordinary profile. Their debug-profile implementations remain
unsupported and are not counted as normally registered builtin passes.

## Initial reproducibility and mismatches (historical)

Time and randomness require explicit injected sources. There is no ambient
Date.now or Math.random fallback. NOW/TODAY currently support UTC serials with
1900/1904 date systems. Native clocks, random generator/seed/distribution,
timezone databases, callback state and the number/order of recalculation stages
are observable sources of nondeterminism. Tests certify only the supplied
deterministic inputs, not native stochastic equivalence.

Static graph links cover both scalar IF branches, while scalar execution visits
only the selected branch. Array IF uses the distinct precomputed-argument path:
scalar condition errors stop before branches, while valid conditions permit
eager branch evaluation and element dispatch. Each run owns indexes/caches;
sheet/cell storage order is retained. Exact native dependency-container traversal, independent volatile
draw order, multi-cell cycle convergence/termination and table event/cache
ordering remain unmeasured.

Full Gnumeric date/currency/thousands/fraction/locale numeric matching is not
implemented by the decimal/percent text matcher. Native Unicode collation order,
non-UTC clock behavior and all plugin numeric functions are not qualified.
Functions outside the implemented set report unsupported-feature rather than
claiming reference-compatible results. Ordinary exported text rendering remains
the responsibility of its explicitly bound codec/formatter; exact native
number-to-text/CSV formatting and numeric-to-text formula concatenation are
unmeasured here. Sparse TABLE input cells are invocation-local index entries;
their exact native workbook namespace/event effects and nested TABLE link
ordering remain unmeasured. No numeric tolerance is used
in these tests, and no text/CSV difference is ignored.

External resolvers are trusted synchronous host capabilities, not a JavaScript
sandbox or an asynchronous workbook loader. Formula namespaces do not authorize
host access. An uncooperative callback cannot be preempted, and cancellation
cannot reverse host effects. Resource-limit refusals are host policy, not
Gnumeric-equivalent formula results.

## Checks and delivery

The independent agent completed stress and repair passes with 47 independently
authored cases, alongside 11 original calculation tests. Final checks:

| Command | Result |
| --- | --- |
| `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache` | Passed selected build closure after final evaluator repair |
| `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache` | Passed selected build closure before final evaluator-only repair; ssconvert rebuilt afterwards |
| `npm run test --workspace=@poe-code/ssconvert` | Passed 810 tests across 54 files, fresh execution |
| `npm run lint --workspace=@poe-code/ssconvert` | Passed ESLint and runtime/test TypeScript checks |
| `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts` | Passed 28 tests against final built engine, no skips |
| `npx eslint tests/commands/ssconvert.test.ts` in safe-bash | Passed |
| `npm run typecheck` in safe-bash | Failed peer-profile guard, described below |

The maintained safe-bash typecheck was attempted and
failed its peer-profile guard: `Public SafeFS must preserve shared SafeJS runtime
identity`; root `./safe-fs` / `./safe-fs/core` exports are absent in the existing
workspace edits. This is an unresolved failed check, not a typecheck pass. Those
edits and the guard assertions were preserved.

The actual built Shell was exercised through
`npm run screenshot -- --no-header --output out/ssconvert-calculation-visual.png node out/ssconvert-calculation-visual.mjs`.
Visual inspection confirmed output `2,4,8,7,#NUM!` with exit 0, and unsupported
FUTURE diagnostic with exit 1 and unchanged destination. The temporary driver
rendered captured stderr on stdout for visual ordering only; separate channel
semantics are asserted in the command suite. Screenshot SHA-256:
`301c705c1c479b5fd8e3c577b56ac8a235bf49225595893e860adb7548d5bd4d`.
Task-owned screenshot, driver and source inspection extracts were purged after
reducing this evidence; preexisting archives and evidence were preserved.

Source binding: dirty workspace base HEAD
`b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`.
The complete `packages/ssconvert/src` inventory has 124 TypeScript files.
Canonical manifest records are UTF-8 `path + NUL + lowercase SHA256 + LF`,
sorted by UTF-8 path bytes. Manifest SHA-256:
`5f2d682db7b0c8a8642c6ded966efab90df761de177c9eb88653d11f14ce892c`.
This binds live dirty source, not an immutable Git snapshot or an append-proof
qualification. Safe-bash command source SHA-256:
`a23b63a408e964f86ef7b5caa5e4cea452d64c09899efd317518913e68473d61`;
command test SHA-256:
`ba5cacf33da546309b665bbafd226458e80d7f9ca20d038df9b36c7c0d2cf47f`.

No broad root unit/lint/release gate or native publication was run. No commits,
remote-main delivery or releases were performed for this task.

## Current dependency/numeric follow-up

The preceding checks bind the earlier candidate and remain historical evidence.
The current follow-up executes
[the additional manual procedure](../plans/ssconvert-calculation-current-qa.md).
It preserves all preexisting edits and adds no README changes, native product
dependency, commits, push or publication.

Original failing memory cases were added before each repair. The independently
authored stress suite now contains 35 deterministic cases. Repairs cover:

- Combined syntax/named-expression depth, including clean imported caches.
- Cached computed-range interiors with parenthesized, named, nested,
  intersection and conditional endpoints, including literal updates into sparse
  storage. Updates and calculation share one graph and local geometry resolver.
- Positive-zero normalization and the captured 32-bit C-int exponent domain
  for negative bases; positive bases retain their distinct domain.
- C-profile binary64 formula text notation, including uppercase scientific
  exponents, two-digit exponent padding and the native -4/17 notation boundaries.
  Numeric fixture-exporter rendering remains separate from formula string results.
- Native recursive recalculation flags: a cycle-bottom read clears the dirty
  flag, later passes read the current value, and completed child calculations
  retain their caches. Native-backed self-cycle, halving and two-cell storage-order
  cases replace earlier incorrect maximum-iteration/convergence expectations.
  TABLE restores temporary flags/current values as well as results on cancellation.
- Binary array dimensions: singleton axes broadcast, nonsingleton axes use
  the common minimum dimension. Precomputed IF arguments instead require
  matching array sizes, including singleton arrays, and stop before subsequent
  argument effects on a shape mismatch.
- Scalar left error/coercion refusal before right operand effects even inside
  array context. Array-valued operands retain element evaluation semantics.
- TABLE zero-initialized positions with absent headers, present blank headers,
  raw input coordinates on the table's own sheet without resolver authority,
  column substitution before row-header evaluation, per-row/per-column temporary
  input restoration and direct use of a computed row header for one-input tables.
- Actual Shell/SDK output byte equality for sparse computed-range updates,
  original input/namespace retention and reloaded workbook-cache replay.

The ordinary captured profile registers exactly SUM, PRODUCT,
GNUMERIC_VERSION, TABLE and IF. NUMBER_MATCH and DERIV remain debug-testsuite
variants, absent from this ordinary profile and unsupported in that variant.
This is a descriptor registration check, not plugin-function activation coverage.

Remaining limitations from the earlier record still apply. Conditional computed
constructors conservatively link possible branch interiors; Gnumeric adds the
active interior dynamically. An inactive branch's changed interior can therefore
trigger extra recalculation, with observable volatile draws. TABLE substitutions now invalidate graph dependents and affected array matrices,
including sparse inputs, while retaining unrelated cached volatile headers.
Original scalar/array header equality controls passed with injected random sources;
broader native selective dirtying/event traversal and stochastic draw ordering
remain unqualified.
Foreign own-data record prototypes are explicitly refused by the existing host
ownership policy, including resolver records; that negative control is not a
cross-realm admission pass. Cross-realm thrown host reason identity is preserved.
Workbook JSON/cache replay is measured; SafeJS VM checkpoint protocol, browser
and workerd runtime cells remain unverified. No performance benchmark or native
stochastic equivalence is inferred from runner timings or deterministic injections.

The independent native rebuild and final broad gates have completed; final
results and refreshed source binding follow. Historical/intermediate passes
remain bound to their recorded source inventories.

### Final selective-cache follow-up

Two original command/SDK regressions first failed with TABLE result 0 instead of
1. Independent scalar and array volatile-header stress cases reproduced the same
defect. The repaired evaluator invalidates substituted-input dependents, retaining
unaffected matrices and restoring temporary pending/current/dirty state. Sparse
input dependencies, cancellation rollback and authority refusals remain covered.

Fresh maintained package checks after this repair: 876 tests in 56 files passed;
package lint (including source/test TypeScript checks) passed; selected ssconvert
workspace build with `--no-cache` passed. Actual virtual command/SDK integration:
31 tests passed, exact bytes/status/diagnostics and memory namespace checks.
These are semantic checks, not performance or complete native compatibility claims.

Independent retained captures before this last repair are linked in
[fixtures](calculation-current-differential-fixtures.json),
[raw results](calculation-current-differential-results.json),
[report](calculation-current-differential-report.json),
[native profile](calculation-current-native-profile.json) and
[build events](calculation-current-build-events.json). They remain bound to the
source inventory inside that capture, rather than qualifying later source changes.
The exact source archive rebuilt without source patches using libgsf 1.14.53,
GOffice 0.10.61 and Gnumeric 1.12.61 on Debian trixie aarch64, GCC 14.2.0,
GLib 2.84.4, GTK 3.24.49 and libxml2 2.9.14, C locale/UTC. The profile captures
38 installed plugin manifests; installation does not establish function activation.

That capture measured 89/89 CLI-versus-SDK exact outputs, 79/89 direct forced
native fixture matches and ten retained raw differences. Nine cycle differences
were separately mapped to automatic import versus explicit recalculation phases:
9/9 automatic and 9/9 subsequent forced phase comparisons matched. One numeric
fixture-exporter spelling difference remains (`1E+308` versus `1e+308`), with the
same measured binary64 bits. It is not masked by a tolerance or normalization.
Formula concatenation text measured 48 exact cases (seed `0x596e1261`, 32 generated
finite normal doubles and 16 explicit cases), plus four notation regressions.
Product native XML/CSV formatting remains absent: these are injected fixture codecs.

The required safe-bash `typecheck` route failed its shared SafeFS public-runtime
identity prerequisite: expected `./packages/safe-js/dist/safe-fs.js`, received
undefined. Root public SafeFS exports/artifacts are absent in the preserved working
state. This required failure is not replaced by root type lint, and the guard was
not weakened. Native build attempts also initially failed for missing itstool and
xmllint before the successful rebuild; these harness events are retained. An SDK
harness initially expected ordinary record prototypes; corrected checks verify the
API's owned null-prototype records without changing product admission policy.

The post-repair independent [recapture](calculation-current-table-recapture.json)
binds 71 runtime modules to manifest
`5afc4e06885927fdbb100f9d6462cc94c71349cabccdf826da7c2160cb79537b`,
stable before/after capture: 89/89 current CLI/SDK bytes/status/diagnostics remain
identical to prior observations, and 48/48 seeded numeric-to-text cases remain
exact against historical native outputs. These native 89/48 comparisons reuse
explicitly historical raw native observations; they are not fresh native executions.
Four additional scalar/array TABLE equality/inequality controls passed both current
CLI/SDK and [fresh exact-native execution](calculation-current-table-native-table-controls.json),
with status 0 and empty diagnostics. The fresh profile and native raw inputs/outputs
are retained. The disposable QA container was removed and absence verified. Native
random draw counts and general event ordering remain unmeasured.

The final normal repository `npm run build` passed after selective TABLE repair.
The complete live-source/test binding is recorded in
[the canonical inventory](calculation-current-source-binding.json), source hash
`941a509aa04508fa397621006be12b52a593bbb418ca17e160036193702598b0`
(129 files); preserved integration metadata hash
`f6757164a61316fe07c4d4443d7c9fa9138dc1401f2315f993c1739c7235c46b`.
This is a dirty source binding, not an immutable committed revision.

The final ad hoc CLI screenshot was rendered with the maintained repository
`screenshot` route and visually inspected. It displayed sparse range 12, positive
zero, absent TABLE 0, numeric text `1E-07`, self-cycle 2, selective volatile TABLE
1, and unsupported-function exit 1 with the existing destination unchanged.
Screenshot SHA-256: `22034a70d699ad5383e127856698f1d5e2787ac95ed115e71b5aa004ee6c3a5f`.
The built public `poe-code/ssconvert` engine export imported successfully after
the final normal build. Raw failing-first cases and focused maintained gate
observations are reduced into [gate evidence](calculation-current-gate-evidence.json).

Final repository `npm run lint` passed after the normal build: ESLint, root type
checks and actionlint completed. Four preserved unrelated unused-variable warnings
remain; no lint errors or coverage gaps were reported. This is distinct from the
failed safe-bash shared-SafeFS typecheck prerequisite.

### Final gate disposition and cleanup

**Passed:** final frozen-candidate `npm test` exited 0 including native npm
pre/event/post scripts and lint-stress. The maintained runner derived 85
workspaces, 33 required build tasks and 53 unit tasks from declarations; it used
the default shared cache for 20 build hits, while unit tasks executed fresh
(no native unit cache hits). Final ssconvert package coverage is 876/876 tests
in 56 files; actual command/SDK coverage is 31/31. Repository build and lint
passed. The separate complete `npm test -- --no-cache` also exited 0, but ran
across live edits and is not substituted for the frozen-candidate gate.

**Failed:** required standalone safe-bash `typecheck`, exit 2, for the missing
shared SafeFS public-runtime identity described above. It remains unqualified.

**Skipped/TODO:** shared unit batches contain one skip and five TODOs; safe-bash
reports 44,079 passes, zero failures, 831 skips and two declared TODO failures
(csvformat numeric/null native serialization; XLSX named `/dev/fd` unavailable).
SafeJS reports 31,121 passes and 48 skips, with 1,467 passing and three skipped
files. The runner explicitly identifies 33 workspaces with no declared tests
and two manifestless directories; neither category is a pass. Optional missing
comparators/profiles remain unavailable. Full raw summary counts and declared
membership are retained in gate evidence. Expected subprocess timeout negative
controls are distinct from unexpected test timeouts; no unexpected timeout or
ordinary test failure occurred in either completed broad gate.

**Unsupported/unverified:** debug testsuite descriptors, full native XML/CSV
codecs, broader numeric text/locale matching, Unicode collation, non-C/non-UTC
profiles, functions outside the implemented set, browser/workerd ssconvert runtime,
SafeJS VM checkpoint/replay, broad stochastic/recalculation event ordering, wider
cycle/array-circularity and nested TABLE namespace/event behavior. Conditional
computed-range static linking may cause extra inactive-branch recalculation and
volatile draws. These remain limitations, not passes or full reference equivalence.
Workbook cache replay and explicit authority/rollback refusals are measured; host
resource refusals are product policy, not reference-compatible numeric outcomes.

**Incomplete runs:** none of the final listed build/test/lint gates remain running;
the failed standalone typecheck and unverified compatibility cells remain open.
The final complete source inventory and all 11 integration metadata records were
rechecked after gates, with no additions/deletions or hash changes. The official
archive was rehashed after implementation and remains the required SHA-256.

Task-owned `out/ssconvert-calculation-current`, `out/ssconvert-calculation-native`,
`out/ssconvert-table-followup` and the standalone TABLE first-failure log are
purged after reducing observations into the linked verification artifacts.
Preexisting source archives/evidence are preserved. The QA container was removed
and its absence verified. No README edits, local commits, pushes, remote-main
delivery, publication or releases were performed by this follow-up.
