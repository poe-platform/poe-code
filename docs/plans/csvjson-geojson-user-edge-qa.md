# csvjson GeoJSON user edge QA

1. Preserve unrelated working-tree changes and staging; perform no Git delivery
   or README edits.
2. Authenticate the released csvjson.py against the frozen source hash and use
   the CPython 3.14.2 reference environment only for differential capture.
3. Capture first versus later null, string, boolean and container latitudes,
   arbitrary-precision integer longitudes, third/fourth dimensions and Unicode
   string ordering. Preserve both inferred and no-inference observations.
4. Add in-memory exact stdout/stderr/status regressions before fixing bounds.
   Record table-inference blockers separately rather than counting them as passes.
5. Have a different agent stress actual safe-bash stream failures, falsey IDs,
   excluded-column overlap, cancellation, stream ownership and cleanup.
6. Run maintained csvkit workspace tests/lint and safe-bash build closure, focused
   command tests and maintained discovery assertion. Inspect screenshots rendered
   from actual Shell output, then purge owned temporary output.
7. Update research/specification compatibility status with measured coverage and
   remaining blockers; do not claim exhaustive all-input parity.
