# DOCX contract reconciliation

Task: `reconcile-upstream-contract` only, 2026-09-14, on `main`.
Documentation/research only. Local commit only; no push or release.

## Ownership and boundaries

Owned files: `docs/specs/docx.md`, this plan,
`docs/docx/contract-reconciliation.md`, and
`docs/docx/contract-reconciliation-verification.json`.
Root AGENTS.md applies; no scoped instructions exist under docs.
The already modified pipeline plan and unrelated archive move remain untouched
and unstaged. No README, product implementation, tests or binary fixtures change.
Status remains Proposed and Implemented Through remains Not applicable.

## Review and validation procedure

1. Read both shared contracts, the format spec, both format test/API audits,
   DOCX inventories, API reconciliation, API map, command coverage and test map.
   Parse all records and reconcile identities, not just totals. Preserve their
   existing pending implementation dispositions.
2. Before editing, assert original behavioral adaptation is permitted in section
   1, section 9 uses the shared empty-selection spelling, exact text cardinality
   is required, and detailed model semantics exist. All four checks failed on
   the starting spec. This is documentary defect evidence, not a product red test.
3. Reconcile all F01–F50 against discovered public behavior and retain additive
   standards/security requirements where source tests are absent. Record original
   acceptance examples and future owners in the research table. Verify the
   cached-break and hyperlink edge conventions against pinned source text.
4. Amend the single proposed spec. Keep per-member signature/error/ownership
   records in the existing API map and the exact language/security decisions in
   the research reconciliation; do not invent method aliases from guide typos.
5. Validate every existing API/command feature reference and source-case identity;
   check every feature has a reviewed assessment and every added owner exists in
   the pipeline. Check all 23 discrepancy decisions have original acceptance
   targets. Hash the unchanged input evidence and record exact denominators.
6. Run the write-spec skill checker on the format spec, repository-installed
   Prettier on the four owned files, `git diff --check`, and local Markdown-link
   checks. Review checker warnings semantically. No maintained product build,
   unit, workflow or screenshot route applies to this documentation-only change.
7. Review explicit staged paths, commit this one atomic reconciliation with a
   Conventional Commit, then verify the committed file list and unrelated status.
   Never stage the pipeline's preexisting changes. No later task is completed.

## Required extensions to pending tasks

This is an additive handoff to the existing task IDs, not a second format spec.
The authoritative behavior is in docx.md sections 9, 9.1 and 9.2. Every acceptance
case below is planned, not written or executed. Before any owning task implements
behavior, write the original failing in-memory test and record its actual failure;
only then implement and run maintained scoped checks. If a foundation task adds a
later-owned behavior, move the associated red cases forward before writing code.

| Pending owner                                                                                                  | Additional acceptance obligation                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finalize-command-contract`                                                                                    | Carry the refined spec and the receipt’s 18 supplemental API feature associations into exact grammar/schema/help and register entries; reject missing/conflicting first/all/occurrence even for a unique match, distinguish allowEmpty from invalid selection, and distinguish explicit CLI pixel conversion from native sizing. No new common names or aliases. |
| `sdk-live-object-model`, `sdk-collections-values`, `sdk-async-capabilities`, `sdk-xml-package-views`           | All 1,337 API-map rows, inherited/protocol/helper/enum and untested public APIs remain required; test safe integer/half-away conversions, null versus omission, async bytes admission, copied values, explicit authority and bounded returned views. Owner/node equality replaces incidental Python wrapper identity.                                            |
| `story-text-extraction`, `field-structure-and-results`, `hyperlinks`                                           | Cached breaks before/after all content, multiple breaks, a break inside a hyperlink, detached fragments and unchanged input XML; internal fragment-only URL is empty, external address and separate fragment concatenate without normalization. Distinguish cached breaks, hard breaks and field results.                                                        |
| `table-construction`, `table-cell-updates`, `merged-cell-operations`, `sdk-table-section-review-api`           | Leading/trailing omitted grid slots, horizontal repetition, vertical continuation, alias-visible edits, nested block order, required terminal paragraphs, rectangular content/width combination and atomic rejection of partial-overlap merges. Split requires independent original cases.                                                                       |
| `sections-and-page-settings`, `headers-and-footers`                                                            | Three-section recursive inheritance across all six variants; model getter creation versus byte-identical CLI reads; unlink/relink, shared-owner edits versus occurrence clone/rebind, display flags retaining definitions, orientation not swapping dimensions.                                                                                                  |
| `styles-and-headings`, `sdk-style-and-format-api`, `run-formatting`, `paragraph-formatting`                    | Inheritance versus direct false, bounded cycles, missing-name errors versus dangling reads, next-style self fallback, defined/latent null differences, name/ID distinction, complete font flags, typed line spacing, tab movement and stale XML handles.                                                                                                         |
| `multilevel-numbering`                                                                                         | Original two-instance shared-definition scenario with independent restart, start override and level/style references; invalid level/missing target/cycle failure; retain referenced picture bullets on removal. Eight mapped source cases do not establish complete coverage.                                                                                    |
| `classic-comments`                                                                                             | Contiguous multi-run anchors, empty/cross-story/nested/header/footer refusal, rich paragraph/table/image body, nullable ID lookup, empty/default versus null text, explicit time and initials removal; no erroneous aliases.                                                                                                                                     |
| `image-inventory-extraction`, `raster-image-insertion`, `sdk-image-format-api`, `image-occurrence-replacement` | Every pinned image header/edge binding plus original unequal-DPI and missing-one-axis cases; all listed formats including TIFF endian paths; malformed/truncated offsets and limits; owned bytes, SHA-1 compatibility, inert links, native/single/two sizes and preservation of replacement extents.                                                             |
| `typed-document-properties`                                                                                    | UTC offset normalization and second precision, invalid assignments, missing/invalid stored dates, 255-code-point boundary, strict strings and positive-only revision writes despite zero reads.                                                                                                                                                                  |
| `adapt-upstream-opc-xml-images`, `adapt-upstream-text-style-document`, `adapt-upstream-tables-bdd`             | Residual completeness audit only; do not postpone original red cases from the first task implementing the behavior. Retain every parameter and example identity plus explicit equivalence/difference evidence.                                                                                                                                                   |
| `whole-api-acceptance`, `audit-upstream-test-completeness`, `behavior-and-coverage-audit`                      | Reconcile all inventories and F01–F50, including no-source-test APIs and preserve/reject subsets. No wrapper-name exclusion, no research pass counted as target conformance.                                                                                                                                                                                     |
| `retire-disposable-qa-fixtures`                                                                                | Delete only authorized disposable inputs after meaningful behaviors are reduced to original in-memory regressions; retain provenance, mapping and required standalone MIT notices. This task deletes nothing.                                                                                                                                                    |

## Results

Validation results are recorded in the verification receipt. Product red/green
tests, schemas, CLI screenshots, rendering, corpus cleanup and every later task
remain pending. The spec checker passed with zero warnings.
