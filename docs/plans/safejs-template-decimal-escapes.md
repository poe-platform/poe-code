# Template decimal escapes

Native VM comparisons reproduce two template escape defects for `\8` and `\9`:
untagged templates were accepted and tagged templates produced string cooked
values instead of undefined. Initial regression run: four failures, 13 passes.

The [ECMAScript template lexical grammar](https://tc39.es/ecma262/2026/multipage/ecmascript-language-lexical-grammar.html#sec-template-literal-lexical-components)
classifies these as NotEscapeSequence. Reject them in untagged templates and
reuse the existing invalid-cooked handling for tagged templates. Do not alter
ordinary string tokenization or strict/non-strict dynamic-function grammar.

Tests compare all four quasi positions, preserve raw text and substitutions,
and cover existing octal rejection, null escapes and escaped backslashes.
The isolated committed-source candidate passes 132 parser/tokenizer tests,
including the 17 new regressions. Stage the exact tested parser blob, not
partial insertion offsets from the larger runtime worktree.

Additional isolated template identity, generator replay, error-order and freeze
coverage passes 46 tests. Package TypeScript and focused worktree ESLint pass.
