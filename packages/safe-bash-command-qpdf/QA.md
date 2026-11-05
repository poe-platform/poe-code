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

# Linearized multi-page output

Requires native `qpdf` (validated with 12.4.2). Keep generated PDFs under `out/linearization` and remove them after validation.

1. Build `@poe-code/pdf-ast` with `npm run build:workspaces -- --workspace=@poe-code/pdf-ast`.
2. Create a three-page `PdfDocument` with widths 200, 300, and 400 and height 500. Save the input without linearization. Repeat with distinct text on each page, shared font resources, and inherited page attributes.
3. Run `--linearize in.pdf out.pdf` through both `runQpdfCli` and `createQpdfCommand().execute` with a memory filesystem. Save each resulting byte array for native validation.
4. Require native `qpdf --check-linearization FILE` to exit 0 and print `no linearization errors`. Also require `qpdf --check FILE` to exit 0. This checks `/L`, `/H`, `/O`, `/E`, `/N`, `/T`, page object counts/lengths, and shared-object hints against the actual file.
5. Repeat for `--pages . 3,1,2 --`, re-linearizing an already linearized input, and `--encrypt reader owner 256 --` (pass `--password=reader` to native checks). Verify the page widths/order and extracted text remain correct.
6. Include outlines both with and without `/PageMode /UseOutlines`, and a resource shared only by pages two and three. Require the same native checks to pass.
7. Render the text fixture before and after linearization with `pdftoppm` and compare page pixels; inspect a rendered page. Empty PDFs must fail linearization instead of emitting a fake one-page hint table.
