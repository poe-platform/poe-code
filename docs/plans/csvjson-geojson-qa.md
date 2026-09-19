# csvjson GeoJSON QA

1. Preserve unrelated edits/staging, README and Git delivery state.
2. Inspect authenticated csvkit 2.2.0 csvjson.py and frozen reference profile.
   Capture original stdout/stderr/status for null, empty, scalar and recursive
   geometry/coordinate inputs using reference-only CPython in owned out scratch.
3. Add canonical in-memory differential regressions and observe failures before
   implementing the generator in packages/csvkit/src/geojson.
4. Independently stress the actual safe-bash tools for selectors, exclusions,
   stream ownership, backpressure, cancellation and cooperative cleanup.
5. Run csvkit workspace unit/lint, selected safe-bash workspace build closure,
   focused safe-bash command suites and maintained discovery assertion.
6. Render actual Shell collection/stream/failure output with the maintained
   screenshot renderer; inspect it and purge owned temporary evidence.
7. Record finite coverage, preserved native bugs and explicit remaining blockers
   in docs/csvkit and docs/specs. Do not infer general parity from finite cases.
