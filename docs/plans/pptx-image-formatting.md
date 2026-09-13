# Picture formatting implementation and accounting

Scope: F33 contain/cover/stretch, crop, clockwise rotation, flips, opacity and
picture outline. Root coordinates domain implementation and validation; delegated
accounting owns this plan, the image-formatting case map and evidence receipt.
The CLI delegate owns command wiring and schema acceptance. No complete pipeline,
push, release, README edit, fixture redistribution or reference runtime execution.

## Source review and adaptation

Use `docs/specs/pptx.md`, `office-cli.md`, `office-sdk.md` and both upstream audit
and inventory pairs. Research baseline is commit
`278b47b1dedd5b46ee84c286e77cdfb0bf4594be` in
`/tmp/pptx-upstream-review`. The standalone MIT notice remains in
`docs/pptx/upstream-license-notice.txt`; do not copy implementation, assets or
source wording into product files.

The focused ledger includes 109 source rows: crop getters/setters, picture
outline, inherited rotation, shared percentage lexical parsing, image sizing,
placeholder cover, and shared LineFormat cases. Every selected parameter and
expanded BDD example retains its own provenance row. Full line formatting and
nonpicture operations are accounted as scope gaps, not silently counted as F33.

## Original regression work

1. Author memfs presentations with independent ZIP/XML assertions before changing
   behavior. Keep authored words and raster data unrelated to research fixtures.
2. Exercise absent crop rectangle, absent side, four independent reads/writes,
   reset-to-zero, negative and greater-than-one values, signed bounds and ties
   away from zero. Read percentage lexical values without losing precision.
3. Distinguish preserved file values from editing policy. Reads must retain legal
   extended crops, including a preexisting rectangle with nonpositive visible
   area; crop edits must reject nonpositive visible width/height before and after
   quantization. Unrelated edits preserve that preexisting rectangle.
4. Verify contain/cover/stretch using landscape, portrait and exact-aspect boxes,
   odd EMU dimensions, explicit and omitted sizes, zero dimensions and repeatable
   rounding. The two placeholder cover scenarios reduce to independent 4:3 and
   3:4 arithmetic tests; placeholder model insertion remains separately planned.
5. Verify normalized rotation, both flips, opacity in 1/100000 units, outline
   width in EMU, outline color and untouched source media/effects/extensions.
6. Pair exposed operations through SDK and CLI. Check plural routes, scalar flag
   rejection, selectors/cardinality, closed JSON, schema/capabilities and errors.
7. Run narrow maintained package tests/build/lint and inspect CLI screenshots.
   Record actual commands/results separately from source baseline passes.

## Disposable corpus QA

Use the existing manifest entry
`.cache/pptx-corpus/CERN-job-opp-250925.pptx` (43,231 bytes; two picture
occurrences). Verify its SHA-256 against the manifest before opening. Do not
fetch links or copy its content into canonical fixtures. Inspect image inventory,
edit one picture into disposable output, reopen and verify integer crop/transform
and original media hashes. Inspect the resulting CLI screenshot; whole-slide
rendering is not implied. If a meaningful defect appears, create a small original
memfs regression before fixing it. Never stage the corpus or disposable output.

## Publication and completion

Stage only explicitly owned implementation, original tests and this accounting.
Commit atomic improvements on main with Conventional Commits after maintained
checks pass; record local hashes separately. No push or release is authorized.

## Final validation

- TDD first exposed the missing operation; subsequent regressions caught null
  outline-color validation, scope parity and command help/schema defects.
- `npm run test:unit --workspace=pptx`: 112 files, 3194 tests passed.
- Final separated command suites: insertion 11 and formatting 8 passed; domain
  formatting 29 and insertion 42 are included in the maintained run.
- `npm run lint --workspace=pptx` and the maintained selected workspace build
  passed. Actual safe-bash script and 107 registration checks passed.
- Independent SDK/CLI corpus QA and help/error screenshot inspection passed;
  see the linked evidence and CLI plan for exact scope and limitations.

Local commit hashes are reported to the user after committing. No remote
operation or release was performed.
