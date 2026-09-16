# Built PPTX command QA receipt

Status: Partial execution with validated contract gaps; no product changes.

Authority: [agent procedure](../plans/office-cli-qa.md), [format contract](../specs/pptx.md),
[shared CLI](../specs/office-cli.md) and [shared SDK](../specs/office-sdk.md).
The [raw transcript](office-cli-execution-20260913.json) retains literal commands,
stdout, stderr, exit statuses, input hashes and explicit limits. No recipe was
replaced with a saved QA script. Commands were selected and inspected in an
interactive Node session. No reference runtime, native document renderer,
network, publisher download or binary cleanup was used.

## Build and admission boundary

Revision: `a2597a3e80b0a737e04ddc3e507adbe032654105`, on main with existing
uncommitted work. `npm run build:workspaces -- --workspace=pptx` passed its
declared dependency closure. The Shell and PPTX adapter were existing compiled
`packages/safe-bash/dist` artifacts; this run did not rebuild that workspace or
certify its source/build equivalence. The imported PPTX package used fresh dist.
This is workspace evidence, not a clean-commit or published-package receipt.

The Shell received only an explicit MemoryFileSystem, cwd `/work`, and an
explicit PPTX engine. No host filesystem/network adapter was supplied. Byte,
argument, XML, relationship and archive ceilings are in the transcript.
Repository reads, evidence writes and screenshot tooling were QA-host operations,
not document-engine capabilities. No ambient metadata was supplied to the SDK.

Original `createPresentation` input: two slides, with `Draft café 🌊` on each;
slide 1 also contains `Keep`, with both shapes named `title`. Coordinates are
integer EMUs, each box 1,000,000 by 1,000,000; the second shape starts at y=1,000,000.
This is a **simplified** text input: no split styles, hyperlink, notes or master
text. The separate table input adds an original 2-by-2 grid A/B/C/D at (0,0),
2 inches by 1 inch, through `addTable`. The first setup attempt omitted its
required box and correctly failed; the corrected explicit box was admitted.
No image or template assets were fabricated from publisher bytes.

## Case accounting

`partial` below means only the stated probe ran, not the full recipe. Every DOCX
counterpart Q01–Q41 is `not_run`; no paired conformance is claimed.

| Cases   | Status  | Observed result and limits                                                                                                                                                                                           |
| ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q01     | failed  | Creation and reopening with inspect succeed, zero slides; `validate` returns usage 2, unsupported operation. Full creation recipe cannot pass.                                                                       |
| Q02     | blocked | Template option probe returns 1, `unsupported-profile`, before template admission. No authored template success case ran.                                                                                            |
| Q03–Q05 | partial | Unicode text and all/second replacement succeed; reads show exactly two/one changed matches and `Keep` retained. Split-run formatting/hyperlink/excluded-scope checks not run.                                       |
| Q06–Q10 | not_run | Required shared/distinct image fixture not prepared in this run. Help alone is not image-operation acceptance.                                                                                                       |
| Q11–Q12 | failed  | Exact B2 recipes return usage 2: `Cell requires one-based row,column coordinates.` Recovery with `2,2` succeeds; SDK reads A/B/C/Harbor 🌊, with other cells unchanged. Recovery does not satisfy shared B2 grammar. |
| Q13–Q16 | partial | List/get title, in-place Unicode title, explicit boolean custom property and removal succeed. Full type-conflict/omitted-type and revision checks not run.                                                           |
| Q17     | not_run | Authored binding template and missing/duplicate-binding variants not prepared.                                                                                                                                       |
| Q18     | failed  | Exact shared property batch rejected via inline and file sources, exit 2: `Batch supports animation add, set and remove only.`                                                                                       |
| Q19–Q20 | partial | Equal diff returns 0/true; changed text returns 1/false with `ok: true`. Full retained-part expectations not independently compared.                                                                                 |
| Q21–Q22 | partial | Global/input capabilities return version-1 envelopes and explicit subsets. No exhaustive feature/schema-to-behavior census.                                                                                          |
| Q23–Q24 | partial | Leading-dash Unicode filename and binary stdin return the original text. JSON counterpart repetitions not run.                                                                                                       |
| Q25     | failed  | Operations stdin is read, but shared property batch returns the same unsupported-batch usage error.                                                                                                                  |
| Q26     | passed  | Competing stdin rejected with usage 2 and actionable ownership message.                                                                                                                                              |
| Q27     | partial | Create-to-text pipeline exits 0 with empty text as expected for an empty deck. Individual PIPESTATUS/transport byte checks not recorded.                                                                             |
| Q28–Q30 | partial | Dry-run returns two effects; dry-run plus binary destination/JSON succeeds; first-match in-place succeeds. Adapter races/failure injection not run. Reset-original token dry-run leaves the input hash unchanged.    |
| Q31–Q32 | not_run | Exact image selector recipes unrun. Supplemental text token probe rejects old fingerprint with 1 after an in-place edit, then accepts the same token against restored original bytes with one dry-run effect.        |
| Q33     | passed  | Missing text returns 1; `--allow-empty` returns 0 with zero effects.                                                                                                                                                 |
| Q34     | partial | Conflicting first/all returns 2 with corrective cardinality message. Omitted/repeated-scalar variants not run.                                                                                                       |
| Q35     | not_run | Merged-table variant not prepared; B2 failure alone cannot prove merge behavior.                                                                                                                                     |
| Q36     | partial | Root help aliases work; screenshot is very long and common edits occur well below initial usage. No fixed-width wrapping acceptance.                                                                                 |
| Q37     | passed  | Nested image replacement help explains one-based selectors, scopes, shared impact, defaults, formats and output flags.                                                                                               |
| Q38     | partial | Text replacement schema has version 1, dotted ID, closed options, scopes, cardinality and selector constraints. Complete per-operation result-schema validation not run.                                             |
| Q39     | passed  | `--version` and `version` match (`pptx selectors v1`).                                                                                                                                                               |
| Q40     | partial | Missing comparison input returns 2, `ok: false`, `data: null`, I/O code. Cancellation not run.                                                                                                                       |
| Q41     | failed  | All four legacy spellings reject with 2, but only say `Unsupported operation.` No plural/text-replace recovery hint.                                                                                                 |

