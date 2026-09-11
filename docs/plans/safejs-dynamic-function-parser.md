# Guest dynamic-function parser stage

Implement the internal source parser required by Function, GeneratorFunction,
AsyncFunction, and AsyncGeneratorFunction. Parse the parameter list and function
body separately before parsing the complete expression. Use only the guest parser,
preserve canonical source ranges and guest regex literals, reject module-only
import.meta, and preserve fatal compilation-owner limits as SandboxError.

Dynamic source has explicit Yield/Await/strict grammar state, separate from existing
SafeJS script extensions. Scope it through nested functions, arrows, and classes.
Respect directive prologues and automatic semicolon insertion. Permit duplicate
simple parameters in non-strict function constructors of all four kinds; reject
them in strict functions, methods, arrows, and non-simple lists. Native Node 18/24
comparisons corrected an initial mistaken assumption about async/generator
duplicates before this stage was committed.

## Verification

The parser suite passes 956 tests with one existing opt-in fuzz test skipped.
The new compiler file contains 111 tests, including contextual grammar, boundary
injection, exact source text, and fatal work/string-length limits. Explicit
test-file TypeScript checking and focused lint pass. The maintained 23-workspace
SafeJS build closure passes, including four fresh-import checks. Rebuilt Node
18.18.0 and Node 24.14.0 each pass all 360 native comparisons.
No matching open GitHub issue was found.

## Remaining integration

This is an internal parser stage, not runtime Function support. The global
constructors are still absent. Implement guest global-environment capture,
constructor/prototype behavior, non-strict this and arguments semantics, retained
source/AST accounting, cancellation, and dynamic source identities for snapshots.
Require the public dynamic-function regression suite to pass before claiming that
integration is delivered; do not substitute parser coverage for runtime coverage.
