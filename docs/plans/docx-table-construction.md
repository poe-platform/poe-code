# DOCX bounded table construction

Status: bounded construction implemented and verified locally. No push or release.
Scope: table-construction only, on main. Later tasks remain pending. The unrelated
pipeline-plan edits observed at entry are preserved and excluded from this commit.
No push, release, downloaded fixtures or native reference build.

## Implementation and contract

`editDocumentTables(bytes, { operation: "tables.add", options, input? }, context)`
is an always-async typed entry to the existing paragraph/block transaction engine.
The original paragraph API and tests remain. The command engine invokes the same
implementation, and the optional safe-bash adapter retains explicit VFS/stream
capabilities. Root only retains its existing package export wiring.

Rows and cols are explicit positive safe integers. Every new cell ends in a
paragraph, including empty cells and cells ending with a nested table. Typed
content retains ordered paragraphs and nested tables, Unicode, run formatting,
style names and collision-safe headings. `tables.add` content is version 1 with
exactly one matching table; no page/theme/style declarations or duplicate direct
formatting sources are accepted. Existing `create` content shares this renderer.

Width defaults to available stored container width, with equal grid division and
left-to-right remainder distribution; explicit columnWidths sum to the preferred
width and must match cols. Both autofit and fixed layout retain exact preferred,
grid and cell widths. Explicit width must fit its container. Nested cells use
stored dxa widths, subtract inherited table margins and honor per-cell overrides,
including zero. Unknown/non-dxa cell widths or margins reject. Body section
columns conservatively use the narrowest stored column width; this is not layout
or pagination. Inserting after a section-ending paragraph uses the next section;
before/caret insertion uses the original section and preserves the suffix owner.

`repeatHeader` repeats the first row; `headerRows` chooses a leading count and is
exclusive with repeatHeader. Row overrides must keep repeated headers consecutive
at the start. Row height supports AUTO/AT_LEAST/EXACTLY, optional per-row overrides,
and explicit split true/false. Borders, shading and margins are typed on table
and cells. Strict uses start/end directional elements; Transitional uses left/right.
Numbers, dimensions, converted units, colors, rectangularity, row-option counts,
header continuity, margins and nested aggregate cell budgets are validated before
publication. Complete nested content is rendered before changing editor state.
Common stale/protection/shared-story checks and publication safeguards remain.

## Exact JS language/security mappings and drift

The pinned API inventory and historical case maps remain unchanged. This utility
milestone does not promote later live owners or general table editing to complete.

| Surface | Exact mapping and disposition |
| --- | --- |
| Input/result | Owned Uint8Array, typed closed options, always-async Promise of the existing mutation data. Version-1 envelopes retain operation, affected, locations, warnings/errors; ordinary exits 0/1/2/3/4/130 remain shared. Publication requires explicit capabilities; no ambient filesystem, fonts, clock, networking, or arbitrary evaluated input. |
| Utility/model naming | CLI tables.add uses camelCase semantic fields and mechanical kebab-case flags, with structured JSON suffixes removed at admission. Retain model `add_table`, `autofit`, `height_rule`, `table_direction`, `iter_inner_content` as documented neutral spellings; no blanket alternate naming layer. The model owners remain pending. |
| Document.add_table | Positional rows/cols and optional style remain proposed synchronous live-model API; utility requires positive dimensions (zero-sized live-model cases remain pending). Optional style names resolve an existing table style; live _TableStyle objects/null resetting are not construction inputs. No unrelated styles are rewritten. |
| _Cell.add_table / Comment.add_table / _Header.add_table / _Footer.add_table | All remain public, including inherited members. Utility inserts into admitted cells/stories, uses stored owner geometry, and adds terminal cell paragraphs. Creating live owners/getters and constructor-specific return/width obligations remain pending. Comments/notes do not gain unrelated creation or annotation behavior. |
| Table and _Cell | Preserve all public rows, columns, cell, row_cells, column_cells, add_row, add_column, style, alignment, table_direction, table, part; _Cell add_paragraph, add_table, grid_span, iter_inner_content, merge, paragraphs, tables, text, vertical_alignment, width and inherited part stay registered. Utility construction does not implement merged aliases, omitted grid slots, destructive text setters, row/column changes or live handles. |
| _Row / _Column | cells, table, width/height/height_rule, grid_cols_before/grid_cols_after and inherited part remain public. Utility per-row options map to new XML properties only, not live setters. Nullable model properties keep null inheritance semantics; construction does not admit null reset. |
| _Rows / _Columns | table, part, indexed access, iteration and length remain public. Proposed JS collections use zero-based at(index), length and Symbol.iterator; _Rows slicing uses slice(start,end). Invalid indexes require bounds errors. CLI row/table ordinals remain one-based. No unsupported collection is hidden by underscore spelling. |
| WD_ROW_HEIGHT_RULE | Tagged utility enum {enum:"WD_ROW_HEIGHT_RULE",name:"AUTO"/"AT_LEAST"/"EXACTLY"} maps to XML auto/atLeast/exact. Documented underlying values 0/1/2, WD_ROW_HEIGHT alias, inherited toString/from_xml/to_xml and full enum value-object behavior remain in the pending live-model register. Other table alignment/direction/vertical-alignment enums and aliases remain pending. |
| Units / colors | Typed Length, no numeric-string coercion, finite safe EMUs rounded once half away from zero, then twips; positive widths, nonnegative margins/heights. Borders use eighth-points and bounded point spacing; RGB hex normalizes uppercase. Explicit false and zero survive. Invalid values map to neutral InvalidValueError (RangeError, usage); limits to ResourceLimitError; malformed/unsupported stored geometry to UnsupportedEditError. |
| XML/package views | Public element/part obligations remain bounded owner-aware views, not ambient XML-library or host access. Current loss-preserving XML/package primitives are implementation tools, not claims that every public model view is implemented. |
| D03 documentation error | Table.direction is a historical documentation error; retain Table.table_direction as the future model member. Do not add an accidental model direction alias. This task does not implement direction editing. |
| Discovery/spec drift | The old tables.add register exposed only dimensions/width despite F19 formatting requirements. Add explicit formatting, JSON content/schema fields, F19 bounded edit capability and applicable help. Cell updates, merges, row/column editing and live model batches remain pending. Existing exact discovery tests are extended with literal expectations. |

