# DOCX Office CLI agent QA — 2026-09-21

Executed the [Markdown procedure](../plans/office-cli-qa.md) interactively against
built DOCX and the existing built Shell adapter. Baseline `3fc19d4b0` on main.
The requested procedure had been removed by historical cleanup commit
`314ba0299`; it is restored with current boundaries and all Q01–Q49 recipes.
[Exact probes and semantic checks](office-cli-qa-20260921.json) retain arguments,
expected/actual exits, stdout/stderr, input fingerprints and decoded part hashes.
The [shared CLI](../specs/office-cli.md), [shared SDK](../specs/office-sdk.md) and
[DOCX](../specs/docx.md) specifications govern this bounded task.

## Observations

All 86 recorded probes returned their expected exits. This includes an initial
Q17 unknown-binding attempt with incorrectly shell-quoted JSON: it tested JSON
syntax rejection only, not binding lookup. The separately labeled corrected
attempt confirms unknown binding rejection. Setup mistakes in SDK image inspection
and screenshot hashing were corrected; they are neither product defects nor passes.

| Cases   | Observed scope                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q01–Q02 | Minimal creation, validation and inspection succeed; minimal creation has no core metadata. Template creation retains DOTX content type despite a DOCX output suffix.                                                                                                                                                                                                                                                                  |
| Q03–Q05 | Text/get agree; all, first and second occurrence replacement work across styled split runs. Reopened all-replacement reads `Final café 🌊 Final`, bold remains true, header remains `Draft header`. Only document XML changes. Hyperlink variant is unrun.                                                                                                                                                                             |
| Q06–Q10 | Three image occurrences share two resources/hashes. One-occurrence replacement changes only the first; shared intent changes both shared occurrences. The distinct resource and 12700-EMU widths remain unchanged. Extraction refuses without transaction/partial consent (3); explicit partial consent succeeds with safe filenames and a manifest.                                                                                   |
| Q11–Q16 | B2 get/set succeed without JSON input; reopened cell is `Harbor 🌊`. Only document XML changes. Title uses direct name/value flags; typed custom boolean false and removal work. Missing custom type returns usage 2 with help guidance.                                                                                                                                                                                               |
| Q17–Q18 | Original tagged plain-text template fills from its declared record schema. File/inline/stdin property batches publish identical bytes; unknown fields reject. A later absent table edit aborts an earlier property edit without publication.                                                                                                                                                                                           |
| Q19–Q22 | Equal/different diff return 0/1 with successful data; capabilities explicitly report unsupported routes, unknown namespaces and actual host constraints. No complete model or format claim follows.                                                                                                                                                                                                                                    |
| Q23–Q30 | Unicode/space/leading-dash paths, document and operation stdin, binary edit-to-text pipe and conditional in-place work. Competing stdin rejects 2. Dry-run needs no destination and allows JSON with proposed binary stdout. Existing sentinel destinations reject 1 and remain unchanged.                                                                                                                                             |
| Q31–Q35 | Fresh image token works; mixed selectors reject 2. An intervening property edit invalidates the old token; rejection preserves the intervening bytes, freshly listed token retry succeeds. Missing literal rejects 1; allow-empty is unchanged success. Cardinality conflicts/omission/repetition reject 2. Covered merged B2 refuses 1 without substituting coordinates.                                                              |
| Q36–Q49 | Help aliases and version conventions agree; nested image/cell help exposes selectors and publication rules. Schema IDs/options are explicit. Failed diff returns 2. Singular resources/top-level replace give plural/path recovery. Unknown scope and lowered/duplicate/unknown/raised limits return the expected 2/4 statuses. Template JSON owns stdin; competing template stdin rejects. Direct output alias rejects despite force. |

Every inspected JSON envelope has exactly the eight shared fields. Failed
prepublication envelopes have null data, zero effects and empty locations.
Direct reads have zero effects. Source bytes remain unchanged after this campaign;
sentinel, stale-failure and batch rollback checks are explicit in the receipt.
SDK preserving replacement dry-run yields the same changes as Q28. This finite
comparison is not per-operation SDK certification.

Common tasks require concise direct flags, including literal replacement,
logical B2 assignment and typed properties. Advanced original image replacement
also succeeds through a closed version-1 ordered JSON batch. The image collection
getter is discoverable via `help batch --operation
model.document.Document.inline_shapes.get`; no evaluated method strings are used.

## Validated usability correction

Image add/set/replace help contradicted current execution: it described live
image/drawing/collection owners as pending or unsupported and denied utility
batches that actually work. Four focused assertions failed before code, after
original memfs picture save/reload and image-byte checks passed. The new
[original regression](../../packages/docx/src/image-help-model-guidance.test.ts)
requires truthful support and an actionable typed batch discovery route; the
existing replacement contract assertion now reflects verified batch support.

Help now retains operation-specific limits while describing supported live
inline collections, admitted drawing metadata and image-part views. It points to
the collection getter's detailed help. Utility batch support comes from the
existing admitted-operation register. No new editing behavior, aliases, runtime
authority or unsupported API implementation was introduced.

