# Chart geometry and layout QA

Target Gnumeric 1.12.61 and GOffice 0.10.61. Preserve source/profile separation:
the native executable is a QA oracle only. All primary-source acquisition and
temporary native artifacts belong under out. Unit tests use small in-memory
data and must never launch native tools or create files.

## Procedure

1. Authenticate both archives against the hashes in
   docs/ssconvert/chart-rendering-verification.json. Inspect the exact pinned
   axis, geometry and plot sources before extending behavior.
2. Add a failing source-specified or captured differential regression before
   each implementation. Test coordinates, indices, bounds and ordering
   independently of PNG/SVG encoding. Use memfs for unit file changes.
3. Run the maintained uncached selected workspace build closure, package test
   and lint routes. When integration/export surfaces change, run the maintained
   cross-workspace test selection and actual virtual-command tests as well.
4. Use a different agent to stress/fix implementation; root retains public
   export, integration and Git ownership. Re-run affected gates after repairs.
5. For native image QA, use the explicitly configured Colima QA container and
   pinned executable/profile recorded in verification JSON. Export the original
   inline fixture there using --export-graphs -T png and a %n template, with
   LC_ALL=C, LANG=C, TZ=UTC, GSETTINGS_BACKEND=memory and the recorded schema
   directory. Preserve raw statuses/stdout/stderr and artifact hashes.
6. Inspect images visually, then compare measured geometry and rendered product
   images under matching explicit font, locale and profile configuration.
   Native-only screenshots do not qualify product rendering.
   Direct GOffice QA probes must set LD_LIBRARY_PATH to the pinned prefix;
   linking against that prefix alone can still load a system GOffice library.
   Include every native marker, checking paths separately from surface rounding,
   paint and raster effects. Record actual effective axis scale: standalone
   axes without plot contributors can resolve category despite requested names.
7. Account for every installed plot/trendline service and absent component.
   Keep automatic bounds/ticks, date/time/formatting, every plot, theme/style,
   marker, title, legend, grid, error-bar, trendline and text-shaping behavior
   open until measured. Unsupported, absent and unmeasured cases are not passes.

## Completion criteria

All chart families and object admission paths must have differential geometry,
layout and image coverage; font/profile configuration must be explicit. Exercise
the shared command/SDK engine through injected byte I/O, checking cancellation,
budgets, diagnostics, output ordering, namespaces and replay ownership. The
current geometry helpers alone do not satisfy these criteria. Do not push,
publish or edit README files for this task.

## Cartesian path and error-bar extension procedure

1. Authenticate `gog-chart-map.c` against its archive member (SHA-256
   `a4a324100b30ef43431a37c1b963109e5f9313a355820d13f3a2e8d674e7795b`)
   and `gog-error-bar.c` against the recorded hash. Read `make_path_linear`,
   `xy_make_path_step`, `gog_error_bar_get_bounds` and the Cartesian branches of
   `gog_error_bar_render`. Add regressions before implementations.
2. Independently stress both modules with another agent. Include reversed maps,
   anisotropic cap conversions, enabled/disabled invalid endpoints, invalid
   runtime directions/interpolation, sparse data, overflow, signed-zero
   sentinels, exact work limits and cancellation at every yielded command.
3. For native path QA only, compile an original C probe under out in the recorded
   QA container. Include the authenticated pinned `gog-chart-map.c` to reach the
   static stages; construct two native axes with explicit bounds 0 through 10,
   maps `(offset=20,length=300)` and `(offset=220,length=-200)` and the native
   `xy_map_2D_to_view` callback. Use original vectors `x={1,3,5,7,9}` and
   `y={2,4,NAN,8,3}`, with `skip_invalid=FALSE`. Call the Cartesian linear and
   all four step stages and interpret each native GOPath to move/line tuples.
   Standalone native axes resolve category here; do not count continuous,
   logarithmic, date or contributor-based cases as verified by this probe.
4. Compile with the pinned pkg-config path, source include root and explicit
   Cairo/GObject libraries. Execute with the recorded LD_LIBRARY_PATH and C/UTC
   environment. Compare all five command streams with the built SDK exports.
   Keep the comparator unchanged for deliberate gap-bridging and first-coordinate
   mutations; require that both controls fail equality.
5. Render the native center-X GOPath to a 340 by 240 Cairo SVG, black stroke width
   2 on white, without text. Encode the SDK center-X commands into the same SVG
   geometry and convert both SVGs through the same explicit QA codec. Inspect
   both PNGs and compare raw pixels. This checks a path stage, not native full
   graph rasterization, theme, text or layout parity.
6. On stable source bytes, run the uncached selected ssconvert build closure,
   full package test and package lint. Execute the focused virtual-command
   `ssconvert-model.test.ts` and `ssconvert.test.ts` suites to check retained
   integration behavior. Record that this focused invocation is separate from
   a full maintained safe-bash gate. Hash candidate sources and preserve statuses,
   initial failures, final reruns, coverage limits and blockers in verification
   JSON. Remove only newly generated temporary QA artifacts after inspection.
7. For error-bound QA, register a concrete QA-only subtype of abstract GogSeries.
   Set its cached validity explicitly and attach original GOData vectors
   `values={10,-20,0}`, `positive={3}` and either absent negative data or
   `negative={1,0,NAN}`. Call the pinned library `gog_error_bar_get_bounds` for
   all three indices and absolute/relative/percent modes (18 cases). Compare
   returned values exactly, preserving negative zero. This measures resolved
   valid-series bound semantics; it does not qualify series/plugin admission.
