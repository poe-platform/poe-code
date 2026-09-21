# Graph image exports independent stress review

The independent agent reviewed the image factory, codecs, and root-owned graph
save loop. Root retains engine, public export, safe-bash integration, and Git
ownership. No native process was spawned by unit tests; command fixtures use
original in-memory Gnumeric XML and memfs.

## Reproduced and repaired

- Four SVG text regressions demonstrated malformed XML output for NUL, another
  forbidden control character, a lone surrogate, and U+FFFE. All four initially
  resolved successfully; the codec now rejects these inputs explicitly.
- A UTF-8 output-budget regression demonstrated that a second scene command was
  accessed after the first exceeded the byte budget. The codec charged UTF-16
  character count. It now charges UTF-8 bytes before advancing the scene, bounds
  XML escaping, and observes cancellation while processing text.
- EMF and WMF command regressions initially omitted each native unsupported-format
  warning. The factory now awaits the stable GOffice source warning payload before
  each ordered image-save failure. Tests separately retain exact status, order,
  paths, empty files, and stop after the failing sheet.
- Three additional native-validated regressions for `bad`, `jpg`, and `PNG` image
  IDs initially omitted the GOffice unknown-name warning. The factory now awaits
  that warning per object before the save failure; literal `unknown` remains
  deliberately quiet, matching `go-image.c:281-301`.
- Two low-resolution PNG regressions initially failed with invalid raster geometry.
  Matching `gog_renderer_get_pixbuf`, the factory now falls back to both dimensions
  being 1 if either Cairo raster dimension is zero. The tests verify status,
  diagnostics, and 1x1 geometry only, including a tall image with zero raster width.
- The captured GdkPixbuf 2.42.12 loader profile exposes writable `bmp`, `ico`,
  and `tiff` IDs separately from the eight enum listings. Fourteen codec/command
  regressions failed before adding the profile registry and real BMP24, ICO32,
  and uncompressed RGB TIFF encoders. Dynamic formats white-compose alpha.
  Registered read-only `ani`, `gif`, `icns`, `pnm`, `qtif`, `tga`, `xbm`, and
  `xpm` now use the renderer-unsupported warning and failure, not unknown-name
  warnings. Neither CLI listing nor enum-only extension inference was broadened.
- The native-validated ICO >256 dimension failure initially had the wrong
  diagnostic in the new codec. A failing regression now preserves `Unknown
  failure while saving image` without dimension clamping. Additional tests cover
  raster/output admission for each new writable target.
- Two native-validated empty PS/EPS ink-box regressions failed before repairing
  `BoundingBox` and adding `PageBoundingBox`. Truly empty command scenes now use
  `0 ceil(height) 0 ceil(height)` instead of claiming full-page ink.
- Two hidden-column/hidden-row offset regressions failed before separating
  nominal axis size for anchor fractions from zero hidden-cell traversal size,
  matching `sheet-object.c:cell_offset_calc_pt`. The column case is native-captured;
  the row analogue follows the same primary-source function. The persisted-defaults
  fixture now declares Gnumeric 1.12.61 and SheetNameIndex explicitly so its raw
  20/30-point expectation represents a valid current-version native fixture.
- A failing factory regression proved next-sheet admission could charge work
  before a rejected sheet was stopped. The built-in image factory now checks the
  internal next-sheet admission callback before metrics, object projection,
  sorting, or work charging. Companion cases preserve prior cancellation and
  normal traversal when the optional callback is absent. Root owns the matching
  engine/publication regression and callback wiring.

## Background-only follow-up stress

An independent `images/scene.test.ts` cohort adds 21 cases for captured explicit
opaque solid fill, explicit none, truly empty default paint, malformed/transparent
colors, unimplemented automatic-theme styles, gradients/images, outline/font/
marker/text-layout metadata, extra properties with original namespaces, and plot
child rejection. The unit cases pass and assert metadata preservation. No runtime
repair was made without a demonstrated failure. Root owns index/integration and
profile differential evidence, including cancellation and raster/work admission.

The root default scene now additionally supports explicit opaque solid root
backgrounds with disabled outlines; this does not render plots, axes, series,
legends, or text. Automatic themes remain unsupported. Native background SVG
paints a rectangle with ten-percent bleed beyond the page, whereas the initially
reviewed JavaScript scene painted the page rectangle. Although page pixels can
match, exact scene geometry is a separate mismatch until root source-validates
and measures any repair.
- Typechecking exposed the stored-deflate parts inference and Blob byte-array
  typing, plus the fixture's incorrect importer callback parameter order. These
  were corrected without weakening assertions.

## Verified unit coverage

`npx vitest run packages/ssconvert/src/rendering/images/codecs.test.ts
packages/ssconvert/src/rendering/graph-images.test.ts` covers genuine image
signatures, PNG decoded RGBA, JPEG decoded white composition, dimensions, vector
geometry/text, unsupported IDs, cancellation, raster admission, XML text validity,
UTF-8 byte admission, stable warning payloads, graph-only filtering, tie order,
global graph indices, no-graph namespace preservation, persisted sheet metrics,
and extension inference. A supplementary-Unicode/XML-whitespace positive case
ensures rejection does not discard valid SVG text.

