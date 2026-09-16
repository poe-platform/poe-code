# Bounded DOCX range and structure removal

Task: `range-and-structure-removal` only. Later pipeline tasks remain pending.
Baseline inspected: `f9aabdde74e2aa68f38f750441131a757add04af` on main.

## Scope and decisions

Implement the existing plural `paragraphs.remove`, `runs.remove`, `tables.remove`
utility paths and export async `removeDocumentContent(bytes, request, context)`.
The generic safe-bash adapter already forwards these operations and capabilities;
its original in-memory integration tests exercise the same package engine.
Root export wiring already includes the package index and requires no changes.

Fingerprint-bearing paragraph/run tokens provide explicit half-open Unicode scalar
endpoints. `markers: exclude | include` is required on ranges and rejected on whole
structures. Exclude retains proof/rendered markers; include removes markers at or
between both endpoints. Collapsed ranges require allowEmpty and produce no change.
There is no flattening/join of story, cell or paragraph endpoints. Existing
logical-map admission rejects hyperlink crossings and unsupported owner maps.

Whole paragraphs, runs and tables retain exact surviving text, run properties,
final body section properties and paragraph-owned section breaks. Empty story
containers retain a paragraph; cells retain a terminal paragraph. A retained
paragraph keeps its properties, and already-empty required paragraphs are no-ops.
Output receipts distinguish deleted owners (after null) from surviving paragraphs/
runs (staged tokens and fresh display positions); range receipts collapse at start.
All selected owners are checked before any deletion is staged or output begins.

## Reference and boundary policies

| Structure | Explicit bounded policy |
| --- | --- |
| Bookmarks/internal destinations | Reject affected marker-bearing owners or removal inside a spanning annotation. Use separate bookmark operations to express destination updates. |
| Classic/modern comments and permission ranges | Reject affected anchors/references and spanning active ranges; retain bodies/extensions exactly. |
| Footnotes/endnotes | Reject affected reference or body-marker removal; retain bodies, reserved separators, numbering and incoming graph. Dedicated notes removal expresses reference deletion. |
| Simple/complex fields | Reject affected field markup, ancestors and active complex-field spans across paragraphs/cells. Never execute instructions. |
| Revisions/moves/property history | Reject affected history/ancestors/ranges; dedicated revision decisions remain the route for update policies. |
| Shared header/footer stories | Reject ambiguous shared-owner mutation using existing selection rules; no implicit shared edits or clone/rebind. |
| Images/shared media/opaque graphics | Reject affected graphics deletion. Unrelated selected text may be removed while all occurrences, media bytes, content types and relationships remain exact. |
| Resources generally | Retain every part and relationship, including unreferenced ones. No local reference-count heuristic, graph garbage collection or resource deletion. |
| Section breaks | Retain paragraph-owned break containers and final body section properties; reject whole tables containing breaks. |

## Exact JS language/security mappings and documentation drift

Reviewed `docs/docx/upstream-api-audit.md`, schema-v2 inventory and shared office
CLI/SDK contracts. Historical inventory rows remain unchanged; this utility
milestone does not establish whole model coverage.

| Obligation | Exact mapping and disposition |
| --- | --- |
| Utility operation | `removeDocumentContent(input: Uint8Array, request: ContentRemovalRequest, context: PublicationContext): Promise<ContentRemovalData>`. Request operation is one of the three existing IDs; options use common camelCase fields; supplied input identity is optional only when publication permits it. Always async. |
| Endpoint/index semantics | Utility ordinal selectors remain one-based; token paths are zero-based element-child indexes. Token ranges count Unicode scalars with half-open end, not UTF-16 units. No implicit first target, scope widening or endpoint reattachment. |
| Marker inclusion | Add operation-specific `markers?: "exclude" | "include"` to CLI/SDK schema; it is conditionally required for ranges. This resolves earlier register drift where F44 was declared with no way to express range marker intent. Whole-resource-only selection rejection now admits bounded paragraph/run removal ranges. |
| Result/null | `changed: boolean`, `changes: readonly {kind: "remove"; before: Location; after: Location|null}[]`, nullable output `{path: string|null; bytes: number; sha256: string}`, `dryRun: boolean`. Deleted owners have no fabricated output location. Staged surviving tokens retain source identity and generation 1; unchanged operations emit no changed locations. |
| Errors/security | Missing targets, stale endpoints and shared ambiguity retain common selection codes; invalid intent is usage; unsafe affected structures are unsupported-edit. Owned admitted bytes, supplied VFS/sinks, cancellation and lowered limits are the only capabilities. No host I/O, networking, clock, fonts, native reference build or field execution. |
| Paragraph.clear | Documented primary `clear(): Paragraph` remains a live-model obligation returning its receiver and retaining paragraph formatting while clearing contents. Structural paragraph deletion is a distinct utility and does not promote that member. |
| Run.clear | Documented primary `clear(): Run` remains a live-model obligation returning its receiver and retaining run formatting. Whole run deletion and scalar deletion are separate utility behaviors, not aliases or a claim that this member is implemented. |
| Paragraph/Run text setters and traversal | Neutral snake_case spellings, inherited `part`, `iter_inner_content`, text properties and owner-bound return/invalidated-handle behavior retain their existing inventory obligations. No blanket camelCase model aliases are added. |
| Table/_Cell/_Row/_Column/_Rows/_Columns | Public underscore-prefixed owners remain public and pending; inherited block/part members, logical merged aliases, zero-based live indexing, at/slice/length/Symbol.iterator and keyed semantics are not hidden or promoted by table deletion. |
| Comment/Comments/Hyperlink/notes | Live members, stored versus Date-valued timestamps, returning collections and inherited `part` retain their existing dispositions. Existing documented id/date and table-direction discrepancy decisions remain unchanged; no accidental aliases. |
| Package/OpcPackage/Part/XmlPart/XML views | Their inherited/returned/member protocols and dangling-reference protections remain individually tracked. Resource retention here does not promote arbitrary XML/package/model removal to supported. |
| Enums/helpers/untested APIs | Complete neutral enum symbols/aliases, typed length/color helpers, null/inheritance and APIs without collected source tests remain obligations at their existing dispositions. No unrelated row is excluded, renamed or marked implemented. |

