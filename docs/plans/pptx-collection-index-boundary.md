# PPTX collection position validation

Date: 2026-09-13. Root owns this plan, the new collection-index-boundary test,
and four guards in slide-model.ts, shape-adjustments.ts and freeform-builder.ts.
The shell verification delegate owns its separate QA receipt. Preserve all other
working-tree changes. Commit locally on main; no push, release or whole pipeline.

## Validated defect and implementation

The public Slides, SlideShapes, AdjustmentCollection and FreeformBuilder `.at`
methods normalized negative positions before checking integrality. With four or
more entries, -1.0000000000000002 rounds to an integral offset after addition.
An object whose valueOf returns -1 also reached valid entries and executed caller
coercion. Eight original public-export tests failed before implementation.

Validate Number.isSafeInteger before comparison, addition or reading collection
length. Preserve IndexError/index-out-of-range and valid negative-index behavior.
No helper abstraction or alternate editor is needed for four one-line guards.
All test file mutations use memfs and small original XML, with literal expected
IDs, values and drawing coordinates. No image artwork or downloaded asset is used.

## Agent validation procedure

1. Run the new test alone and capture the eight expected failures.
2. Add the guards; run collection-index-boundary, slide-model,
   shape-adjustments and freeform-builder tests together.
3. Run maintained pptx workspace tests and lint; selected workspace build closure.
4. Review the supplemental research receipt and the delegated real .sh adapter
   evidence. Do not present collection `.at` as a CLI command: the CLI has typed
   selectors, with its existing input schemas and rejection tests.
5. Stage only the named owned source/test/evidence/plan files for one atomic fix.
   Record separate local commit identity. Preserve unrelated files and notices.

## Results

Red: 8/8 new cases failed because invalid inputs returned collection entries.
Green focused: 32/32 cases passed across four files, 107 ms test-body total.
The first maintained workspace run passed 6,801 tests in 258 files before the
new regression file entered that run. Final post-change checks are recorded in
the accompanying research receipt; this baseline is not the final gate.

Whole public API and every public-command QA remain broader obligations. This
bounded index fix does not mark outstanding upstream inventory entries complete.

Final maintained checks passed: 6,809 tests in 259 files; workspace ESLint and
source/test TypeScript; selected pptx build dependency closure. No public CLI
presentation changed. See the research receipt for commands and limitations.
