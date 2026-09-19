# in2csv implementation and QA

Implement the literal csvkit 2.2.0 executable in the CSV domain workspace; preserve its frozen parser and safe-bash registration. Keep filesystem, byte streams, encodings, locale, clock and terminal capabilities injected. Do not commit, publish, add README copy or use Python as a product fallback.

1. Capture source/reference cases under the frozen CPython 3.14.2 profile using only reference tooling. Keep temporary work in `out/in2csv` and durable measurements in `docs/csvkit/in2csv-reference.json`. Confirm failing canonical in-memory cases before implementation.
2. Implement source dispatch, inference priority, CSV/JSON inference, fixed and GeoJSON conversion, DBF fields and XLS/XLSX reads. Validate workbook ZIP expansion before parsing. Preserve stdout before side effects, ordered sheet selection/deduplication, main active/first sheet behavior, reopening and side-file naming.
3. Use a different agent to stress and fix measured tool behavior through actual safe-bash invocation. Root owns integration and exports. Follow the separate stress QA document.
4. Compare exact stdout, stderr, status and side files with native reference observations; canonical unit tests use memfs and frozen byte fixtures. Exercise SDK parity, partial side-file failure, input reuse, backpressure, cancellation and cleanup enrollment.
5. Run the maintained uncached selected-workspace build closure, CSV package test and lint commands, plus safe-bash integration tests. Expand maintained checks when shared infrastructure changes require it. Inspect a CLI screenshot for visual effects. Record unsupported/unmeasured cases as blockers, purge task temporary evidence after recording outcomes.
