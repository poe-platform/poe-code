# in2csv GeoJSON user edge qualification

The independent user stress cohort adds 25 exact original-executable observations under the frozen CPython 3.14.2/csvkit 2.2.0/Agate 1.14.2/SQLAlchemy 2.0.54 profile. Interpreter and converter hashes were verified; new observations remain separate in in2csv-geojson-user-edge-reference.json. Captures use byte pipes and UTF-8 decoding without universal-newline translation. Agate itself converts embedded CR to LF in raw string cells.

Two independent safe-bash cases failed before rebuilding the fix: DEL in geometry/ordered property JSON and a mixed control/Unicode case. A separate CLI/SDK regression also failed before the engine edit. Python json.dumps escapes U+007F as `\u007f`; the importer escaped only characters starting at U+0080. The converter now includes U+007F in that boundary. Raw string cells retain DEL and list cells retain Python `\x7f` representation. No other engine behavior changed.

New observations cover control characters, non-BMP coordinate slicing, numeric-looking/prototype property names, first-position/last-value duplicate keys, reserved headers, false/empty geometry, malformed property/geometry combinations, validation order, root diagnostics and signed/exponent numbers. They run through reused borrowed three-byte stdin chunks and named MemoryFileSystem inputs with exact stdout/stderr/status and unchanged input/file inventory.

Two additional actual shell workflows verify input/output redirection, an in2csv-to-csvcut pipe, and cat-to-in2csv with the frozen ignored common flags. Exact virtual output bytes and source/file inventories are asserted. The downstream csvcut observation is retained under the same reference profile. Intermediate incorrect test-helper imports were corrected before the final independent 27/27 run; those harness failures are not passing checks.

Verified on 2026-09-18:

- CLI/SDK GeoJSON cohort: 32 tests passed after the failing regression.
- Maintained csvkit workspace test route: 54 files, 2,971 passing tests; one skip and six TODOs remain incomplete.
- Maintained csvkit lint route: ESLint and product/test TypeScript passed.
- Selected safe-bash workspace build: maintained uncached dependency/build closure passed.
- Combined new/existing GeoJSON, registry and output-ownership tests: all 82 passed in the final state. The independent new cohort passed 27/27.
- Maintained integration-discovery tests: 109 passed with literal registration of the new test file.
- Maintained safe-bash typecheck passed source/tests and 26 public-consumer groups, including expected negative assertions. Its source/test compile stage was repeated successfully after the workflow additions. Public-consumer compilation does not establish deployed-service behavior.
- Focused ESLint passed the final integration test and discovery assertion; Git whitespace checks passed.
- Actual safe-bash output was rendered and visually inspected: preserved leading-zero ID, accented text, DEL JSON escape, duplicate type header, altitude dropping and null geometry. An initial screenshot helper imported an internal source codec and failed initialization; switching the helper to the public package API produced the inspected successful capture. That failed helper run is not a passing visual check.

Unpaired surrogates, nesting beyond the qualified limit, exhaustive CPython float ties, verbose traceback identity and unmeasured inputs remain explicit blockers. This cohort does not establish complete fourteen-command parity or database/network/interactive qualification. Full repository tests/lint and publication gates were not run for this focused converter correction.

QA procedures are in docs/plans/in2csv-geojson-user-edge-qa.md and in2csv-geojson-user-stress-qa.md. No commit, staging change, push, publication or README addition was performed. Only task-owned temporary files are purged after verification.
