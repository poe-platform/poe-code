# csvjson validation

The literal executable now uses the engine authored in
packages/csvkit/src/commands/csvjson.ts through the existing generated inventory
and safe-bash registry. CLI and typed SDK requests share this engine. No product
subprocess, Python fallback, implicit filesystem/network/database binding,
README addition or Git delivery was introduced.

Reference qualification downloaded the required PyPI source archive and verified
SHA-256 147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b.
The installed csvjson.py matched the authenticated source-manifest hash
cbfe8f90a73d234ddb332b25bf288922cd960b250ea1847b474a05a3554273c5. The isolated
environment replayed the require-hashes CPython3.14.2 lock: Agate1.14.2,
SQLAlchemy2.0.54, Babel2.18.0, SQLite3.50.4 and precision-28 half-even Decimal
context with the frozen traps. Captures used C locale, UTC, UTF-8 independent
pipes and fixed terminal dimensions. csvjson-reference.json retains 38 exact
original stdout/stderr/status cases. The warning path is an injected deployment
identity string; canonical tests never read that path or execute Python.

Before implementation, 18 of the initial 28 command checks failed. A separately
authored safe-bash stress suite reproduced skipped-line/no-header dispatch and
bulk-only codec materialization; both regressions failed before their fixes.
Raw streaming now requires an injected incremental decoder rather than silently
consuming the whole input. A final original empty-string key/newline case also
failed before the source ValueError ordering was implemented.

Validation routes: maintained selected workspace build closures for csvkit
(2 stages) and safe-bash (10 stages), csvkit workspace unit and lint/type checks,
direct narrow safe-bash node:test command suites, exact integration-discovery
registration check and scoped safe-bash ESLint.
The final csvkit workspace run passed 2033 tests across 45 files, with one skipped
and six TODO cases kept separate. The focused csvjson file passed all 40 checks.
The independent stress suite has 14 passing tests covering memory filesystem preservation, byte ownership,
awaited stdout writes, false-reason cancellation, cooperative once-only cleanup
and retained earlier features on later GeoJSON failure. All fourteen executable
help/version/error contracts remain covered by the existing integration suite.

The attempted npm safe-bash test invocation with path operands also selected the
entire discovered inventory; it was terminated, and is not reported as a pass.
The narrow direct node:test route passed 22 cases. A preliminary test-name filter
selected no registration test; the corrected exact normal-runner registration
test passed and asserted the new literal test pathname.

The maintained screenshot route rendered the actual built Shell's indented
typed Unicode array, Decimal keyed object, incremental missing-cell NDJSON and
GeoJSON collection. The corrected capture exited zero and was inspected: layout
and values matched expected output. The screenshot font lacks Japanese glyphs;
exact UTF-8 Unicode bytes are verified by differential tests. The first capture
failed because the scratch script used an incorrect relative import; it was
corrected before the successful capture. Owned reference/visual scratch was
purged after reduction.

This is finite compatibility coverage, not complete csvkit parity. Explicit
status-78 blockers remain for non-string geometry input, malformed/nonnumeric
bbox schemas, timedelta GeoJSON serializer TypeError representations and typed
nonnumeric coordinate TypeError profiles. Exhaustive float rounding, GeoJSON
schema/index/truthiness, encoding/locale/sniffer and interactive profiles remain
unmeasured. Existing unrelated workspace skipped/TODO tests are not credited as
passes. See docs/specs/csvjson.md for the implemented contract and limitations.

## User edge review, 2026-09-18

A fresh hash-locked CPython 3.14.2 environment authenticated csvjson.py to the
same cbfe8f90a73d234ddb332b25bf288922cd960b250ea1847b474a05a3554273c5
source hash. `csvjson-user-edge-reference.json` retains 120 original executable
observations with exact output/status and explicitly documented warning-path
normalization. These cover arrays, keyed objects and materialized/raw streams,
nonfinite/large/small Decimals, signed zero, dates/durations, empty/header-only
input, duplicate/prototype/numeric headers and missing/extra cells.

Six differences in the initial 108-case probe identified numeric `ms`/`us`
abbreviations incorrectly blocking temporal inference rather than remaining text.
Six new regression tests failed before the fix, then passed in array, stream and
keyed duplicate-error modes. The final expanded 120-case probe had zero differences.
This narrowly qualifies numeric `ms`/`us` spellings; other unsupported natural
language temporal expressions remain blockers.

An independent agent checked 10 additional original GeoJSON cases and found
bbox comparisons rounded arbitrary integers through Number, e.g. minimum
9007199254740993 instead of 9007199254740992. The failing regression preceded
exact bigint/number comparisons. Seven new safe-bash stress tests cover property
truthiness, source numeric offsets, CRS/no-bbox, duplicate IDs, exact and mixed
integer/float/nonfinite bounds, and consumer-owned cleanup while stdin is pending.
The expanded independent suite passed 21/21. Read admission alone does not prove
codec output has flushed; an initial timing expectation was corrected and is not
reported as a product bug.

Maintained csvkit workspace tests passed 2039 cases across 45 files; one skip and
six TODOs remain separate. Workspace lint/source/test type checks passed. The
selected maintained safe-bash build closure passed all 10 stages; focused shell
csvjson/general csvkit/temporal checks passed 41 with one TODO. Focused stress
ESLint passed. The exact normal-runner integration discovery registration check
passed and retained the literal stress-suite pathname. The maintained screenshot route rendered actual built Shell
indented Unicode text, missing-cell NDJSON and exact large-integer bbox output;
the image was inspected successfully. Original reference and visual scratch was
purged after reduction. README, staging and Git delivery were untouched.

The earlier explicit status-78 GeoJSON blockers remain. This finite review does
not qualify exhaustive binary64 rounding, arbitrary geometry schemas, all
encoding/locale/sniffer combinations or interactive reference behavior.
