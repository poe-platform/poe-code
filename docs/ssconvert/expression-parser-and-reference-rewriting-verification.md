# Expression parser and reference rewriting verification

Verified September 19, 2026. This implements the syntax/reference layer in
TypeScript ESM, with the existing shared SDK engine and explicit safe-bash
`ssconvert` command. It does not establish full Gnumeric or codec compatibility.

## Reference identity and evidence

The official Gnumeric 1.12.61 archive retained under
`out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz` was rehashed with
`shasum -a 256`; result:
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Primary source acquisition/extraction remains under `out`.

The captured [reference profile](reference-profile.json) records dependency,
plugin and locale identities and qualification gaps. Its retained binary identity
is `8a9a0ef179cc97f9588c8f54173f0d29a265277246f1d89b0eabc0be7e28ff57`,
with C locale, UTC and 50 activated plugins. The source-reviewed GOffice 0.10.61
archive identity is
`558597fd9ca59b93ff562750218d1e7ea8ec3c8d0ed6a5cc096aa715ef909a15`.

This task used source review and original in-memory regressions. No fresh native
formula differential run was available; retained profile observations are not
fresh observations for these cases. Native ssconvert is never a dependency,
subprocess or fallback in the product or unit tests.

## Verified scope

- Data AST and parse spans, explicit parse origins, bounded parsing, native unary
  precedence and right-associative powers, ODF left-associative powers, percent,
  concatenation, comparisons, parentheses and reference operators.
- Escaped strings, scalar/error/custom-error/rectangular array literals,
  omitted arguments, Unicode logical operators, namespace prefixes and selected
  aliases; array-only quoted numeric/boolean/exact-error coercion.
- A1/R1C1, relative/absolute/mixed axes, reversed endpoints, whole axes, sheet
  scopes/spans, external namespaces and named expressions.
- Source-preserving reference edits and explicit grammar serialization for native,
  Excel, ODF, SYLK and selected legacy OpenOffice/Applix conventions. Unknown
  function spelling and untouched formula text survive reference-only edits.
- Sheet rename/move/merge/resize, dependency/name remapping, clipped/reversed
  ranges, removed references, detached retained formulas, shared/array translation
  at distinct origins, and retained manual/clean unknown-function caches.
- Ordered `--set` parse/name effects: qualified unknown names enter their own
  sheet scope; missing-sheet references create no names. Parse failure retains
  the literal input rather than deleting it.
- Cancellation and work/depth/node/text bounds, borrowed-input preservation,
  accessor denial and replay controls in the focused suites. These are tested
  contracts, not a universal host-isolation proof.

Initial failing tests preceded implementation: unary/power precedence, omitted
arguments and reversed mixed/whole-axis translation. A different agent then
stress-tested and repaired concrete reference, legacy, ownership and convention
cases. Its final formula-only run passed 134 tests; this overlaps the full suite.
Root retained public exports, engine/virtual integration and Git ownership.
Tests use original in-memory fixtures and memfs for file effects.

## Final checks

| Command | Result |
| --- | --- |
| `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache` | Passed maintained 18-build dependency closure, including ssconvert |
| `npm test --workspace=@poe-code/ssconvert -- --no-cache` | 733 tests, 50 files passed |
| `npm run lint --workspace=@poe-code/ssconvert` | ESLint and source/test TypeScript checks passed |
| `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts` | 26 passed, zero skipped |
| `npm exec --workspace=@poe-platform/safe-bash -- eslint tests/commands/ssconvert.test.ts` | Passed |

An attempted root `npm test -- --workspace=... --no-cache` was rejected by the
maintained runner as an unsupported unit option. It ran no tests and is not a
pass; the supported package route above ran freshly. No full repository test or
lint pass is claimed.

The virtual command tests compare actual SDK/CLI bytes, statuses and channels.
Unary/power plus omitted SUM arguments yield 516. Manual resize preserves cache
7 while rewriting `=Future(A120:A140,A140)` to
`=Future(A120:A128,#REF!)` and marking it dirty.

