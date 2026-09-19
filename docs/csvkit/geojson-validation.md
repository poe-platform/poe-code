# GeoJSON validation

The generator now lives in packages/csvkit/src/geojson/index.ts and is consumed
by the existing csvjson engine shared by CLI, SDK and safe-bash registration.
Original executable names and argv descriptors remain intact.

A 25-case original CPython differential cohort is frozen in
geojson-reference.json. The first 21 cases reproduced 18 failing regressions
before the fixes. They cover empty/short/nested-empty coordinate arrays, null
and scalar containers, boolean bbox coordinates, inferred non-string JSON input,
empty geometry containers and MultiPolygon recursion. Four additional original
cases confirm scalar float and list/string membership error diagnostics.
The independent safe-bash agent also reproduced the original empty coordinate,
empty geometry and inferred-null input discrepancies before the updated build.

Verified uncached routes:

- csvkit maintained workspace unit task: 2064 passed, one skipped, six TODOs.
- csvkit workspace lint and both production/test TypeScript checks passed.
- selected safe-bash maintained build closure: ten workspace builds passed.
- existing focused safe-bash csvjson and csvkit suites: 29 tests passed,
  including all fourteen executable help/version/error channels and statuses.
- independent GeoJSON stress: nine tests passed with in-memory filesystem
  preservation, Boolean numeric selector offsets, type/ID overlap, stream
  indentation/CRS behavior, native empty collection bounds, reusable input
  buffers, awaited sink backpressure and cooperative cleanup on consumer close.
- maintained default normal-runner discovery assertion passed and includes the
  literal new stress pathname. Scoped safe-bash ESLint passed.

The maintained screenshot renderer captured actual built Shell output for an
indented collection with ID/type exclusion and unvalidated CRS, a raw feature
stream containing zero-coordinate null geometry, and empty-coordinate IndexError.
The image was inspected: ordering, indentation, diagnostics and statuses match.
Only owned temporary reference/visual scratch was purged afterward.

These checks do not establish full csvkit parity. Unsupported and unmeasured
profiles remain explicit in geojson-compatibility-register.md and csvjson.md;
workspace skips/TODOs are not counted as passes. No README, staging, commit,
push or publication action was performed.
