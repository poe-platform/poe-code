# Original DOCX unit fixtures

Task: `author-original-unit-fixtures` only. Implementation and fixture checks
complete on 2026-09-14. Later tasks remain pending, beginning with
`independent-structure-assertions`. The pipeline file already had unrelated edits;
this separate owned record reports this task without staging those edits.

## Owned scope

- `packages/docx/tests/fixtures/documents.ts`
- `packages/docx/tests/fixtures/documents.test.ts`
- `packages/docx/THIRD_PARTY_NOTICES.txt`
- `docs/docx/original-fixture-coverage.md`
- This plan/check record.

No package manifest, public exports, CLI adapter, editor or README is introduced.
The existing root Vitest configuration already discovers these tests. Packaging
and independently reusable assertions belong to later tasks. The fixture builder
uses the existing shared ZIP codec; it is not an independent ZIP oracle.

## Executed red/green evidence

1. Wrote the fixture acceptance tests before the helper. Running
   `npx vitest run packages/docx/tests/fixtures/documents.test.ts` failed with
   `ERR_MODULE_NOT_FOUND` for `./documents.js` (2026-09-14 00:47 local).
2. Implemented four original fixture themes and named variants. The initial
   16 tests passed.
3. Added the complex-field boundary assertion before adding that structure.
   The same command failed: expected `begin,separate,end`, received `[]`
   (00:49 local). The remaining 20 tests passed, including added relationship
   and content-type checks.
4. Added original REF instruction/cache/bookmark data. All 21 tests passed.
   Test runtime was approximately 1.4 seconds; individual tests were below 200 ms.

5. Added misuse tests for museum-only negative variants before their guard.
   Both failed because garden calls resolved instead of rejecting. Added the
   explicit theme guard; all 23 tests passed.

## Validation

- Focused maintained root Vitest configuration: 23 passing tests.
  `npx vitest run --config vitest.root.config.ts packages/docx/tests/fixtures/documents.test.ts`
- Explicit-path ESLint and strict TypeScript checking cover both new files and
  their imported shared codec closure.
- Prettier checks the owned TypeScript files.
- `git diff --check` checks owned whitespace changes before commit.

These are fixture checks, not product conformance, full schema validation,
independent ZIP validation, document rendering or visual CLI QA. No CLI visuals
changed. No external binary or renderer was used. Tests operate on owned memory;
file mutation uses memfs. Network-looking relationship strings are inert data.

## Provenance and boundaries

All prose, XML assemblies and technical BMP pixel/header bytes were authored for
this task. No downloaded report body, source code or binary fixture was reused.
The bitmap is a two-pixel technical format fixture, not artistic imagery; image
generation is neither needed nor called. No QA downloads were made or deleted.

Read the pinned API audit/inventory, public API map and test-case crosswalk.
Behavioral adaptations use their semantic boundary descriptions: three-state
formatting, merged/omitted cells, shared stories/media, per-axis density, rich
comments, field caches and ownership. The MIT notice is retained separately in
`packages/docx/THIRD_PARTY_NOTICES.txt` for the behavioral research contribution;
identities do not appear in the helper or tests. Historical research evidence and
its existing standalone notice remain untouched.

No mapped product case is promoted to passing: all 2,259 source-case targets and
1,337 public API rows keep their existing implementation status. Fixture evidence
is tracked in the separate F01–F50 register. The exact language/security mappings
and already resolved documentation discrepancies remain the governing contract;
this task adds input data, not speculative method implementations or aliases.

## Delivery

One atomic fixture-and-coverage commit on main, owned paths only. No push or
release authorized. Local commit hash is reported in chat after verification.
