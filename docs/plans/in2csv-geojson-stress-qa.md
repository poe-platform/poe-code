# in2csv GeoJSON independent stress QA

Use registered safe-bash commands and `MemoryFileSystem`. Canonical tests do not
create host files, invoke native programs, or access network/database services.

1. Build the selected csvkit workspace through the maintained workspace build
   closure, then run `TSX_DISABLE_CACHE=1 node --import tsx --test
   packages/safe-bash/tests/commands/in2csv-geojson-stress.test.ts` from the root.
2. Compare exact stdout, stderr and status against all 14 existing frozen stress
   observations and the 30 additional original executable observations in
   `docs/csvkit/in2csv-geojson-reference.json`. Both references identify csvkit
   2.2.0 and source SHA-256
   `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
3. Exercise each input through borrowed stdin with reused one-byte chunks and
   through a named virtual file with explicit `-f geojson`. Check the input stays
   byte identical and no extra files appear. Do not assume extension inference.
4. Retain original argv flags in the differential. Check raw conversion rather
   than typed-table inference: ignored flags, property order/collisions, missing
   and null values, altitude dropping, nested dict JSON versus list repr,
   malformed features/geometry, root validation and nonfinite numbers.
5. With a direct registered command context, hold the injected stdout write
   pending. Verify execution does not settle until the sink accepts output and
   cleanup was registered before input acquisition. Repeated cleanup must close
   the admitted input iterator exactly once.
6. Cancel a cooperative pending borrowed input. Require the caller's reason to
   escape unchanged, no stdout/stderr, and exactly one iterator return after
   execution and repeated registered cleanup settle.

The maintained safe-bash test runner appends every discovered test to positional
file arguments; a focused invocation must use the command above.

These tests qualify only the frozen observations and the injected stream
lifecycle above. Unmeasured GeoJSON inputs, complete csvkit suite compatibility,
database profiles, performance and release qualification remain outside this
independent cohort.

Record run outcomes and harness corrections in
`docs/csvkit/in2csv-geojson-validation.md`.
