# Statistical tests independent review

Reference source: Gnumeric 1.12.61, archive SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Primary source inspected only below `out/ssconvert-lifecycle/gnumeric-1.12.61`.
Native oracle runs separately in the root-owned Docker QA container; it is never
used by product code or unit tests. Root records its captured dependency, plugin,
locale and environment profile and external differential denominators.

## Procedure and ownership

A different agent from the implementing agent independently inspected and
stress-tested the initially implemented eight statistical tools, then the
remaining seven requested tools after implementation. Root retained exports,
integration, evaluator repairs, native captures and Git ownership.

1. Inspect source-specific properties, formulas, label mutation, geometry,
   retained objects and warning paths in released source.
2. Author original small fixtures through runCommand/createEngine with an injected
   custom codec and memfs. Unit tests never spawn native utilities or write files.
3. Reproduce source/oracle discrepancies in strict failing regressions before
   repair. Preserve input fixtures and distinguish formula ownership from values.
4. Rerun regression cases and focused lint; root runs maintained uncached
   workspace build/test/lint and Safe Bash integration checks.

## Validated repairs

- Pair labels use direct top-left references. GenericB t-tests and f-test remove
  a column when width is greater than or equal to height; source-specific z-test
  constructs range expressions before labels mutate its local range. Root
  independently validated and repaired z-test relocation; its independent fixture
  now specifically asserts the original untrimmed absolute range.
- Chi-squared preserves its conditional independence/homogeneity warning format
  and centered/bottom title. The original strict expected-minimum regression
  exposed a cross-formula evaluator defect. Source func.c evaluates A/r function
  arguments with PERMIT_NON_SCALAR independently of real array context. Root
  repaired that permission separation; both retained strict chi cases now pass.
- Sign-test and paired signed-rank retain source single-cell array ownership for
  two-tail results. Source's uncapped balanced sign probability above one remains.
- Mann-Whitney merges adjacent sample ranges, otherwise uses ARRAY(x,y), rather
  than a SET expression. Both original source-derived regressions pass.
- Kaplan median header and array value occupy the source columns on the same row;
  logrank starts at the source row and its statistic retains array ownership.
  One accessible group remains df=0; grouping is unavailable through run_tool_test.
- Kaplan relocates relative input axes separately for every generated expression,
  including distinct risk/death/censor output columns. Absolute fixtures remain
  absolute. Root preserves input relativity in argument parsing.
- Kaplan survival and standard-error formats are 0.00% and 0.0000.
- Kaplan chart=true creates the established retained Gnumeric Objects tree:
  step-start XY probability series, no normal marker, optional triangle-down
  censor ticks with hidden line, source sheet/data expressions and source anchor.
  Captured default graph styles and dimensions are included. Chart creation no
  longer rejects supported source configuration.
- Advanced-filter permits numeric field references outside database width,
  preserves absent-cell condition bypass, and skips genuinely absent cells during
  source unique-row comparison. Each repair had a failing original regression.
- Date fill retains the captured default-date format [$-f8f2]m/d/yy rather than
  omitting its locale token; original strict failing regression now passes.

## Measured coverage

The final independent file contains 27 authored cases. Its imported maintained
moments helper registers another 21 existing cases; those are not new independent
coverage. The focused two-file run passed 86 cases (48 independent-file total plus
38 implementing-agent-file total) with --maxWorkers=1. No timeout changes or
suppressed failures were used.

Additional original fixtures check paired numeric-pair filtering and distinct
sample counts; one-mean row grouping, labels and hypothesis/alpha links; signed
rank tied absolute ranks, median exclusion and small-sample #N/A; advanced-filter
OR rows, AND columns, prefix criteria, uniqueness and stable ordering; growth,
setter-state overrides, original-start month clipping and weekday weekend gaps;
Kaplan zero start, excluded negative times, inherited labels ignored, inclusive
censor intervals and unchanged survival at censor-only times.

Root supplied measured native captures at:

- out/ssconvert-tests-utilities/native-captures.json
- out/ssconvert-tests-utilities/kaplan-chart.xml
- out/ssconvert-tests-utilities/fill-date.xml

Those temporary outputs are evidence for root's final capture report and cleanup,
not canonical test inputs. Maintained tests use original fixtures and literal
source-derived expectations.

## Remaining limits and mismatches

This review is scoped stress coverage, not exhaustive all-input parity. Root's
final native differential report remains authoritative for measured denominators.

- Mann-Whitney native process shutdown may emit Leaking string diagnostics. These
  process-lifecycle artifacts are reported as diagnostic mismatches; product code
  does not fabricate memory leaks or suppress observed diagnostics.
- Root repaired retained normal-approximation and alpha comments after strict
  failing regressions. Independent follow-up verified exact native attributes and
  texts for single/paired signed-rank, Mann-Whitney and chi-squared comments.
  Four separately captured native alpha ties (0.125, 0.375, 0.625, 0.875) confirm
  C ties-to-even formatting. Fourteen actual-command in-memory cases cover these
  alpha values and all warning comments with formulas enabled and materialized;
  Gnumeric byte serialization/readback preserves text, bounds and array ownership.
  This resolves the previously recorded comment metadata mismatch. These 14
  ad hoc review cases are distinct from canonical test counts.
- Graph default dimensions/styles are bound to the captured default profile.
  Custom font metrics, sheet geometry, graph themes, alternate locale defaults and
  drawing exports were not exhaustively measured. Retention and data links do not
  establish pixel parity across those profiles.
- Blank criteria headers reach source uninitialized field-index behavior; their
  undefined native paths are not claimed passes. Extreme invalid date serials,
  zero-step non-day dates and source integer-overflow/undefined cases remain
  unsupported or unmeasured as root records.
- GUI Kaplan grouping cannot be supplied by run_tool_test. GUI-only consolidate,
  random-generator and random-generator-cor remain explicitly unavailable.

Unsupported, unavailable and unmeasured cases are never counted as passes.