The format spec remains Proposed with `Implemented Through: Not applicable`:
its full contract exceeds this bounded utility milestone. Additive F44 behavior
is recorded without changing the historical full-model/version evidence.
Reference project provenance stays in existing research records and standalone
legal notices; these are original tests/assets and no material was copied.

## Failing-tests-before-code evidence

- Initial 18 original unit cases ran before product code: 16 failed, primarily
  missing exported removal implementation; rejection assertions were tightened
  with subsequent valid reference graphs and stable error-code cases.
- Three new original shell integrations failed before implementation with
  unsupported-profile/usage mismatches for whole structures and scalar ranges.
- Required-cell paragraph properties and already-empty no-op cases failed before
  their corrections; the later staged paragraph display-position case failed
  with 2 instead of 1 before refreshing receipts from the staged index.
- Screenshot review exposed overlong help lines; three width cases failed before
  splitting the removal guidance into readable lines. An intermediate full run
  caught those same three failures; the corrected final rerun is recorded below.
- All unit mutations use memfs or original in-memory fixture/byte helpers.
  Exact retained strings/properties/parts are asserted. No downloaded fixtures,
  reference runtime, native build, networking or product ambient I/O is involved.

## Validation and QA

- Maintained DOCX workspace tests: full run passed 143 files / 2,958 tests before
  the final receipt refinement; final full run recorded below.
- Final focused removal/discovery/public portable exports: 50/50 pass, including
  28 removal cases and a bundled browser runtime with no external imports.
  Final help refinement adds three more passing removal cases (31 total);
  final removal/discovery focused run passes 51/51.
- Safe-bash original removal integration: 3/3 pass with actual VFS scripts,
  binary pipelines, explicit marker intent, exact retained Unicode/properties,
  dry-run and unchanged destinations on boundary rejection.
- Maintained safe-bash test:runner: 515/515 pass, zero skips. Its discovery
  assertion explicitly includes the newly added test file.
- A broad safe-bash npm test invocation was interrupted after discovering that
  positional filenames are additive to all discovered tests. It is not counted
  as a pass; the bounded integration and maintained runner checks above replace
  that unintended broad execution.
- Maintained selected workspace build closure, DOCX lint/types, root ESLint and
  spec checker results are recorded below after completion.

Manual QA steps (executed by the agent):

1. Generate the real parsed paragraphs-remove help with the maintained terminal
   screenshot route and inspect `output/docx-removal-qa/paragraphs-remove-help.png`.
2. Check plural command name, common selection/output flags and marker inclusion,
   and confirm rejection/resource-retention limits are visible and readable.
3. Keep screenshots disposable and uncommitted. No screenshot tests or QA scripts.

## Remaining coverage

Affected annotations, notes, fields, revisions and graphics require explicit
resource operations or reject under this task's declared policy. General
cross-container joining, resource garbage collection, ordered utility batches,
full live content owners and whole-public-API/format coverage remain pending.
Deterministic dummy text, sanitization and all subsequent pipeline tasks remain
pending. Delivery is local commits only; no push or release is authorized.

Independent read-only worker review found no concrete defect in the bounded
removal, selection/schema and publication behavior. No later task was started.

The final screenshot was regenerated and visually inspected: readable plural
command, common selectors/destinations and explicit endpoint/marker/refusal
guidance. The first oversized screenshot was replaced with the improved output;
QA PNGs remain disposable and uncommitted.

## Final verified task state

`implement: done`, `test: done` for this task only. The shared pipeline receives
only this task's two status changes; unrelated existing changes remain unstaged.

| Maintained/check route | Final result |
| --- | --- |
| `npm test --workspace=docx` | 143 files, 2,966 tests pass, zero skips |
| `npm run lint --workspace=docx` | Pass, including production/test TypeScript checks; existing unused-variable warning retained |
| `npm run lint:eslint` | Pass (exit 0), guarded root traversal completed; existing warnings retained |
| `npm run build:workspaces -- --workspace=docx` | Pass, maintained selected portable dependency closure; no native targets |
| `npm run test:runner --workspace=virtual-bash` | 515/515 pass, zero skips |
| Focused shell removal integrations | 3/3 pass on final code |
| Existing public export/browser closure regressions | 2/2 pass on final code; built `poe-code/docx` export verified |
| Final removal/discovery checks | 51/51 pass (31 removal cases) |
| Spec checker / whitespace check | Pass, zero spec warnings |
| Manual terminal screenshot | Regenerated and visually verified; QA files unstaged |

One atomic feature commit includes owned product/tests, shared schema/discovery,
the normative F44 refinement, this mapping/check record and only the selected
pipeline status hunk. No remote delivery or release is claimed.
