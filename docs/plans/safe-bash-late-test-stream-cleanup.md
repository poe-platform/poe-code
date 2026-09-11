# Preserve test outcomes until output streams finish

Node can deliver stdout or stderr after the entry file's successful test summary.
The concise reporter deleted the file state at that summary, then treated late
fixture output as output from an unfinished file. A real in-memory Node fixture
reproduced this on iteration 42 with Node 22.23.2: passing file summary, late stderr,
aggregate success, followed by an unwanted fixture dump in the report.

Retain the file outcome until the event iterator finishes. Clear already handled
output at each file summary and apply the known successful outcome to subsequent
fixture streams. Keep all diagnostics. A subsequent failure must still flush late
streams and report its error; files without a known outcome retain all output.

Validation:

- First add a deterministic summary-before-stream regression and demonstrate its failure.
- Add a companion case for a late failure after a successful summary.
- Run the focused reporter suite and repeat the real Node fixture 100 times.
- Root runs the maintained runner checks and commits this fix separately from artifact removal.

Results: the deterministic late-stdout assertion failed before the source change;
all 26 reporter tests passed afterward. All 100 subsequent real Node fixture runs
suppressed both successful streams. The existing diagnostics, failure, and unknown
outcome tests remained passing.

Focused ESLint passed, and the maintained workspace runner passed all 284 tests
after incorporating the current remote main changes.
