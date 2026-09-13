# Table implementation and verification

## Scope and ownership

Implement F28 grid dimensions, cell text, row/column sizing, table style references
and flags, supported four-side borders, direct fills and margins in packages/pptx.
Root owns package operation integration/schema, exports, command tests and Git.
The domain worker owns tables.ts and the bounded live model and tests. The audit
worker owns original parameter cases and scoped research/API receipts. The
safe-bash worker owns registered-Shell tests and exact discovery registration;
the existing generic adapter requires no new editing logic. Preserve unrelated
work, keep README untouched, and do not push or run the whole pipeline.

## Procedure

1. Establish missing tables commands with original failing memfs tests; implement
   the byte SDK and direct plural-resource command routes using the same domain.
2. Distinguish physical row/cell XML from logical grid/merge spans. Independently
   assert XML geometry, text, empty cells, theme references, borders and margins.
3. Exercise zero/remainder dimensions, invalid selections and typed options,
   getters, stale tokens and no-op package identity. Reject unsupported structural
   edits instead of changing the logical grid accidentally.
4. Reconcile every relevant source parameter and BDD row in scoped research
   receipts, and record all public table API obligations including deferred ones.
5. Run maintained pptx unit/lint routes and the selected pptx workspace build
   closure. Run scoped registered-Shell tests and exact discovery checks. Capture
   table help/error through the existing terminal screenshot tool and inspect it.
6. Use admitted cached corpus inputs only as disposable QA; retain fixture
   provenance in research and reduce meaningful findings to original regressions.
7. Review owned paths and commit verified atomic work on main using Conventional
   Commits. Report local hashes separately from remote/release status.

## Evidence in progress

- Original command tests initially failed with Unsupported operation through
  both the engine and the actual safe-bash registry.
- Package engine and byte SDK cases now cover rectangular empty/Unicode data,
  early option validation, one-based selection, sizes and no-op archive bytes.
- Independent style parameter assertions exposed incorrect bandRow/bandCol
  names before correction. The domain uses exact DrawingML spellings.
- Source research mappings and corpus receipts are in the dedicated table
  accounting plan and docs/pptx table research files; none of the corpus bytes
  belongs in the commit.

## Corpus regressions and verification

- Admitted the cached `slides-public-engagement-DEC-2021.pptx` bytes against
  manifest SHA-256 `0377c715798aa4462b826670dd0bb2bcf1b3fca98cdf546b1f326cdd6ffd397e`.
  Product inspection of slide 9 reported a 4×4 table with 16 physical cells and
  12 empty cells, plus a 1×1 table with one empty cell.
- Inspection initially reparsed an owning slide for each unrelated drawing.
  An original 25-drawing regression measured 27 parses. Reusing parsed owner
  documents during selection now satisfies the independently bounded parse
  assertion (at most four) without changing selection results.
- The first corpus no-op test failed: unchanged XML was repackaged, changing ZIP
  metadata and ordering. An original reversed-order archive with explicit file
  metadata reproduces this independently of corpus bytes. Table mutations now
  retain admitted original bytes when no part payload changes, after validating
  the package, selection and edit intent.
- Repeated admitted corpus QA passed: same-text assignment retained every byte;
  changing cell 1,1 changed only `/ppt/slides/slide9.xml`; SDK readback returned
  the original QA marker. No fixture bytes or output files were written.
- Terminal help and invalid-dimension output were captured and visually inspected
  at `/tmp/pptx-tables-help-20260913.png`. Statuses are 0 and 2. The screenshot is
  disposable QA, not a source asset or slide-rendering fidelity claim.

## Final checks and delivery

- `npm run test:unit --workspace=pptx`: 101 files, 2,902 tests passed.
- `npm run lint --workspace=pptx`: ESLint and source/test TypeScript checks passed.
- `npm run build:workspaces -- --workspace=pptx`: declared three-workspace build
  closure passed. Public package imports expose the table model, collections and
  byte SDK operations. No whole-pipeline execution was performed.
- Exact-path serial Node tests for all five safe-bash pptx files passed: 100
  tests. The integration-input discovery suite passed 107 tests. Focused ESLint
  passed for the owned Shell test and registration file.
- Research accounts for all 212 selected cases: 125 covered, 14 explicit partial
  behaviors, eight admission/language mappings, 45 deferred structural cases and
  20 wider model obligations. Whole API parity remains partial; see the scoped
  API receipt rather than treating those deferrals as passes.
- Commit this as one atomic table editing capability, including domain, command,
  SDK, original regressions, integration and evidence. Only explicitly named
  owned files are staged. Existing standalone legal notices are retained.
  No README, fixture binary, unrelated work, push or release is included.
