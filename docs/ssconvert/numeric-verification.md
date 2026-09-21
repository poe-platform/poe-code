# Mathematical, engineering, complex and number theory implementation evidence

Task: `functions-math-engineering-complex`, working-tree implementation,
2026-09-19. No commit, push, publication, or README edit was performed.
Previous and unrelated workspace edits remain in place.

## Source and implementation census

The official Gnumeric 1.12.61 archive was authenticated again with SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Primary source and extracted reference dependencies are under `out`.
The separate ARM64 QA binary, actual dependencies, plugin files/hashes, C locale,
UTC timezone, and memory GSettings backend are captured in
[numeric-native-profile.json](numeric-native-profile.json). Historical profiles
are separate observations and are not substituted for this capture.

[function-coverage.json](function-coverage.json) enumerates every requested
manifest function and its eight-field source descriptor, source hash, and
implementation module. The manifest and source inventories agree exactly:

| Group | Manifest/source functions registered |
| --- | ---: |
| fn-math | 101 |
| fn-eng | 25 |
| fn-complex | 45 |
| fn-flt | 4 |
| fn-numtheory | 15 |
| Total | 190 |

The independent inventory checks exact names, signatures, flags, and groups.
All 170 fixed-signature kernels reject invalid arities before argument
evaluation. Those checks are argument-contract evidence, not numerical passes.
Static TypeScript-AST extraction finds literal formulas naming 176 functions;
per-function file references and occurrence counts are in the register. The
14 without static literal occurrences also have descriptor evidence and may
appear in dynamically constructed unit/native cases; static extraction does
not certify those cases. Unsupported and unmeasured inputs are never passes.

All product calculation logic lives in `packages/ssconvert`, with the same
engine used by the SDK and the opt-in safe-bash virtual command named exactly
`ssconvert`. Numeric algorithms include binary64 adjacency, BigInt integer/bit
arithmetic, source-order rounding, two-component matrix QR, special-function
recurrences/series/quadrature, full-domain pi reduction, guarded complex
arithmetic, and the captured profile's fused arithmetic/exponential behavior.
Native processes and mpmath are isolated QA references only. Neither is a
product dependency, fallback, or unit-test capability.

## Independent observations

The QA procedure is
[docs/plans/ssconvert-functions-math-engineering-complex-qa.md](../plans/ssconvert-functions-math-engineering-complex-qa.md).
Independent agents executed stress reviews after the initial implementations.
Each linked review preserves concrete failures, original in-memory regressions,
primary behavioral evidence, final observations, and unmeasured domains.

| Scope | Executed evidence |
| --- | --- |
| Float/radix/number theory | [Numeric review](numeric-independent-review.md): 32 initial and six error-order follow-up native observations match. |
| Scalar math | [Math review](math-independent-review.md): 134 distinct native fixtures match; independent 100-digit mathematical references remain separate. |
| Matrices | [Matrix review](matrix-independent-review.md): source-order QR/regularization repairs match all ten follow-up observations; unstable native crash/assertion cases are excluded. |
| Scientific math | [Scientific review](scientific-independent-review.md): includes cancellation, gamma reflection, native overflow, and repaired Lambert W branch-point cases. |
| Conditional math | [Conditional review](conditional-math-independent-review.md): all 27 native fields match. |
| Roman/Arabic | [Roman review](roman-independent-review.md): 20,014 small/exhaustive native fields plus isolated int32 overflow behavior measured. |
| Conversion/HEXREP/INVSUMINV | [Engineering review](engineering-extra-independent-review.md): 162 ordered constants audited and 28 native fields match. |
| Complex | [Complex review](complex-independent-review.md): all 208 distinct final native inputs match; seven earlier residuals and later power-extreme failures are retained as repair history. |
| Complex gamma/IGAMMA | [Complex scientific review](complex-scientific-independent-review.md): all 21 clean native fields match; the critical-assertion case is excluded. |
| Pi reduction/ACOTH | [Reduction review](reduce-pi-independent-review.md): all 402 final native numeric/error fields match; 126 full-path cases also match independent high precision. |
| Bessel/error functions | [Special numeric review](special-numeric-independent-review.md): latest native formula cohorts match 60/60, 140/140 and 88/88 fields exactly; captured trigonometry matches 2,866/2,866 isolated native outputs. Earlier discrepancies remain as repair history; domains outside these cohorts remain unmeasured. |
| Bessel ownership/budgets | [Ownership review](bessel-ownership-independent-review.md): 24 actual SDK conversions cover repeated deterministic results, early work-limit failure, and cancellation reason identity without serialization/output. |
| Diagnostics/OpenFormula/XLSX | [Integration review](numeric-integration-independent-review.md): ordered awaited notices, cancellation/rejection identity, queue budgets, manual mode, six validated OpenFormula defects, and all 190 native XLSX zero-argument writer fields independently examined. |

