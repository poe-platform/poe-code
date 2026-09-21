# Independent analysis tool protocol stress

## Procedure

Use the authenticated Gnumeric 1.12.61 source in `out/ssconvert-lifecycle/gnumeric-1.12.61` and the captured profile `docs/ssconvert/analysis-tool-profile.json`. Read `src/ssconvert.c`'s `run_tool_test`, moving-average calculation in `src/tools/analysis-tools.c`, and `src/tools/dao.c` output preparation/admission. Native utilities are separate QA oracles; none are spawned by these unit cases.

Execute `npx vitest run packages/ssconvert/src/analysis` to run original in-memory fixtures. Verify labeled heading style with formulas retained and materialized; check unlabeled and nonheading cells as negative controls. Select a 128-row sheet and reference a larger explicit source to test clipping, exact 128-cell admission, rejection at 127 cells, and moving-window bounds before clipping. Remove the explicit sheet qualification to verify the invalid range produces no input. Reference 257 source columns and verify only the selected sheet's 256 columns are emitted.

Root owns maintained workspace build/lint/test routes, engine/CLI integration, native differential QA, screenshots, and exact final candidate qualification. Those gates must be recorded separately from this focused stress run.

## Verified findings and fixes

- Labeled moving-average headers lacked italic style. A new failing regression observed `undefined` against `{ italic: true }` before the fix. Gnumeric `analysis-tools.c` sets italic before the heading expression. The runner now preserves italic with both `formulas:yes` and `formulas:no`; unlabeled headings and subsequent cells remain negative controls.
- The runner rejected output exceeding the selected sheet dimensions, and charged the cell budget for cells the native DAO would discard. A new failing regression rejected an explicit 129-row source with a selected 128-row sheet and a 128-cell output budget. Gnumeric `dao_adjust` clamps dimensions, `dao_prepare_output` copies the selected sheet dimensions, and `adjust_range` drops out-of-sheet cells. The runner now admits actual clipped output and retains full input height when deciding moving-window validity. Independent horizontal clipping and invalid unqualified input cases pass.

## Run accounting

September 21, 2026: focused uncached Vitest analysis directory run passed 40 tests in four files. The new independent stress file passed three tests; existing runner stress passed 11, protocol independent stress passed 16, and protocol integration passed 10. These are deterministic semantic checks, not performance measurements. Tests allocate no disk fixtures, query no models, and spawn no native oracle.

One intermediate directory run had 37 passes and one failure in root's newly added selected-sheet range regression; root investigated and fixed preparation before the final 40-test passing run. This failed intermediate run is not a pass.

## Remaining limits

This agent did not independently run the native binary, full workspace gates, screenshots, realm/checkpoint/replay runtime cells, or deployed adapters. Such cells remain unverified here. Built-in numerical execution still implements only supported moving-average variants; other catalog tools, graph output, standard-error output, and moving-average variants 1 through 4 reject as unsupported. Catalog/property preparation coverage does not certify numerical output for those tools. No universal Gnumeric parity or bounded performance claim follows from these tests.
