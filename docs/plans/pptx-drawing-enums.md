# Drawing enum implementation

Atomic scope: `packages/pptx/src/drawing-enums.ts` and its original unit cases. Public drawing symbols retain documented numeric values, immutable alias records and bounded XML-token maps. Return-only mixed values have no editable XML token. The documented `PERCENT_40` spelling is retained.

TDD: the initial test run failed because the new module did not exist. The implementation then passed three behavioral checks; expanded independent fixed-value assertions cover 70 enum rows and retain 73 passing cases overall. Tests use only authored literal values and no filesystem/download/native dependency.

Verification: `npx vitest run packages/pptx/src/drawing-enums.test.ts` passed 73 cases in 5 ms at the focused checkpoint. Final maintained PPTX lint passed and the package unit run passed 2,760 tests across 96 files before commit. Enum name/value object metadata and public conversion helpers remain separately recorded API gaps; these numeric records do not claim that broader surface.

Commit only these explicitly named enum files and this plan after maintained checks. No push, release or empty commit.
