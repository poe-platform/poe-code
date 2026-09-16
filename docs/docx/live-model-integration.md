# Live model integration evidence

Only the table/section/review milestone is implemented. The historical API and
test inventories remain research provenance; no full-format denominator or
source-runtime pass is promoted. Exact scoped table and section overlays are in
[table evidence](table-model-api.md) and [section evidence](section-model-api.md);
[review evidence](review-model-api.md) records comments, hyperlinks and cached
page-break behavior, including inherited owners and source-guide typo handling.

## JavaScript and security mappings

| Contract              | Implemented mapping                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Admission/publication | Async Document(input?, explicit context?), save(explicit sink); no implicit paths/network                                        |
| Model access          | Synchronous admitted owner operations; mutations use existing XML/domain engine                                                  |
| Document blocks       | Paragraphs/tables and ordered iter_inner_content; sections partition content                                                     |
| Collections           | Zero-based live at/index/iteration/slices; utilities retain declared one-based selectors                                         |
| Ownership             | Shared package/part/style identities, stable sibling handles, stale removed owners; complete transaction rollback                |
| Styles                | Existing neutral styles/font/formatting types bound to same archive; lazy definition creates original Normal                     |
| Comment metadata      | Readonly comment_id and fresh Date timestamp or null; author/initials writable, no id/date aliases                               |
| Comment ranges        | Whole admitted run endpoints and descendants; reject cross stories, overlap and forbidden field/control content                  |
| Links                 | Stored address/fragment/history and run traversal; targets inert, no resolution/network                                          |
| Cached breaks         | Detached paragraph fragments; whole split hyperlink precedes boundary, source remains unchanged                                  |
| Typed batch           | Explicit declared member registry and checked document-owned handles; no callback/eval or guessed reflective public surface      |
| CLI                   | Existing shared batch engine calls same SDK; plural resources/text replace/common flags/selectors/JSON/status contracts retained |
| Publication           | One guarded archive publication, cumulative owner budget, caller ceilings may only narrow; failed edits publish nothing          |

Run.style and Run.mark_comment_range are supported with existing bodies. General
Document settings/inline_shapes/add_heading/add_page_break/add_section and
Run.iter_inner_content remain neighboring pending APIs, explicitly discoverable
as unsupported. Existing enums/helpers/style/package public interfaces keep their
separate mapped implementations. Public \_Cell/\_Row/\_Column/\_Rows/\_Columns and
\_Header/\_Footer are retained; no Rows/Columns/Header/Footer aliases are invented.
D03 uses table_direction, and guide comment id/date typos use comment_id/timestamp.

## Verification

Original acceptance uses only small original in-memory/memfs XML packages.
No downloaded documents, cloned binaries, native office runtime or implicit
network was used. Focused tests reproduce owner rollback and publication errors
before fixes. The maintained docx unit/lint/build and CLI screenshot results are
recorded below when complete. QA procedure and ownership are in the
[integration plan](../plans/docx-live-model-integration.md).

Maintained `npm run lint --workspace=docx` passes (one existing type-only unused
variable warning in operation-types.test.ts). The explicitly selected maintained
`npm run build:workspaces -- --workspace=docx` passes its five-build dependency
closure, including portable filesystem output; no office runtime was executed.
Focused discovery tests pass all 33 cases, and all seven closed registry cases
pass. The earlier full run exposed stale support expectations and help drift;
these were corrected without removing public unsupported-API coverage.

CLI screenshot QA: inspected `/tmp/docx-live-model-qa/help.png` and
`help-wide.png` produced by the maintained screenshot route. The existing human
formatter uses 140 columns; a 150-column terminal displays the detailed header
operation, receiver, argument names and shared flags/statuses without clipping.
The default 120-column transcript display introduces terminal wrapping. This is
exact public detailed-help transcript display; root bash plugin registration and
native document rendering are not claimed. No image/fixture is committed.

- Help transcript SHA-256: `1405923f8d69ed00676a79b697cf55260df12769442b8d2f5e6282d352f87a7f`.
- 150-column screenshot SHA-256: `e8083e8e7fbc4d1e1229787dff2e1b6f936618dfb1fb9277ae698a92df9bb871`.

The live graph and SDK-backed CLI bindings are one atomic feature with shared
constructor/import ownership and cross-layer original regressions. Only explicit
owned paths and their evidence/plans are staged; unrelated work and later tasks
remain pending. Delivery is local main only, without push or release.

Final maintained `npm run test:unit --workspace=docx`: 194 files passed,
3,620 tests passed, four existing cross-format CLI cases skipped (3,624 total),
138.60 seconds. No new skips or failed cases. Local commit delivery only.

Verification correction, 2026-09-15: the skips are PPTX validate and DOCX tables
list, unscoped diff and public-engine cancellation in cross-format-cli.test.ts.
Independent schema QA is a separate maintained route with pinned schema/native
validator requirements; the four skips do not represent that route. See
[the task verification](table-section-review-verification-20260915.md) for current
checks, original new red/green evidence and remaining gaps.
