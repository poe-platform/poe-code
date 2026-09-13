# Notes graph regression verification

## Ownership and result

Owned files: `packages/pptx/src/notes-graph.test.ts` and this plan. No production source was changed. Existing graph behavior was verified with eight original in-memory cases, independently inspected through ZIP payloads and Saxes XML assertions. The first run exposed that deleting a slide while an opaque survivor exists is intentionally rejected; the final cases distinguish this safety boundary from deletion of an opaque notes part owned by the removed slide.

The cases establish:

- Duplication creates a private notes slide with reciprocal slide ownership, retains the shared master, and preserves body, slide-image, date and footer placeholder roles.
- Deletion removes the selected notes slide, its relationship part and content-type entry; another notes slide and the shared notes master remain byte-identical. Opaque content owned by the removed note does not block its deliberate deletion.
- Import copies two notes slides and their single shared master, preserving each reciprocal slide association and placeholder roles.
- Import rejects both source graphs containing competing notes masters and destination/source combinations requiring competing masters. Both inputs remain unchanged.
- Duplication/import reject opaque notes structures when remapping cannot be established safely. Deletion rejects opaque survivor structures that might conceal references to a deleted slide. These are explicit limitations, not support or preservation claims for a successful copy.

## Standards evidence and limitation

Microsoft's [PresentationML structure documentation](https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document) describes at most one Notes Master part per conforming package, with notes-slide and presentation relationships. The [NotesMasterIdList API](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.notesmasteridlist?view=openxml-3.0.1) exposes a singular `NotesMasterId` child, matching the schema's `maxOccurs="1"` constraint.

Therefore this work does not remove the competing-master import guard or emit multiple master-list entries. Existing graph-specific read/edit preservation on nonconforming packages is a separate concern; accepting an input for a preserving read is not a conformance claim. Source-theme import across competing notes masters remains unsupported until an explicit, validated reconciliation policy can preserve inherited appearance.

## Research accounting

Consulted `docs/pptx/upstream-test-audit.md`, `upstream-test-inventory.json`, `upstream-api-audit.md` and `upstream-api-inventory.json`. These supplemental graph cases extend the behavior behind `DescribeNotesSlidePart::it_provides_access_to_the_notes_master` and notes-slide creation/access cases with copy/remove/import lifecycle assertions. They do not count as complete adaptations of those public model cases, whose lazy creation, live collections, inherited placeholder geometry, enums and methods require their own API/domain tests. The master lookup and slide association assertions are independent of the reference implementation. No reference implementation code, fixtures, names or comments were copied into tests; no new derived-material notice is required for these original cases. Existing legal notices remain intact.

## Validation

- `npx vitest run packages/pptx/src/notes-graph.test.ts packages/pptx/src/slide-copy.test.ts packages/pptx/src/slide-removal.test.ts packages/pptx/src/slide-import.test.ts`: 89 tests passed across four files.
- `npx prettier --write packages/pptx/src/notes-graph.test.ts`: formatted owned test.
- Full package maintained checks are coordinated by the parent task, avoiding concurrent duplicate test/build work.

No downloads, native runtime, implicit host I/O, README changes, CLI visual changes, pipeline execution, commits, push or release occurred in this subtask. `docs/pptx/corpus-manifest.json` was consulted; disposable downloaded fixtures were not needed for the small graph regressions and are not dependencies or shipped assets.

## Independent notes domain and command review

Additional owned file: `packages/pptx/src/notes-review.test.ts`. Twenty-three independent original regressions verify ambiguous names, stale tokens even with `allowEmpty`, absent master relationships, duplicate notes associations, all-target add/set atomicity, actual per-note master resolution, and CLI scope validation before input reads. CLI cases also assert publication is never invoked on a failed multi-slide add and absent optional notes yield JSON null. The second-master read/edit fixture verifies byte preservation only on an existing nonconforming graph, not standards conformance or supported multi-master import.

Review reproduced runtime input-validation defects before production fixes: non-record options (`true`, `42`, arrays and inherited-prototype records) were accepted, and explicit falsy selections (`false`, `0`, empty string and null) silently became unfiltered reads. Each group failed four original parameter cases before the domain owner tightened validation. Four further cases proved that a non-record mutation selector was spread into a valid default selection and actually edited the sole slide; mutation preflight was assigned the same strict selector validation. A current opaque-token CLI notes-list case also verifies token selection is not accidentally combined with an implicit all flag. A direct foreign paragraph child was rejected at the profile gate; the final atomicity fixture uses a valid extension wrapper to reach the preserving-edit rejection. ZIP fixture inputs use the fixture archive helper and are asserted immutable directly; generated output assertions use the independent ZIP inspector.

- `npx vitest run packages/pptx/src/notes-review.test.ts packages/pptx/src/notes-graph.test.ts`: 31 original cases pass after the domain owner's validation fixes.
- `npx eslint packages/pptx/src/notes-graph.test.ts`: passed.
- `npx prettier --check packages/pptx/src/notes-graph.test.ts docs/plans/pptx-notes-graph.md`: passed before this review appendix; final owned checks coordinated separately.

The review only changed original tests and this plan, preserving domain and CLI ownership. It did not change production validation or relax opaque-content safety.
