# DOCX sections and page settings

Status: Implemented and verified locally; no push or release.

Scope: only `sections-and-page-settings`. Header/footer content editing and all
later tasks remain pending. Inspected baseline:
`6b9bbcb2e95496f032218dab532c7505e6e119c0` on main. The already-modified
`docx-typescript-safe-bash.md` is unrelated work and is not owned by this task.

## Bounded implementation

Add utility `sections list/add/set` through the existing package engine and
safe-bash adapter. Section setters own the terminating paragraph's `sectPr` or
the final body's `sectPr`; neither ownership form may be flattened or removed.
Orientation assignment changes the flag alone. Explicit dimensions, margins,
gutter, header/footer distances, columns, section start, page-number metadata
and first/even/odd display policies retain unrelated XML and package parts.
Direct columnGap and columnSeparator control the equal-column gap and separator;
custom unequal column definitions and the advanced columns batch remain pending.
Page-number formats are decimal, upperRoman, lowerRoman, upperLetter and lowerLetter.

Original tests must fail before production edits. In-memory mutation uses memfs;
no native reference build, downloaded canonical fixtures, host I/O or product
networking is introduced. Tests retain existing names and original authored data.
No read-only audit work receives an empty commit. The final owned improvement is
committed on main after maintained checks, without push or release.

## Standards and inheritance evidence

Reviewed the DOCX and shared Office CLI/SDK specifications, root instructions,
section-related API inventory records, audit, and reconciliation. The following
primary format documentation clarifies the distinction between geometry and
story inheritance:

- [Section properties](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.sectionproperties?view=openxml-3.0.1)
  distinguishes final-body and paragraph-owned section properties.
- [Page size](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.pagesize?view=openxml-3.0.1),
  [page margins](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.pagemargin?view=openxml-3.0.1),
  and [columns](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.columns?view=openxml-3.0.1)
  describe the current section. They do not establish blanket inheritance from
  the previous section when a geometry element is absent.
- [Section type](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.sectiontype?view=openxml-3.0.1)
  identifies next-page as the absent-type default. Continuous sections can omit
  certain page-level properties because they inherit from the following section.
  That statement does not define a universal scalar-resolution algorithm or
  establish rendered page boundaries. Missing direct geometry must stay visible;
  no invented previous-section fallback is allowed.

- [Even/odd policy](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.evenandoddheaders?view=openxml-3.0.1)
  belongs to document settings, defaults false when absent, and does not replace
  first-page policy. Disabling it ignores retained even definitions rather than
  requiring their deletion.
- [Header references](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.headerreference?view=openxml-3.0.1)
  describe relationship-owned default/first/even definitions and prior-section
  inheritance independently of page geometry.

Reviewed schema families are `CT_SectPr`, `CT_PageSz`, `CT_PageMar`, `CT_Columns`,
`CT_SectType`, `CT_PageNumber`, and on/off policy elements. Relevant Part 1
subclauses exposed by the primary reference are §17.6.4 (columns), §17.6.11
(margins), §17.6.12 (page numbering), §17.6.13 (size), §17.6.17–19 (section
property contexts), §17.6.22 (type), and §17.10.6 (first-page policy).
Both Strict and Transitional namespace ownership remains intact. These reviewed
facts are structural evidence, not complete schema certification or pagination.

## Exact language/security mappings and documentation drift

The historical inventory is retained unchanged; no Section, Sections, Settings,
_Header, _Footer, inherited interface, enum, helper or owner-bound XML/package
member is promoted to complete model coverage by utility tests.

| Public contract | Exact JavaScript mapping and bounded disposition |
| --- | --- |
| Section geometry | Planned synchronous `page_width`, `page_height`, `top_margin`, `bottom_margin`, `left_margin`, `right_margin`, `gutter`, `header_distance`, `footer_distance`: Length or null, with nullable assignment retained in the model register. Utility options use camelCase and explicit length objects; this setter does not acquire nullable model setters by implication. |
| Orientation | `WD_ORIENTATION.PORTRAIT = 0` maps to `portrait`; `LANDSCAPE = 1` maps to `landscape`. Planned model `orientation` reads an enum and accepts enum/null. Utility assignment accepts the closed symbolic enum record; omission leaves state unchanged. No automatic width/height swap. |
| Section start | `CONTINUOUS = 0` → `continuous`, `NEW_COLUMN = 1` → `nextColumn`, `NEW_PAGE = 2` → `nextPage`, `EVEN_PAGE = 3` → `evenPage`, `ODD_PAGE = 4` → `oddPage`. The documented WD_SECTION alias remains in the model inventory; no free numeric coercion or extra operation spelling. Planned `start_type` nullable assignment remains separate from utility `startType`. |
| Creation | Planned synchronous `Document.add_section(start_type = WD_SECTION.NEW_PAGE)` remains pending as a model owner. Utility `sections.add` appends a boundary, preserves prior content, retains a final body section and copies geometry without introducing shared mutable geometry. |
| Display policy | Planned boolean `different_first_page_header_footer` maps to local title-page policy. Utility `differentFirstPage` is a strict boolean. Planned Settings `odd_and_even_pages_header_footer` maps to document-wide policy; utility `evenAndOddHeaders` requires explicit `all:true`, even in a one-section document. Disabling display retains definitions and bindings. |
| Stories | All six default/first/even header/footer variants remain separately represented. Missing bindings resolve recursively to the preceding definition; initial absence remains an empty/unresolved story. Noncreating utility inspection records linkage and owner without allocating a part. Content access, unlink/materialize/relink and shared story setters remain next-task/model obligations. |
| Collections | Planned Sections zero-based lookup, `.length`, `Symbol.iterator`, `.at` with negatives and `.slice`; inherited count/index/includes/reversed behavior stays registered. Utility one-based selectors and bounded snapshot records are not live Sections objects. |
| Units | Shared safe integer EMU conversion, then nearest twips halfway away from zero; 635 EMU/twip and 914400 EMU/inch. Section direct inventory identifies stored twips. Invalid/nonfinite/unsafe values reject rather than coerce. |
| Errors and authority | Closed input/schema failures use usage/exit 2; stale or missing selections and unsupported edits retain shared typed codes/exit 1. I/O, limits and cancellation retain exits 3, 4 and 130. Owned bytes and explicit VFS/sink authority only; no external relationship acquisition or arbitrary XML/runtime evaluation. |
| D17 drift | The guide's sample count and eleven-property summary do not limit section coverage or establish blank-template section count. Utility orientation tests address the no-swap rule; complete traversal and live owners remain pending. |
| D09 drift | Historical guide text denying header editing does not narrow the proposed API. This task only inspects/preserves bindings and changes display policies; actual content editing remains pending under explicit ownership intent. |

