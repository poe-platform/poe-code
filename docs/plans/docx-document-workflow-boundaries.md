# Document creation workflow qualification

Task: `adapt-upstream-tables-bdd` only. Root owns the new original
`packages/docx/src/document-workflow-boundaries.test.ts`, the corresponding
creation methods in `document-model.ts` and closed action registrations in
`structure-model-batch-operations.ts`, this plan and
`docs/docx/document-workflow-evidence-20260915/`. Settings are a separate atomic
improvement. Other assigned workers' paths and unrelated changes are preserved.
No README, later task, push or release.

## Original test first

Four tests failed before code: missing heading/page-break/section methods and
unsupported typed creation actions. Add source-neutral methods over ModelStore
transactions and existing live style/paragraph/run/section owners. Default heading
level is 1; 0 creates Title and 1–9 create corresponding heading styles. Missing
original heading styles are authored through the existing style owner; explicit
unknown ordinary style assignment still fails. Original text and bounds tests
check invalid-type versus invalid-value errors and no partial mutation.

Page breaks create an empty paragraph with a page-break run. They do not claim
cached rendered pagination. Section creation clones the preceding final section
into a paragraph boundary, retains its header/footer bindings, strips explicit
bindings from the new final section and sets its explicit start enum. Original
namespace bindings are retained. Orientation alone does not swap dimensions.
Tests cover even-page landscape addition and all six linked header/footer variants,
shared inherited text and save/reopen via memfs. Existing and new content use the
same admitted owner and loss-preserving editor; no competing editor or host I/O.

Initial implementation attempts exposed undeclared inherited namespace prefixes
and overlapping insertion/replacement patches; both were corrected before the
retained final green run. They are implementation failures, not new source-case
passes. Four original focused tests pass.

## Exact mappings

`add_heading(text="",level=1):Paragraph`, `add_page_break():Paragraph` and
`add_section(start_type=WD_SECTION_START.NEW_PAGE):Section` are synchronous;
Document admission/save remain always async. Enum aliases retain neutral symbols.
Closed typed operation IDs and argument schemas already existed; register their
implemented actions without introducing aliases or dynamic user invocation.
Operation JSON uses camelCase startType; the model retains start_type.

Source scenarios and exact observations are reconciled independently in the
workflow case supplement. This improvement alone does not qualify all 650 BDD
rows or whole-public-API coverage, including unrelated untested members.

## Agent QA procedure

1. Inspect all four retained reds before implementation and the final focused green.
2. Validate title/heading style names, exact Unicode, invalid input immutability,
   page-break XML, previous/new section orientations and six linkage states.
3. Save/reopen the authored document through a memfs sink; verify inherited text.
4. Run maintained package lint/unit/build and the SDK-backed command/Shell scope.
5. Independently review creation and ownership behavior, stage only owned paths
   and commit locally on main.

Renderer QA: not run. `soffice` and `libreoffice` are absent from PATH. Pages
computer use was denied. The documents skill's packaged `render_docx.py` path
is absent and no load_workspace_dependencies tool is exposed. These structural
creation tests do not prove document layout. The explicit table layout procedure
remains in docx-table-bdd-adaptation.md; no DOCX artifact is shipped.
