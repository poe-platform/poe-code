# csvjson GeoJSON independent stress QA

Use the frozen `darwin-cpython-3.14.2-csvkit-2.2.0` profile from
`docs/csvkit/reference-profile.json`; source archive SHA-256 is
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
Canonical inputs and expected bytes belong to the in-memory stress test, with
native differential evidence separately captured in `docs/csvkit/geojson-reference.json`.
This procedure uses injected UTF-8, C locale, UTC, non-TTY terminal dimensions
80 by 24 and the registered literal `csvjson` command. No product subprocesses,
ambient files, network, database drivers or interactive capabilities are used.

1. Build the selected maintained safe-bash workspace closure uncached with
   `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`.
2. Run `node --import tsx --test packages/safe-bash/tests/commands/csvjson-geojson-stress.test.ts`.
   Compare exact stdout, stderr and exit status. Each semantic case preserves
   an existing VFS sentinel and requires no other filesystem entries.
3. Preserve native failures for empty, one-item and nested empty coordinate
   arrays and null coordinates. The original engine returned unqualified status
   78 instead of the source's IndexError/TypeError status 1; these tests were
   observed failing before the implementation rebuild and passing afterward.
4. Check inferred null geometry fails JSON parsing before bbox. Empty geometry
   object, array and JSON string retain unknown four-null bounds. Preserve
   MultiPolygon coordinate recursion, geometry order and integer JSON tokens.
5. Compare both numeric-selector argv forms: default offset zero and `--zero`
   offset one. A type/key overlap with latitude or longitude excludes those
   source columns before ID selection; point type stays Point.
6. Check raw streaming permits indentation and excludes collection bbox and
   CRS. Arbitrary invalid CRS strings remain unchanged in collection named CRS
   objects. Zero coordinates retain null geometry with `--no-bbox`. Header-only
   collections retain their four-null bbox or omit it with `--no-bbox`.
7. Hold the first GeoJSON stdout sink write. Require no later writes or source
   advances during the hold; then require exact two-feature output and once-only
   input return. Reuse and overwrite the same source bytes after each yield.
   Fill the existing UTF-8 decoder's 8192-byte frame so the first feature flushes
   before admitting the second source fragment; shorter inputs may prefetch.
8. Close an explicitly enrolled stdout consumer during an admitted cooperative
   stdin read. Require original cancellation reason identity, no later output,
   exactly one input return and idempotent overlapping registered cleanup.
   Assert cleanup was registered before input acquisition and caller signal
   remains unmodified.
9. Run focused ESLint for the test file. Root owns exact integration-test
   registration, typechecking, remaining build/lint checks and visual CLI
   screenshot validation. No README changes or Git delivery are authorized.

This scoped stress result does not measure exhaustive invalid coordinate schemas,
all temporal coordinate profiles, deployed database/network behavior or every
csvkit executable. Unsupported and unmeasured profiles remain explicit blockers.
Keep temporary reference-only capture/output under `out` and purge only owned
temporary evidence after reducing it into maintained specifications/regressions.
