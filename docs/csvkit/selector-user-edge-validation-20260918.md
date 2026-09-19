# Selector user edge validation, September 18, 2026

Independent agent review added seven in-memory safe-bash suites containing 32
actual command invocations. They check exact stdout, stderr and exit status,
plus unchanged join input files. Cases cover Unicode decimal, digit and numeric
classification, empty and literal-quote headers, whitespace, repeated and
reversed ranges, separate include/exclude open endpoints, malformed ranges,
names output for csvcut/csvgrep/csvsort/csvstat, and default-header carry into aaa.

Validated bug D01: csvsort and csvjoin omitted the trailing comma in an invalid
selector diagnostic for a singleton Agate table. The original in-memory engine
regression and independent Shell regression failed. Authenticated Agate 1.14.2
archive SHA-256 `7f29841c39d84b1de7fde762b8d792085371515324f3a01413b20f810398225b`
confirms deduplicate returns a tuple and Table.column_names returns that tuple.
The pinned csvkit source formats repr(column_names)[1:-1]. The selector SDK now
accepts optional namesAreTuple (default false), and the shared sort/join engine
passes true. Raw helper punctuation and both range branches stay distinct.

Completed uncached checks: csvkit workspace test (1,593 passes, five TODOs),
csvkit workspace lint including production/test types, selected csvkit build
closure (two builds), selected safe-bash build closure (ten builds), scoped
safe-bash edge-test ESLint, and all current safe-bash csvkit tests (128 passes).
Integration-discovery runner tests passed 109 cases; scoped discovery-test
ESLint passed. Maintained safe-bash typecheck passed source/tests and 26 current
consumer groups, including the expected rejection of three negative groups.
The independent selector-only rerun passed 14 tests with no skips or TODOs.
Compiled Shell output was rendered with terminal-png and inspected for names
padding and diagnostic punctuation. Owned temporary source and visual evidence
under out are purged after use.

These new expectations are source-derived, not new frozen native differential
captures. Five domain TODOs remain unqualified. Agate warning/deduplication
output, GeoJSON serialization, typed inference and the other existing suite
blockers remain; this review does not establish full csvkit 2.2.0 parity. No
full-root lint/test gate is claimed. No README changes, staging, commits, pushes
or publishing were performed.
