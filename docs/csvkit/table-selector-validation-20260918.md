# Table selector validation, September 18, 2026

This change implements source helpers in `src/table/headers.ts` and
`src/table/selectors.ts`, exports them through the domain SDK, and uses the
same selector implementation in csvcut, csvgrep and csvsort. csvjoin retains
its default offset. It does not qualify the full csvkit suite.

Original failing regression: matching header `-1` produced a 1-based-index
diagnostic instead of selecting the first exact header. An independent actual
safe-bash invocation also failed for `+1,-1, 1,1`. These pass after correcting
name-before-integer matching, including Unicode isdigit classification.

A second failing case expanded `-1:1` against a header named `-1` and reported
invalid column 0 instead of invalid column -1. Expansion now passes integer
values to matching so literal signed names cannot override range ordinals.

Completed uncached checks:

* Maintained csvkit workspace test: 28 files, 1,591 passed, five TODOs. TODOs
  remain unqualified; none was converted into a pass.
* Maintained csvkit lint: ESLint, production types and test types passed.
* Selected csvkit build closure: two builds passed; selected safe-bash closure:
  ten builds passed, including safe-bash ESM and declaration generation.
* Independent-agent safe-bash selector stress: seven exact-channel in-memory
  suites passed after rebuilding the domain; focused ESLint passed.
* Entire current csvkit safe-bash command cohort: 121 tests passed using
  node:test/tsx. Integration discovery assertions include the new literal path.
* Integration-inputs maintained runner test: 109 tests passed. Existing unrelated
  inventory assertions were preserved.
* Maintained safe-bash typecheck passed source/tests and 26 current public
  consumer groups, including expected rejection by three negative groups.
  Its first run failed on three existing sniffer fixture stdin optionality
  errors. Marking the two fixture arrays `as const` corrected tuple inference
  without changing fixture bytes or behavior. That test's seven runtime cases
  and focused ESLint passed after the correction.
* Compiled Shell names and signed-header output rendered with terminal-png;
  screenshot inspected for alignment, quotes and clipping. Temporary evidence
  is purged after inspection.

The attempted normal safe-bash npm test did not recognize SAFE_BASH_TEST_RG as
a selector and launched the full discovery cohort. It was interrupted rather
than counted as a completed gate; the focused csvkit cohort above completed
separately. No full-root gate or full safe-bash runtime pass is claimed.

Agate warning/deduplication output, GeoJSON serialization, typed inference and
other previously recorded status-78 operations remain blockers. Geometry
Boolean offsets are pinned as source quirks, not credited as product parity.
Reference-only archive and Unicode inspection used network and native archive
tools; canonical new tests use only memory and injected services.

No README additions, staging, commits, pushes or publishing were performed.
