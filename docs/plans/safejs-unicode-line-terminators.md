# Unicode line terminators

JavaScript treats U+2028 and U+2029 as line terminators alongside CR and LF.
The committed lexer rejected them between tokens, failed to end line comments
at them, and did not advance source line positions. Modern quoted strings may
still contain these Unicode characters literally.

Validation used a separate checkout with the exact committed tokenizer blob
`34515cc83dfbdefd69d65615f202b0f54277cf79`. All four new regression cases failed
before the fix: two unexpected-character errors and two incorrect line counts.

The isolated change recognizes both separators in trivia and line positions,
while keeping raw quoted-string newline rejection restricted to CR and LF.
Tests cover token separation, line/block comments, preserved string contents
and source positions. Parser-wide tests, focused lint and package typechecking
are required before pushing this independent fix.

The larger working-tree parser/dynamic-constructor regression run passed
1,194 tests with one existing skip, including HTML-comment execution across
all four terminators. That run is supplementary evidence; the independent
candidate is verified separately and excludes pending dynamic-function work.

Independent candidate verification: 1,109 parser tests passed with one existing
skip; package TypeScript checking passed. Its first lint attempt could not
load an omitted SafeBash configuration dependency, so that attempt is not a
pass. Focused lint is being rerun using the maintained main configuration and
the exact candidate tokenizer bytes through ESLint's stdin/file-name route.

The escaped-continuation audit also reproduced two failures against native
JavaScript: both Unicode separators were retained in decoded strings instead
of being removed after a backslash. The isolated parser now removes them like
LF/CR continuations. The new regression covers both quote styles and template
cooked values. The combined independent candidate is being rechecked with
parser-wide tests, package TypeScript and focused lint after restoring the
committed lint-configuration dependencies.

Final independent validation: 1,111 parser tests passed, one existing skip;
package TypeScript passed. Both exact candidate source blobs and both new test
files passed focused ESLint using the maintained main configuration. The
partial-checkout lint attempts are not counted. The delivery contains only
Unicode terminator/continuation handling, its tests and this plan.
