# Independent csvformat shell QA

Execute the canonical in-memory shell suite at
`packages/safe-bash/tests/commands/csvformat-stress.test.ts`. Use the maintained
safe-bash test route with a focused csvformat test-name selection after rebuilding
the csvkit public entry. Tests compare stdout bytes, exact stderr, status and
virtual-file effects; they use injected UTF-8 codecs, locale, clock and terminal
bindings, without native executables, real files, network or database access.

1. Verify ASV overrides output tabs, invalid lower-priority delimiters and arbitrary
   terminators; output options must leave the input semicolon/comma dialect intact.
2. Verify physical skip-lines precedes generated headers and header skipping.
   Include writer numbering after skipping and empty-input StopIteration.
3. Verify missing escapes preserve previously emitted headers and VFS redirection
   bytes, leave input unchanged and do not poison later invocations.
4. Verify custom quote, no-doublequote and explicit escaping operate on output.
5. Verify nonnumeric output materializes number/text only, including quoted
   numeric inputs, nulls, booleans retained as text, German locale, header-only
   input and generated-header skipping.
6. Verify raw ragged rows, blank records, NULL and leading-zero literals retain
   their content; empty delimiter/terminator arguments use source defaults.
7. Verify input quoting modes 2, 4 and 5 report their explicit status-78 blockers.
   These assertions measure blocker reporting, not compatibility success.
8. Verify invalid output delimiter rejection precedes stdin consumption. Shell
   exec obtains the borrowed iterator during setup; measure `next()` calls rather
   than treating iterator acquisition as command input consumption.

The exact released source examined is csvkit 2.2.0
`csvkit/utilities/csvformat.py`, authenticated by the parent task's archive
SHA-256 `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
ASV, tabs, empty output-option fallback and generated-header sequencing are
source-derived; arbitrary END terminator quoting also has frozen
`docs/csvkit/raw-operation-reference.json` evidence. The original upstream
German-locale regression is independently exercised through the actual Shell.

Duplicate/unnamed typed-column warning identities, full CPython 3.9.6 runtime
coverage, database drivers and typed input dialect conversion remain unqualified
in this focused QA. These are explicit gaps and must not be counted as passes.

Independent execution after the csvkit workspace build: eight tests passed;
the typed-input test verifies explicit blocker reporting. Focused ESLint passed.
Before the rebuild, the original German-locale case failed through the public
shell entry, reproducing the stale public engine behavior; after the root fix
and maintained build it passed. No production engine edits, README changes,
staging, commits or pushes were performed by this reviewer.
