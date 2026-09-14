# Bounded paragraph editing

Status: Implemented and verified; owned local commit only, no push or release.

Scope: Only the paragraph insertion/editing task. Later pipeline tasks remain
pending. The existing edits in `docx-typescript-safe-bash.md` are independently
owned and are not part of this commit.

## Contract and implementation

- `editDocumentParagraphs` implements `paragraphs.set`, `paragraphs.add` and the
  inline insertion subset `runs.add`. The common engine invokes this same SDK.
- Direct alignment, signed indentation, spacing, all line-spacing rules,
  ordered tab stops/leaders, side-wise borders, shading, outline and pagination
  controls use the existing XML editor and bounded atomic publication.
- Paragraph text assignment intentionally removes run formatting, retaining
  paragraph properties, direct annotation boundaries and required paragraphs.
  Fields, objects, tracked content and nested opaque annotations reject when
  assignment/splitting cannot retain them. Literal `text replace` is unchanged.
- A collapsed paragraph range inserts at a Unicode scalar caret. Inline insertion
  splits runs only; block insertion retains prefix and suffix paragraphs. Both
  preserve each surviving run's properties. A section property stays on the
  suffix paragraph only. Boundary carets retain empty paragraphs.
- Whole paragraph anchors insert after, or before explicitly; story/cell anchors
  append before final section properties. Nested-table owners remain isolated.
- Heading/style creation, paragraph deletion, live model handles and batch
  execution are later tasks. Existing named styles are reusable here.

## Standards and exact language/security mappings

Read `docs/specs/docx.md`, `office-cli.md`, `office-sdk.md`, root/scoped AGENTS,
`docs/docx/upstream-api-audit.md`, the parsed 920-record API inventory and its
reconciliation. No reference runtime/build or downloaded behavioral fixture was
used. Original tests use Harbor/Coast wording, authored XML and memfs sinks.

The pinned ECMA-P1 schema at
`/tmp/docx-standards-20260913/ECMA-P1/schemas/wml.xsd` was inspected for
`CT_PPr`, `CT_PPrBase`, `CT_PBdr`, `CT_Ind`, `CT_Spacing`, `CT_TabStop`,
`ST_TabJc`, `ST_TabTlc`, `ST_SignedTwipsMeasure` and the point measure types.
This is the previously pinned research artifact, not a product input. The
schema uses integer measures, not a signed-32-bit paragraph limit. Safe JS
integer EMUs and safe serialized integers bound this implementation. Border
line widths use the 2–96 eighth-point profile and border spacing 0–31 points.
Strict start/end names are emitted for left/right paragraph and tab alignment
and indentation; the deprecated LIST tab value rejects in Strict.

| Retained model spelling / source behavior | This bounded operation mapping and remaining model work |
| --- | --- |
| `ParagraphFormat.alignment`, `left_indent`, `right_indent`, `first_line_indent` | `alignment`, `leftIndent`, `rightIndent`, `firstLineIndent`; typed enum records and explicit physical lengths. Omission preserves, null removes, signed first-line values select firstLine/hanging and clear competing attributes. Live properties retain their original snake_case spelling when implemented. |
| `space_before`, `space_after`, `line_spacing`, `line_spacing_rule` | Nullable explicit lengths, positive numeric multiples and `lineSpacingRule`. Convert to EMUs once with half-away rounding, then twips; multiples serialize in 240ths. EXACTLY/AT_LEAST require physical spacing when supplied together. Fixed single/1.5/double rules reject conflicting values. Rule-only changes preserve existing line magnitude unless the rule defines a fixed multiple. |
| `keep_with_next`, `keep_together`, `widow_control`, `page_break_before` | Nullable booleans map to keepNext/keepLines/widowControl/pageBreakBefore. False is explicit, not inherited absence. |
| `Paragraph.text`, `clear()` | Explicit `paragraphs set --text`; SDK null means empty. Runs/formatting are replaced; owning paragraph properties and direct range markers survive. Complex content rejects before publication. Model setter/clear methods remain pending. |
| `Paragraph.insert_paragraph_before`, `add_run`, `Run.add_break` | `paragraphs add --before`, `runs add`, `runs add --break line|page|column`. Insertion is async at the operation/I/O boundary, with immutable location receipts rather than live return handles. No alias renaming of future model methods. Other model break kinds remain pending. |
| `TabStops.add_tab_stop`, `clear_all`, deletion; `TabStop.position/alignment/leader` | The operation accepts a complete tab-stop array, sorted by rounded position; empty/null removes direct tabs, duplicate positions reject. Model `.length`, `[Symbol.iterator]()`, `.at(index)`, `remove(index)` and live tab handles remain pending, not falsely implemented by array assignment. No source slicing is added. |
| D23 tab movement / inherited `.element` | Preserve the existing reconciliation: a future moved handle follows the current node; a detached XML view fails stale. This task issues no live XML handles and does not claim D23 model implementation. |
| Units, enums and inherited members | Existing inventory rows, aliases, helpers, protocols and public underscore-prefixed types remain in scope with their original statuses. No unsupported member is reclassified private. The new operation types are additive; model constructors and enum factories remain planned. |
| Type/value errors and authority | Closed operation schemas reject invalid/coerced/accessor/unknown values as `DocxUsageError` (`usage`, exit 2). Existing typed stale/missing/ambiguous selection errors and unsupported-edit use exit 1; publication, limits and cancellation retain exits 3/4/130. These utility errors do not claim implementation of the planned model TypeError/RangeError/LookupError mapping. All document bytes, filesystem authority, cancellation and sinks are supplied; no host I/O or networking is added. |

