# in2csv GeoJSON user edge QA

1. Inspect root/scoped instructions and preserve unrelated edits and staging.
2. Have an independent agent reconstruct the hash-pinned CPython 3.14.2 reference in a unique out directory and capture exact csvkit 2.2.0 executable stdout/stderr/status under the frozen environment. Preserve new observations separately from earlier references.
3. Exercise control-character boundaries, ordered properties, duplicate keys and reserved headers, malformed combinations and validation order, ignored options, encoding/BOM behavior and named virtual files. Keep canonical tests in memory and verify file effects.
4. Reproduce confirmed mismatches with failing regressions before fixes. Check the actual CLI and SDK engine and independently registered safe-bash commands.
5. Register new integration tests by literal path. Run uncached csvkit workspace tests/lint, the selected safe-bash build closure, focused safe-bash differentials and integration-discovery tests, and relevant source/test type checks.
6. Render and inspect actual safe-bash converter output in an ad hoc screenshot. Record measured outcomes and unresolved blockers in docs/csvkit, then purge task-owned temporary evidence.

Do not commit, push, publish, change staging or add README content. These cases do not establish exhaustive GeoJSON or complete suite compatibility.
