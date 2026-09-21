# Workbook merge verification

The shared TypeScript ESM `ssconvert` engine implements merge-to for two or more
inputs; the safe-bash virtual command uses that engine. No native executable is
a product dependency or fallback. No README edits, commits, pushes or publication
were made; unrelated dirty/untracked work was preserved.

Gnumeric 1.12.61 primary archive SHA-256 was authenticated against
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Primary source was acquired/extracted only under `out`. The separate Linux
native oracle was captured with GLib 2.84.4, GOffice 0.10.61, libgsf 1.14.53,
libxml2 2.9.14, C/UTC and installed memory settings schemas. Binary/source hashes,
linked libraries, installed plugins and active importer/exporter listings are in
[the reference profile](merge-workbooks-reference-profile.json).

Thirteen native differential cohorts verify normal merge, sorted workbook-name
abort, negative sheet/active-sheet exporter options before imports, explicit
split rejection, graph-free implied split without a renderer, empty suffix,
forced importer/encoding with ignored `--set`, retained chart dataset repair,
C Unicode diagnostics, compatibility-normalized conflict ordering, case-distinct
global names/evaluation, and workbook/sheet-scoped expression migration. Exact
statuses/stderr and publication effects were compared. Normal/empty/chart cases
also compared decoded sheet order, dimensions, cells and formulas; chart dataset
expressions matched native output. Raw Gnumeric archive bytes were not compared.

Concrete regressions failed before code repairs. Sixteen independent stress
tests exercised naming counters, stable IDs, scopes, 3D/shared formulas, immutable
object ownership, cancellation identity, work/storage budgets, graph aliases and
disposition, exact-case direct/INDIRECT resolution, selective dependency revival,
and JSON replay. The native counter-zero rule corrected an initially mistaken
empty-suffix expectation. Native name identity is case-sensitive; collation
normalization only orders conflict diagnostics and does not merge name identities.

Final uncached maintained ssconvert tests passed: **5,281 tests / 232 files**.
Selected maintained build closures for safe-bash and final ssconvert passed.
Ssconvert lint and production/test TypeScript checks passed. All **82** scoped
safe-bash ssconvert tests and **120** integration-input runner tests passed with
zero skips. The edited integration test passed scoped ESLint. Virtual-command
checks verified repeated-input collisions, exact stdout replay, restored export,
graph-free output effects and untouched destination on option failure. The
maintained screenshot tool captured and visually verified merge, negative-option
and graph-free CLI responses. Owned scratch was purged after evidence reduction.

The broader maintained safe-bash typecheck **failed before compiler/consumer
phases** at `Public SafeFS must preserve shared SafeJS runtime identity`: actual
root export binding `undefined`, expected `./packages/safe-js/dist/safe-fs.js`.
The existing root manifest edits and this assertion were preserved. This is not
a successful typecheck, repository gate or release qualification.

Remaining unsupported or unmeasured cases are not passes: incoming detached
sheets; graph rendering without injected capability; unknown/malformed or other
graph dialects; valid external links across input workbooks; arbitrary object
expression callbacks and all chart types; native maximum-dimension execution;
other locales/Unicode-version edges; equal-collation conflict ties; broad native
metadata/serialization and full host-isolation/replay gates. The measured
case-distinct fixture also has different serialized global-name order: native
`clash, Clash`, implementation input order `Clash, clash`; name/value semantics
match. Maximum dimensions and size suggestion have source/unit coverage only.

The [verification record](merge-workbooks-verification.json) contains exact
cohorts, original small native fixtures, failed-before-fix descriptions, final
source/test hashes, check results and every remaining gap. The agent-executed
procedure is [the merge QA plan](../plans/ssconvert-merge-workbooks-qa.md).
