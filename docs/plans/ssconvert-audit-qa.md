# ssconvert source-register qualification

This is a manual QA procedure for `docs/ssconvert/coverage.json`, against the
SHA-256-pinned Gnumeric 1.12.61 archive. It does not authorize product changes,
source/asset reuse, native product dependencies, commits, pushes or releases.
The implementation target remains TypeScript ESM in `packages/ssconvert`, named
exactly `ssconvert`, exposed through the virtual command in `packages/safe-bash`.

Acquire primary sources and task-owned captures only in `out`. Verify archive
hashes before extracting. Read root/scoped instructions before any later code
work. Use the existing captured reference profile as the primary baseline;
record alternate build/dependency/plugin/locale profiles separately. Native
ssconvert and native inventory helpers are QA oracles only. Never load native
plugins or invoke the oracle from product execution or unit tests.

Every register entry must retain its task, primary source locator and independent
case or unresolved blocker. A specified case is not an executed case. A source
parser entry is not a supported record; an extension is not a whole format;
status zero is not evidence of a nonempty or correct output. Keep source,
activation, eligibility, observed behavior and implemented parity distinct.

## qa-cli-contract

Use an original two-row numeric CSV (`1,2` and `3,4`) and explicit locale `C`,
timezone `UTC`, memory GSettings and empty task-owned configuration roots.
Compare status, exact stdout/stderr bytes and VFS/output effects separately.

1. Check no operands, help/version/listing actions, unknown options before/after
   help and option-group collisions against the captured primary profile.
2. Exercise repeated `--export-options` in both orders, repeated `--set` and the
   `--` terminator. Preserve scalar replacement versus ordered array behavior.
3. Force configurable text and supply `formulas=true`, then `formulas=false`.
   Both must fail with status 1, empty stdout, and the captured invalid-option
   diagnostic. Force CSV with `formulas=true` and check its saver-specific ID.
   Use `format=raw` as the accepted control. Update A1 to `=SUM(1,2)` and confirm
   raw export contains its value rather than formula source.
4. Check merge/per-sheet conflict ordering, sheet/save-scope capability errors,
   inference versus forced IDs, percent templates, fd/file/URI behavior and
   clipboard paths independently. Do not introduce invented aliases/options.
5. Record inherited GTK/library directory/module behavior as profile-dependent
   observations. Host transport/modules require explicit future capabilities.

Audit captures for the text controls are embedded in `coverage.json#auditOracle`;
its separate binary/build identity must not replace the older primary profile.

## qa-codec-record

For each format service, version and explicit record/XML node in the register:

1. Read its primary format definition and the pinned source handler, attributes,
   writer and default/error branch. Resolve macros and nested dispatch before
   classifying a record as handled, rejected, ignored or partly preserved.
2. Author an original minimal fixture with the record under review and sentinel
   neighboring cells/metadata. Add unknown, missing, duplicate, truncated and
   size-boundary variants. Keep every upstream loss warning visible.
3. Compare import, export and round trip separately. Inspect typed cell values,
   formula/cache presence, names/date system, styles/rich text, dimensions,
   sheet order/visibility, objects/charts/comments/links, print/solver settings,
   relationships and unsupported-record handling. Inspect actual output bytes.
4. Exercise each version/edition independently. Check BIFF7 versus BIFF8 limits,
   double-stream output, OOXML editions/conformance, XLSB with a valid primary
   specimen, XML namespace versus application version, and ODF dependency
   version versus extended/strict saver mode.
5. For CSV, compare RFC 4180 grammar cases with native behavior without assuming
   identical guessing/defaults. Exercise separated/fixed-width parsing,
   quote/EOL/separator ambiguity, trailing empties, Unicode and encodings.
6. Treat empty Paradox output and unqualified fixtures as failures/blockers.
   Resolve missing legacy primary specifications and optional reference builds
   explicitly, without narrowing requested compatibility.

Record current format-header observations as header observations only. They do
not qualify styles, formulas, objects, interoperability or rendering.

## qa-function-contract

For every manifest entry, C descriptor, builtin and dynamic script entry:

1. Resolve registration and aliases in the exact activated profile; include
   descriptor-only `logmdeterm`, internal TABLE and debug-only NUMBER_MATCH/DERIV.
2. Independently specify arity, optional/default arguments, direct/reference
   coercion, blank/string/boolean/error propagation, lazy branches, arrays,
   intersection/reference semantics, domain endpoints and numeric accuracy.
