# Bounded portable text metrics

Implement the metrics prerequisite to text fitting in `packages/pptx`, with original
in-memory fixtures and no host fonts, rendering, README edits, push or release.
Root instructions apply; no deeper AGENTS.md exists on these owned paths.

Owned files: `packages/pptx/src/font-metrics.ts`, its test file, this plan and
`docs/pptx/font-metrics-evidence.md` and its supplemental
`font-metrics-case-map.json`. The coordinator implements this focused
package change; no other worker or shared command files are needed.

1. Prove missing admission, measurement and best-size behavior with failing tests.
2. Admit bounded copied scalar advances, exact family/bold/italic identity and
   line height. Reject missing fonts/glyphs unless an explicit replacement glyph
   is present. Collapse whitespace into word separators, greedily wrap whole
   words, retain overlong words as overflow, and choose the largest integer size.
3. Bound input, metric count, numeric values and total work across the search.
   Document scalar-additive metrics as a specific portable profile, without
   implying shaping, host rasterizer equality or whole-slide layout.
4. Map the pinned font/layout cases to original fixtures and specific security
   differences; keep document mutation and public `TextFrame.fit_text` visibly
   pending. The module is internal and adds no SDK-only editing operation.
5. Run focused TDD, maintained pptx test/lint and selected workspace build.
   Commit the atomic prerequisite on main with only named owned files.

QA uses an original metric JSON document through memfs; there are no downloaded
or cloned canonical fixtures, renderer invocations or visual CLI changes.

## Completed evidence

The missing-module TDD run failed before implementation. The final original suite
contains 26 passing cases (7ms focused execution), including a memfs-authored JSON
metric input; no test reads host fonts or canonical binary fixtures.

Maintained checks passed:

- `npm run test --workspace=pptx`: 66 files, 1,791 tests passed.
- `npm run lint --workspace=pptx`: ESLint, production and test typechecks passed.
- `npm run build:workspaces -- --workspace=pptx`: selected maintained build closure
  completed for office-package, toolcraft-schema and pptx.

The supplemental ledger retains all 73 previously deferred source rows: 50
security mappings, 11 original metric behavior cases, four private architecture
mappings and eight still-deferred document integration cases. These are source
case dispositions, not the number of TS tests or a full-parity claim.
No CLI, public package exports, README or unrelated source files changed.
