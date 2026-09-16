# PPTX workflow example accounting and QA

Status: Inventory reconciliation and bounded table/text-frame assertions recorded.
Full workflow parity and rendering are not verified. This task does not execute
the whole pipeline, push, release, download fixtures or edit a README.

## Scope and evidence

Apply root and scoped ownership instructions, `docs/specs/pptx.md`,
`docs/specs/office-cli.md` and `docs/specs/office-sdk.md`. Domain behavior belongs
in `packages/pptx`; safe-bash integration belongs in its owned adapter/test scope.
Use original TypeScript cases and memfs, independent expected values and explicit
capabilities. Every exposed operation needs SDK and CLI coverage. Preserve neutral
model spelling, plural command resources, shared selectors/envelopes/statuses and
typed schema/batch routes. No arbitrary model evaluator, host paths, native/font
runtime, network or copied artwork is an acceptable testing shortcut.

The research ledger `docs/pptx/workflow-example-accounting.json` retains exactly
973 expanded BDD rows from all 54 features, including exact example parameters and
pointers to every expanded step. It also retains all 83 nonempty guide headings
and 74 literal snippet locations/hashes from the 15 inventoried guide topics.
Heading rows and snippet rows overlap: their sum is not a count of unique
workflows. Installation, introduction, licensing, glossary and navigation headings
are context, not executable product scenarios. Other headings remain visible even
when they contain no literal code block.

The canonical 2,700 unit variants remain in `test-case-map.json`; this new ledger
does not replace or complete those obligations. Whole API coverage remains in the
public/API registers, including inherited members, enums, helper values, collection
protocols, underscore-prefixed documented types and APIs without source tests.
The current API inventory has 2,409 objects: the audit narrative's 2,407 is a
historical checkpoint preceding the two documented freeform offset additions.
All original 719 candidate IDs remain retained. These mixed record counts do not
measure implemented coverage and must not be presented as a parity percentage.

Candidate evidence links use exact inventory identities or feature file/line
matches in existing research ledgers. A ledger link, historical status or test
filename is not a passing assertion or workflow equivalence certificate. Every row
retains its canonical recorded status without treating that status as current
execution. Until reviewed, its SDK/CLI parity remains explicitly unverified.

Research provenance is the pinned revision in `upstream-test-inventory.json` and
`upstream-api-inventory.json`. Reference identities belong only here, in research,
and in required standalone legal notices. Retain `upstream-license-notice.txt` for
substantial derived research; tests use newly authored wording and XML/assets.
The audited published/pinned version and documentation errors remain governed by
`api-reconciliation.md` and J01–J10 in `api-language-mappings.md`; do not reproduce
erroneous prose-only members as new APIs or suppress legitimate public members.

## Review and original regression procedure

1. Resolve each ledger pointer into its original expanded preconditions, action,
   expected clauses and exact parameter values. Read corresponding step semantics;
   a feature title is insufficient. Retain null, false, zero, empty text, negative
   values, Unicode/control characters, units and collection distinctions.
2. Write original fixtures with the smallest relevant XML graph and memfs bytes.
   Assert SDK public returns, live ownership and exact independent serialized
   values. Write a failing case before correcting a validated product defect.
3. Run the exposed direct CLI or typed batch route using the same semantic input.
   Assert independent XML/package results plus common operation ID, affected
   count, exit status, selection and preservation. Byte equality with SDK output is
   supplementary, never the sole assertion. Include executable safe-bash scripts
   where the workflow composes commands.
4. Record each exact assertion group, expanded parameter equivalence and actual
   maintained-check receipt. A partial assertion stays partial. Do not promote
   related collection/getter coverage to complete guide or workflow coverage.
5. Commit each verified atomic improvement with only explicitly named owned files
   and this relevant plan. Root coordinates shared accounting and review. Report
   local commit hashes separately. Do not push or release.

## Renderer-dependent QA — not run

The best-fit scenario at `upstream-test-inventory.json#/bdd_cases/858` allows a
10pt or 11pt outcome due to host fonts. The original deterministic design in
`test-case-map.json` uses explicit supplied metrics and expects exactly 10pt,
`auto_size = NONE` and wrapping. Passing that semantic mapping cannot prove the
same visual layout. No native or host-font dependency belongs in the unit suite.

The visual examples for shape arrangement, fills/lines, images and cropping,
placeholder insertion, bullet/character formatting, table merging and charts
also require renderer comparison if appearance is claimed. The structural BDD
assertions do not become renderer tests merely because they create these objects.
Media metadata cannot establish playback; hyperlink metadata cannot establish
external navigation, and no external action is to be activated by the product.