Root's additional clean native ODS export observation confirms CEIL→CEILING,
FLT.NEXTAFTER→ORG.GNUMERIC.FLT.NEXTAFTER,
ODF.SUMPRODUCT→SUMPRODUCT, SUMPRODUCT→ORG.GNUMERIC.SUMPRODUCT, and lowercase
`floor`/`ceiling` with native significance/mode arguments. All six native
exports exited zero with empty stdout/stderr. Source-backed original regressions
also cover optional/dynamic rounding modes, prefixed namespace bypass, malformed
released zero-arity writer output, and invalid-arity importer fallback.
Reference rewrites process each original lexical token once after semantic
rounding expansion, preserving original source bytes and callback effects.
XLSX numeric export prefixes derive from released unique implementation-status
facts and the three precise-function renames. Source-specific FLOOR and ERF
handlers preserve released argument rewrites; precise aliases apply only after
the `_xlfn.` reader prefix. The independent 190-field native writer cohort
matches exactly, with zero exit status and empty stdout/stderr. It does not
measure valid-argument numerical results. A later independent native XML writer
audit reproduced a casing discrepancy in all 190 numeric names. Six original
small regressions failed before scoped canonical output adopted authenticated
lowercase descriptor spelling. The independent postrepair replay matches all
190 native writer fields exactly and six source/unknown/other-grammar controls
pass. Details are in the
[native writer review](numeric-gnumeric-writer-independent-review.md).
Noncanonical source reconstruction retains the caller's original spelling;
other function groups and nonzero-argument lexical behavior are unmeasured by
the 190-field writer cohort.

Deterministic negative Bessel K warnings now travel through a bounded local
calculation queue and settle through the engine's injected diagnostic capability
before export or a later calculation failure. Direct synchronous callers can
provide the evaluator's optional fourth diagnostic callback. Async conversion
uses this callback internally and awaits notice delivery. Normal native
negative-x K cases emit one warning; native XML import plus `--recalc` emitted
two warnings because that codec/lifecycle evaluates twice. Our injected-fixture
checks measure one warning per actual calculation; they do not certify the
native XML import's evaluation count or its codec behavior.

## Maintained checks

Temporary logs are under `out`; only summarized observations belong here.

| Check | Result |
| --- | --- |
| `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache` | Passed selected maintained build closure; settled code also rebuilt fresh in the final safe-bash closure. |
| `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache` | Final uncached run passed the maintained 18-workspace dependency closure, including native postbuild stages. |
| `npm test --workspace=@poe-code/ssconvert` | Final fresh run: 99 files, 2,500 tests passed, no skips. |
| `npm run lint --workspace=@poe-code/ssconvert` | Final fresh run passed ESLint and production/test TypeScript checks. |
| Safe-bash command test file through its native Node/tsx route | Final rebuilt engine passed 33/33, no skips; numeric SDK/command bytes, exit status, warning bytes, matrix order, replay, and namespace preservation covered with memfs. |
| Scoped safe-bash command/source ESLint | Final run passed; root-wide lint is not claimed. |
| `npm test --workspace=@poe-platform/safe-bash` | Completed with exit 0: 44,914 tests, 44,081 passes, 831 skips, 2 TODOs, zero non-TODO failures/cancellations. Both failing TODO bodies remain unresolved and are not passes. |
| `npm run typecheck --workspace=@poe-platform/safe-bash` | Incomplete: prerequisite rejects current root metadata with `Public SafeFS must preserve shared SafeJS runtime identity`, expecting absent `./packages/safe-js/dist/safe-fs.js` export. No source/consumer typecheck pass is claimed. |

