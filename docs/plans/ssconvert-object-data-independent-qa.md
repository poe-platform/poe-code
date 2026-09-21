# Independent chart data and passive style QA

Procedure: run the original SDK negative controls in `packages/ssconvert/src/objects/data-independent.test.ts`, then the existing data-link and workbook-independent suites. Run the maintained ssconvert workspace lint route. These are in-memory deterministic tests; no native subprocesses, filesystem fixtures, network access or LLM queries occur in unit tests.

## Verified findings

Four SDK passive-metadata cases failed before the fix: a dimension beneath foreign-namespace data, a dimension beneath an image, a dimension beneath foreign-namespace GogObject, and a dimension beneath an opaque chart property. Each was incorrectly rewritten by sheet rename. The fix admits only Objects → matching-namespace graph → unqualified GogObject → unqualified data → unqualified dimension, and recursive unqualified GogObject children. Existing rename/resize/merge linked-dimension regressions still pass.

The original XML variants were first attempted but import drops these invalid schema children. That was fixture admission failure, not evidence of the rewrite defect. The minimized regression uses direct original SDK metadata, where all four failures reproduced before the fix.

Unknown and abstract chart data types remain unknown; literal data remains literal; qualified type attributes do not authorize formula parsing. Nested valid graph expressions update. Aborted rename preserves the exact cancellation reason; bounded rewrite and projection work reject without changing caller input. Qualified paint attributes stay passive; foreign font/gradient/Style children do not become schema values. External image URI remains a string with no I/O resolution. Wrong chart property types do not become GogStyle.

## Results

- Initial minimized regression: four failures, two passes (before fix).
- Final scoped deterministic run: 18 passes across three files: 9 independent cases, 3 existing chart rename/resize/merge cases, 6 existing workbook-independent cases.
- Maintained `npm run lint --workspace=@poe-code/ssconvert`: passed including the final cross-realm characterization and strengthened exact cancellation identity assertion. Root must qualify the final complete integration candidate.
- Intermediate object suite: 23 passes / 1 styles test failure while root's style implementation was incomplete. Root subsequently completed the style projection; this intermediate run is not a passing gate.

## Remaining mismatches and unverified cells

Cross-realm sheet-object projection succeeds, but sheet rename rejects foreign-realm imported metadata at the existing workbook snapshot prototype guard (`Unsupported workbook prototype`). The characterization test verifies that actual limit; it does not count cross-realm rename compatibility as a pass. Fix ownership lies outside this agent's assigned files.

No independent native differential, CLI screenshot, command exit-status comparison, full workspace unit route, maintained uncached build, full repository gate, immutable Git candidate, checkpoint/replay, or bounded performance measurement was performed by this reviewer. Root owns those integration checks. Exact Gnumeric object plugin matrix, rendering/printing fidelity, optional GOffice types, all codecs and opaque-payload behavior remain outside the coverage of this focused review. Unsupported or unmeasured cells are not passes.

## Registry and graph-export follow-up

Eleven additional original registry/rendering cases produced ten passes and one concrete initial failure: the chart-data registry outer map was frozen but its grammar descriptors were mutable. Freezing every descriptor fixes that defect. Mutation negative controls now fail to modify storage, type metadata, aliases or plugin arrays.

Graph export admits both direct graph spellings and rejects direct images, components, comments, shapes, widgets, prototype-name strings, foreign-namespace graphs and graph lookalikes nested under unrelated metadata. Cancellation preserves its exact thrown reason and bounded scan rejects before a later graph can authorize export. No new rendering defect reproduced.

Final focused follow-up: 23 passes across registry-independent (11), data-independent (9), and data-links (3). The original 18-pass run additionally covered six workbook-independent tests. Neither focused result is a completed workspace gate. Root's earlier full unit run observed the initial registry failure and must rerun after the descriptor fix; no earlier passing run certifies the new bytes.

Chart dimension fixture coverage is model-only. Direct data beneath GogGraph is not a measured native dataset layout, and these tests make no native chart compatibility claim. Registry immutability checks verify passive declarations; the plugin census is not an activated dependency profile or complete import/export/render/print behavior matrix. No native render, optional plugin activation or actual drawing fidelity was independently measured.

## Working-tree input bindings

These hashes bind the final reviewer edits and currently inspected inputs, not a frozen committed candidate. Root may subsequently change its owned files; refresh bindings for final qualification.

- `packages/ssconvert/src/objects/data.ts` SHA-256 `510113e15eb88a3fd0e12d32215b93ab921084cff136603990939cd279c9d855`
- `packages/ssconvert/src/objects/index.ts` SHA-256 `5b80534a9c66e38f0c52d9caa96bb2cc8a5f875822e2894c4af05d891e5063bb`
- `packages/ssconvert/src/objects/registry.ts` SHA-256 `2301fce5b3543f40e4aabf7bb0cd01be4954e6c824bdf51b81edd88328f617c0`
- `packages/ssconvert/src/rendering.ts` SHA-256 `7248ea9820ffffd3649959d16b361321c82000462721a7b0e167dae143a23ebb`
- `packages/ssconvert/src/formulas/workbook.ts` SHA-256 `eebf7b11693431efb70e11eeb8a030bbdd0f45d473ca007b3bf681f7b45d753d`
- `packages/ssconvert/src/objects/data-independent.test.ts` SHA-256 `1053734a881c2f36f7a0372181b1afec9a88277f44434716f6ea05e04f689b02`
- `packages/ssconvert/src/objects/registry-independent.test.ts` SHA-256 `0cd412b06c2312a60cc91dceaecb45801c227961bb9df9cedcd7a1ba4f6710f8`
