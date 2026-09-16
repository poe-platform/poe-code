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
