# Authorized canonical DU expectation migration, v1

Original full author tests and the exact historical 9-test TAP (5 pass, 4 fail)
are authenticated in ORIGINALS.json and preserved byte-for-byte in originals/.
The prior evidence commit and all its authenticated artifact bytes are unchanged.
These .ts.txt snapshots are captured data, not canonical test inputs.

Only four superseded expectations migrate; production remains frozen at DU
32c5b60c and Overlay 1c793b93. Overlay test migration 0d6b9fcf is a prerequisite.

1. behavior.test.ts: retain every invalid explicit argument case and its zero-FS
   assertion. Rename the containing test to distinguish strict arguments from
   selected-environment fallback. Move the unchanged two selected-env inputs to
   a 1025-byte logical fixture and assert exact success, stdout 2\tfile\n, empty
   stderr, and exactly one lstat with no other filesystem call. This replaces
   the obsolete environment exit-1/no-FS requirement without deleting coverage.
2. native.test.ts O062 (empty operand): change only its exact diagnostic map
   value from the fabricated lstat-empty error to the measured virtual diagnostic
   du: invalid zero-length file name\n. Status/stdout checks stay unchanged.
3. native.test.ts O086 (invalid selected DU_BLOCK_SIZE): remove its obsolete
   strict-error exception; use existing exact frozen-native status/stdout/stderr.
4. native.test.ts O087 (empty selected DU_BLOCK_SIZE over valid BLOCK_SIZE): use
   the same existing exact frozen-native status/stdout/stderr. The frozen input
   and output data do not change; lower-priority values are not consulted.

No other diagnostic mapping, O060 branch, deterministic ordering, production
file, public wiring, excluded backend/overlay/independent test, or raw capture
changes. The exact Git patch is sealed separately after migration.

Validation will run all seven current DU canonical test files plus the existing
Overlay strict/focused selections against one committed input snapshot, followed
by scoped strict types and an isolated build. Installed GNU9.7/Darwin is reused
read-only for existing native cases only; no new native breadth is introduced.
Author validation is not acceptance by the separately assigned reviewer.
