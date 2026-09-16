# Text/style/document adaptation: run breaks

Scope: `adapt-upstream-text-style-document` only. Main; local commits only.
Later tasks remain pending. Root AGENTS.md applies; no scoped instruction file
exists under packages/docx or docs. No README or disposable QA input changes.

Owned paths: packages/docx/src/block-model.ts,
packages/docx/src/structure-model-batch-operations.ts,
packages/docx/src/run-break-contract.test.ts, this plan,
and docs/docx/run-break-adaptation.json.

## Procedure and execution

Read the DOCX and shared Office contracts, both test audits, the DOCX test/API
inventories, API reconciliation and exact source-case crosswalk. The current
adaptation supplement only qualifies highlight serialization. Select the six
Run.add_break variants from tests/text/test_run.py at line 271, plus independent
alias/default, Unicode, false-formatting, stable-owner and invalid-input cases.
Use original tiny admitted XML and memfs publication; no reference runtime or
binary fixture is necessary. Tests contain no reference identity.

The valid original fixture produced 14 failures and three passes before code:
LINE incorrectly wrote type=textWrapping, all three clearing variants lost clear,
section enums and forged records were silently accepted. PAGE and COLUMN retained
correct break markup but formatting reads failed because inherited namespaces
were missing from the run fragment. The first exploratory run used an extra
argument unsupported by the fixture helper; corrected that test setup and reran
before making product changes. Only the corrected run is retained as red evidence.

Write exact attribute-free LINE and clear-only line variants; validate owned enum
symbols and reject section variants before editing. Formatting reads use the
existing bounded self-contained XML view so ancestor namespace declarations
remain available. The correction is limited to the reproduced run font owner.

Add typed batch publication acceptance. Correct its argument to the declared
camelCase breakType before treating any error as product evidence. The valid
transport value then failed with Expected a trusted break enum, establishing that
the registry must decode validated enum records into owned symbols before calling
the SDK. This decode follows the declared field type and canonical alias map.
The model keeps neutral add_break; the utility field remains breakType. No eval,
callbacks, networking, ambient files/time or second editing engine is introduced.

Run focused tests, maintained DOCX unit/lint and selected workspace build closure.
Record actual results and exact mappings in the evidence file. This correction
changes stored XML/model behavior, with no terminal layout or help changes.
Stage only the five owned files, inspect the index, and commit with hooks enabled.

Full residual case adaptation remains open; neither these six source cases nor
coverage measurements certify all document/style/story/comment/settings members.
No historical inventory status or later pipeline task is promoted by this commit.

## Verified result

All 18 original tests pass. Final maintained DOCX unit run: 202 files passed,
4,005 tests passed and four existing cross-format cases skipped, 142.31 seconds.
The earlier full run loaded the intermediate registry and reported the valid
batch regression; final code fixes that failure. Maintained package lint passes
with one unchanged type-only warning; selected workspace closure builds all five
declared tasks. No full repository test/lint or renderer qualification is claimed.

Commit the five explicit owned files locally on main only. The task remains open
until every residual obligation has passing exact evidence.
