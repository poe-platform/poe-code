# Image fit and deterministic geometry

Scope: `packages/pptx/src/image-insertion.ts`, its original in-memory tests, and
focused default-fit corrections in the insertion usage, evidence, and case map.
CLI integration is separately owned.

## Contract and evidence

Follow `docs/specs/pptx.md` §6.5 and the shared Office CLI/SDK contracts.
An explicit width and height default to stretch. A supplied fit still requires
both dimensions. Uncharacterized intrinsic dimensions permit only a complete
stretch box, including the default stretch behavior.

The existing code rejected explicit boxes without fit. Two original tests first
failed with `invalid-value`: a 103-by-77-EMU GIF box and a 301-by-203-EMU box for an
admitted JPEG with uncharacterized intrinsic dimensions. The implementation now
accepts these boxes without changing source bytes.

Independent SAX attribute assertions cover native/one-dimension sizing, explicit
and default stretch, contain centering on both axes, cover on both axes, equal
aspect ratio, positive dimension half rounding, negative half-position rounding,
zero supplied dimensions, and derived dimensions that round to zero. Cover cases
straddle the smallest representable positive source rectangle: a 2-by-99999 box
retains two crop units; a 2-by-100001 box is rejected after crop quantization.
Portrait sources of 2-by-4 and 4-by-6 pixels cover a square with independently
asserted vertical crop units of 25000 and 16667. Extreme cover is rejected on both
axes. Tests use original small GIF/JPEG bytes,
memfs, and an independent ZIP reader; no downloads or host fixtures.

## Research and QA boundaries

Consulted `docs/pptx/upstream-test-audit.md`, `upstream-test-inventory.json`,
`upstream-api-audit.md`, `upstream-api-inventory.json`, and the existing image
insertion case map. This change supplies bounded operation behavior; it does not
claim implementation of the separately inventoried live public object model.
No source code or assets were copied from the reference implementation.

The parent task coordinates SDK/CLI parity checks and maintained package
validation. QA procedures stay in `docs/plans`; this scope
requires no downloaded corpus fixtures and makes no renderer-fidelity claim.

## Validation

- Red: focused insertion suite, two expected default-box failures and 38 passes.
- Green: all 40 focused insertion cases pass after integrated module completion.
- Portrait extension: all 42 insertion cases pass; focused execution took 622 ms.
- TypeScript source and plan formatting pass. Package-wide checks are coordinated
  with the parent task to avoid duplicate runs.
- Maintained `npm run test:unit --workspace=pptx`: 111 files pass; all 40 insertion
  cases and the CLI default-stretch case pass. Six new formatting fixture cases
  failed because their archive-writing helper omitted explicit compression.
  The helper was corrected, and the parent reports all 28 formatting cases pass.
  The final maintained package rerun is coordinated by the parent task.

Final verification: maintained `npm run test:unit --workspace=pptx` passed
112 files / 3194 tests. The default-fit CLI regression now lives in
`command-images-add.test.ts`; its 11 tests pass. Source/test lint and the
selected workspace build passed. No push or release.
