# Exact style and tab workflows

Task: `adapt-upstream-tables-bdd` only. This delegated scope owns the new
`packages/docx/src/style-workflow-variants.test.ts`,
`docs/docx/style-workflow-variants-20260915.json`, this plan and
`docs/docx/style-workflow-evidence-20260915/`. Root owns Git and product fixes.
No README, existing product, later task, push or release changes.

## Selection and original adaptation

Take every expanded `features/sty-*` and `features/tab-*` row from the historical
870-row table/BDD selection: 97 style and 19 tab rows, total 116. The exact source
parameters and observations remain documentary provenance. Read the pinned
feature/step files in `/tmp/docx-table-source-20260915` to distinguish named input
relationships, self/default fallback and initial settings. Never load those
files or their binary documents in canonical tests.

Each independent case creates original XML and package bytes backed by memfs,
admits through public `Document`, and observes the live document's styles or
paragraph tabs. Incidental style labels map to original Harbor/Anchor/Foundation/
Annotation names. Preserve exact enum families, builtin flags, counts (including
137 admitted latent definitions), default priority 99, load count 276 and its
assignment 240, priority 42/24/null, on/off/absent states, and signed EMU values.
Model property names retain neutral documented spellings. Wrapper-only identity
expectations map to typed returned interfaces and observable live edits.

The test's literal case data is original and self-contained; it does not read
research inventory or fixtures. The documentary map records each source identity,
exact parameters, observations, normalized case and unique test name. Existing
bounded supplements are not erased or counted as these new workflow runs.

## Verification and limitations

```bash
npx vitest run packages/docx/src/style-workflow-variants.test.ts
npm run lint --workspace=docx
npx prettier --check packages/docx/src/style-workflow-variants.test.ts docs/docx/style-workflow-variants-20260915.json docs/plans/docx-style-workflow-variants.md
```

Initial run passed 114 cases and failed two signed tab-position assignments
because the new test supplied a bare number. The reconciled setter accepts
`Length`; correct the test with public `Emu` for the exact numeric value. This was
a test mapping correction, not concrete evidence for a product change. Final
116-case run passes. Root independently reviews this scope and runs relevant
maintained checks before any atomic owned commit.

Focused ESLint passes. The maintained package lint and test typecheck encountered
namespace typing and evolving workflow declarations in concurrently owned image
files. The final test typecheck reports no errors in this scope; logs retain the
actual unsuccessful wider gate for root integration rather than claiming a pass.
The test's enum selector was narrowed to the public enum `members` keys after
its first typecheck; runtime enum values remain identical.

These are model workflow observations; whole public API and all CLI/schema
surfaces remain broader additive obligations. Rendering-only page wrapping,
glyphs and pagination are not run here and require separate explicit Markdown
QA. No cloned/downloaded binary is needed or newly retained.
