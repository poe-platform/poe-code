# Released statistics accuracy inventory and independent review

Reference: Gnumeric 1.12.61, archive SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
The companion `statistics-upstream-accuracy.json` inventories 212 released
plugin descriptors, upstream test labels, workbook assertion drivers, grouped
formula-case counts and the random-generator suites. An exhaustive hashed
87,481-formula inventory remains under `out`; primary-source fixtures and
formula text are not copied into product files or documentation. An upstream
`EXHAUSTIVE` label is a claim about Gnumeric; it is not a product pass.
Every inventoried workbook case is currently **unmeasured against the product**.

The eight available workbook inventories contain every exported formula cell,
including downstream assertion/helper cells. Native conversion into XLSX was
used only to capture cached binary64 values and formula text. XLSX names can
include `_xlfn` prefixes and standardized aliases; these are normalized for the
scope index, while original formulas remain in the hashed `out` evidence. XLSX export is not
itself an execution of the Perl driver's assertion and cannot establish product
parity. The primary archive lacks `samples/burkardt.gnumeric`,
`samples/gsl.gnumeric` and `samples/erlang.gnumeric` referenced by three drivers.
These unavailable cases are explicitly recorded and are not passes.

The random driver has 23 active families and ten disabled `#if 0` families.
Its default sample size is 20,000, or 200,000 for selected families; `--fast`
reduces those sizes by ten. Its Perl wrapper ignores statistical failures unless
`USER` is `welinder` or `aguelzow`. This exception must not be inherited as a
product success criterion. Seed reproducibility and distribution quality are
separate checks, and neither has been measured by this inventory.

`src/gnm-random.c` uses MT19937 when `GNUMERIC_PRNG_SEED` is present, initialized
with one unsigned byte of the seed string per initialization word. Without that
variable, Unix uses `/dev/urandom` with an MT fallback. Normal sampling uses a
polar transform and caches a second normal draw, so interleaving and cell
recalculation affect stream consumption. An injected uniform source establishes
unit reproducibility but does not establish released seed-stream parity.

The helper-source records include hashes for `src/mathfunc.c`,
`src/gnm-random.c`, `plugins/fn-r/extra.c`, time-series and queueing sources.
Gnumeric's probability algorithms include separate lower/upper/log paths,
scaled/continued-fraction gamma calculations, asymptotic branches and
specialized discrete tails. Correct central outputs do not establish fidelity
of these helpers. In particular, log probabilities can stay finite after an
ordinary probability underflows, inverse log probabilities must not first be
exponentiated, and cancellation can make a mathematically positive skew tail
zero in the released implementation. Binary64 precision/range limits and
function-specific source error conversion require separate boundary checks.

Independent holdout QA used original in-memory formulas through the shared
product evaluator and a separate native process configured with
`LC_ALL=C`, `TZ=UTC`, `GSETTINGS_BACKEND=memory`, and the captured oracle prefix.
Native values were read from XLSX cached `<v>` values, retaining roundtrip
digits, instead of formatted CSV. Temporary artifacts stayed in `out`.

| Formula | Product at review | Native 1.12.61 | Finding |
| --- | --- | --- | --- |
| `R.PSNORM(-10,1,0,1,TRUE,FALSE)` | `5.877471754111438e-39` | `0` | Observed parity mismatch; native also loses a mathematically positive tail. |
| `R.PSNORM(-10,1,0,1,TRUE,TRUE)` | `-88.02969193111305` | `#NUM!` | Observed parity/domain-error mismatch. |
| `R.PST(-20,10,3,TRUE,FALSE)` | `9.004027991948993e-16` | `9.1723503792273675e-16` | Observed relative discrepancy of about 1.8%. |
| `R.PNORM(40,0,1,FALSE,TRUE)` | `-804.6084420137538` | `-804.6084420137538` | This individual binary64 result agrees. |
| `R.QNORM(-1000,0,1,TRUE,TRUE)` | `-44.61574773196663` | `-44.615747731966614` | Observed two-ULP discrepancy; tolerance agreement is not exact parity. |

For skew-normal shape one, the mathematical CDF is `Phi(x)^2`. At `x=-10`
it is approximately `5.8e-47`, so both the released zero and the reviewed
product result differ from mathematical truth. A parity repair must follow the
released behavior, while documenting that accuracy limitation. No independent
high-precision computation was executed here; this identity is analytic
validation, not a claimed high-precision numerical certification.

The three skew-tail defects and the inverse-normal discrepancy were reported
to the root owner for TDD repair by the separate runtime stress agent. The
results above describe the reviewed state and require rerun after repair.
No complete numerical accuracy, seed, upstream-workbook, or distribution-quality
parity claim is made. QA procedure: `docs/plans/ssconvert-functions-statistics-random-timeseries-qa.md`.
