# Array for-in regression expectation

The full package run at a9d9e26c2 and an independent interpreter-file rerun
failed the assertion that for-in enumerates only array indices. The fixture has
an enumerable named property, `extra`. A native Node comparison returns
`["0", "1", "extra"]`, matching the already repaired runtime.

Correct the test name and expectation, and derive the result from native
JavaScript while explicitly asserting the intended key sequence. Do not change
the runtime to omit enumerable properties or weaken the assertion to a subset.

Run the complete interpreter test file and the existing ordinary-array and Proxy
for-in tests, plus scoped test lint. This change does not by itself establish a
passing full package gate. Pushes and releases remain paused.

Verification: interpreter and Proxy for-in selection passed 496 tests across two
files; the ordinary array-property file separately passed all six tests.
