# csvjson user edge QA

1. Preserve unrelated source changes and staging; do not commit, push, publish or
   change README content.
2. Replay the frozen CPython 3.14.2 require-hashes runtime lock in owned out
   scratch. Verify installed csvjson.py against the authenticated source hash.
3. Exercise ordinary array/keyed/stream output using exact stdout, stderr and
   status comparisons: Decimal extremes, signed zero, nonfinite numbers,
   dates/durations, unknown subsecond abbreviations, empty input, header-only
   input, duplicate/prototype/numeric headers, short/long rows and no-header mode.
4. Add failing in-memory regressions for validated discrepancies before fixing
   code; independently delegate GeoJSON and stream ownership stress coverage.
5. Run the maintained csvkit workspace tests and lint, selected safe-bash build
   closure, focused safe-bash command/temporal suites and integration discovery
   registration check. Keep skips/TODOs and unsupported cases separate.
6. Render actual built Shell outputs with the maintained screenshot route;
   inspect array indentation/Unicode, missing-cell streaming and exact large
   integer GeoJSON bbox output. Do not add screenshot tests.
7. Reduce original reference observations into docs/csvkit, document finite
   coverage and remaining blockers, then purge only owned scratch files.