Screenshots used the repository `npm run screenshot` route with the actual built
Shell, explicit ssconvert plugin, injected in-memory codec, byte stdin/stdout and
explicit limits. The formula output displayed both 516 results and exit 0 without
stderr. Malformed formula text retained the literal and exited 0. The resize
image displayed `=Future(A120:A128,#REF!)`, cache 7 and exit 0. An additional
`--resize=bad` invocation exited 0 without a diagnostic; its native equivalence
was not measured and it is not an error-diagnostic compatibility pass.
Images were inspected for legibility;
task-owned screenshot scratch was purged after reducing findings here. An initial
QA invocation omitted required limits and produced a shell internal error; it was
corrected as a fixture error and is not product compatibility evidence.

## Remaining unsupported or unmeasured cases

- Fresh exact-version native formula/canonicalization/span/writer-warning
  differential coverage is absent. Exact diagnostics and offsets are unit-tested
  only for selected cases, not qualified across the native grammar.
- Binary BIFF/Lotus/QPro legacy token decoding and complete codec reader/writer
  wiring are not implemented by this syntax layer.
- Full function alias argument rewrites and native unknown-function
  canonicalization remain unmeasured beyond selected prefixes and Applix
  IPAYMT/PAYMT/PPAYMT aliases.
- Full native calculation is absent from the bounded evaluator. Dirty unknown
  functions, logical calls and reference operators can report unsupported
  evaluation; clean/manual imported formulas and caches are preserved.
- Cross-workbook loading/resolution, external identifiers/URI canonicalization,
  sheet-size relative wrapping and broader detached ownership are unmeasured.
  There is no ambient external workbook loading.
- Partial shared/array-group resize and split merged-cell resize are explicitly
  unsupported. 3D range relocation is ignored following native source; broader
  resize effects are unmeasured.
- Applix external references, native qualified-name `!` paths, ODF absolute sheet
  sigils/XML/locale extensions, structured references/spill dialects and exhaustive
  Unicode/locale grammars are not fully qualified.
- Array scalar matching covers decimal/scientific numbers, ASCII whitespace,
  booleans and exact known errors. GLib hex parsing and extreme underflow/subnormal
  errno behavior are unmeasured; JavaScript Number is not assumed equivalent.
- SYLK reader uses native backslash decoding; its separate writer grammar emits
  raw quoted strings, following source. Backslash output loses the slash when
  reparsed, and embedded quotes produce invalid input. Tests record this source
  asymmetry, not successful interoperability; native warnings/loss are unmeasured.
- Target grammars that cannot represent custom errors, intersections, qualified
  names or whole axes fail explicitly instead of silently changing semantics.

Unsupported and unmeasured cases above are not passes. No README changes, commits,
pushes or publications were performed for this task.

## Current-worktree follow-up, September 19

This follow-up preserved the implementation and other existing edits. Its base
is `b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`; the candidate is a dirty,
uncommitted worktree, not that Git revision alone. The SHA-256 inventory digest is
`d7383fd70e2ab0cb824024ea3b69242b70856ecf7146384a9f50befcac98e70b`.
The inventory has 122 members: all regular `.ts` files recursively beneath
`packages/ssconvert/src`, its package.json, and the safe-bash ssconvert adapter
and command test. Sort paths with JavaScript's default sort, map each to
`{path,sha256}` in that key order, and hash `JSON.stringify(entries)` as UTF-8.
This qualifies the selected implementation/test inventory, not all dependency
or repository bytes. Final parser SHA-256:
`edb92bcf20aaba8f2a14d36764c6a474c10750f8454f1346a8e1870270318d13`.

The official archive was rehashed again and matches the required digest.
Primary source stayed in `out`. Source review identified and failing tests
reproduced these defects before fixes:

- ODF absolute sheet sigils were retained in unquoted names or rejected before
  quoted names. `oo_cellref_parse` ignores the sigil before name decoding.
- Punctuation in unquoted ODF sheet names was rejected by native-style word
  tokenization. Bracket references now scan a separate sheet-name token.
- The different agent reproduced corruption of literal leading dollars in
  quoted ODF names and fixed the second sigil removal.