These are unit/runtime checks, not proof of profile-specific native visual parity.

Final independent focused run also includes `images/factory.test.ts` and the
root-owned `graph-publication.test.ts`: 69 tests across four files passed after
next-sheet admission repair. Factory cases cover zero-work rejected admission,
cancellation before and during callback rejection, and omitted-callback traversal.
The maintained package lint route is `npm run lint --workspace=@poe-code/ssconvert`;
it runs ESLint and production/test TypeScript checks fresh without task caching.

## Runtime metadata and cumulative text admission follow-up

A different agent independently reproduced four failures before repairing runtime
font admission: malformed producer-supplied `font` metadata was interpolated into
SVG markup and silently substituted with Helvetica in PDF/PS/EPS. All four vector
codecs now reject any runtime font other than the declared Helvetica contract.
This validates the JavaScript producer boundary, not native font parity.

Three further failing regressions proved PDF/PS/EPS accepted a 1,000-character
ASCII literal with a ten-unit workbook work budget. Text work is now charged
cumulatively before encoding or literal escaping in every vector format. Four
additional independent cases cover two individually small text commands whose
combined work exceeds the limit. Existing valid Helvetica and supplementary SVG
Unicode cases remain positive controls.

The fresh focused run `npx vitest run packages/ssconvert/src/rendering/images`
passed 70 cases in three files after these repairs. No test created files or
spawned native utilities. The maintained uncached package lint route
`npm run lint --workspace=@poe-code/ssconvert` also exited zero after the final
test additions, covering ESLint and production/test TypeScript checks.
This cohort did not run native differential or visual
measurements, safe-bash replay/checkpoint gates, or a broad repository gate; those
remain separate root-owned validations.

## Remaining mismatches and unmeasured cases

- The built-in producer renders genuinely empty graphs and the explicit opaque
  background-only subset described above. Nonempty plot layout,
  axes, series, titles, legends, and font shaping require an injected JavaScript
  scene producer; the default implementation explicitly fails. This is incomplete
  requested graph functionality, not a passing unsupported native target.
- EMF/WMF stable source warning payload and save failure order are covered. The
  GLib PID/time/severity envelope is not reproduced; exact stderr parity fails.
- Dynamically registered GDK pixbuf savers may expose additional format IDs beyond
  the reviewed fixed enum. The captured profile's BMP/ICO/TIFF targets and read-only
  IDs are pinned in the separate registry. Other plugin profiles remain unsupported
  and unmeasured; arbitrary unknown-ID profile parity is not established.
- SVG/PDF/PostScript/EPS output is real vector content, but native output bytes,
  font behavior, visual text fidelity, and nonempty native graph rendering were
  not independently measured here. PDF/PS text currently rejects non-ASCII text.
- PNG compression differs from native compression. JPEG uses a JavaScript encoder;
  native JPEG pixel parity outside the measured empty-white image is unverified.
- TIFF uses uncompressed pixels rather than the native compression choice.
  BMP/ICO/TIFF synthetic pixel packing, headers, dimensions, white composition,
  and budgets have unit evidence. Root independently decoded generated empty
  images with native GdkPixbuf 2.42.12 and measured matching 98x48 RGBA pixels
  for the captured empty-white profile; BMP bytes also matched. This does not
  establish nonempty graph layout or every codec/input pixel pass.
- Nonempty PS/EPS ink boxes currently use the page box; tight text/path ink bounds
  are not implemented or measured. Media-name bytes differ from the native output
  while point geometry matches. Both remain explicit mismatches.
- Legacy XML without Version (or older-version markers) undergoes native font/axis
  size scaling. Raw declared 20/30 defaults produced native 18.8889/28.3333 in the
  missing-version profile; JavaScript currently retains raw defaults. This is an
  actual geometry mismatch, not a passed current-version fixture or a supported
  version narrowing.
- The zero-dimension native fallback allocates a new 1x1 pixbuf; its pixel
  initialization is not asserted as normative. JavaScript allocates zeroed bytes,
  and fallback pixel parity remains explicitly unmeasured/profile-specific.
- JPEG's third-party synchronous encoder cannot cooperatively interrupt mid-encode;
  cancellation is checked around it. Output length is checked after encoder
  allocation; its internal memory is not accounted as a complete peak-memory bound.
- Aggregate remaining-output admission is enforced by the root-owned engine after
  per-image encoding; individual codec admission does not model the complete peak
  memory of combined intermediate strings, rasters, or encoder lookup tables.

To continue QA, root should compare each gate independently against the captured
Gnumeric 1.12.61 / GOffice 0.10.61 oracle: exit/status/stderr and namespace effects;
dimensions and geometry; decoded pixels; and visual text/font placement. Preserve
all failed or unmeasured gates as failures or unknowns rather than normalizing them
into passes.