Documentation drift resolved narrowly: the old direct signature omitted nullable
indent/spacing resets and had no direct path for advanced paragraph properties
while model/batch execution remained pending. Additive JSON flags, typed SDK
fields and direct line-spacing rules now describe the actual operation. No
existing planned model signature or historical evidence is rewritten.

## Red/green evidence

1. Added 19 original public SDK/CLI regressions before product code. All failed
   at the missing SDK function/CLI fields. After implementation, one fixture
   assertion incorrectly assumed a final sectPr; it was corrected to supply its
   own explicit section. The 19 tests passed.
2. Additional regressions exposed reverse property insertion ordering, missing
   line-spacing rules and rejected nested-cell all-selection. Added Strict
   directional and token-before cases failed before their corrections.
3. Safe large integer and inline-XML-comment cases failed before correcting an
   unnecessary signed-32-bit restriction and a whole-text comment-loss path.
4. Original discovery tests failed because their exact inventories lacked the
   three new operation paths and F13. Only those expectations were extended.
5. The final reset regression first rejected a simultaneous null spacing/rule
   reset, then exposed materialized empty properties on an inherited paragraph.
   Both failures preceded the corrections; the final reset is byte-preserving.

## Manual QA plan

1. Build the maintained docx dependency closure and run package tests/lint plus
   root portable-export checks and existing safe-bash registration checks.
2. Through the existing explicit safe-bash plugin, create an original document,
   add a paragraph, set its properties, insert a page/column break and read text.
   Verify binary stdout, JSON dry-run and validation failure with memfs authority.
3. Capture actual CLI output/help/errors using the maintained terminal screenshot
   renderer. Inspect the PNG for readable help, options and diagnostics.
   This checks CLI presentation, not Word page layout.
4. Review only owned diffs, stage explicit owned files, commit on main with a
   Conventional Commit. Do not push or release; report the local hash separately.

## Verification results

Completed on 2026-09-14:

- `npm run test --workspace=docx`: **921/921**, 38 files, including 41 new
  paragraph regressions; no skips. Final log:
  `/tmp/docx-paragraph-tests-final-20260914.log`.
- `npm run lint --workspace=docx`: ESLint and source/test TypeScript passed.
  Final log: `/tmp/docx-paragraph-lint-verified-20260914.log`.
- `npm run build:workspaces -- --workspace=docx`: all five maintained declared
  build-closure tasks and applicable lifecycle hooks passed, uncached.
  Final log: `/tmp/docx-paragraph-build-verified-20260914.log`.
- `npx vitest run scripts/docx-exports.test.ts`: **2/2** portable export checks.
- From safe-bash, `node scripts/test-reporting.mjs --import tsx
  tests/commands/docx-registration.test.ts`: **10/10**, no skips. Existing
  adapters/registration and root exports required no source changes.
- Seven final actual Shell calls with the built SDK and existing opt-in plugin
  passed: create, paragraph insertion, formatting, column break, text readback,
  JSON dry-run and negative spacing (expected exit 2). Binary output used shell
  redirection into its explicit MemoryFileSystem. Independent built SDK/XML
  readback confirmed CENTER, line=360 and the column-break segment. No host file
  authority was supplied to the product. Raw transcript:
  `/tmp/docx-paragraph-shell-verified-20260914.txt`.
- The first Shell attempt's commands passed, but its QA assertion mistakenly
  expected LF for a column break. The existing documented extraction emits VT.
  Preserve `/tmp/docx-paragraph-shell-20260914.txt` as the earlier transcript;
  the corrected explicit VT assertion passed without a product change.
- Executed generated paragraph help, then inspected both PNGs from the maintained
  `npm run screenshot` renderer:
  `/tmp/docx-paragraph-help-20260914.png` and
  `/tmp/docx-paragraph-shell-20260914.png`. Help was word-wrapped to 110 columns
  for capture; text-control bytes were escaped in the final Shell transcript.
  Options, normal results and the spacing diagnostic are readable. These are
  CLI screenshots, not document rendering evidence.
- `git diff --check`: passed. Only owned paths enter the Conventional Commit.
  All original tests and historical evidence remain; unrelated plan/research
  edits stay unstaged. Later tasks, live model objects and heading creation remain
  pending. No push, remote-main delivery or release is claimed.

Disposable logs, transcript captures and screenshots remain under `/tmp`; none
is staged. No reference build, product networking or downloaded behavioral
fixtures were introduced.
