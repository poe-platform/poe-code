# Escaped keyword syntax

Native/source comparisons found escaped return, if, true and null accepted
as actual keywords by SafeJS, whereas native JavaScript rejects them. Escaped
keywords used as property names (object keys, methods and member access) and
an ordinary escaped identifier all matched native behavior. Escaped if in a
variable binding was already rejected.

The tokenizer decodes identifier escapes and classifies the decoded spelling
as keyword without preserving the distinction. The parser must distinguish
keyword grammar from IdentifierName property grammar, while also supporting
contextual words in allowed identifier positions. Do not globally reject
escaped property names or turn all escaped reserved words into unrestricted
identifiers. Added parse regressions cover both rejection and acceptance.
The initial regression run failed four cases and passed five controls. The
tokenizer now emits escaped-keyword tokens for escaped spellings in its keyword
set. IdentifierName property positions accept them, contextual identifier
handling preserves permitted await/yield uses, and ordinary keyword grammar
does not consume them. The three focused parser/tokenizer/regression files
passed 124 tests, and package TypeScript passed. Broader parse and dynamic-function
tests and lint are being checked. Additional grammar paths that use token values directly
still require audit; this is not a complete escaped-keyword conformance claim.

The first broad run passed 1,229 tests with one skipped. A follow-up native
audit validated six further failures: escaped var, switch, new, super, in and
debugger. Their regression run failed six cases and passed nine controls.
Escaped reserved spellings that otherwise use identifier tokens now receive
the escaped-keyword category, and new/super/binary-operator grammar checks
exclude it. The expanded broad run passed 1,235 tests with one skipped, and
TypeScript passed. Focused lint for the latest changes is running. Hashes are
derived from parsed ASTs rather than token categories; valid property-name
ASTs remain unchanged by this classification.

Latest escaped-keyword lint passed. A contextual-word audit found non-strict
var let rejected in both ordinary and escaped spellings. Native controls
confirmed both valid; the regression failed those two cases and passed 18
others, including strict rejection and the lexical let-let prohibition.
Non-strict contextual identifier handling now includes let, with an explicit
prohibition on let as a lexical-declaration binding. The broader parser/runtime
suite passed 1,240 tests with one skipped, and TypeScript passed. Latest lint
is running. Statement-position let ambiguity
still needs separate coverage; these binding cases do not prove every use.

Releases and pushes remain paused.
