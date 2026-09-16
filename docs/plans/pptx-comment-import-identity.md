# Comment import identity safety

## Scope

Reject slide import when legacy comment or author structures carry opaque extensions
whose identity associations cannot be remapped safely. Preserve ordinary legacy
imports and existing author-ID collision handling. Modern comments remain
preservation-only; this change does not convert them to legacy comments.

## Evidence and implementation

Six original in-memory SDK regressions initially failed because import returned a
package after remapping legacy author IDs while copying opaque identity references.
The cases cover comment extensions, comment attributes, position attributes, text
extensions, author attributes and author-list attributes. The import preflight now
allows only understood legacy author/comment attributes and children (including
`xml:space` on text), rejecting unsupported identity-bearing material before copying.
Destination identity structures are not remapped by this validation.
The package-internal `requireLegacyCommentRemapping` helper also supports callers
that reassign a legacy comment author; it is not exported from the public entry point.

The same six cases run through `slides import` with injected memfs reads. They
independently assert `unsupported-edit`, status 1, zero affected objects, no output
publication, and unchanged source/destination bytes. Existing tests independently
assert distinct remapped authors, indices and preserved original comment bytes.

## Research accounting

Consulted `docs/specs/pptx.md`, `docs/specs/office-cli.md`,
`docs/specs/office-sdk.md`, `docs/pptx/upstream-test-audit.md`,
`docs/pptx/upstream-test-inventory.json`, `docs/pptx/upstream-api-audit.md` and
`docs/pptx/upstream-api-inventory.json`. The pinned review-comment API has no
parametrized or BDD cases to adapt for this safety boundary; core-property
`comments` and comment shape enums are separate obligations, not thread identities.
These are original specification regressions with original markup and wording.

## Validation procedure

Run the focused lifecycle, legacy comment, slide import and command slide import
Vitest files; then the maintained pptx workspace lint and test routes. No downloads,
host fixtures, README edits, pipeline execution, push or release are needed.

## Verification receipt

- Six new negative cases reproduced the defect before implementation.
- Focused lifecycle/comments/slide-import/command-slide-import checks passed (67
  cases before adding the destination-identity preservation check).
- Final lifecycle suite passed all 12 cases, including the positive unchanged
  destination author identity check.
- `npm run lint --workspace=pptx` passed (ESLint and both TypeScript projects).
- Separate modern coexistence/security tests pass all four SDK cases and belong
  with the modern inventory implementation rather than this independent guard.

Final coordinator verification: maintained `npm run test:unit --workspace=pptx`
passed all 4,170 cases in 163 files; `npm run lint --workspace=pptx` passed ESLint
and production/test TypeScript. Selected maintained pptx dependency-closure build
passed. No push or release was attempted.
