# Contextual function names and strict directives

Native comparisons validated rejected ordinary, generator and async function
expression names using contextual identifiers. They also exposed accepted
invalid strict function names: a use-strict body did not revalidate the name
parsed before the directive. The initial regression run failed 31 tests and
passed 14 controls.

Function-expression names now use their own async/generator grammar, retaining
inherited strictness. Declaration names continue to use the enclosing grammar,
as native declarations and expressions have different restrictions. Once the
body is parsed, declarations and expressions reject strict-reserved names if
the body's directive made the function strict.

Tests compare all four function forms, five contextual/restricted names,
declaration versus expression, and optional strict directives against native
compilation. Additional cases verify nested grammar reset and guest execution.

All 45 focused tests, package TypeScript and focused lint passed. The broader
parser/runtime suite passed 1,314 tests, with one skipped. Changes remain local; pushes and
releases remain paused.
