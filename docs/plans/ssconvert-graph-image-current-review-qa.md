# Graph image current-candidate QA

Use the procedures in `ssconvert-graph-image-exports-qa.md`. This cohort validates
background-only root style metadata and independently reviews codec boundaries.
It does not establish complete graph export compatibility.

## Reproduction and differential procedure

1. Verify Gnumeric 1.12.61 and GOffice 0.10.61 archive hashes under out against
   `docs/ssconvert/graph-image-exports-verification.json`. Verify the pinned
   ssconvert and GOffice library hashes in the Colima `ssconvert-statistics-qa`
   container. Use its C/UTC, memory GSettings and pinned library/schema environment.
2. Construct the original 72x36-point absolute-anchor fixture recorded in the
   verification JSON. Compare baseline against separate root style additions:
   `<font font="Sans 10" color="0:0:0:FF"/>`,
   `<marker shape="circle" fill-color="FF:0:0:FF"/>`, and
   `<text_layout angle="45"/>`. The root has no children or data.
3. Run the oracle and the actual JavaScript `runCommand`/`createEngine` through
   injected byte I/O for svg, png, jpeg, pdf, ps, eps, bmp, ico, tiff, emf and wmf.
   Use absolute filenames; a relative output without the appropriate engine
   environment cwd resolves in the virtual root, not the host working directory.
   Preserve acquisition failures separately from rendering outcomes.
4. Independently decode PNG/JPEG/BMP/ICO/TIFF using the captured GdkPixbuf loader
   library. Compare dimensions and every RGBA channel separately from encoded
   bytes. Rasterize both SVGs with the same Sharp decoder and inspect a labeled
   side-by-side image. Inspect the image-format CLI screenshot produced by
   `npm run screenshot -- --no-header --output out/graph-image-current/image-formats-cli.png`
   with Node invoking the actual command engine's `--list-image-formats` operation.
   This is the ssconvert engine, not a poe-code subcommand.
5. Negative control: add an empty `<GogObject role="Chart" type="GogChart"/>`.
   Native produces an additional themed white outlined box. Keep that case
   unsupported by the default producer until its layout/paint is implemented;
   do not broaden background-only acceptance to all empty child nodes.
6. Before the root repair, run the new three metadata command regressions and
   observe exit 1 instead of native exit 0. After repair, compare all nine genuine
   renderer outputs against the corresponding baseline bytes in memfs. Preserve
   metadata and retain negative children/data/paint controls.
7. A different agent independently stress-tests runtime font values and aggregate
   text budgets. Require initial failures and positive/negative controls for each
   repair. Unsupported runtime fonts must fail rather than interpolate into SVG
   or silently substitute Helvetica in PDF/PS/EPS.
8. After all source/test edits, run the fresh maintained package test/lint routes
   and selected uncached build closure. Run the safe-bash ssconvert command file
   against that build. Record source content hashes since these files were already
   untracked at task start; the base Git SHA alone does not identify the candidate.
   Purge this cohort's temporary out directory after recording results.

## Coverage boundaries

Nine renderable targets and two native-unsupported metafile targets are exercised
for the four root metadata fixtures. The raster pixel gate covers twenty cells;
it measures background pixels only. Font metadata does not measure text rendering.
Actual native chart output in the negative control confirms a remaining scene
implementation gap. PDF/PS/EPS signatures and page geometry are distinct from
unmeasured rich chart/text fidelity. Dynamic GLib stderr envelopes still differ.

Focused Node command tests cover existing SDK, memfs namespace, error, cancellation,
budget and checkpoint/replay behavior. They are not a completed whole safe-bash
test gate. Browser/workerd, independent cross-realm execution, full repository
test/lint/build, and broad performance measurements are not run in this cohort.
These unavailable cells remain unverified. No workflow, README, shared engine,
safe-bash integration or package export changes are made in this cohort.
