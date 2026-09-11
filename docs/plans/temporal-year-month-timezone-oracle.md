# Year-month timezone oracle qualification

The local full test run fails three timezone-invariance cases before invoking
SafeJS: Node 22.23.2 / ICU 78.2 formats the ISO year/month with long month width
as `2000 `, missing February. A standalone Node command reproduces this without
loading product code. This is not evidence of date shifting by SafeJS.

Use numeric month/year for the timezone fixture and assert both native parts
explicitly before comparing UTC, Pacific/Honolulu and +05:30 guest results.
Keep calendar matching, receiver validation and captured-method replay checks.
This narrows the fixture to timezone invariance; it does not establish that ISO
long-month names work. Existing untracked ISO completeness tests and the gap
inventory continue to record that unresolved formatting limitation.
