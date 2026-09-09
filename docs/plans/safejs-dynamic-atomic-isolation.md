# Dynamic runtime isolation for local delivery

The integrated worktree contains dynamic functions/eval and experimental weak
collections in shared files. Preserve that worktree; prepare a separate candidate
so dynamic-runtime delivery does not accidentally include unfinished weak-symbol
lifetime support. The complete goal still requires the weak work and other gaps.

Candidate: `/tmp/safejs-reference-error-commit.1afxzl/checkout`.
Private index: `/tmp/safejs-dynamic-atomic.5XnUdJ/index`, initialized at 3a25d863f.
The index now contains the exact 130 candidate TypeScript files (4,427 added
lines, 320 removed), staged from the isolated working tree, not the main tree.
Related plans are not yet staged. Earlier restricted-accessor/Array candidate
indexes must not be reused. Do not commit before required verification finishes.

Copied the current package into the candidate, excluding weak-collection files,
the two separate unresolved host-Promise property-import tests, and the unrelated
snapshot-mutation optimization. Restored committed versions of globals/symbol.ts,
symbol-registry.ts, snapshot/serialize.ts and test/adversarial/snapshot-mutation.ts.
Removed only weak-collection additions from globals.ts, values.ts, guest-heap.ts,
guest-heap-validation.ts and snapshot/restore.ts in this isolated copy. Removed
only the WeakMap/WeakSet new-global expectations from the two historical graph
tests (math-f16round.independent and regex/compile-policy), preserving all other
assertions and fixture contents. No weak-collection imports or heap tags remain
in candidate source. No such removals were made in the user's working tree.

The candidate includes the latest eval block-function deletion fix and the
15 new eval/super coverage cases. TypeScript passes (38230, exit 0). Validate the
source/grammar/mapped-argument/snapshot/security tests, verify exact candidate
diffs, then construct atomic commits; this preparation is not a passing gate or
a completed feature delivery. The separate integrated full suite (11849) ended
with exit 143 and no final unit summary; its manifest remained unchanged and
still includes experimental weak collections. It is not a passing gate.
No push or release.

The candidate is now frozen for focused verification (75696): dynamic/eval
globals, mapped arguments, with references, all snapshot tests and sandbox
integrity. Private-index documentation was synchronized to 07bb230fb so a later
candidate commit cannot revert the recorded integrated-run termination.

The frozen selection passes all 2,171 tests across 155 files (75696, exit 0),
including the latest block-function deletion fix and eval/super coverage.
Whitespace checks pass. Parser, historical graph, function-prototype, Date,
console and lint-rule regressions are now under verification, along with ESLint
over package source and tests. These focused results do not establish a passing
whole-package gate or resolve the excluded outstanding work.

The second selection passes 1,673 tests with two skips across 65 files
(64 passed, one skipped; 86852, exit 0). It does not overlap the first selection,
giving 3,844 passing focused tests; skips are not counted as passes. Package
ESLint remains running as 92953. The candidate's 1,160-file manifest, excluding
node_modules/dist/coverage and using localeCompare path order, has SHA-256
`608df4e82d8398b4e31c1aba2fdb2f713b66d73b785f87fb22f3023ef371b94d`.
The uncommitted error-diagnostic-accessors test is an independent passing audit,
not a dynamic-runtime fix; exclude it from the eventual feature commit.

Node 18.18 readonly comparisons pass all ten constructor/eval/mapped-argument/
scope/isolation cases (21209, exit 0), covering all four function constructor
kinds. This is a portability spot check, not complete Node 18 conformance.

Package ESLint over src and test passes (92953, exit 0). The maintained SafeJS
build closure and full package unit route are now being run against this
candidate. The unit invocation adds only --reporter=default so completed file
results remain visible if the process is interrupted; no task membership,
deadlines, budgets or concurrency settings are changed.