An exploratory maintained safe-bash `--test-name-pattern=ssconvert` run failed
an unrelated network test file's lifecycle hook while cases were excluded.
It was stopped and replaced by the full maintained safe-bash test invocation;
the excluded cases are not counted as passes. No assertions, timeouts, supported
versions, discovery inventories, or unrelated runtime files were changed to
obtain a passing selection.

The two failing TODO bodies are outside this numeric-function task: csvformat
numeric/null quoting mode reports status 78 instead of native float output,
and a requested XLSX shell `/dev/fd/3` input path is unavailable. Their existing
TODO declarations and assertions were preserved; exit zero does not certify
these behaviors or the 831 skipped cases.

Independent stored-value ingress QA found native numeric -0 is canonicalized
to +0 by `value_new_float` (`src/value.c:117`), including numeric XML admission.
The SDK instead returned -pi from ATAN2(-1,A1) and pi from IMARGUMENT(A1).
Original failing in-memory regressions preceded normalization of owned cell
values and caches, including detached sheets. Frozen records, generic numeric
metadata and caller values are preserved. A different agent passed 94 focused
ownership/calculation cases, then found the external resolver discarded its
normalized snapshot. Two further original regressions failed for scalar and
1x1 array external numeric -0; consuming admitted cell values repaired both.
The three zero regressions plus 82 external/calculation cases pass, preserving
resolver authorization, cancellation, accessor denial and row shape.
The final independent ingress review passed 96 focused tests and 13 grouped
assertions covering 2x3/3x2 external array ordering, deeply frozen outputs,
untouched caller records, oversize/ragged rejection and cancellation before
and during resolver calls.

Ad hoc screenshot capture ran the actual virtual command with an original
in-memory preview codec. The inspected output shows readable native value/error
strings across the five groups, including repaired J/I/K scientific outputs.
The final capture used the rebuilt engine. This is presentation evidence for the injected
preview, not a full real-format exporter certification or a screenshot test.

## Remaining mismatches and limits

Exact parity across the full domain is not certified. The special numeric
review retains every measured final-digit discrepancy and subsequent repairs,
with latest cohort results stated separately. Numerical tolerance success
does not make an exact pass.
`IMIGAMMA("1+i",0)` has matching `#NUM!` output but emits four native GOffice
critical-assertion messages that product execution does not reproduce.
Negative pseudoinverse thresholds have unstable native values/diagnostics;
JavaScript returns `#NUM!`. Native pseudoinverse diagonal inputs at 1e-200 and
1e200 crash/assert and produce no output; they are not passing numeric cases.
Native XML import/recalc warning multiplicity and codec-level lifecycle effects
remain outside the injected-fixture evidence.
Invalid-arity OpenFormula FLOOR/CEILING fallback names are preserved as
`ODF.FLOOR`/`ODF.CEILING`; their native placeholder execution is outside the
190 registered manifest functions and remains unsupported. Namespace/writer
regressions for those names are not calculation passes.
Canonical Gnumeric numeric names now match the measured native spellings.
Names from other function groups and the full nonzero-argument syntax/format
writers remain outside this lexical audit; no global casing equivalence is
claimed.

The review documents enumerate further unmeasured limits: high-dimensional
matrix convergence/conditioning, worst-case number-theory work, all conversions
and prefixes/locale profiles, rare argument/branch boundaries, every binary64
rounding/cancellation/subnormal combination, and complete exporter/CLI byte
formats. Available host isolation, ownership, cancellation, and work/output
budgets were preserved; passing sampled cases do not prove the full domain.
No remote-main delivery, release, or publication is claimed.

After recording the observations, owned temporary logs, fixtures, scripts and
the inspected screenshot were purged from `out`. The owned QA container was
removed after all independent agents finished. Existing primary archives and
extracted sources under `out/ssconvert-lifecycle` were preserved, along with
unrelated artifacts and workspace edits.