Maintained verification passed: `npm test --workspace=docx` (254 files, 5,198
tests), focused tests (four files, 31 tests), `npm run lint --workspace=docx`
(zero errors, existing type-only-variable warning), and
`npm run build:workspaces -- --workspace=docx` (declared five-build closure with
shared cache and maintained dependency postbuild checks). The final help wording
retains direct PNG/JPEG-only insertion limits; focused tests, lint and build
were repeated for that wording correction. No full repository gate or fresh
Shell-adapter build is claimed. One initially supplied optional insertion-contract
filename did not exist and provided no test coverage.

Fresh-process built help for add/set/replace returns 0 with the new discovery
route. Inspected maintained terminal-png screenshots cover image/cell help,
common-task root excerpt, ordinary cell edit, stale/merged/missing-selection
errors and scope/schema error, plus corrected image help. The root
screenshot-poe-code route cannot reach the virtual DOCX command; the same
maintained renderer consumes actual captured built output directly. No wrapper,
screenshot suite or saved QA runner was added. Screenshots do not emulate an
80-column terminal; JSON/tokens are wide, and the wave emoji shows a missing
glyph despite correct reopened Unicode. Document page rendering is unrun.
Screenshot hashes and verification receipts survive owned temporary cleanup.
Absolute `/out` is read-only; disposable repository `out` storage was used.

## Exact language/security mapping and drift

Both full historical inventories were parsed and traversed: 920 API records,
262 nested enum values, 11 enum aliases, 23 documentation resolutions, 1,609 unit
variants and 650 BDD cases. Their hashes are in the receipt. These denominators
remain research identities, not new implementation passes. The current
[whole-public-API acceptance](whole-api-acceptance-20260921.md) supersedes stale
pending statements only where it links exact evidence. Numbering construction,
unqualified returned interfaces and unsupported public behaviors remain visible.
Inherited members, collections, helpers, enums, APIs without source tests and
underscore-prefixed public owners are never excluded by spelling.

| Mapping            | Exact contract retained                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Names/arguments    | Neutral snake_case model members and positional order; optional positions use undefined. Reserved package argument binds as owner_package. Utility JSON uses camelCase and CLI kebab-case. No blanket aliases.                                                                                                                                                                                                                                                                           |
| Values/lookup      | No coercion; null differs from false, zero and empty text. Nullable reads do not imply nullable writes. SDK sequences are checked zero-based, live length/iteration, explicit negative at and only documented slice profiles. CLI ordinals are one-based. Keyed styles/relationships retain keys, get/at/items; comment ID lookup is nullable.                                                                                                                                           |
| Units/enums/colors | Safe integer EMUs: 914400/in, 360000/cm, 36000/mm, 12700/pt, 635/twip; nearest rounding with half ties away from zero. Numeric line spacing is a multiple, Length is distance. Typed enum membership/XML mappings reject unknowns. RGB is exactly six ASCII hex digits, uppercase output.                                                                                                                                                                                                |
| Bytes/dates/images | Owned Uint8Array copies; copied UTC Date instants serialized at whole seconds. Image metadata is bounded and synchronous after async admission; per-axis native DPI falls back independently to 72. SHA-1 is compatibility metadata; SHA-256 is evidence identity.                                                                                                                                                                                                                       |
| Async/authority    | Document, image admission and save are always async; admitted model access is synchronous. Paths require supplied VFS/resolver capability, source/sink streams are explicit. No host/font/identity/network discovery or external-target dereference. QA fixture creation supplies fixed 2026-01-02T03:04:05Z. Current omitted model timestamp defaults to fixed 1980; this existing difference from proposed explicit-context wording is recorded without expanding this usability task. |
| Ownership/XML      | Live owner/node handles, explicit cross-owner import and deterministic invalidation. Read-only CLI queries avoid creating getters. Bounded XML/package views allow validated graph edits; no arbitrary XPath, eval, dynamic dispatch, dependency runtime or ambient resources.                                                                                                                                                                                                           |
| Errors/status      | Type/value failures map to usage 2; bounds/missing-key to missing-selection 1; ownership to conflict 1; stale handles to stale-selection 1; semantic invalidity to invalid-package 1; budgets to limit-exceeded 4; source/sink/permission/publication to 3; cancellation to 130. Diff uses equality 0, difference 1 with successful data, trouble 2, cancellation 130. Nullable lookup stays null.                                                                                       |

D01–D23 documentation/source resolutions remain authoritative in the
[reconciliation](upstream-api-reconciliation.md). This task resolves image-help
drift only. Shared plural images/tables/properties, preserving text replace,
selectors, common options, JSON, schemas/capabilities and exit statuses remain
unchanged; destructive model setters remain distinct. Whole-public-API and
whole-format acceptance are still incomplete.

All PPTX counterparts, exhaustive SDK counterparts, cancellation/injected I/O
and publication failures, transactional/collision extraction variants,
shared-header image edits, repeated/nested template expansion, hyperlink
replacement variant, second alias/symlink path, large publisher corpus and native
document renderer cases are unrun. No publisher inputs or cloned binaries were
acquired or cleaned up. No README edits, push or release; unrelated work is
preserved and later tasks remain pending. Local commit hashes are reported to the
user separately from remote delivery and releases.
