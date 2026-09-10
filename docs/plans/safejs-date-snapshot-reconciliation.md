# Date snapshot expectation reconciliation

The full-package gate failed before reaching Date replay assertions because
the test required a legacy `date` heap node. Current guest Date capture uses
`guest-date` with explicit prototype state, preserving the originating realm.

A direct current-source probe (b0d045) found the saved date at time 1007 with
a prototype reference. Replay preserved the shared date/alias identity,
timestamp 1007, invalid Date, and recorded Date.now value 1000. It made zero
new clock reads and restored the saved clock state twice, as the existing
test expects. No Date runtime defect was reproduced.

The test now follows the actual date binding to its guest-date heap node,
asserts time and prototype-reference presence, and checks the alias binding
shares that reference. All existing clock and value behavior assertions remain.
This does not remove legacy snapshot support or change runtime serialization.

All 29 Date tests pass (129760), followed by 24 Date-property and mixed-realm
snapshot tests (79d35b). The Date test invocation also included a nonexistent
guest-date filename filter; it ran only the Date file, so the two actual
snapshot files were then selected explicitly. No unexecuted coverage is counted.
Scoped ESLint passed (cb456c). No push or release was made.
