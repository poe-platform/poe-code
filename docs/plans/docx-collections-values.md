# DOCX collections and values

Scope: `sdk-collections-values` only, main, local commits only. Later tasks remain
pending. Preserve the pre-existing working tree, including the pipeline plan.

## Ownership

Root owns this new plan, new `docs/docx/collections-values.md`, new original
collection/value tests, and changes to `formatting-values.ts`,
`formatting-model.ts`, `style-model-batch-operations.ts`, `operation-schema.ts`,
`operation-types.ts`, new `docs/docx/collections-values-map.json`, and the public
export line in `packages/docx/src/index.ts` as needed. No safe-bash
implementation, README, host capability expansion or second editor is authorized.
The independent `values_review` worker owns read-only research and final review;
root alone edits and commits.

## Agent QA procedure

1. Read root/scoped instructions, all three specs and retained API/test audits and
   inventories. Keep documented underscore types and unsupported owners visible.
2. Add original failing public enum protocol tests before implementation. Exercise
   all missing families, exact aliases, numeric/XML conversions, declaration order,
   immutable membership and transport/security distinctions.
3. Extend the existing value/collection types and typed model batch executor.
   Check negative indices, bounds, mutation invalidation and keyed lookup using
   original memfs owners. Do not add slicing where the documented API lacks it.
4. Run focused tests, maintained docx tests/lint/build closure and independent
   review. Record actual failures and successes under docs/docx. Inspect CLI
   screenshots if visible rendering changes.
5. Explicitly stage only owned files and this plan per verified atomic improvement.
   No push, release, ignored QA inputs, hook bypass or coauthor.

## Initial findings

The pipeline marks the earlier live-object task done, but its scoped evidence
explicitly leaves Document, table, section/story, comment and package owners
pending. Existing live types are Styles/LatentStyles, formatting and immutable
images/values. This task must not count utility operations as live owner coverage.
The first implementation increment completes enum values/protocols over the
existing enum transport representation and typed batch routes.

## Enum TDD and review

The first original run failed all twelve new enum tests. Independent review then
identified omitted batch value-alias names and forged-accessor/prototype-family
defects; new tests reproduced each before its correction. Final focused run:
four files, 38 passing tests, including 18 new original enum tests. The earlier
maintained run passed 180 files / 3,455 tests / four skips before the last three
security cases; a fresh maintained run is required for the final correction.

The review checked all 262 inventoried numeric values and XML mappings across
19 canonical families with no mismatches. Direct `.members` is an immutable
name-keyed record instead of the research register's proposed ReadonlyMap; batch
members retain the existing map entry encoding. This explicit JS security mapping
avoids exposing mutable Map storage. No inherited/underscore owner is excluded.

Final enum correction checks passed: maintained `npm test --workspace=docx`
(180 files, 3,457 passed, four skipped), maintained package lint and source/test
TypeScript checks (zero errors, one existing warning), and the explicitly scoped
maintained docx build closure. Independent final review found no remaining enum
blocker. Original CLI memfs JSON acceptance and inspected human-output screenshot
passed. Documentary formatting, all 262 unique evidence rows and owned whitespace
checks passed. No push or release.

## Collection ownership and reds

`c6e27953d` locally commits the enum increment; no push or release. The next
atomic improvement additionally owns `styles-model.ts`, new `model-errors.ts`,
new `numeric-index.ts`, and new `collection-value-protocols.test.ts` in
`packages/docx/src`. It extends existing live collections and immutable values.
Initial original collection run: nine tests, six failed and three passed. Missing
RGB lookup/tuple protocols, tab numeric semantics, iteration snapshot membership,
mapped removal and neutral typed errors are concrete failures. Existing units and
keyed/null/false/zero cases remain passing evidence, not reasons to rewrite them.

Further separate original reds reproduced reverse iterator shape, invalid numeric
properties, removed metadata, cross-view token invalidation, generator transport
cloning and enum value error exit 1 instead of usage exit 2. Each correction
extends the existing live type. Signed bracket lookup was preserved because the
established original suite explicitly requires it; primary `.at` remains the
documented negative-index mapping. No source slicing is added to TabStops.

Final focused collection candidate: eight files, 134 passed, including 21 new
original tests. Independent final read-only review found no remaining blocker
for this increment. The actual missing-target human CLI returned exit 1, bounded
diagnostics and no content leakage; the maintained general screenshot was
inspected with complete readable output. The initial lint's two unchecked-index
test annotations were corrected without weakening runtime assertions.

Final maintained collection checks passed: `npm test --workspace=docx`
(181 files, 3,478 passed, four skipped), `npm run lint --workspace=docx`
(ESLint and source/test TypeScript, zero errors and one existing warning), and
`npm run build:workspaces -- --workspace=docx`. The focused eight-file run passed
134 tests. Independent review, inspected human CLI screenshot, documentary
formatting and owned whitespace checks passed. This verified atomic increment
is ready for a local owned-files commit; no push or release is authorized.

The actual public export prerequisite probe returned exit 1 / `ok: false` for
Document, Sections, \_Rows, \_Columns, InlineShapes, Comments, ImageParts and
Relationships. These absent earlier-task live owners prevent complete collection
acceptance. The pipeline's working-tree statuses are unrelated and untouched;
this task and all later tasks remain pending. No placeholder collections or
competing editor were introduced, and no absent API was hidden as private.
