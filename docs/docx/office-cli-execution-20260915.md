# DOCX Office CLI bounded execution — 2026-09-15

Executed the [paired agent QA procedure](../plans/office-cli-qa.md) interactively
against built DOCX commands with an explicit MemoryFileSystem rooted at `/work`,
bounded streams, limits and fixed creation timestamp. The [raw receipt](office-cli-execution-20260915.json)
retains exact commands, exits, JSON/text, original input hashes, retained part
hashes and audit hashes. No saved QA runner or screenshot suite was introduced.

Baseline source revision was `e79ce0251da8d6817eed60a59520916adb0879fb` with
unrelated dirty DOCX changes. The selected DOCX build closure passed; the Shell
adapter used existing built output and was not freshly rebuilt or certified in
this task. Interactive module dependencies remained cached across later builds;
baseline receipts are not post-fix results. Fresh subprocesses and focused tests
verify the owned changes. A query-suffixed index import also retained cached
dependencies and was discarded for post-fix verification.

No document engine receives ambient host I/O, network, fonts, identity, clock or
native runtime authority. Host writes are limited to these evidence files and
disposable screenshots. Original tiny SDK-authored documents, tagged template,
merged table and PNGs replace publisher inputs; nothing was downloaded or cloned.
There are no owned publisher documents or cloned binaries to clean up.

## Observed cases

`passed` means the stated bounded observation, not every variant in the plan.
`partial` identifies a remaining setup, recovery or documentary boundary.
Original failures remain visible even after an owned fix.