3. Use original analytic cases, including empty PRODUCT, mixed-reference SUM,
   IF with an unused error branch, missing versus explicitly blank IF arguments,
   date-system boundaries and statistical tails. Compute expected values from
   independent mathematics or primary specifications rather than the function
   being tested. Numerical accuracy needs a justified per-family criterion.
4. Keep random/clock/locale/date-system inputs explicit. Do not count manifest
   presence or upstream implementation/test-status flags as verified accuracy.
5. Once product code is authorized, create failing original regressions before
   implementing it. Unit file changes use memfs; capabilities are mocked; no
   native subprocesses or LLM queries in unit tests.

## qa-analysis-property

For each of the 31 accepted tool names, compare the native writable-property
inventory to its source class and ancestors. Verify default/range/enum name/nick
and ownership, including inherited labels/group-by or labels/alpha. Distinguish
GParamSpec declared defaults from actual initialized state and setter effects.

1. Exercise omitted/default, valid, lower/upper/out-of-range and malformed values
   for every property, plus hyphen/underscore spelling and repeated keys.
2. Test `sheet`, direct/generic `data`, generic-B `x`/`y` and `formulas` independently.
   Analysis boolean parsing is case-sensitive yes/y/true/1; exporter booleans
   follow the separate GOffice property parser.
3. Check colonless arguments, first-colon splitting, replacement order, enum
   nick/numeric conversion and unused arguments against actual source/runtime.
4. Inspect generated labels, ranges, formulas versus constants, number formats,
   charts and independent statistical results, not only command status.
5. Retain consolidate/random-generator/random-generator-cor source tools as
   separate protocol gaps; do not invent accepted `--tool-test` names for them.

The audit introspection qualifies property declarations/defaults/nicks only;
it does not execute all setter/analysis/accuracy cases.

## qa-numerical-oracle

Use independently constructed goal-seek, LP/MIP and nonlinear models with known
solutions and explicit bounds. Check objective/constraint feasibility,
termination, infeasible/unbounded cases, integer tolerance, sensitivity/report
outputs, algorithm fallback and diagnostic/status distinctions. Preserve future
budgets, cancellation, isolation, realm ownership and replay invariants. Native
GLPK/LPSolve subprocesses remain separate oracle capabilities. Resolve missing
upstream NIST/solver workbooks with pinned primary provenance or original models;
a solver availability flag is not a solution-accuracy pass.

## qa-render-print

Use original styled workbooks with text/fonts, images/graphs/objects, comments,
merges, hidden rows/columns, margins, paper orientation, repeat titles, scaling,
page breaks and multipage layouts. Inspect screenshots/rendered output using
pinned fonts and paper dimensions. Check clipping/placement/text/colors and
pagination. Exercise PDF sheet/object/paper/fit combinations and graph/image
formats independently. A listed renderer and a PDF header do not prove a usable
renderer or correct pages. Justify each nondeterministic field separately; never
normalize away content, warnings, layout or namespace changes.

## qa-extension-profile

Capture installed/activated/functional services separately. Include build-disabled
Psiconv, Python/GnomeGlossary/GDA/GnomeDB profiles, activated Perl examples,
interactive-only configurable text import and arbitrary third-party extensions
as distinct categories. Preserve activation diagnostics and failed builds.
Third-party scope is an explicit capability/interface gate, not a finite source
census. No ambient host plugin discovery, credentials or native fallback.

## qa-upstream-family

For every `upstreamTests` entry, read its driver and shared `GnumericTest.pm`
helpers; resolve all subtests, options, fixtures, generators and independent
assertions. Check the separate `src/sstest.c` selectors and internal numerical
families. Track native introspection/C/GTK/Valgrind/source-policy/other utility
checks with explicit applicability decisions rather than silently omitting them.

Inspect default subtest exclusions, filters, tolerances, ignored failures and
Valgrind-only checker substitutions. In particular, upstream round-trip
`ignore_failure` can still print Pass after a failed diff. Preserve this as an
upstream qualification limitation; never copy it into product tests or mark it
a pass. Map each variant to an original regression, executed independent QA case
or named unresolved blocker. Archive census completion is not test execution.

## qa-upstream-sample

For every distributed sample/template, additional workbook specimen, referenced
fixture and dynamic expression, inspect contents and rights. Check distribution
versus full-corpus declarations and generated function-help samples. Resolve
absent references separately; do not invent SHA-256 identities for missing files.
Author original small cases for the sample's behavioral purpose. Do not copy
licensed assets/schema/code into unit fixtures without a licensing/notice
decision. Retain primary provenance, unknowns, diagnostic losses and the exact
case/disposition per file. After reducing findings, remove only owned scratch
captures and the owned QA container.