The direct section setter table previously omitted gutter/distances, section
start updates, page-number format and explicit document-wide parity policy despite
F16's broader requirements. The narrow authoritative update adds those fields;
it does not claim the later advanced columns batch or full model is implemented.

## Acceptance and QA procedure

1. Record failing original section regressions before implementing the engine.
2. Verify Strict/Transitional middle-section edits, actual portrait/landscape
   switches, next-page/continuous boundaries, columns and unselected sections.
3. Verify recursive header/footer bindings and first/even display policies without
   creating parts during reads or altering retained definitions during edits.
4. Verify invalid geometry/columns, revised/duplicate ownership and stale tokens
   fail before publication; input and preexisting output remain unchanged.
5. Run maintained DOCX unit/lint/build checks, relevant safe-bash DOCX checks,
   portable exports and the authoritative spec checker. Use actual registered
   Shell commands for CLI/SDK result and exit-status parity.
6. Capture and inspect help/workflow screenshots with the maintained renderer.
   Keep disposable QA artifacts outside Git; make no page rendering claim.
7. Stage only owned source/tests/docs explicitly and create one Conventional
   Commit for the interdependent improvement on main. Do not push or release.

## Verification

Executed on 2026-09-14 against the owned working tree:

- Red baseline: eight section API regressions failed before production edits;
  the three original safe-bash section workflows also failed (unsupported
  operations/undeclared new flags). Negative assertions were tightened to stable
  error codes. No original tests were removed or renamed.
- Subsequent original red regressions established no-op implicit owner creation,
  incorrect resulting paths, unresolved continuous dependencies, schema insertion
  order, custom-column count/gap/extent handling, shared token resolution,
  top-gutter extent, section cardinality limits, terminal direction controls and
  unnecessary publication-identity access during read-only listing. Each was
  corrected only after the failing case ran.
- `npm test --workspace=docx`: 54 files, 1,433 tests passed, including 28 new
  original section cases. Both dialects and all six story binding variants are
  covered; actual landscape-to-portrait round trips use edited bytes.
- `npm run lint --workspace=docx`: passed ESLint, source TypeScript and test
  TypeScript checks.
- `npm run build:workspaces -- --workspace=docx`: passed its maintained selected
  dependency closure and native postbuild hooks (five declared workspace builds).
- `node --import tsx --test packages/safe-bash/tests/commands/docx/*.test.ts`:
  21 tests passed, including three new registered section workflows.
- `node --test --test-name-pattern='default normal runner passes every discovered active file' packages/safe-bash/scripts/integration-inputs.test.mjs`:
  one check passed, confirming exact discovery of the new test file.
- `npm exec vitest run scripts/docx-exports.test.ts`: two checks passed, including
  the browser/worker bundle closure with no external runtime imports.
- The write-spec checker passed `docs/specs/docx.md` with zero warnings;
  `git diff --check` passed.
- Maintained generic `npm run screenshot` rendered `/tmp/docx-sections-cli.png`;
  the image was inspected for readable listing, a successful landscape/two-column
  dry run and invalid-selector exit 2. The root CLI does not register docx, so
  `screenshot-poe-code` cannot exercise this optional command without unrelated
  wiring. The screenshot used the actual optional Shell command and explicit
  in-memory filesystem. It is disposable QA and is not committed.

A preliminary `npm test --workspace=virtual-bash -- <file>` attempt discovered
that the maintained runner appends the entire normal test inventory; it was
stopped, is not a passing check, and was replaced by the focused commands above.
No full-root or full safe-bash suite is claimed.

The original API inventory and unrelated queue edits remain unchanged. The
command register retains its proposed whole-operation status and adds explicit
bounded utility evidence. Live model/advanced batch and header/footer content
editing remain pending. The commit includes this standalone completion record;
the already-modified shared task queue is not staged.