| ID  | Status                | Observation                                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q01 | passed                | Bare creation exit 0; no invented dated properties; inspect and partial validate exit 0.                                                                                                                                                                                                                                                        |
| Q02 | passed                | Explicit original DOTX admission succeeds; retains DOTX content types despite `.docx` destination suffix.                                                                                                                                                                                                                                       |
| Q03 | passed                | Rich body text has two Draft matches; header and hyperlink remain excluded/untouched; SDK text agrees.                                                                                                                                                                                                                                          |
| Q04 | passed                | All replacement changes two styled body matches; unrelated part bytes and untouched styles retained; CLI/SDK output bytes equal.                                                                                                                                                                                                                |
| Q05 | passed                | Occurrence 2 and first-only edits each affect the intended one match in rich input.                                                                                                                                                                                                                                                             |
| Q06 | passed                | Three image occurrences with owner positions.                                                                                                                                                                                                                                                                                                   |
| Q07 | passed                | Two unique resources; owner association counts two and one.                                                                                                                                                                                                                                                                                     |
| Q08 | passed                | One selected occurrence changes hash; extents and other owners retained.                                                                                                                                                                                                                                                                        |
| Q09 | passed                | Explicit shared edit changes both owners of the selected resource, retaining extents.                                                                                                                                                                                                                                                           |
| Q10 | failed then corrected | Incapable adapter rejects 3 before publication; original JSON wrongly included planned manifest/locations. Original red test reduced the defect; fresh built retry has null data and empty locations. Consent without directory fails 3; consent plus precreated directory succeeds with exact hashes. Injected mid-publication variants unrun. |
| Q11 | passed                | B2 returns the expected logical cell.                                                                                                                                                                                                                                                                                                           |
| Q12 | passed                | Plain `--text` assignment changes B2 to Harbor 🌊; independent read retains other cells.                                                                                                                                                                                                                                                        |
| Q13 | passed                | Properties list and title get succeed.                                                                                                                                                                                                                                                                                                          |
| Q14 | passed                | Plain title flags and explicit in-place intent succeed.                                                                                                                                                                                                                                                                                         |
| Q15 | passed                | Explicit boolean false remains false; new custom property without type rejects 2.                                                                                                                                                                                                                                                               |
| Q16 | passed                | Explicit custom property removal succeeds.                                                                                                                                                                                                                                                                                                      |
| Q17 | partial               | File and inline bindings fill original tagged text control; empty bindings reject 2; code-like string remains literal. Repeated/ambiguous/expansion variants unrun. DOTX retained.                                                                                                                                                              |
| Q18 | passed                | Shared property batch file and inline JSON succeed; unknown argument field rejects 2. Semantic rollback variants unrun.                                                                                                                                                                                                                         |
| Q19 | partial               | Original recipe omitted required scope and returned 2; corrected `--scope package` returns equal 0. Recipe corrected, no default invented.                                                                                                                                                                                                      |
| Q20 | partial               | Original omitted scope and returned 2; explicit package scope returns successful difference 1.                                                                                                                                                                                                                                                  |
| Q21 | passed                | Tool capabilities available without input.                                                                                                                                                                                                                                                                                                      |
| Q22 | passed                | Input-aware capabilities available. No exhaustive per-operation behavioral certification.                                                                                                                                                                                                                                                       |
| Q23 | passed                | Leading-dash, spaces and Unicode path works after `--`; JSON-before-terminator variant unrun.                                                                                                                                                                                                                                                   |
| Q24 | passed                | Explicit binary document stdin reads same text.                                                                                                                                                                                                                                                                                                 |
| Q25 | passed                | Operations stdin with VFS document succeeds.                                                                                                                                                                                                                                                                                                    |
| Q26 | passed                | Competing stdin owners reject usage 2 without waiting.                                                                                                                                                                                                                                                                                          |
| Q27 | partial               | Binary create-to-text pipeline succeeds; no package banner observed. Individual pipe statuses/other binary mutation variants unrun.                                                                                                                                                                                                             |
| Q28 | partial               | Dry-run replacement reports effects without writes or destination. Invalid-destination/sentinel variants unrun.                                                                                                                                                                                                                                 |
| Q29 | partial               | Dry-run stdout destination returns JSON without package publication. Invalid-destination variants unrun.                                                                                                                                                                                                                                        |
| Q30 | passed                | Explicit first-only in-place replacement succeeds.                                                                                                                                                                                                                                                                                              |
| Q31 | passed                | Fresh returned image token selects correctly; combining token/ordinal rejects 2.                                                                                                                                                                                                                                                                |
| Q32 | partial               | Intervening in-place property edit invalidates old fingerprint; stale token rejects 1 without write. Diagnostic red test reduced terse recovery; fresh-token retry sequence unrun.                                                                                                                                                              |
| Q33 | passed                | Missing match rejects 1; explicit allow-empty succeeds 0.                                                                                                                                                                                                                                                                                       |
| Q34 | passed                | Conflicting, omitted and repeated cardinality/flags reject 2.                                                                                                                                                                                                                                                                                   |
| Q35 | partial               | Merged covered B2 rejects ambiguous selection 1; independent unmerged B2 works. Original generic diagnostic was terse; a focused red test reduced recovery guidance. No arbitrary alternative chosen.                                                                                                                                           |
| Q36 | failed then corrected | Help aliases agree. Original root help lacked introductory common examples and had a 538-character line. Two red tests reduced defect; built help now starts with plain workflows and wraps at 140 characters.                                                                                                                                  |
| Q37 | passed                | Nested image help exposes selection, shared intent and output flags.                                                                                                                                                                                                                                                                            |
| Q38 | passed                | Versioned text replacement input/result schema exposes literal operation and cardinality.                                                                                                                                                                                                                                                       |
| Q39 | passed                | Version aliases agree without document input.                                                                                                                                                                                                                                                                                                   |
| Q40 | passed                | Explicit package scope and missing comparison input produce comparison trouble 2/source-failure.                                                                                                                                                                                                                                                |
| Q41 | failed then corrected | Legacy image rejected 2 with no recovery spelling. Four original red tests cover image/table/metadata/replace; built diagnostics now recommend plural resources/text replace and root help.                                                                                                                                                     |
| Q42 | passed                | Cell help exposes B2, owner selectors, destructive assignment and output rules.                                                                                                                                                                                                                                                                 |
| Q43 | partial               | Missing image selection rejects 2 without write; fresh location success observed separately in Q31, full ordered retry unrun.                                                                                                                                                                                                                   |
| Q44 | passed                | One binding JSON stdin owner fills VFS DOTX, retaining its kind.                                                                                                                                                                                                                                                                                |
| Q45 | passed                | Competing template/document stdin rejects 2 before consumption.                                                                                                                                                                                                                                                                                 |
| Q46 | partial               | Force does not authorize output/input alias: conflict 1, original preserved. Second VFS path identity alias variant unrun.                                                                                                                                                                                                                      |
| Q47 | failed then corrected | Invalid scope rejects 2; original generic diagnostic gave no recovery route. Red test reduced defect; built error names `--scope` and `docx help text get`, without supplied-value leakage.                                                                                                                                                     |
| Q48 | passed                | Lowered xmlDepth breaches at 4; duplicate/unknown/raised limit names reject 2.                                                                                                                                                                                                                                                                  |
| Q49 | passed                | Table schema agrees with B2/covered-owner help. All 1,517 actual declarations represented in discovery; unsupported behavior remains visible.                                                                                                                                                                                                   |

