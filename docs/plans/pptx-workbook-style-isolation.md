# Workbook dependency and styling isolation

This increment owns `packages/pptx/src/chart-editing-preservation.test.ts`, this
plan, and the dependency wording in `docs/pptx/workbook-evidence.md`. Root
AGENTS.md applies; there is no scoped AGENTS.md in these directories. No adapter
or root implementation changes are needed. Existing working changes remain
outside this commit.

Authority: `docs/specs/pptx.md` F36–F38, `docs/specs/office-cli.md`,
`docs/specs/office-sdk.md`, both upstream audits/inventories, and the workbook
case/API ledgers. This is additional original security/preservation evidence,
not another parity claim or execution of the whole implementation pipeline.

Procedure:

1. Author small in-memory presentations with an external chart formula, an
   embedded worksheet formula plus opaque binary part, and an external workbook
   relationship. Independently verify fixture admission and inventory.
2. Exercise public SDK functions and the shared CLI command engine with memfs.
   Reject dependent data replacement before publication, including dry-run;
   retain existing destinations and caller input bytes.
3. Permit local chart styling. Compare every non-chart part's bytes, the complete
   retained embedded workbook, and chart XML with only the requested style added.
   Thus formulas, cache values, relationships and opaque bytes stay unchanged.
4. Run the focused file, maintained pptx test/lint, and verify existing workbook
   ledger pointers. Commit these explicitly named files on main without pushing.

The corpus manifest was consulted. This focused preservation check uses original
memory fixtures; no corpus files need acquiring, modifying, shipping or deleting.
There are no CLI grammar/output or product implementation changes, so no new
visual rendering claim or screenshot is needed. No README or legal material is
changed; no implementation/assets were derived from reference projects.

Observed results: the initial worksheet fixture omitted its binary content type
and correctly failed package admission. After correcting the original fixture,
all 21 tests in the focused file passed. No production defect was reproduced;
no runtime fix is claimed. The new three parameter cases each cover SDK inventory,
SDK/CLI safe styling, rejected data writes, and byte preservation. CLI also
covers rejected dry-run and no publication callback invocation.

The 180-case workbook ledger and 190-member API ledger remain authoritative for
exact source parameter/scenario dispositions and JS/security mappings. Existing
unsupported live-model APIs, inherited members and underscore-prefixed types
remain visible. This increment does not invent a spreadsheet adapter capability.
Maintained package checks and final commit receipt are recorded below.

Validation: `npm run test --workspace=pptx` passed 128 files / 3,640 tests in
35.67 seconds on the live working tree, including unrelated pending image work;
this is not a clean committed-archive certificate. The 21-test focused file
passed again after correcting a test-only typed-array backing-buffer mismatch.
`npm run lint --workspace=pptx` passed ESLint and both TypeScript configurations.
All 920 JSON pointers in the existing workbook case/API ledgers resolved (540
case pointers and 380 API pointers). Full API parity and nested spreadsheet
dependency inventory remain incomplete. No push or release is authorized.