The first candidate build attempt exited before building because the temporary
checkout lacked turbo.json. Restored that exact committed configuration into
the temporary tree. The retry (74273) was inadvertently launched in the main
worktree: its 23 builds and four import checks pass, but its unit results apply
only to the integrated main tree, including experimental weak collections and
the unresolved host-Promise tests. Do not count it as isolated-candidate evidence.
No concurrent second heavy build/unit route is being started. The candidate's
full maintained build/unit verification is still required.

Main run 74273 has now completed: 22,788 passed, two host-Promise import failures,
37 skips, 840 files. Its source was unchanged during execution. After it ended,
the validated CLI lint parity repair was synchronized from this candidate to
main. See safejs-cli-dynamic-source.md for red/green evidence and screenshot QA.
The private index now stages 138 TypeScript files (4,530 added, 412 removed).
The 45 related plans are now staged with the 138 TypeScript files in the private
index (183 files total). The separate eval-import autofix follow-up is not part
of this frozen candidate or its private index.

Candidate session 8302 is the maintained build/full-unit retry, explicitly
launched with this isolated checkout as its working directory. It excludes the
unfinished weak collections and host-Promise import policy work, not tests of
the dynamic-source feature. Its frozen package manifest is 1,162 files with
SHA-256 `3b469cf4e6f994851753c92ab586d81d9f9c6428d1688ba0e0195e5ff7e127cb`.
The CLI follow-up lint selection passes 608 tests in 46 files (3048); do not add
that count to older selections without accounting for overlapping lint files.

Session 8302 completed with exit 1: 22,740 passed, 12 failed and 37 skipped
across 837 files (835 passed, one failed, one skipped), 516.11s. All failures
are the obsolete eval diagnostic triggers in loader/multiple-blocks.test.ts;
no other failure was reported. The post-run manifest exactly matches the
1,162-file digest above. All 23 builds and four built import checks passed.

After termination, applied the two-line loader fixture correction, retaining
every diagnostic-offset assertion. Main's 162 loader tests and scoped lint
pass; candidate loader verification also passes all 162 tests (68927). This is full-run
evidence plus targeted repair verification, not a claimed green full rerun.
The built candidate CLI also passed nested Function/eval execution with the
default lint gate. Documentation baselines were synchronized to a9f981cf5.
The separate import-autofix and escape-global repairs remain outside this
feature candidate and will receive their own commits.

## Local commits and combined follow-up run

The runtime/CLI feature and verified loader-fixture correction are locally
committed as 5541c7a19. Follow-ups are separate local commits: 68d0a324e preserves
imports read by direct eval; 0a1a18533 declares escape/unescape to lint.
No push or release occurred. Protected SafeBash staging retains patch id
69df99c443cea05ae0f9e88dae5d20292332d8b8.

The isolated package's tracked files exactly match 0a1a18533 after applying
the follow-ups and committed README. The independent error-diagnostic-accessors
audit test remains additional untracked verification, not part of the commits.
Experimental weak collections and host-Promise policy tests remain in main,
not this candidate. Private feature index 5XnUdJ has completed its purpose; do
not reuse it for future commits. Follow-up index is stored separately.

Combined maintained build/full-unit verification is running as 75555, explicitly
from the isolated checkout. Its frozen package manifest is 1,164 files with
SHA-256 919f11c3bbaf5c1181e38882a8011026484d493004fbc976f73f901e35754bbe.
Do not claim a passing full rerun until it completes. The earlier 8302 failure
and the 162 passing loader repair tests remain separate evidence.

75555 has completed successfully: 22,765 passed, 37 skipped, zero failures;
838 files passed and one skipped (839 total), 413.52s. All 23 maintained builds
and four fresh imports pass. The post-run 1,164-file manifest exactly matches
919f11c3bbaf5c1181e38882a8011026484d493004fbc976f73f901e35754bbe.
No active candidate test handle remains. Later main-only Proxy work is outside
this passing candidate; weak collections and host-Promise policy remain open.
