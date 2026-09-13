# Bounded chart workbook evidence

This receipt supersedes historical “adaptation not started” statements for the
bounded workbook operation only. The full public model remains incomplete.
The [case ledger](workbook-case-map.json) accounts for 180 exact source rows:
all workbook writer tests, series rewriters, data builders, chart parts,
replacement, supplemental cache writers and all seven replacement scenarios.
The [API ledger](workbook-api-map.json) retains 190 data-builder/member records,
including inherited members and aliases, plus `Chart.replace_data`. Other public
chart members, enums, helpers and collections remain in the existing
[784-row register](chart-expansion-api-map.json). No type is excluded because its
name starts with an underscore. A mapped operation is not live-model parity.

## Provenance and reuse

The authority is the [test audit](upstream-test-audit.md),
[test inventory](upstream-test-inventory.json), [API audit](upstream-api-audit.md)
and [API inventory](upstream-api-inventory.json), pinned to
`278b47b1dedd5b46ee84c286e77cdfb0bf4594be`. Exact inventory pointers, selected
parameters, source-file hashes and earlier case IDs are retained in the new
ledger. The source checkout was read for research; its binaries are not test
inputs. No downloaded documents or cloned fixtures were created, shipped or
removed. Other campaigns' disposable inputs remain untouched.

The crosslinked [DOCX test audit](../docx/upstream-test-audit.md) and
[API audit](../docx/upstream-api-audit.md) establish the same OPC/XML/image
boundaries: bounded bytes, namespace-aware edits, relationship ownership,
unchanged unrelated parts, inert external content and no ambient native decoder.
They do not establish worksheet semantics. `office-package` supplies existing
verified archive primitives; it has no workbook engine. The existing pptx
workbook writer was extended in its owning package. No new dependency was added.
Original assertions and authored in-memory data replace dependency mocks and
binary fixtures. Existing standalone legal notices remain in place.

## Implemented subset

Generated data uses one sheet, literal strings, finite numbers/null values,
category hierarchies and adjacent XY pairs/bubble triples. Each range has a
checked grid address, at most XFD/1048576. Names, category/value/x/size formulas,
sparse cache indices, cell values and number formats are written together.
Series growth allocates fresh idx/order values; trimming follows declared display
order and preserves surviving identities. Existing nondata series XML remains.

Imported sheets may use shared/rich strings and direct relative/absolute ranges,
quoted sheet names and vertically stacked XY/bubble series. Replacement
canonicalizes these ranges to the generated layout. Populated cells outside the
owned ranges (including supported XY header cells) reject replacement. Shared
strings are retired with their relationship and content-type override once the
owned sheet uses inline strings. Existing themes and other admitted metadata
remain unchanged; number format definitions are extended structurally.

Strings beginning with `=` remain literal. XML text/attribute escaping and
SpreadsheetML escape-shaped literals are distinct. Literal `_xHHHH_` sequences
have their leading underscore protected; carriage return and attribute tab/newline
use the spreadsheet string encoding. This follows Microsoft's
[ST_Xstring implementation notes](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/d34ae755-c53f-4a44-a363-c6dd3ee018a4),
reviewed 2026-09-13. Other invalid XML controls are rejected, not silently removed.

The 1900 discontinuity (59 to 61), both epoch origins and all four audited date
examples have original worksheet/cache assertions. Operation dates use explicit
UTC-Z strings at calendar-day precision. Creation defaults to 1900; replacement
retains the workbook epoch and rejects supplied or chart/workbook disagreement.
Dataset formats apply to x and size; per-series overrides apply to y. This resolves
the previously documented source workbook/cache format disagreement consistently.

All edits reject formula cells, named calculations, external links, additional
sheets/tables, ambiguous ownership, dependent chart formulas, and detached
calculation/external/query/pivot dependencies. No calculation or external fetch
occurs. Failure leaves caller bytes and existing CLI destinations unchanged.

## Language and security mappings

