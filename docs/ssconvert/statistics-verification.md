# Statistics implementation verification

The TypeScript ESM `ssconvert` engine implements and registers all 212 released
descriptors in `fn-stat` (111), `fn-r` (59), `fn-random` (34), `fn-tsa` (4) and
`fn-erlang` (4). The shared workbook evaluator supplies the SDK and Safe Bash
virtual command; probability helpers are product algorithms, not oracle mocks.
`function-coverage.json` records names, descriptor signatures, aliases,
source handler/error sites and measured results. Registration is not a claim of
exact released numerical parity.

The reference is Gnumeric 1.12.61, archive SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Primary sources, native compilation, fixtures and temporary output stay in
`out`. `statistics-native-profile.json` captures dependencies, plugins, locale
and architecture. The native process is a separate QA oracle and is never a
product dependency or fallback. Compiler identification does not authenticate
every upstream compiler flag.

Before implementation, 33 original shared-engine regressions failed. Further
domain, alias, aggregate-budget, random, regression and tail defects were
reproduced before repairs. Tests use small in-memory workbooks and injected
capabilities; unit execution does not spawn native tools, write files or query
LLMs. The independent reviewer used a different agent, with root retaining
export, integration and Git ownership. Its procedure and repairs are recorded
in `../plans/ssconvert-statistics-independent-review-qa.md`.

Final candidate hashes and gate commands/results are recorded in
`statistics-candidate.json` and `statistics-gates.json`. Their identities cover
the dirty-worktree candidate, not a commit or release. No push or publication
was performed. Existing unrelated edits and README files were preserved.

Original deterministic comparisons retain raw binary64 values in
`statistics-differential-results.json`, `statistics-boundaries-results.json`
and `statistics-tails-results.json`. Exact equality and relative tolerance
agreement are counted separately. The recorded numeric tolerance is
`max(Number.MIN_VALUE, abs(reference) * 1e-10)`; matching types/errors must
also agree. Every outside-tolerance case is retained in those files and in the
per-function coverage inventory. Two regression residuals remain: native
`INTERCEPT(A1:A10,A1:A10)` is `-1.870947913170458e-31` and native `STEYX`
is `2.091783358105259e-31`, whereas the product returns zero. A plausible
serialized value does not establish exact numerical agreement.

`statistics-holdout-results.json` reruns the five independent numerical
observations in `statistics-accuracy-review.md`; that review intentionally
preserves its historical observations. Source-specific cancellation and domain
quirks are retained, including skew tails that the native implementation loses.
Parity with such a result is not mathematical accuracy certification.

`statistics-random-qa.json` separates same-seed replay from distribution quality.
The native seed string and injected product LCG seed each replay independently;
they do not select identical streams. All 33 original variate sample controls
(1,000 samples per function) fall within the recorded conservative two-sample
empirical-CDF bound. This is finite-sample quality evidence, not proof of
algorithm equality, MT19937 seed parity or passage of the upstream random
suites. The 34th descriptor is the simulation-table context function.

`statistics-upstream-accuracy.json` accounts for all released accuracy labels,
11 workbook drivers, 33 worksheet groups containing 87,481 formulas, and 33
random suites (23 active, ten disabled). Those upstream formulas and suites
remain unmeasured against the product. Three archive-referenced workbooks
(`burkardt`, `gsl`, `erlang`) are unavailable. Disabled, missing, unsupported
and unmeasured cases are not passes. The exhaustive source-derived formula
inventory is retained under `out` with its hash in the accuracy receipt.

Two original mixed extreme batches using values around `1e308` failed to settle
in the separate native oracle: one was stopped, the other exceeded the 45-second
QA bound. The individual blocking formula was not isolated, so no particular
family is blamed. The successful moderate-boundary cohort uses `1e6` probes;
it does not certify those stalled extreme cases. Extreme queueing asymptotics,
all solver/rank-deficient regression paths, every interpolation layout and
every numerical helper region remain unmeasured beyond the recorded cases.

Filtered-row metadata is absent from the current workbook contract, so filtered
subtotal exclusion cannot be represented or verified. Simulation-tool contexts
and real-format byte roundtrips are unverified; the existing codecs require
injected readers/writers. The CLI screenshot exercises the actual virtual
command with an injected original fixture and records values, diagnostics,
exit status and VFS effects; it does not establish real-codec parity.

| Final comparison | Cases | Exact | Within tolerance | Outside tolerance |
| --- | ---: | ---: | ---: | ---: |
| Deterministic representatives | 178 | 100 | 176 | 2 |
| Original boundary probes | 674 | 623 | 674 | 0 |
| Lower/upper/log tail probes | 480 | 411 | 480 | 0 |
| Independent numerical holdout | 5 | 5 | 5 | 0 |

The final maintained package suite passes 3,199 tests in 118 files; package
lint passes. The uncached Safe Bash build closure completes all 18 selected
workspace builds, including ssconvert. All 38 focused SDK/virtual-command tests
pass with no skips. The independent review reports 122 focused passes, scoped
ESLint and both TypeScript checks passing. Its extreme Tukey inverse unit still
takes approximately 2.7 seconds: a concurrent earlier invocation exceeded the
unchanged five-second timeout at 5.922 seconds under CPU contention. That failed
measurement remains in the review procedure as a performance limitation;
sequential independent and final maintained package checks pass. No timeout
or assertion was relaxed.

The comprehensive Safe Bash typecheck is blocked before consumer execution:
the public `./safe-fs` export is absent, whereas the maintained prerequisite
expects `./packages/safe-js/dist/safe-fs.js`. It exits 2 with zero consumer
groups and zero runtime executions. Focused command tests and successful
workspace builds do not turn that blocked gate into a pass. No unrelated export
repair was made as part of this statistics feature.

Exact whole-domain Gnumeric parity is not established. The linked receipts
state the measured scope and every known mismatch; remaining domains require
additional differential and numerical verification.

Current follow-up: [independent stress verification](statistics-current-stress-verification.json) records the duplicate-knot whole-function error repair, 3,214 package passes, 38 command passes, successful uncached engine/Safe Bash builds, repository lint and full build. The uncached broad test gate failed on an unchanged Safe Python exhaustive codec case exceeding its five-second timeout; the isolated case passed, but later declared tasks were not reached. Safe Bash public-consumer typechecking remains blocked. This follow-up preserves the numerical residuals and unmeasured upstream accuracy domains above.
