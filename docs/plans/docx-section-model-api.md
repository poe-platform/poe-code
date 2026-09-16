# Live section model API

Owned scope: `packages/docx/src/section-model.ts`, its original test, and
`docs/docx/section-model-api.md`. Shared model-store and Document integration
belong to the parent agent. No later task, README, external corpus or runtime
work is authorized by this bounded delegation.

Read root instructions, the three office/DOCX specifications and the four
required API/test audit/inventory resources before implementation. The inventory
retains public underscore-prefixed _Header/_Footer obligations. Those are exposed
as the documented neutral _Header/_Footer classes, including their inherited block-container
members and part access; naming alone does not narrow the public API.

## TDD record

The first targeted run of `npx vitest run packages/docx/src/section-model.test.ts`
failed on the missing live Document model import, before section model code was
written. Tests use only original authored XML and a memfs Volume; no publisher
binaries or ambient I/O occur. The acceptance boundaries include live indexed
sequence behavior, section-owned ordered blocks, missing length versus zero,
nullable setters, enum values, policy flags and all six story slots.

## Exact language and security mappings

- Sections uses `length`, numeric indexing, `at` with negative indexes, `slice`,
  iteration, `count`, throwing `index`, `includes` and `reversed`. All indexes
  are zero-based; utility selectors remain one-based. Invalid types are
  InputTypeError and absent sequence values are BoundsError.
- Section snake_case properties remain primary. Values are immutable typed
  lengths, nullable missing XML attributes and retained enum symbols. Twip
  serialization uses the common integer-EMU/halfway-away rounding mapping.
  Orientation does not silently swap page dimensions.
- _Header/_Footer retrieval does not create a part. Container/part/element reads
  that require a definition retain the documented creating getter effect:
  inherited definitions are resolved recursively, creating the first section's
  definition only when no ancestor provides one. Explicit unlink creates a
  blank local definition; it does not clone inherited content.
- CLI section/story reads retain the existing noncreating utility queries.
  Their common plural paths and camelCase operation options are independent of
  model snake_case spelling. The shared model store owns the same archive and
  XML domain engines; no independent competing editor is introduced.
- XML and part access use the owner's bounded public views. Synchronous admitted
  edits require no file, native process, implicit clock or network capability.

## Agent QA procedure

1. Run the targeted original section model test after Document integration.
2. Verify each story slot links, creates a required empty paragraph, shares
   inherited writes, explicitly unlinks into a blank definition and relinks.
3. Run maintained package lint and the package tests with parent integration.
4. Record executed evidence in docs/docx and commit only the owned files with
   the parent-owned relevant plan integration. Do not push or release.

## Executed bounded validation

The integrated targeted section suite passes all 27 original tests (1,210ms total; individual cases remain fast),
including every nullable distance, each retained orientation/start enum, numeric
indexes and reverse/slice/membership protocols. Owned source/test ESLint passes.
Package test compilation reports no owned section errors. Parent-owned
maintained integration checks remain the final precommit authority.

The intermediate-package graph failures were reproduced by all six creating
story tests. The shared store now offers transactional staged writes; story
creation/relinking use those transactions. Relinking proves direct section-ID
sharing and other relationship targets before removing the local relationship
and orphan definition. Removal also clears matching content-type overrides and
owned definition relationship parts. Unrelated shared resources remain intact.

The source test description referring to odd/even policy while manipulating
`titlePg` is not a new API alias: `different_first_page_header_footer` remains
first-page policy, and the Settings even/odd policy remains separate.

Maintained package checks and parent integration/owned commit delivery are still
pending. The bounded pass is not whole-public-API conformance evidence.


## Exact overlay and additional reds

The owned evidence table expands each of the 45 scoped historical API rows:
four owner types, 34 members (including three inherited/returned part views),
and seven inherited/direct sequence protocols. The section-file research test
closure has 93 records and the section-guide closure has 36 scenarios; those
are not product-pass counts. Public _Header/_Footer inheritance and missing
source tests remain represented explicitly.

Additional original failing cases preceded each correction: `includes` was
missing, ranged `index` ignored start/stop, missing null-set geometry containers
were not retained, and enum-bound _Header/_Footer constructors selected the wrong
story. The setter-container test also specifies removal of default/new-page or
null section-start storage. The original style-container failures were reported
to the parent and repaired through the shared paragraph owner, without a second
editor. Every orientation/start/story-index enum, all geometry members,
null/zero/signed values, wrong types, lexical boolean variants, all six linked
slots and both rich containers now have independent original acceptance.

## Parent-requested shared-owner review

The parent subsequently assigned read-only review of shared ModelStore,
block/Document owners and batch integration, with regressions owned in the section
model test. No parent-owned source was edited. Original concrete reds identified:

- Identical retained paragraph siblings were rebound by lexical matching when
  the first paragraph was replaced. The retained first handle incorrectly read
  the second sibling's original text.
- Creating the missing style owner in a failed transaction restored the archive
  but left the lazy binding pointed at the removed part.
- Deleting an existing retained style in a failed transaction restored XML but
  failed to restore style tokens, detaching a previously valid retained style.
- A missing style getter created an empty stylesheet rather than the original
  default paragraph Normal definition already authored by document creation.
- Unstyled run append incorrectly created a missing stylesheet. Detection uses
  the actual styles relationship, not a fixed allocated filename.
- Typed batch accepted a named live Sections index selector but runtime resolution
  supported only arrays, rejecting an admitted selector.
- Adding a table to a header/footer already ending in a table returned the prior
  table. Mutating the returned new table changed unrelated existing content.
- Rollback of lazy styles replaced the package owner object, splitting retained
  part owner identity from the document's current owner.

The independent mutable-width test passes: caller mutation of a declarative
2-inch batch width to 5 inches during asynchronous admission does not change the
admitted physical width. The operation boundary captures owned values and maps
them to immutable Length values.

These regressions remain in the original small test file; parent corrections
use the same format engines. The final owned rerun passes all 27 original tests (1,210ms total), and owned
ESLint passes. The parent also reports passing 12 package-view rollback tests
alongside the section suite. Maintained full package validation and commit
delivery remain the parent's final authority. No later task, host/native QA,
implicit network, README, ignored fixture, commit or push was performed here.


## Final owned result

All parent-requested original review regressions now pass against the repaired
shared store, including stable package identity. The parent implemented the
same-owner package checkpoint, tracked XML replacement/insertion reconciliation,
style owner/token checkpoints, original Normal getter creation, noncreating
unstyled append, live collection selector resolution and new-table return
selection. Owned source/test ESLint passes. The section suite has 27 passing
original cases; no source corpus count is promoted into a product-pass count.

Parent batch integration declares the section/rich-container operations through
the shared closed typed registry, including inherited part getters. The owned
semantic batch cases execute named collection selectors and captured physical
widths. Whole format/API and later tasks remain pending; no commit, push or
release was performed by this delegate. All four owned files are ready for the
parent's explicit staging with maintained checks and atomic integration commit.

Parent final maintained checks: all 194 docx test files pass (3,620 passing,
four existing skips); maintained docx lint and selected build closure pass.
Owned files are delivered in the local main feature commit; no push or release.