Original independent cases cover previously untested public-behavior obligations
for required paragraphs, nested order, width distribution, explicit false/zero,
row height and headers; none depends on downloaded data or source test wording.
No source material was copied into product/tests; no new derived-code notice is needed.

## Test-first evidence and manual QA

1. Before product edits, three SDK construction cases failed with unsupported
   operation; three Shell cases failed with unsupported operation/unknown options.
   The original aggregate-cell limit case already passed and was preserved.
2. Independent XML parsing walks tblGrid/tr/tc/tcPr and compares exact grid widths,
   row counts, terminal paragraphs, properties and surrounding section XML.
3. An independent Shell review reproduced omitted inherited table cell margins:
   a nested 4-inch table with 12-point margins produced 2880-twip columns instead
   of 2640. Fix follows that failing original memfs regression. Explicit zero
   per-cell margin overrides are separately covered.
4. Type-check regressions exposed direct rowHeight/cellMargin types admitting
   twips despite the direct schema excluding them; both typed maps now match
   the schema. A failing empty-style regression exposed silent omission; an
   explicit empty style now fails resolution before publication. An allowed empty
   selection with nested headings initially created styles without inserting
   content; a failing package-equality regression now guarantees no such changes.
5. A failing help regression exposed irrelevant insertion selectors. Help now
   shows applicable options, with schema and CLI/SDK JSON normalization checked.
6. Run maintained DOCX tests/lint and selected build closure; run safe-bash DOCX
   integration tests, exact test-runner inventory and portable export checks.
7. Capture actual command-engine help, successful dry-run and limit rejection via
   the maintained terminal-png renderer; inspect PNGs. This optional command is
   not a root poe-code route. Disposable screenshots are not committed.
8. Stage only explicitly owned files plus this plan, commit one cohesive
   construction improvement with Conventional Commits, and do not push/release.

## Verification

Verified on 2026-09-14 against the owned working tree:

- `npm test --workspace=docx`: 58 files, 1,508 passing tests, including 25
  independent construction tests and the direct-length type regression.
- `npm run lint --workspace=docx`: ESLint, source TypeScript and test TypeScript
  passed. `npm run build:workspaces -- --workspace=docx`: maintained five-workspace
  build closure and native postbuild export checks passed.
- `node --import tsx --test packages/safe-bash/tests/commands/docx/*.test.ts
  packages/safe-bash/tests/commands/docx-registration.test.ts`: all 43 tests passed,
  including six new construction Shell tests. File mutations use memfs.
- `npm run test:runner --workspace=virtual-bash`: all 515 maintained runner checks
  passed, including the literal discovery registration for the new test file.
- `npx vitest run scripts/docx-exports.test.ts`: both portable export/browser
  closure checks passed. Root runtime wiring and dependencies remain unchanged.
- The additional repository `npm run lint:eslint` scan completed with one error
  in an existing XML stdin test. Its minimal, behavior-preserving correction and
  passing scoped ESLint/original XML recheck are recorded in
  [the separate prerequisite](docx-table-checks.md); no global lint rerun is claimed.
- `git diff --check` passed. The reviewed final CLI screenshot is
  `/tmp/docx-table-cli-final-20260914.png`, created by `npm run screenshot` from
  the actual Shell transcript. Help lists applicable options; dry-run exits 0,
  the aggregate limit rejection exits 4. This is terminal QA, not document glyph
  rendering. Two earlier QA setup attempts used an incorrect import or omitted
  explicit archive limits; those disposable captures remain separate and are
  not counted as product successes.

Earlier red cases and intermediate discovery/type/no-op failures are retained in
this account; they are not counted as passes. No complete live model, table-cell
updates, row/column editor, merge implementation, downloaded corpus run, remote
main delivery or release is claimed. Later task statuses remain pending.
