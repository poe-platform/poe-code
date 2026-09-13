# Picture formatting CLI delivery

Ownership: new command-images-formatting.test.ts and safe-bash
image-formatting.test.ts; formatting additions in command-engine.ts,
images-schema.ts and the exact integration-inputs.test.mjs registration.
Existing image replacement changes belong to prior work and remain intact.
Root owns staging, domain implementation, package exports and commits.

Implement `images set` using the domain `setImage` operation with the shared
selector, destination, JSON and exit-status conventions. Flags map to flat SDK
options: cropLeft/cropRight/cropTop/cropBottom, rotation, flipHorizontal,
flipVertical, opacity, borderColor/borderWidth and altText. CLI lengths convert
to integer EMUs. Selection cardinality and crop visible-area checks stay in the
package domain. Explicit insertion boxes default to stretch as the format
contract requires; fit still requires both dimensions.

Original memfs command tests first failed with Unsupported operation. They now
exercise signed negative/greater-than-one crop, transforms, opacity, border
units, unchanged original bytes, schema result conformance, rejected nonfinite
values, zero visible area, dry runs and explicit-box default sizing. The actual
safe-bash script case also first failed before the built SDK admitted images.set.
It now proves quoted script invocation, occurrence-local formatting, unchanged
media hashes and untouched second-picture crop.

## Verification

- Focused command suite: 27 tests passed before the added help regression.
- Final formatting command suite: 9 tests passed, including rotation schema bounds.
- Actual safe-bash memfs script: one test passed.
- Exact integration registration: 107 tests passed.
- `npm run lint --workspace=pptx`: passed source lint, source typecheck and test
  typecheck. Root coordinates final checks after the final help correction.
- `npm run build:workspaces -- --workspace=pptx`: passed the maintained selected
  closure. Root coordinates rebuilding after final source changes.

## Manual visual QA procedure and receipt

Use `npm run screenshot -- --no-header --output PATH` with an inline invocation
of the injected command engine, first for `images set --help`, then for an
invalid boolean value. This utility is injected into safe-bash; it is not a root
poe-code subcommand. Inspect both generated PNGs. Keep captures disposable under
.cache and never stage them. No downloaded fixture enters this command check.
Corpus QA belongs to the coordinated domain/accounting owner and follows the
manifest; no whole pipeline is executed here.

Inspection found formatting help falling back to the full command inventory.
An original failing command test captured that behavior, and the help assignment
now uses the resolved command usage. The regenerated help screenshot shows a
compact readable formatting command with crop, transforms, opacity, borders,
selectors and output choices. The error screenshot shows the actionable
`Picture flips require true or false` diagnostic and the command returned 2.
Captures: `.cache/pptx-image-formatting-help.png` and
`.cache/pptx-image-formatting-error.png` (uncommitted).
