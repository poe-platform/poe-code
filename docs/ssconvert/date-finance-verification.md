# Dates, finance, derivatives and calendars verification

127 released Gnumeric 1.12.61 descriptor entries are registered in the shared
TypeScript evaluator: date 27, financial 57, derivatives 29, Christian calendar 5,
and Hebrew calendar 9. Both SDK calculation and the safe-bash virtual `ssconvert`
use the same engine, injected byte I/O, cancellation and invocation budgets.
Native ssconvert is only a separately built QA oracle; no product native
executable, fallback, implicit filesystem access or ambient clock was added.

This is implementation coverage with measured parity limits, **not complete exact
Gnumeric compatibility**. See `function-coverage.json` for each descriptor's
signature, arity, flags, import/export names, source identity, direct source errors
and native observations. Direct error inventories do not exhaust shared helper
paths or every admissible input. Unsupported/unmeasured cases are not passes.

## Primary evidence

The primary archive SHA-256 is
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Primary source was acquired/extracted only under out. Authenticated plugin member
hashes, native binary/plugin/dependency hashes, dependency versions, compiler,
locale/timezone and invocation environment are retained in
`date-finance-native-profile.json`; the existing `reference-profile.json` is
preserved. The fresh oracle uses Gnumeric 1.12.61 with GOFFICE 0.10.61 on Debian
trixie ARM64, C locale and UTC. Oracle configure disables introspection, component
and Python integration. Source-derived GPL notices are retained; package license
metadata and included license text identify GPL-2.0-or-later.

`date-finance-differential.json` retains formulas, reference values, product
values, date systems and exact/tolerance classifications. There are 410 function
cases across both date systems, covering 125 of the 127 names: **354 exact matches,
56 exact numeric mismatches, zero differences outside the declared tolerance**.
The numeric tolerance is `abs(actual-native) <= 1e-12 * max(1,abs(native))`.
Those 56 differences remain mismatches; tolerance does not establish exact parity.
Four additional bare-name parser controls are excluded from function totals.
Every exact mismatch is listed individually in that evidence file. NOW and TODAY
have injected-clock/timezone unit coverage but no deterministic native measurement.

## Fail-first implementation and independent repairs

Original small in-memory cases failed before implementation (25 initial failures,
22 derivative failures, 9 coupon failures and 7 expression/date-system failures).
Unit tests do not launch native utilities, write fixtures to disk or query LLMs.
File-change integration fixtures use injected VFS/memfs capabilities.

Three different agents independently stressed the implemented groups: 36 date and
calendar regressions, 90 financial regressions and 43 derivative regressions
(the latter run together with 22 original derivative cases). Native findings were
reproduced by failing unit regressions before repairs: financial boolean collection
errors, multi-coupon zero-yield PRICE failure, zero-step time-switch failure,
HDATE_MONTH's zero-based result, released C integer division in bivariate correction,
and a multiple-root IRR result affected by captured ARM64 `fmadd` instructions.
Compiler contraction evidence is retained in the fresh profile; IRR uses the
existing correctly rounded fused multiply-add helper for those accumulations.
Independent budget and cancellation checks remain in place.

## Conversion and visual checks

Expression roundtrips exercise Gnumeric, Excel and OpenFormula namespaces,
ODF.TIME/TIME, G_DURATION/PDURATION and Easter's argument-dependent export name.
Both date systems retain numeric serial values and workbook metadata. Virtual
command/SDK/replay checks exercise injected byte codecs and original fixtures.

**Real .gnumeric/.xlsx/.ods product roundtrips remain unverified.** Existing format
providers declare formats but require injected byte readers/writers; the package
has no built-in XML/ZIP/BIFF codecs. Grammar and injected-fixture checks do not
prove actual file conversion. Native-generated Gnumeric fixtures are oracle input,
not evidence that the product parses those bytes. The requested real-format
conversion criterion remains outstanding.

Ad hoc screenshot QA exercised the virtual command with date, clock, finance,
Hebrew and option expressions under the 1904 system. Numeric output was readable.
The screenshot renderer lacked Hebrew glyphs; independent tests verify exact UTF-8
Hebrew text. A font rendering pass remains outstanding; no unrelated font change
was made.

## Remaining domains

- 56 captured exact numeric differences, including financial and option kernels;
  every formula/value pair is retained in the differential evidence.
- Broader compensated `pow1p`, JS/native libm ULP parity, ill-conditioned/multiple
  roots, and complex odd-coupon end-of-month inputs remain unmeasured.
- Non-C locale parsing, libc DST fold/gap behavior, Hebrew far-future signed-32-bit
  overflow, and out-of-range C integer casts in time-switch bounds are unmeasured.
- Invalid-input native GLib assertion diagnostics are not proven identical.
- Volatile native clock/subsecond behavior and real-format byte codecs are not
  covered by deterministic native parity measurements.
- Finite enormous time-switch loops are tested against product work budgets. One
  oracle sweep containing that expensive budget-stress fixture was interrupted;
  the interrupted run is not a pass. Completed final sweeps omit that fixture.

The execution procedure is
`docs/plans/ssconvert-functions-date-finance-calendars-qa.md`. Maintained commands,
exit results and current source identities are retained in `date-finance-gates.json`
and `date-finance-candidate.json`. No commit, push or publication was performed;
README files were not edited.