Supplemental duplicate-title replacement returns 1 with two owner-scoped candidate
locations. This verifies ambiguity rather than silently selecting the first name.
The raw transcript includes two exploratory SDK invocation mistakes (not retained
as commands): corrected `readSelectionIndex(input, context)` argument order and
the explicit table box above. Neither is a validated SDK defect.

## Visual and usability observations

Inspected four disposable PNGs produced by the maintained `terminal-png` renderer
used by the screenshot script: `root-help.png`, `images-help.png`, `errors.png`
and `selectors-edit.png` under `screenshots/office-qa-20260913`.
These depict actual captured built Shell output, not invented help or tests.
The maintained `npm run screenshot -- --no-header --output PATH -- node ...`
route also freshly executed nested image help through the built Shell using the
recorded context and an empty MemoryFileSystem. Its `maintained-help.png` was
inspected and agrees with the captured nested-help image. No host file adapter
was granted to that Shell; the harness explicitly read only the recorded context.
Root help is a dense, tall reference listing; nested image help is substantially
easier to scan. Cardinality errors explain recovery; legacy-operation errors do
not. B2 errors suggest the currently accepted alternative but conflict with the
shared contract. Long JSON/token lines make very wide screenshots. The renderer
shows a missing glyph for the wave emoji although text bytes preserve it; this
is not evidence of PPTX text corruption or application rendering behavior.

Simple text/property edits need no JSON. Numeric-coordinate table edits also
need no JSON, but their grammar fails the shared contract. Advanced JSON is
discoverable through schema, yet the shared property batch is not supported.
No global usability/conformance pass is warranted. Product fixes and their
failing focused tests are deferred by the documentation-only task boundary;
the procedure retains concrete follow-up cases.

## Audit and language mapping reconciliation

Parsed every record in both required inventories and the target/case registers:
2,409 API records, 2,426 targets (17 additional bounded-view members), 2,700 unit
variants, 973 BDD examples and 3,673 central adaptation rows. These counts are
accounting, not executed coverage. The historical review's 2,407/2,424 totals
predate two builder-offset obligations; its hashes remain a historical receipt.
The untracked test audit/inventory belong to existing work and were not changed
or staged. Its “adaptation not started” sentence is a baseline statement, as
already reconciled by [the current register receipt](register-reconciliation-20260913.md).

The exact [J01–J10 mappings](api-language-mappings.md) and
[earlier mapping table](office-cli-qa-review.md) remain authoritative: neutral
snake_case model properties stay synchronous/live; factory, byte admission and
save are always async; keyword-only fields map to trailing typed options;
undefined selects defaults and nullable values remain distinct from false/zero.
Sequences use zero-based checked access, sparse placeholder keys stay keys,
and supported slicing explicitly includes step. CLI ordinals remain one-based.
Lengths use safe integer EMUs and halfway-away-from-zero rounding; UTC dates
drop subseconds without consulting a clock. XML/package views remain owned and
bounded, with no eval, arbitrary XPath or host access. Creating getters are not
read-only CLI queries. Typed errors keep the exact classes/codes in J08;
operation JSON remains camelCase, distinct from model spelling.

Inherited members, helpers, enums/aliases, collections and documented returned
underscore-prefixed types retain their obligations, including APIs without source
tests. No unsupported API was reclassified private. None of this command QA
certifies complete model acceptance. Existing downloaded documents and cloned
binaries were untouched; meaningful future cases require original small unit
reductions before any cleanup.

## Documentation verification

Scoped installed Prettier and `git diff --check` passed. All 27 local Markdown
links resolve in the workspace. Every one of the 2,409 API identities has a
target; all 3,673 source case pointers occur exactly once in the central ledger.
Recorded JSON operation envelopes have the shared fields, with null data and
zero affected count on failure. Discovery-schema output is a separate schema
document, not counted as an operation envelope. These are documentation checks,
not a product unit-suite run. No new unit tests were authored because no product
code changed. The raw receipt includes SHA-256 hashes of all four required audit
inputs and the built engine/adapter. Only this receipt, its JSON transcript,
the QA plan and historical review framing are owned by this change.
