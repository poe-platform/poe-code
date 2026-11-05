# Stamp placement regression

Requires native `qpdf` and Poppler's `pdftoppm`. Keep generated files in the checkout's `out` directory and remove them afterward.

1. Build with `npm run build:workspaces -- --workspace=safe-bash-command-qpdf`.
2. Create a 200 × 100 PDF page with a red 20-point stripe on its left edge. Create a separate stamp page with a blue 30 × 20 rectangle located 10 points from its lower-left corner. Use `PdfDocument` from `@poe-code/pdf-ast` to produce the inputs.
3. Exercise both `--overlay` and `--underlay`. For each, cover all combinations of base and stamp rotations (0, 90, 180, 270), stamp sizes (100 × 50, 400 × 200, 199.8 × 99.8), and these MediaBox origins:
   - Both pages at (0, 0).
   - Base at (10, 20), stamp at (30, 40), with drawing coordinates shifted by their respective origins.
4. For each case, generate the native reference with `qpdf out/base.pdf out/native.pdf --overlay out/stamp.pdf --` (substitute `--underlay` when appropriate).
5. Run the same arguments through `runQpdfCli` with an input byte map, and through `createQpdfCommand().execute` with `createMemoryFileSystem`. Read both resulting PDFs and require exit code 0.
6. Render all three PDFs with `pdftoppm -r 72 -singlefile INPUT.pdf` and compare the returned PPM bytes. Require pixel-identical output for both command paths against native qpdf: 192 cases, 384 comparisons.
7. Inspect a rendered smaller-stamp example visually. The blue rectangle must retain its original size and be centered with the stamp page; oversized stamps must shrink to fit. Confirm the red stripe's layering differs where the stamp overlaps it.

The in-memory unit regressions in `src/retained-stamps.test.ts` also check native-derived placement matrices for both command paths, including nonzero origins and rotations.