- That agent reproduced rejection of `[#REF!]`, `[.#REF!]` and `[.$#REF!]`.
  These now lower to a scalar #REF! error, matching `parser.y:1195`; exact
  original bracket bytes survive source-preserving serialization.

An initial fourth root assertion expected `[Remote.A1:.B2]` to end on the
formula's local sheet. Further source review disproved that expectation:
`position.c:717` and `expr.c:3573` resolve a missing last sheet against the
first sheet. The assertion was corrected and the attempted behavior change was
removed. This was a faulty regression expectation, not a product defect.

The different agent added 12 independent cases covering quoted dollars,
invalid-reference lowering, negative malformed syntax, external namespace
preservation, unknown function/string preservation, distinct copy/move origins,
cancellation reason identity and admission budgets. Root added seven cases,
including the corrected negative control. All fixtures are original and in
memory. No native tools or LLM calls occur in these unit tests.

| Final selected gate | Result |
| --- | --- |
| `npm test --workspace=@poe-code/ssconvert -- --no-cache` | Passed: 752 tests, 52 files |
| `npm run lint --workspace=@poe-code/ssconvert` | Passed: ESLint, source and test typechecks |
| `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache` | Passed: maintained 18-build dependency closure and native npm lifecycle scripts |
| `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts` after final build | Passed: 26, failed 0, skipped 0, cancelled 0 |
| `npm exec --workspace=@poe-platform/safe-bash -- eslint tests/commands/ssconvert.test.ts` | Passed |
| Independent formula suite | Passed: 153 cases, overlapping the package suite |

The final package run includes original/repeated execution, borrowed workbook
preservation, accessor denial, work/node/depth/text budgets and error controls.
These deterministic checks are not a performance measurement, an arbitrary
JavaScript realm isolation claim or a serialized checkpoint/replay runtime
qualification. No checkpoint engine or host authority boundary changed.

Manual QA followed the Markdown procedure. Both repository-tool screenshots
were inspected and were legible. An actual built Shell with explicit ssconvert
registration, memory FS, injected codec and byte I/O converted
`of:=Future([$Budget-2026.$A1];[#REF!])` to
`=FUTURE('Budget-2026'!$A1,#REF!)`, retaining manual cache 7, status 0 and empty
stderr. The negative invocation `--set=bad` yielded no data, status 1 and exact
stderr `Failed to set cell bad\n`. These measure the injected-codec/shared-engine
path; they do not establish an ODF XML reader/writer implementation. Task-owned
images were purged after inspection.

| Required variant/runtime cell | Current evidence and limit |
| --- | --- |
| Native, Excel, ODF textual grammar | Deterministic source-reviewed syntax/reference tests pass; fresh native differential cell unverified |
| SYLK reader/writer | Deterministic tests pass, including the previously recorded lossy quoting asymmetry; native interoperability unverified |
| Legacy OpenOffice/Applix | Selected textual conventions pass; exhaustive mapped aliases and legacy readers unverified |
| CLI/SDK engine and virtual Shell | 26 integration cases pass with injected original codecs and memfs; complete format reader/writer parity absent |
| External workbook resolution/warnings | Unverified; no implicit host/external loading. ODF external local-first sheet selection remains unsupported |
| Checkpoint/replay and alternate realms | No new checkpoint/alternate-realm runtime qualification; repeated data operations are covered only |

No host ssconvert was found; `docker --context colima ps -a` showed no retained
oracle container. Fresh exact-version differentials therefore remain unmeasured,
and historical native captures were not counted as new passes. Broader ODF
broken-axis references, native writer sigil/canonicalization choices, external
resolver diagnostics, exhaustive punctuation/Unicode/locale behavior and all
previously listed unsupported/unmeasured cases remain open. The prior absolute
sheet-sigil gap is closed only for the explicit cases above.

Final selected gates had zero failures, skips or incomplete runs. The initial
failing regression runs are retained as reproduction history, not final gates.
Full repository `npm test`, lint and build were not run for this localized
formula-package follow-up; no broad-gate pass is claimed. No README edits,
commits, pushes, releases or publications were made.
