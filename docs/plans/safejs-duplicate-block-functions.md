# Repeated non-strict block functions

Eight native runtime comparisons failed because SafeJS rejected repeated
ordinary function declarations in non-strict blocks and switch bodies.
Eight strict, mixed async/generator and lexical/var conflict controls passed.

Track ordinary non-strict block declarations distinctly in parser scope
bookkeeping. Permit repetition only for that declaration category, preserving
var and lexical conflict checks. During block binding initialization, later
eligible declarations replace the existing block function binding; calls before
either declaration therefore see the final function, matching native behavior.
Keep the existing execution-time outer var binding update semantics.

Validate executed/unexecuted switch cases, lexical shadowing, strict function
bodies inside non-strict blocks and generator checkpoint restoration. Focused
tests passed 42 cases; checkpoint checks passed 11. Broader parser/runtime/
snapshot checks passed 1,531 tests with one skip, and TypeScript passed.
Focused lint passed.
This is local work outside the frozen integration candidate; publication is held.
