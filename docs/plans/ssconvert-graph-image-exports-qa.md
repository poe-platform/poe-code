# Graph image export QA procedure

Target Gnumeric 1.12.61 archive SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`
and GOffice 0.10.61 archive SHA-256
`558597fd9ca59b93ff562750218d1e7ea8ec3c8d0ed6a5cc096aa715ef909a15`.
Primary sources and temporary evidence belong only under out. Native ssconvert
is a separate QA oracle, never an implementation dependency or fallback.
Do not push, publish, or edit README files.

## Procedure

1. Authenticate archived sources already under out. Inspect ssconvert.c
   by_anchor, infer_image_format, cb_image_export_options,
   export_objects_for_sheet, do_split_save; sheet-object.c image publication,
   anchor conversion and object-list insertion; sheet-object-graph.c image
   failure/size handling; go-image.c enum; gog-renderer.c target switches,
   dimensions, raster rounding; gog-graph.c supported target listing.
2. Capture dependency/plugin/locale/font profile independently of product code.
   Use the recorded native profile in chart-rendering-verification.json, with
   explicit Colima context, container ssconvert-statistics-qa, pinned prefix,
   LC_ALL=C, LANG=C, TZ=UTC, GSETTINGS_BACKEND=memory,
   GSETTINGS_SCHEMA_DIR and LD_LIBRARY_PATH pointing at that prefix.
   Do not assume host fonts, library resolution or locales are interchangeable.
3. Construct original small inline workbooks with absolute and two-cell anchors,
   identical anchors, non-graph objects, foreign namespaces, multiple sheets,
   names containing template characters, and explicit row/column defaults.
   Add a concrete failing regression before implementation or each repair.
   Unit tests use memfs and injected capabilities, no native utilities or disk I/O.
4. Capture every image ID separately: svg, png, jpeg, pdf, ps, emf, wmf, eps,
   unknown IDs, jpg and upper-case IDs. Record command, status, raw stdout,
   raw stderr, all namespace effects and artifact geometry separately from image
   fidelity. Listed formats do not imply graph-renderable formats. Check auto
   extension inference, .jpg versus .jpeg, fallback SVG, and default resolution.
5. Check resolution C-atof prefixes, decimal/hex exponents, signed values,
   range endpoints 1 and 10000, trailing junk, invalid values, and repeated
   options. Preserve object-level continuation then sheet-level stopping,
   pre-encoding output creation/truncation, global indices, %o expansion,
   cancellation and attempted-byte accounting.
6. Check genuine codec signatures, PNG CRC/filter/decoded RGBA, JPEG white
   compositing and decoded pixels, SVG geometry/text, PDF object offsets,
   point geometry and text placement, PS/EPS page geometry and ink bounding boxes.
   Inspect screenshots of both product and native images. Empty graphs verify
   empty graph pixels only; never count those as measured plot/text fidelity.
   Different compression and document metadata are separate byte gates.
7. Exercise command and SDK through the actual safe-bash binding and injected
   byte I/O. Test cancellation before/after acquisition and render, failed
   output admission before rendering, repeated writes to the same namespace,
   budgets, replay and isolation. Use an independent agent to stress/fix codecs;
   root owns engine, public exports, integration and Git.
8. Run the explicitly selected uncached workspace build closure, maintained
   ssconvert package test/lint, focused maintained safe-bash command selection,
   safe-bash build/typechecks, and repository ESLint wrapper as applicable.
   Record all gate statuses and remaining mismatches in verification JSON.
   Unsupported/unmeasured cases are not passes. Purge only task-generated
   temporary sources/logs/images after inspection and evidence summary.

## Open completion gates

The built-in scene producer currently supports genuinely empty GogGraphs and
explicit opaque solid background-only graphs with disabled outlines. A captured
72x36-point original fixture measures all nine renderable targets; compare
profile-decoded PNG/JPEG/BMP/ICO/TIFF RGBA independently of encoded bytes. Native
SVG uses a rectangle extending 10% beyond the page while product paints the page;
record this vector geometry difference separately from visible raster pixels.
Plots and other paints require an injected JavaScript scene producer; their layout,
full chart families, font shaping and profile-specific rasterization remain open.
Metafile failure status/path effects must be distinguished from the dynamic
GLib stderr PID/time envelope. Neither codec primitives nor empty native graphs
establish full graph-image export parity.
