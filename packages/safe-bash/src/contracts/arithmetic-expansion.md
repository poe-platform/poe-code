# Arithmetic expansion

`$((expression))` performs parameter, command, backtick, and nested arithmetic
expansion before evaluating the resulting arithmetic expression. Named, braced,
and positional parameters use the existing parameter operators and nounset rules.
Scalar indirection (`${!name}`) remains unsupported, as elsewhere in this shell.
For example, both `rows=3; value=$(($rows-1))` and
`value=$(($(printf 3)-1))` assign `2`.

Expansion is left-to-right and precedes arithmetic short-circuit evaluation.
Parameter assignments and nested arithmetic writes affect the current shell;
command substitutions retain their isolated state, output trimming, and exit
status behavior. Each substitution executes once. Substitution output is
arithmetic data, never reparsed as shell source.

There is no field splitting, pathname expansion, or brace expansion of the
arithmetic body. Literal double quotes are removed, single quotes are literal,
and backslashes follow double-quoted expansion rules. Quotes introduced by a
parameter or command result remain data rather than quotation syntax.

Expanded operands and arithmetic reparsing share the invocation's expansion,
parse, command, output, cancellation, and nesting limits. Limit failures escape
as their original control failures, and cancellation preserves the original
reason. Reusing a previously parsed literal arithmetic tree does not reparse it.

This contract concerns arithmetic expansion, not new syntax for `((...))`
commands or arithmetic `for` headers. The existing scalar arithmetic evaluator
and its operator, integer-width, recursive-variable, and array restrictions
remain in effect; this is not a claim of complete Bash arithmetic compatibility.
