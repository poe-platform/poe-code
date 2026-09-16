# Image density CLI regression

Ownership: `packages/safe-bash/tests/commands/pptx/image-density.test.ts` and this
plan. The root owns metadata correction, SDK coverage, research accounting and
literal integration-test registration. No adapter product change is needed.

Exercise plural `images add` through an actual quoted memfs shell script. Supply
an original JPEG metadata/scan container with centimeter densities 75 and 25,
which convert to 190.5 and 63.5 DPI. Ties-to-even normalization produces 190 and
64; a 190-by-64 frame therefore occupies 914400 EMUs on both axes. This fixture
asserts metadata admission, never pixel decoding.

Independently read ZIP member headers and use SAX namespace-aware XML assertions
for emitted extents. Independently hash retained media with SHA-256, and verify
the presentation and image inputs remain unchanged. The SDK owner separately
covers public byte APIs and normalization bounds. Audit and API inventories were
consulted for density behavior; full inherited model API parity is outside this
single correction.

Run the focused TypeScript test first against the existing rounding behavior,
then rerun after the metadata owner rebuilds the package. Record both receipts.
For visual QA, inspect existing image command help/error evidence or take an
ad hoc screenshot through the maintained screenshot tool. No visual grammar is
changed. Disposable fixtures are not needed and no downloads or README edits are
authorized. Do not execute the pipeline, commit, push or release from this worker.

Verification receipt: `node --import tsx --test
packages/safe-bash/tests/commands/pptx/image-density.test.ts` first failed with
width 909613 instead of 914400 EMUs (83 ms test body). After the metadata owner
corrected rounding and rebuilt the package, the same command passed 1/1 (67 ms
test body). This proves actual CLI publication plus independent emitted geometry
and retained-media hashing; it does not establish pixel rendering support.

Visual review inspected existing `.cache/pptx-image-replacement-help.png` and
`.cache/pptx-image-replacement-error.png`. Text is legible, complete and unclipped;
no new capture or CLI formatting change was made. These existing disposable
screenshots remain unowned and unstaged. The root added the required literal
test registration while preserving the preexisting replacement registration.

Maintained registration check: from `packages/safe-bash`, `node --test
scripts/integration-inputs.test.mjs` passed 107/107 in 19.6 seconds with the new
literal test path registered. This checks maintained discovery and ownership
boundaries; it is not a full safe-bash test-suite run.

Additional focused type check passed: `./node_modules/.bin/tsc --noEmit --target
ES2023 --module NodeNext --moduleResolution NodeNext --strict
--noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck
packages/safe-bash/tests/commands/pptx/image-density.test.ts`. This validates the
namespace-aware SAX attribute assertions and the memfs adapter assignments; it
does not replace the package's maintained full type-check route.
