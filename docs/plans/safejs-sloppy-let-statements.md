# Non-strict let statement ambiguity

Native comparison validated five rejected valid forms: assignment, postfix
update, member access, a call expression and a traditional for initializer
using a variable named let. The initial regression had five failures and four
passes, retaining strict-mode rejection, the lexical let-let prohibition and
the special statement restriction on let followed by an opening bracket.

Variable-declaration detection now uses lookahead for non-strict let: a binding
name or opening binding-pattern delimiter selects a declaration; other tokens
select an expression. The same predicate is used for statement and for-head
declaration detection. Strict parsing and ordinary var/const dispatch remain
unchanged. All 29 focused grammar checks passed; broader parser/runtime checks,
TypeScript and lint are running. This follows the local contextual let binding repair and is not in
the frozen full-validation candidate. Releases and pushes remain paused.

The broader run subsequently passed 1,249 tests with one skipped, plus
TypeScript and lint. A follow-up audit found lexical loop bindings named let
accepted by the separate for-in/of declaration path. Two regression groups
failed and twelve controls passed. That path now rejects let in non-var bound
names, while preserving var let, plain for-in targets and parenthesized for-of
targets. The expanded broad run passed 1,254 tests with one skipped; TypeScript
and lint also passed. Five added runtime/recovery tests suspend generators
containing let bindings and check original/restored results against native
JavaScript. They cover assignment, update, traditional loops and var for-of /
identifier for-in targets. All 19 focused parser/recovery tests passed;
lint for the new recovery file is running.