| Source behavior                    | Exact operation mapping and remaining model obligation                                                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-memory workbook/context manager | Internal async `createChartWorkbook` returns owned `Uint8Array`; public `addChart`/`setCharts` return presentation bytes. No exposed dependency writer or host path.                                                                                       |
| Category/XY/bubble builders        | Typed `ChartData` records with dense bounded arrays; live `CategoryChartData`, `XyChartData`, `BubbleChartData`, `ChartData` alias and their inherited members remain unsupported. Neutral model spellings are retained in the register.                   |
| Reference helpers                  | Internal checked zero-based column helper and bounded direct-range parser; no formula evaluator. Model helper properties and arbitrary package-part access remain unimplemented.                                                                           |
| `number_format`                    | Operation `numberFormat`, `categoryNumberFormat` and series overrides; strings only, omitted means General, no numeric coercion. Live/per-point properties remain gaps.                                                                                    |
| Dates                              | UTC-Z operation strings; calendar-day serials, explicit `date1904`; model UTC `Date` and its synchronous property behavior remain obligations.                                                                                                             |
| Errors                             | Invalid typed data/column indices use `OfficeError` with `invalid-value`; unsafe reconstruction uses `unsupported-edit`; grid/archive/XML limits use `resource-limit`. CLI usage/unsupported/limit statuses are 2/1/4.                                     |
| Collections and side effects       | Operation arrays/snapshots are detached. Checked indexing, iteration, slicing, live ownership, getter creation effects and model invalidation are not implemented by these arrays.                                                                         |
| SDK/CLI                            | `addChart` and `setCharts` back plural `charts add/set/replace`, common selectors/flags, version-1 JSON, schema/capabilities and atomic publication. Both workbook policies synchronize admitted sheets. The trusted publication callback honors `dryRun`. |

## Explicit gaps and differences

- Full live workbook/data/chart-part model APIs, per-point formats, direct
  `xlsx_part` replacement and creating a missing workbook on imported replacement.
- Complex/combination/extended chart reconstruction, formula-dependent workbooks,
  arbitrary sheets and general spreadsheet operations.
- New series use supported generated decoration rather than cloning arbitrary
  decoration from the last series. Multi-plot clone/trim cases remain unsupported.
- Generated XY/bubble layout uses adjacent columns rather than stacked rows;
  imported stacked ranges are supported. Generated category columns do not impose
  the source default width of 10. These are explicit serialization differences.
- Empty datasets, numeric format coercion and null series names in private cache
  writer fixtures are rejected under the typed contract. Source public builder
  behavior is still retained as a model gap; no whole-row parity is claimed.
- Strict workbook reconstruction, native application rendering, arbitrary control
  characters and full public API conformance are not established by these tests.

## Verification

The first seven range/ownership/identity regressions failed before implementation
and passed after it. Five string/format/dependency cases subsequently failed and
passed. Three string-encoding assertions and one display-order trim case also
failed before their fixes. New tests use original memory data and complete in
milliseconds per case; no disk-writing unit fixture or LLM is used.

The maintained package gate passed 3,627 tests before the final encoding cases;
then 3,635 tests passed after encoding and the seven exact scenario transitions.
After the last display-order fix, the affected two-file gate passed 38 tests,
and package lint (ESLint plus both TypeScript configurations) passed. Final gate
and commit receipts are appended below. The selected workspace build uses the
maintained dependency closure, not a custom build list.

The maintained generic screenshot route captured `charts replace --help` at
`.cache/pptx-corpus/workbook-help.png`; visual inspection confirmed readable
selectors, policies, common flags and data examples. It is disposable terminal QA,
not presentation rendering evidence, and is not committed. QA procedures remain
in [the plan](../plans/pptx-bounded-workbook.md).

Final runtime gate: `npm run test --workspace=pptx` passed **128 files / 3,636
tests** in 32.46 seconds. `npm run lint --workspace=pptx` passed, including both
TypeScript configurations. `npm run build:workspaces -- --workspace=pptx` passed
the maintained three-workspace closure. A final original numeric-label rewrite
assertion was added while resolving the exact source-row mapping; its 33-case
file and package lint passed afterward. No further product code changed.

Research validation resolved **920 JSON pointers**, verified unique case/member
IDs and confirmed every original test-title link. Source suite passes are never
counted as product passes. No private abstract-writer test disposition removes a
documented public member. The ledger records 180 case dispositions and 190 live
API obligations without claiming full parity.

Local fix commits: `f312b6954` (owned ranges), `f69147adf` (data fidelity),
`5b541d039` (worksheet string encoding), `afcac84fa` (series display order).
No push, remote-main delivery or release was performed. README files and unrelated
working changes were preserved. The case/API receipts and this document belong
to the subsequent local accounting commit.
