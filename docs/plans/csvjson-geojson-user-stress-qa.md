# csvjson GeoJSON user edge stress QA

Use the frozen `darwin-cpython-3.14.2-csvkit-2.2.0` profile with C locale,
UTC, UTF-8 and non-TTY pipes. Archive SHA-256:
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
The original command source hash was independently rechecked as
`cbfe8f90a73d234ddb332b25bf288922cd960b250ea1847b474a05a3554273c5`.
The additional nine native observations are frozen in
`docs/csvkit/geojson-stream-user-edge-reference.json`; canonical tests run only
the registered JavaScript command, injected capabilities and memory filesystem.

1. Run the selected maintained uncached safe-bash build closure:
   `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`.
   Root owns build coordination and integration/export changes.
2. Run the focused regression suite:
   `node --import tsx --test packages/safe-bash/tests/commands/csvjson-geojson-stress.test.ts`.
   Require exact stdout, stderr, status and unchanged memory filesystem entries.
3. In a raw stream, pass an empty feature ID, empty property, numeric-looking
   zero property and false-looking property. Require empty ID retention, empty
   property omission and the two nonempty string properties unchanged.
4. In an inferred stream, exercise false/true/null IDs with zero and Boolean
   properties. Require false ID retention, null ID absence, falsey property
   omission and source property/feature insertion order.
5. Emit a valid explicit geometry then malformed JSON. Test inferred and raw
   streams: the first complete feature remains on stdout before the exact
   JSONDecodeError and status 1. Collection mode produces no partial collection.
6. Select each latitude, longitude, geometry and type column as feature key.
   Require source column exclusion to precede ID selection; none emits an ID.
7. Retain the existing native bbox, CRS, indentation, selector-offset and
   reusable-input/backpressure cases. Their original failures and source
   evidence are recorded in the earlier GeoJSON stress QA and reference files.
8. Cancel an admitted cooperative stdin read separately through stdout consumer
   closure and caller cancellation. Require exact reason identity, no diagnostic
   or later feature, once-only input return and overlapping idempotent cleanup.
   Check registration precedes input acquisition and only the chosen signal is
   aborted.
9. Run scoped test lint. Root owns maintained integration discovery,
   TypeScript checks and visual screenshot verification.

Execution: all nine added native observations matched the independently authored
expectations. The focused suite passed all 14 tests without skips or TODOs.
No product defect was reproduced in these added stream/ID/exclusion/cancellation
cases, so no product fix was made by the stress agent. These cases do not prove
exhaustive GeoJSON or full csvkit compatibility; explicit unsupported and
unmeasured profiles remain blockers. No README, staging, commit, push or publish
action was performed. Purge only owned temporary evidence under `out`.
