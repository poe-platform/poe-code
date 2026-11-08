# csvjson GeoJSON compatibility register

Target: csvkit 2.2.0, source archive SHA-256
147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b.
Reference profile: darwin-cpython-3.14.2-csvkit-2.2.0 in reference-profile.json.
The inspected installed csvjson.py SHA-256 is
cbfe8f90a73d234ddb332b25bf288922cd960b250ea1847b474a05a3554273c5,
matching the authenticated source. geojson-reference.json preserves 25 exact
original observations; canonical tests execute only the TypeScript engine.

Preserved native behaviors:

- Boolean zero_based is passed directly as column_offset: default numeric
  selectors start at zero; --zero selectors start at one. Names are unaffected.
- --type resolves and excludes its column, but does not change Point generation.
  Excluded geo/type columns take precedence over --key IDs when they overlap.
- Null and other falsey properties disappear. Non-null IDs remain even when
  falsey. Feature ordering is type, properties, optional id, geometry; collection
  ordering is type, optional bbox, features, optional named CRS.
- Numeric zero in either coordinate yields null geometry. Default collection
  bbox processing raises TypeError on null geometry, including invalid text
  coordinates that float conversion rejects. Null numeric inputs fail conversion.
- Empty/short coordinate lists, including nested empty lists, raise IndexError;
  null/scalar coordinate containers raise the original len TypeError. Boolean
  coordinates count as numbers but keep their JSON boolean identity in bounds.
- Empty object/list/string geometry has no coordinates and leaves null bounds.
  No rows yields four null bbox entries. These are not normalized or rejected.
- Explicit geometry is parsed as ordered JSON. Table inference can turn its
  source cell into null/bool/Decimal; json.loads then fails with TypeError.
- Bounds accept the first latitude without comparison, including null, strings,
  lists and mappings. Null leaves a bound uninitialized; a later numeric value
  can replace it. A later null after a numeric bound raises the native comparison
  TypeError. String latitudes compare by Unicode code point; mixed scalar types
  raise the original TypeError rather than undergoing JavaScript coercion.
- CRS text is copied without validation. Feature streams omit collection bbox
  and CRS, permit indentation, and retain earlier output on later row failures.

Additional measured cohorts are geojson-user-edge-reference.json (21 disabled-
inference bbox cases) and geojson-stream-user-edge-reference.json (nine stream/
property cases). geojson-inferred-user-edge-reference.json preserves the first
15 inferred bbox observations: twelve initially failed, including ten that hit
the shared parsedatetime inference blocker before entering GeoJSON. The bbox
cohort was separately recaptured with -I to isolate and fix ten bbox discrepancies;
this does not qualify the inferred cases that still hit that blocker.

Remaining explicit status-78 blockers include list-to-list bound comparisons,
coordinate string recursion and larger mapping-coordinate schemas, timedelta
property/ID serializer representations and typed nonnumeric coordinate float
representations, and shared parsedatetime inference on some JSON geometry cells
containing lowercase words such as null/true/false after digits. Exhaustive
arbitrary schemas and runtime profiles are unmeasured;
no unsupported or unmeasured case is credited as a pass.
