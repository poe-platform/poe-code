# Bounded style/formatting verification, 2026-09-14

Reviewed implementation commit `2f18bd13a` against the root instructions,
DOCX/shared CLI/shared SDK specifications and the retained API/test inventories,
audits, scoped case map and original style/formatting tests. No broader document
model completion is claimed.

## Validated correction

`Styles.get_by_id(null, type)` and `get_by_id("", type)` incorrectly selected a
nondefault definition whose public `style_id` had been cleared to the same value.
The documented absence semantics require the type default. Two original memfs
parameter cases in `styles-model-boundaries.test.ts`, titled
`uses the default for an absent lookup ID even when a style has ID %s`, failed
before the implementation change: expected `Default`, received `Detail` for both
null and empty IDs. The focused red run collected 257 cases, executed two failures
and filtered 255; filtered cases are not passes. Duration: 2.28 seconds.

The format-package lookup now resolves absent IDs to the type default before
searching definitions. Existing nonempty lookup and type validation remain in
place. The regressions also assert null when the requested type has no default.
This supplements the existing mapped `Styles.get_by_id` default/fallback cases.

## Current checks

- Before correction: maintained DOCX unit route passed 1,388 tests / 52 suites.
- After correction: `npm test --workspace=docx` passed 1,390 tests / 52 suites,
  no skips, 46.30 seconds. Output: `/tmp/docx-style-review-tests.log`.
- `npm run lint --workspace=docx` passed ESLint and both TypeScript checks.
  Output: `/tmp/docx-style-review-lint.log`. `git diff --check` passed.
- `npm run build:workspaces -- --workspace=docx` passed all five declared build
  tasks. Output: `/tmp/docx-style-review-build.log`.
- Scoped map verification resolved 2,409 JSON pointers and checked 1,899 original
  test links in nine files using parsed TypeScript literals and parameterized
  title prefixes. All 613 API and 898 source row IDs were unique. This is link
  integrity, not a fresh execution of external cases or proof of every equivalence.

## Prior evidence and limits

Inspected retained `/tmp/docx-style-formatting-red.log` (nine failures) and
`/tmp/docx-model-boundaries-green.log` (25 passes), plus the audited red/green
receipts. These are different historical scopes; their counts are not combined.
Inspected `/tmp/docx-style-qa-final.txt` and both retained style help/workflow
screenshots: explicit in-memory publication, latent values, Title creation,
typed tab batch, exit 1/2 failures and SDK readback are visible. No fresh shell
campaign or screenshots were claimed for this model-only correction.

General Document/Paragraph/Run/Table owner integration remains incomplete as
recorded in the case map. Full public API conformance, publisher corpus QA,
document rendering/repair checks and native-runtime validation were not run.
No external fixtures were downloaded or removed. Unrelated work and index
entries are preserved; no README changes, push or release.