## Verification and screenshot observations

Original focused failures preceded each code change: four legacy cases, two
recovery cases, two root-help cases, one extraction envelope case and one ambiguous-selection case. The
[owned procedure](../plans/docx-office-cli-usability-qa.md) records reductions and
checks. Maintained DOCX tests, scoped lint and the selected workspace build closure
were run after each improvement. Final maintained `npm test --workspace=docx`: 177 files passed, 3,436 tests
passed and four skipped. `npm run lint --workspace=docx` passed with one existing
type-only-variable warning at operation-types.test.ts:20.
`npm run build:workspaces -- --workspace=docx` passed its five-build closure.
Scoped installed Prettier, local evidence links and Git whitespace checks passed.

Maintained `npm run screenshot` exercised built discovery/errors; its
`terminal-png` renderer also rendered captured built Shell output. Inspected root
and nested help, cell help, ordinary edit, schema error, stale and ambiguous
selection errors, legacy before/after and extraction failure. Disposable files
are under `screenshots/docx-office-qa-20260915`; no image binaries are committed.
The root `screenshot-poe-code` invocation started a broad build and was cancelled:
DOCX is a virtual command. Wrong internal-export import and initial incomplete
limits were QA setup errors, corrected before inspection. Screenshot rendering
is a terminal observation, not document application rendering or font fidelity.

Root help now leads with plain creation, text replacement, cells and properties.
Common edits use flags without JSON; advanced property batches and template data
use closed schemas. Selectors are discoverable through help/schema and tokens.
Legacy, invalid-flag and stale diagnostics now give recovery actions. Ambiguous
selection now advises inspecting and choosing an unambiguous owner/location;
publication diagnostics remain terse. Ordered recovery and
injected failure observations remain pending rather than claimed complete.

## Exact mappings and remaining scope

The [mapping review](office-cli-qa-review.md#exact-js-and-security-mappings)
retains neutral snake_case model spellings separately from camelCase operation
options; always-async admission/save/media versus synchronous admitted model
access; zero-based live SDK sequences with length/iterator/at versus one-based
CLI selectors; keyed collections; distinct null/false/zero/empty values; safe
integer units (914400/in, 360000/cm, 36000/mm, 12700/pt, 635/twip) with half-away
rounding; copied UTC Dates versus utility timestamp strings; owned Uint8Array;
scoped ownership/invalidation and bounded XML/package views; explicit capabilities
without evaluation/host/network; per-axis image DPI fallback 72 and compatibility
SHA-1 versus evidence SHA-256. No new model aliases or helpers are invented.

All inherited members, enum values/aliases, helpers, collections, public returned
underscore-prefixed types and APIs without source tests remain in public scope.
The complete inventories were read/parsed. Their planned/historical case counts
are research accounting, not executed acceptance. No whole-public-API completion
claim follows from 1,517 discoverable declarations or the passing unit suite.
Schema pattern suspicion was checked with actual RegExp behavior and was not a
validated defect; no change was made. Bounded BMP admission rejection does not
establish an insertion API expansion task.

All PPTX counterparts were not run in this task; the separate
[historical PPTX receipt](../pptx/office-cli-execution-20260913.md) retains its own
limited scope. Cancellation, injected source/sink/publication failures, exhaustive
SDK behavior, repeated/ambiguous template expansion, transaction/collision
variants, large/corpus documents and native rendering remain unrun. Maintained
tests are verification evidence, not substitutes for those agent observations.
Later tasks remain pending. No push or release is authorized or performed.

## Local delivery

Owned usability commits on main: `5de4bd53c` (legacy paths), `d2d99dbf0`
(diagnostic recovery), `ddf6791db` (root help), `adb633b6a` (extraction error data).
Ambiguity guidance is `f11606f11`; the final evidence commit is reported in the
delivery response.
All commits stage only owned files/hunks and relevant procedure updates. Unrelated
dirty work remains untouched. Remote-main delivery and release were not attempted.
