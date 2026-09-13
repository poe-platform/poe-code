# Picture formatting evidence and compatibility mapping

This focused receipt supersedes historical “not implemented” statements only for
the verified operation subset described below. It does not establish a complete
presentation object model or whole-public-API coverage.

The [focused ledger](image-formatting-case-map.json) retains 109 individual source
unit variants and expanded BDD examples. Selected parameters, source assertions
and steps remain research provenance. Original TypeScript tests use authored
presentations and independent ZIP/XML assertions; no research binaries or runtime
are part of unit tests. Required attribution remains in the standalone
[MIT notice](upstream-license-notice.txt).

## Exact language and security mappings

- Operation input/output is always asynchronous admitted bytes or explicit
  capability-scoped streams/VFS. It never derives filesystem, network, native
  image runtime, font, clock or identity authority from the host.
- Detached operation options use camelCase. The documented live object model
  retains `crop_left`, `crop_top`, `crop_right`, `crop_bottom`, `rotation`, `line`
  and inherited geometry spellings; operation support does not replace those
  planned Picture members. The ledger retains 42 picture/line member obligations,
  including inherited, returned and untested public members. Existing shared
  LineFormat implementation and tests are crosslinked rather than relabeled as
  missing merely because the live Picture wrapper remains planned.
- Crop fractions map to signed integer 1/100000 units, ties away from zero,
  bounded by signed 32-bit storage. No clamp to [0,1] is permitted. An existing
  crop rectangle is inspected and preserved even when it does not describe
  positive visible area. A requested crop edit must leave both visible axes
  positive before and after quantization. Unrelated edits must not normalize or
  silently reject the existing crop merely because its visible area is empty.
- The source crop-read case containing right=2.5 and no opposite compensation
  therefore remains a read/preservation case. The BDD bottom=.8 setter against
  existing top=.25571 is deliberately rejected by the format edit contract;
  positive-area behavior is not claimed equivalent to that source write.
- Dimensions are integer EMU; rotation uses integer 1/60000 degrees normalized
  modulo 360. Flips precede clockwise center rotation. Opacity is a fraction
  stored in 1/100000 units on the picture blip, without changing source pixels.
  Outline width uses EMU. Unknown effects and neighboring nodes remain intact.
- Numeric strings are not SDK numbers; nonfinite/unsafe or unknown option values
  fail through neutral stable errors. CLI lengths use explicit units and CLI
  picture selectors are one-based, distinct from eventual zero-based model
  collections. CLI uses `images set`, common flags and the shared schema contract.

## Documentation drift and limitations

The source BDD scenario titled `LineFormat.width setter` at the earlier line 24
actually assigns `dash_style`; its expanded steps, not its title, determine its
ledger disposition. Shared LineFormat dash/fill/color and nullable inherited
width behavior already has original evidence in `drawing-accounting.test.ts`.
Shared rotation variants already have `transform-behavior-cases.test.ts` evidence.
The ledger reuses these scoped receipts without claiming new Picture wrappers.

Earlier insertion receipts describe explicit fit as mandatory for a two-dimension
box and contain an older DPI rounding account. The authoritative format contract
now defaults an explicit box to stretch and characterizes DPI using ties-to-even.
This receipt does not treat historical prose as a replacement for current tests.
The crop contract's signed range and positive-area edit policy take precedence
over historical [0,1]-only schemas or unconstrained source setters.

## Validation receipt

The maintained selected workspace build and package lint completed.
`npm run test:unit --workspace=pptx` passed 112 files / 3194 tests, including
29 picture-formatting cases and 42 image-insertion cases. Final separated
command suites passed 11 insertion and 8 formatting cases. A ledger row without executed target evidence is
not a parity claim.

Disposable corpus QA used the cached 43,231-byte manifest deck with SHA-256
`85cc7b338a11b9d1a9dfcaaaa504bf21ab643e4c30004a478152f390ee9f5f1d`.
The SDK listed one slide picture and shared scope listed two occurrences, matching
the manifest census. SDK and CLI engine edits used crop left=-0.15/right=0.25,
rotation=27.125, horizontal flip, opacity=0.625 and a 2pt `2468AC` outline.
The CLI returned exit 0, affected 1. Independent Saxes inspection of serialized
XML asserted crop -15000/25000, rotation 1627500, alpha 62500 and width 25400.
Only `/ppt/slides/slide1.xml` changed; every other decompressed part, including
all media, remained byte-identical. Output remained disposable in memory; no
corpus bytes or assets were written, downloaded or staged. No meaningful defect
was found in this check, so no corpus-derived regression was needed. This is
package/command QA, not whole-slide rendering evidence. The procedure and scoped ownership live in
[the implementation plan](../plans/pptx-image-formatting.md).
