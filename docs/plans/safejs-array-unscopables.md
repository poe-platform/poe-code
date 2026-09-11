# Array unscopables compatibility

Native comparison found Array.prototype[Symbol.unscopables] absent locally.
Five of six new native-comparison tests failed before editing: missing entries,
null prototype and descriptor flags, incorrect with lookup, and mutation.
Deletion behavior was the passing control. This is a concrete language gap,
not inferred from a prototype-name inventory (which missed symbol keys).

Install the specified sixteen-name null-prototype record as a non-writable,
non-enumerable, configurable Array.prototype property. Track the record through
the existing intrinsic identity and mutation-retention machinery. Its entries
remain writable, enumerable and configurable; do not freeze the guest record.

Check native descriptor/name-resolution/mutation controls, snapshot identity
and mutations, array prototype behavior, with behavior, TypeScript and lint.
The currently running isolated full candidate stays frozen and does not include
this later repair. No full-gate or release success is implied by focused tests.

Validation: 55 runtime/array-prototype/with tests, 18 snapshot and retention
tests, and 48 array-method/data-budget/measurement tests pass (121 total).
TypeScript and focused lint pass. The snapshot cases preserve
record identity and changes to its values flag or deletion of the prototype
property. Existing limits and assertions remain unchanged.

Separate followup validated during this audit: native reads of both
Function.prototype.caller and Function.prototype.arguments throw TypeError;
the current guest returns undefined. This differs from the previously noted
own properties on non-strict function instances. No repair for those prototype
accessors is included here; add dedicated failing tests before changing them.

## Independent qualification

The later function-prototype and strict-arguments repairs are now separately
committed. New descriptor and record-recovery tests do not require Function or
with, so the seven-line Array intrinsic addition can be verified independently
of the uncommitted dynamic runtime. Existing native with/mutation and recovery
tests remain unchanged and are being rerun in the integrated worktree.

Against the isolated committed code, the new tests reproduce eight failures
with two passing deletion/redefinition controls (30706). The failures cover
the missing record, null prototype, property flags, entry flags, mutations and
three recovery cases. The proposed isolated candidate adds only the seven-line
production change and these two new files. All 64 isolated focused regressions
pass across seven files (33701). Main-tree integration passes all 19 tests
across four files, including unchanged with/recovery cases (41715). Ten cases
overlap between those runs; the counts are not additive. TypeScript/lint remain
running (53644); do not commit until their terminal result is known.
Private index: `/tmp/safejs-unscopables-commit.F2Krtx/index`. No push or release.

The broader isolated snapshot suite passes all 1,491 tests in 99 files (9049).
The record's specified keys/order were cross-checked against ECMA-262 2026
23.1.3.41: https://tc39.es/ecma262/2026/multipage/indexed-collections.html#sec-array.prototype-%symbol.unscopables%.
Node 18.18's native record has thirteen keys in an older order, whereas Node 22
has the specified sixteen. The two whole-record test expectations in the main
tree now use that explicit specification list rather than inherit an older
host's missing entries. Remaining native comparisons and all assertions remain.
The frozen isolated test file is still the earlier Node-22-oracle version;
replace it only after 53644 finishes, then verify the final test version.
Main-tree final-test/lint validation is running as 60904.

A Node 18.18 readonly probe against the isolated implementation verifies the
specified record, mutation, retained identity and null prototype after recovery
(38852, exit 0). The initial probe used nonexistent snapshot/run.ts imports and
failed before execution (65903); it is not compatibility evidence.

Final qualification: isolated TypeScript and three-file lint pass (53644,
exit 0). The final explicit-spec test file passes its seven tests and lint in
the main tree (60904, exit 0). After the original isolated checks completed,
that final file was exported into the candidate; all ten independent runtime/
recovery tests pass there (30337). Production and recovery test bytes are
unchanged from the 1,491-test snapshot run. The exact four-file candidate is
ready for its own local commit, excluding the dependent dynamic-with tests.
