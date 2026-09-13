# Bounded image header metadata

Owner: `image_metadata`; root integrates and commits. This is a dependency of the
F30 image-inventory plan, not image decoding or insertion admission.

## Procedure and evidence

1. Write original inline-byte tests before the module; initial run failed on the
   absent module.
2. Read PNG IHDR/pHYs, JPEG frame/JFIF/EXIF, GIF logical-screen, BMP DIB and TIFF
   first-directory metadata with explicit byte-offset bounds. Do not follow TIFF
   directory chains or decode pixels. Unknown/vector types yield null dimensions.
3. Assert literal expected sizes and densities, both TIFF byte orders, truncated
   headers, rational denominator zero, sliced input offsets and directory cycles.
4. Reconcile density tuples `(42,24)`, `(42.1,23.6)`, absent density, out-of-range
   values and malformed values with original cases. Include a 204-by-204 JPEG
   header with default 72 DPI. Round numbers before the 1–2048 range check; reject
   implicit numeric-string coercion and explicitly use positive half-up rounding.
5. Run focused unit and ESLint checks, then the maintained package unit/lint
   routes with the inventory integration. No files created by unit tests, native
   image runtime, network, new dependencies or README changes.

Verification: 30 focused cases passed in 6 ms; focused ESLint passed. The maintained
`npm run test --workspace=pptx` passed 3,019 tests in 105 files, and
`npm run lint --workspace=pptx` passed source lint and both TypeScript projects.
The selected maintained PPTX build closure also passed. Reference identities remain in the
separate research receipt; all binary test headers and wording are original.