For a separately executed QA campaign:

1. Select only disposable cached originals listed in
   `docs/pptx/corpus-manifest.json`, checking cache path, bytes and SHA-256 before
   use. Keep downloads immutable, preserve original credits, and edit an owned
   disposable copy. No fixture or embedded asset is committed or redistributed.
2. Record renderer version/platform and exact supplied font availability. Render
   both unmodified source and edited output with the same renderer. Record a
   missing renderer, font or fixture as blocked/not run, never as a pass.
3. Inspect screenshots of the affected slides and neighboring content: text
   wrapping/overflow, table boundaries/merged content, image extent/crop, chart
   labels/axes/colors and placeholder geometry. Distinguish opening, structural
   validation, rendering and human visual inspection as separate results.
4. For fit-text, record measured original/output point sizes and overflow; test
   absent explicit metrics separately as a visible capability failure. Do not
   infer renderer equality from font metadata alone.
5. For any meaningful failure, reduce its structural cause into an original
   minimal TypeScript regression with new text/assets and exact expectations.
   Keep screenshots and downloaded inputs disposable; retain concise evidence
   and original regressions. If the cause is rendering-only, record that limitation
   without manufacturing a fast unit-test pass.

Current QA result: not run. No renderer version, font inventory, corpus edit,
visual pass, playback pass or full guide-workflow pass is claimed by this plan.

## Bounded implementation receipt

The new SDK table suite has 23 passing tests, including all 34 expanded table,
cell and column scenarios. Exact test groups and parameter equivalence are in
`docs/pptx/workflow-coverage-tables.json`. The focused command was
`npx vitest run packages/pptx/src/table-workflows.test.ts` (197ms test duration).

The new safe-bash suite has 17 passing tests, run with
`node --import tsx --test packages/safe-bash/tests/commands/pptx/workflow-examples.test.ts`
(final namespace-aware run: 1.394s total). Maintained safe-bash typecheck passed
with 26 consumer groups. Seven table scenarios now have reviewed SDK model and CLI evidence:
six true/false style toggles and the 1.5in column width (1,371,600 EMU). The other
27 table scenarios retain SDK-only new evidence; collection interface checks are
not silently equated with CLI detached records. Fifteen text-frame rows have SDK
operation/CLI evidence for four autofit modes, four margins, three wrap states and
two getter/setter text values. Their live-model workflow assertions remain
outstanding. Independent ZIP/XML assertions supplement SDK/CLI byte equality.

Exact boundary mapping is retained per row. Margins 0.1/0.2/0.3/0.4in serialize as
91,440/182,880/274,320/365,760 EMU. Wrapping true/false/null serializes as
square/none/absence; autofit null/none/shape/text produces no autofit child or the
single noAutofit/spAutoFit/normAutofit child. Original three-character and
three-paragraph text replaces source wording while retaining line boundaries.

The public Presentation save/reopen table test uses byte-operation creation as
an explicit alternative workflow. `Slides.add_slide` and `SlideShapes.add_table`
are absent at the initial assertion checkpoint; the new test does not complete those
documented guide recipes. The table batch attempt returns usage exit 2 with zero
publication: batch currently admits animation operations only. That original
rejection regression does not count as supported general table batch behavior.

Accounting validation resolved all 973 distinct source identities, canonical
expanded-step pointers and candidate ledger pointers, plus all guide references
and 74 pinned snippet hashes. The 83 heading rows are a topic superset and overlap
the snippets. This static validation is separate from tests and does not imply
that unreviewed workflow or guide rows pass. Maintained scope-wide checks and
local commit ownership remain root's final delivery responsibility.

Local assertion commits reported separately: SDK `58b17ee45`, safe-bash
`67d5ce691`. Neither is a push or release. A subsequent live table creation
implementation is separate work and needs its own passing receipt; the missing
creation-method finding above describes the assertion checkpoint.

## Subsequent live table creation

Local commit `9040152fd` implements synchronous `SlideShapes.add_table` with
13 original SDK tests and two paired safe-bash cases. The exact expanded
creation row at `upstream-test-inventory.json#/bdd_cases/688` now has reviewed
model/CLI evidence; totals are 35 SDK model rows and eight paired model/CLI rows.
The 27 SDK-only rows and 15 operation/CLI rows retain their narrower status.
See the [method receipt](../pptx/table-creation-model-evidence.md).
`Slides.add_slide`, broader workflow coverage and renderer QA remain outstanding.
