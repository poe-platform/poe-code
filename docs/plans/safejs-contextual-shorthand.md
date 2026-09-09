# Contextual identifier shorthand

Native comparisons validated rejected non-strict object shorthand for await,
yield and let, plus as rejected as a binding identifier. The initial regression
failed four groups and passed two strict rejection controls.

Object-expression, binding-pattern and assignment-pattern shorthand now use
the same context-sensitive identifier eligibility as ordinary references.
The non-reserved contextual word as is accepted as an identifier, alongside
async and of. Strict yield/let restrictions remain unchanged. Tests exercise
ordinary and escaped spellings across object and destructuring shorthand.

All 40 focused grammar tests and package TypeScript passed. The broader
parser/runtime suite passed 1,260 tests (one skipped), and focused lint passed.
The six shorthand tests also passed with direct guest execution compared to
native results for all 24 accepted source variants.
These changes remain
local and outside the frozen full-validation checkout. Releases and pushes
remain paused.
