# Collection position validation receipt

This bounded correction applies the shared [SDK contract](../specs/office-sdk.md)
sections 4–5 and supplements [collection evidence](public-collections-evidence.md)
and [adjustment/freeform mappings](adjustments-freeform-evidence-20260913.md).
The [agent procedure](../plans/pptx-collection-index-boundary.md) records ownership
and red/green evidence. It is not a whole-public-API coverage certificate.

## Exact JavaScript mapping

Slides.at, SlideShapes.at (also used for group children),
AdjustmentCollection.at and FreeformBuilder.at require a safe integer before
negative-position normalization. Fractional values, nonfinite numbers and objects
fail with IndexError/index-out-of-range. No implicit valueOf or Symbol.toPrimitive
conversion is permitted. Valid -1 means the final entry; -length means the first.
These are collection positions, not sparse placeholder keys or CLI ordinals.
There is no new CLI operation; structured CLI selectors continue to use their
existing schema validation. Arbitrary model method dispatch remains disallowed.

## Provenance and accounting boundary

Consulted the pinned [unit/BDD inventory](upstream-test-inventory.json),
[test audit](upstream-test-audit.md), [API inventory](upstream-api-inventory.json)
and [API audit](upstream-api-audit.md). The source revision remains
278b47b1dedd5b46ee84c286e77cdfb0bf4594be. Relevant public protocol records include:

- pptx.slide.Slides.**getitem**
- pptx.shapes.autoshape.AdjustmentCollection.**getitem**
- pptx.shapes.freeform.FreeformBuilder.**getitem**
- SlideShapes inherited indexed-access behavior, also used for group children.

The existing inventories retain every variant and BDD example. This correction
supplements indexed access/bounds cases in tests/test_slide.py (DescribeSlides),
tests/shapes/test_shapetree.py (Describe_BaseShapes), and
tests/shapes/test_autoshape.py (DescribeAdjustmentCollection). All three normalized
indexed-access variants remain distinct obligations; assignment cases are not
reclassified by this read-only correction. The GroupShapes and SlideShapes
sequence scenarios in features/shp-shapes.feature remain covered by their broader
sequence receipts; these eight regressions do not certify complete BDD adaptation.

The IEEE-754 rounding and JavaScript object-coercion inputs are additional original
language/security regressions, not copied source test assets or source parameter
values. Existing standalone license notices remain unchanged. No source identity
was added to product code, test names, fixtures or output. Historical inventory
status labels are not a current statement that the tested methods are absent;
passing evidence here supersedes those labels only for this exact boundary.

## Original evidence

collection-index-boundary.test.ts imports public package exports and constructs
small original memfs-backed XML. All four collections reject both fractional
neighbors of -1, NaN and infinities. All four reject a valueOf object without
calling it. Literal expectations check valid first/last entries and lower bounds.
Eight regressions failed first; all eight passed after four validation guards.
The focused four-file suite passed all 32 cases.

No corpus document was needed: this is a numeric boundary, reproducible without
binary downloads. The corpus manifest and its outstanding rendering/application
obligations are unchanged. Product host I/O, native runtime, network, package
branding and README files are unchanged. No screenshot is needed for this
SDK-only argument-validation correction; CLI presentation did not change.

## Maintained final checks

- `npm test --workspace=pptx`: 259 files, 6,809 tests passed (65.95 s).
- `npm run lint --workspace=pptx`: ESLint plus source/test TypeScript passed.
- `npm run build:workspaces -- --workspace=pptx`: selected three-build dependency
  closure passed, including the pptx package.
- `git diff --check`: passed. Owned Markdown/test formatting checked with Prettier.

Checks apply to the working tree, including preserved unrelated changes. The
separate [shell/adapters receipt](../plans/pptx-shell-verification-20260913.md)
records the executable command workflows and their bounded coverage.
