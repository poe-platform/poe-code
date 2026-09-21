# DOCX corpus structure QA

Scope: execute only downloaded structural qualification against current source;
no product code, README, push, release or neighboring implementation tasks.
Shared contracts: `docs/specs/docx.md`, `office-cli.md`, `office-sdk.md` and root
`AGENTS.md`. Historical evidence does not establish a current pass.

## Procedure

1. Record HEAD, source-tree hash, manifest/API inventory hashes and environment.
   Download every manifest source into repository `/out/docx-structure-20260921` (host `/out` is read-only); verify size
   and SHA-256 before admitting it. Changed/unavailable downloads are unrun,
   never silently replace a pin. Downloads and outputs are disposable.
2. Independently census ZIP/XML structures with Python zipfile/ElementTree.
   Use fresh budgets per operation. Execute admission, inspect and text under
   default limits. If limits reject a dense source, rerun under explicit large
   limits (512 MiB expanded, 2 GiB retained, 5 million nodes, 8 GiB work).
   Record default and large separately; never change product defaults.
3. For every admitted source execute unchanged round trip and a real selected
   edit. Select existing core title metadata when present: set original QA text,
   preserving every other metadata subtree and all other parts. If no title
   exists, choose a measured body split-run text match, table cell, field cache,
   section property or note with an explicit selector; record the actual choice.
   No structural feature is inferred from a document title.
4. Independently validate final ZIP CRCs, XML well-formedness, content types,
   internal relationship target existence and duplicate IDs. Compare member sets,
   exact bytes and SHA-256 of untouched parts; prove the chosen edit and rehash
   source after all operations. Report package structural validity, not full
   OOXML schema/layout/renderer conformance.
5. Classify pass (assertions executed), reject (document/profile/limit refusal),
   fail (unexpected error/invariant failure), unrun (not executed with reason).
   Admission alone is not inspect/edit success. At least two measured dense/large
   sources must pass both round trip and edit; otherwise task remains incomplete.
6. Every new meaningful finding gets a small original in-memory unit regression.
   Reproduce failures before any code change; product fixes are outside this task.
   Existing matching regressions are linked explicitly. Never retain downloaded
   binaries, full extracted reports or copied external behavioral assets as tests.
7. Run maintained DOCX unit/schema/lint checks covering owned changes. Keep compact
   evidence under `docs/docx`, durable specification changes under `docs/specs`.
   Remove temporary downloads/helpers/logs after evidence extraction. Commit only
   explicitly listed owned files on main with Conventional Commits; no empty
   commits, hook bypass or co-author. Do not push or release.

## API and contract boundaries

Read `docs/docx/upstream-api-audit.md` and the complete JSON inventory. Utility
`properties.set` uses common operation options/JSON, plural resource paths and
stable codes; this is distinct from neutral model `core_properties.title`.
Bytes map to Uint8Array, factory/load/save remain async, in-memory reads remain
synchronous, dates use explicit UTC context, I/O uses explicit capabilities,
SDK collections are zero-based versus one-based CLI selectors, null means
absence/inheritance. Model text assignment is destructive; `text.replace` is
preserving. Public `.element`/`.part` map to bounded XML/package views.
Inherited members, enums/aliases, collections/protocols, helpers, APIs without
external tests and publicly documented underscore-prefixed types remain in scope.
No corpus result changes any inventory disposition or proves whole API coverage.
Historical corpus status fields describe their dated run/retirement, not current
availability. The fresh receipt supersedes historical execution claims only for
this campaign; later tasks stay pending.

## Exact scoped mappings and drift dispositions

| Surface                               | JS/security mapping                                                                                                                                                                           | Evidence/disposition                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `properties.set`                      | `await editDocumentProperties(Uint8Array, { operation, name, value, output }, context)`; `name: "core:title"`; explicit stdout byte sink, signal and budgets; no ambient file or clock access | Real corpus title changes plus original preservation regression; command schema discovery passes |
| Neutral model `core_properties.title` | Synchronous string property on a live owner; no second object-model naming alias                                                                                                              | Corpus utility evidence does not promote model/inherited inventory entries                       |
| Admission versus semantic validation  | `await readDocumentArchive` can succeed while later text/save/edit throws `SemanticValidationError` with `code: "invalid-package"` and `style-next-type` diagnostics                          | Measured before original regression; ordinary command exit 1, not a successful edit              |
| Work capacity                         | `DocumentBudget` host ceilings are explicit; fresh ledger per operation; caller limits only lower; `limit-exceeded` maps to ordinary exit 4                                                   | Default/large runs remain separate; no default change                                            |
| Bytes/publication                     | `Uint8Array` source, async byte sink; unchanged source hashes and zero sink writes on semantic rejection                                                                                      | Original in-memory regression plus independent ZIP/XML final comparison                          |
| Snapshot/collection authority         | Utility locations are owner/fingerprint snapshots; CLI positions are one-based, model sequences zero-based with `.length`, iterator, `.at`/`.slice`; keyed lookup stays keyed                 | No corpus claim about complete live collections, returned objects or cross-owner import          |
| Public graph                          | Neutral retained spellings, inherited members, enums and aliases, helpers, protocols and public underscore-prefixed returns remain documented obligations                                     | Inventory unchanged; absence of external tests is not exclusion                                  |
| Documentation drift                   | Historical acquired/retired/not-run fields are dated observations; fresh response-pin failures and current semantic refusals supersede only campaign execution status                         | Pins/signatures remain unchanged; no repair, invented alias or whole-API promotion               |

## Execution

The [fresh receipt](../docx/corpus-structure-qa-20260921.json) and
[qualification report](../docx/corpus-structure-qa-20260921.md) record the campaign.
14/23 source pins were reacquired; nine changed/unavailable downloads are unrun.
Eleven sources passed all operations, including two dense large-profile cases;
two auxiliary-part packages rejected and one admitted source later semantically
rejected. Independent final package/preservation checks passed for every successful
output. Existing original regressions cover historical boundaries. Measured
`style-next-type` refusal was reproduced before adding an original memfs regression
for admitted text/round-trip/metadata refusal without sink writes; 5/5 focused
corpus regressions pass with no product implementation changes.
Maintained DOCX unit verification passed all 252 files / 5,191 tests on the
single-worker rerun, including the new regression. The initial concurrent run
had two five-second timeouts; both passed without timeout increases or product
changes. Final DOCX lint passed with one warning. Shared schema/capabilities
discovery and documentation formatting passed. All 14 downloaded inputs, 22
successful output packages, temporary helpers and logs were removed after compact
evidence extraction. The owned local commit completes only this task.
Optional native schema cases are unrun: the pinned schema-root prerequisite is
absent. No full schema/renderer coverage is claimed.
