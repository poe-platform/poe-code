# Legacy non-strict for-in initializers

Native execution validated rejected ordinary non-strict var initializers in
for-in heads. The initializer runs before the right-hand expression, including
when enumeration is empty or null. Nine tests failed initially (seven execution
cases and two suspension/recovery cases); seven invalid forms were rejected.

The parser admits only a non-strict var identifier initializer in a for-in
head. A token boundary separates the initializer from the loop's in operator,
including conditional-consequent and parenthesized in expressions. The syntax
is lowered to a block containing the initialization and the existing for-in
loop. The loop keeps its labels; its identifier node is copied to avoid shared
node IDs. Existing block/declaration suspension support is reused, rather than
adding a new snapshot continuation phase.

Tests cover evaluation order, empty/null enumeration, conditional expressions,
labels, with-scope effects, invalid strict/lexical/destructuring/of forms and
restore during both initialization and right-hand evaluation. All 16 focused
tests and package TypeScript passed. The broader parser/runtime suite passed
1,457 tests (one skipped). Focused lint remains required. This is local work,
not a validated full delivery. Releases and
pushes remain paused.
