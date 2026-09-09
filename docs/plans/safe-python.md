# Safe Python implementation ledger

## Objective

Build full Python 3 support in a modular, efficient, internally and externally
extensible package. Type syntax must parse and be ignored without evaluating
annotation expressions. Integrate filesystem operations with safe-fs. Commit each
meaningful change. The requested work period is at least five days, with seven
days available; completion also requires evidence of the entire requested scope.

## Initial inspection — 2026-09-08

No safe-python package or project-specific Python specification was found in this
checkout. The initial implementation uses the Python language reference as the
compatibility baseline: https://docs.python.org/3/reference/ . An existing external
specification has been requested from the user. The starting worktree contains
unrelated changes; those are outside this task.

## Implementation and evidence sequence

1. Source positions, newline normalization, lexical tokens, indentation, complete
   Python grammar, and syntax diagnostics. Preserve locations through parsing.
2. Explicit Python values and object protocols, scopes, calls, operators,
   exceptions, control flow, comprehensions, generators, coroutines, classes,
   descriptors, pattern matching, and imports. Do not use host eval or host Python
   as an execution shortcut.
3. Parse annotation and type-parameter syntax, including forward references and
   type aliases, without runtime evaluation of type expressions.
4. Builtins and standard library coverage, with a module-by-module audit and
   explicit capability boundaries for filesystem, processes, network, and native
   extensions. Full compatibility must not imply ambient host authority.
5. safe-fs-backed file objects, imports, paths, filesystem modules, binary/text
   streams, error translation, and cancellation using in-memory tests.
6. Public extension contracts for modules, native callables, and execution
   policy; host objects must not leak unrestricted JavaScript capabilities.
7. Execution limits, cancellation, bounded memory, performance measurements,
   adversarial tests, CPython differential evidence, packaging, and documented
   public options. Expose CLI options through the SDK if a CLI is introduced.

Each stage requires failing tests before code, scoped passing tests and lint,
and a meaningful local commit. Checklists alone do not establish compatibility.
Do not mark the overall goal complete while any language, library, safety,
extension, integration, or validation requirement is missing or unverified.

## Current status

- Implemented source cursor and source diagnostics: universal newlines without
  copying the normalized source, original UTF-16 offsets, Unicode code-point
  columns, initial BOM handling, NUL rejection, stable EOF and lookahead.
- Implemented indentation stack: tab stops, ambiguity detection at equal/greater/
  lesser indentation, form feeds, dedent validation, and EOF flushing. Lexer
  integration is still pending; this does not establish complete lexical support.
- Verified 16 in-memory unit cases after observing missing-module failures before
  implementation. Package typecheck, scoped ESLint, and the maintained selected
  workspace build passed. No CLI visual surface was changed.
- Added a numeric token reader with exact bigint-backed integers, binary/octal/
  hexadecimal bases, decimal floats, imaginary coefficients, underscore grammar,
  leading-zero validation, source spans, and deprecated keyword adjacency warnings.
  It leaves following punctuation for the lexer. Unary signs remain parser work.
- Numeric validation: 99 new unit cases (115 package cases total) pass. An ad hoc
  comparison with CPython 3.14.7 covered 1,380 combinations of integer parts,
  fractional parts, exponents, imaginary suffixes, bases, and malformed separators,
  with no acceptance/value differences. Floating and imaginary values were compared
  by IEEE-754 bytes, including overflow and underflow. This evidence covers literal
  reading only, not numeric operations or the complete lexer.
- Added ordinary/raw string and bytes readers: short/triple quotes, all recognized
  escapes, named Unicode escapes, bytes ASCII restrictions, line continuation,
  normalized newlines, source spans, and first-warning behavior. Text literal
  values are code-point arrays so separate escaped surrogates do not collapse
  into a different Python character. Bytes values use Uint8Array.
- Unicode name lookup uses 45,786 explicit names/aliases and 17 algorithmic
  ranges from pinned Unicode 16.0.0 inputs, matching CPython 3.14.7. It searches
  sorted text without constructing a large lookup map. Generated source includes
  the Unicode license; declaration output is 143 bytes, not a literal-type copy
  of the database. The database is local at runtime; no runtime download or host
  Python dependency is introduced.
- Regenerate the name database with
  `npm run generate:unicode --workspace=@poe-code/safe-python`. Input downloads are
  SHA-256 checked in `scripts/generate-unicode.ts`; the pure compilation function
  is tested in memory. Inputs are Unicode's `16.0.0/ucd/extracted/DerivedName.txt`
  and `16.0.0/ucd/NameAliases.txt`. Python's omission of algorithmic Tangut names
  and rejection of multi-character named sequences in string escapes are preserved.
- String/Unicode validation: 212 package unit cases pass. CPython comparison
  checked 194,639 canonical-name/alias lookups without differences. A separate
  3,720-case string corpus yielded 3,710 single-literal comparisons with no
  acceptance, code-point/byte-value, or warning-text differences. Ten generated
  cases were adjacent literals and are explicitly excluded until parser-level
  concatenation exists. Differential failures first exposed non-ASCII escape
  warnings and warning timing; five failing regression cases preceded fixes.
  Focused ESLint, source and generator typechecks, and selected workspace build
  passed. Error-message text/locations have not been exhaustively compared.
- Next: lexical token generation, identifiers, logical-line joining, and f/t-string
  expression parsing, then the complete parser and evaluator. Ordinary literal
  decoding does not establish complete lexical support or interpreter execution.
- Workspace lockfile registration and packaging integration remain pending.
- Package README creation awaits the requested permission under repository rules.
- No push or release was requested.
