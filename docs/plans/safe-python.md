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
- Added Unicode 16 identifier classification and raw name-token reading with
  source spans. Generated/coalesced tables contain 684 start ranges and 800
  continuation ranges. ASCII takes a direct path; non-ASCII uses binary search.
  The Unicode generator now also hashes and reads `DerivedCoreProperties.txt`.
  No host Unicode character classification or runtime data downloads are used.
- Identifier validation: all 1,114,112 code points were compared in both start
  and continuation positions with CPython 3.14.7 (2,228,224 classifications), with
  zero differences. The initial check exposed an incorrect older-Python assumption
  about join controls; three failing regressions preceded its removal. There are
  now 249 passing package unit cases. Source/build and generator typechecks and
  focused ESLint passed. The name reader preserves spelling; parser-level NFKC
  normalization is still required, including avoiding dependence on host Unicode
  versions (the inspected host reports Unicode 17, while the target uses 16).
- Added the public lazy `lex(text, { filename?, onWarning? })` token stream.
  It joins explicit and bracketed physical lines, suppresses comments and blank
  logical lines, emits indentation/dedentation and EOF, matches delimiters and
  longest operators, and integrates existing name/literal readers. No CLI or
  environment variables were introduced. This is a lexer API, not a complete
  interpreter API.
- Lexer validation: 304 package unit cases pass. A comparison of 89 source
  fixtures with CPython matched significant token kinds and non-indent lexemes
  after newline normalization. INDENT text was compared separately: after a
  leading backslash continuation, CPython's public tokenizer reports the later
  physical prefix, while this API retains the earlier prefix that determines the
  actual indentation width. CPython compilation confirmed the width behavior.
  Further compilation checks exposed comment/blank-line continuation handling;
  three failing regression cases preceded deferred indentation acceptance.
  Source typecheck and selected workspace build passed; focused lint also passed.
- Added f/t-string tokenization with an explicit mode stack for literal text,
  replacement fields, and format specifications. The existing lexer reads field
  expressions, including nested f/t strings, ordinary strings, dictionaries,
  slices, comments, physical newlines, and quote reuse. Top-level colons enter
  format mode; parenthesized walrus expressions retain their normal operator.
  Literal doubled braces collapse in `content`, while `text` and spans retain
  source spelling. Escapes remain encoded for parser-level literal decoding.
- Interpolation validation: 331 package unit cases pass, including 300 nested
  interpolated strings without recursive lexer calls. A 992-case differential
  corpus matched CPython syntax acceptance and significant tokens after merging
  adjacent middle-text tokens and dropping empty middle tokens. Thirty-two
  deliberately mismatched-delimiter fixtures used CPython compilation as the
  reference: its public tokenizer emits those invalid delimiters without rejection.
  Prefix case/raw variants, both quote sizes, format fields, named escapes,
  multiline expressions, conversions, and debug-marker tokens were covered.
  Source typecheck, selected workspace build, and focused lint passed.
  This does not validate field-expression grammar, conversion semantics,
  interpolated literal escape decoding/warnings, formatting, or evaluation.
- Added a shared bounded-lookahead token cursor, source-spanned expression AST,
  and public `parseExpression(text, { filename?, onWarning? })` API. The first
  expression grammar covers scalar literals, raw name spellings, grouping,
  arithmetic/bitwise operators, unary signs/inversion/not, boolean and/or,
  chained comparisons, and conditional expressions. Comparison chains retain
  all operands so a future evaluator can evaluate each intermediate operand once.
  No evaluation or host code execution is introduced.
- Expression validation: 358 package unit cases pass. CPython AST comparison
  covered 755 combinations of binary/comparison/boolean operators, unary prefixes,
  grouping, and conditional expressions, with no structural differences after
  flattening equivalent boolean chains. Source typecheck, selected workspace
  build, and scoped ESLint passed. Parenthesis/source-span conventions were not
  part of that AST comparison. Identifier binding still needs pinned NFKC
  normalization; AST names deliberately retain `spelling` rather than claiming
  to contain normalized binding names.
- Added primary trailers: chained calls, attributes, subscriptions, slices with
  omitted bounds/steps, multidimensional keys, and starred subscription keys.
  Calls retain positional/keyword/iterable-unpacking/mapping-unpacking forms and
  reject invalid ordering and repeated raw keyword spellings. The AST preserves
  source argument order; runtime evaluation must still implement Python's
  positional/starred-before-keyword evaluation rule. Scalar and tuple keys remain
  distinct even for one-element trailing-comma and unpacked subscriptions.
- Primary validation: 382 package unit cases pass. A 110-case CPython compilation
  and AST comparison covered argument-order combinations, unpacking, slices,
  trailing commas, and chained trailers with zero differences. Comparison grouped
  call arguments into CPython's positional and keyword AST lists; this is a syntax
  check, not runtime argument evaluation evidence. Focused lint, source typecheck,
  and selected workspace build passed. Normalized duplicate-keyword checks still
  depend on the pending pinned identifier normalization/binding work.
- Added tuple/list/set/dictionary display parsing, including empty collections,
  grouping versus singleton tuples, top-level unparenthesized tuples, iterable
  unpacking, and mapping unpacking. Commas are owned by their grammar context so
  tuple parsing does not absorb call arguments or subscription dimensions.
  Dictionary entries remain ordered and retain duplicate keys for later evaluation.
  Unparenthesized unpacking operands follow the display grammar's bitwise-or
  precedence boundary; conditionals/boolean expressions require grouping there.
- Display validation: 406 package unit cases pass. A 515-case comparison with
  CPython compilation and ASTs covered ordinary, starred, mapping, key/value,
  and mixed-invalid displays with and without trailing commas, with no differences.
  Source typecheck, scoped ESLint, and selected workspace build passed. Collection
  construction, key equality/hashing, duplicate-key replacement, and unpacking
  protocols are still runtime work; this evidence proves syntax/tree behavior only.
- Added adjacent ordinary string/bytes literal concatenation before primary
  trailers. Text remains a sequence of Python code points, including distinct
  escaped surrogates across literal boundaries. Mixed bytes/text concatenation
  is rejected. Joined logical lines permit concatenation across comments and
  explicit continuations; separate logical lines do not. Multiple segments are
  collected and copied once into the final typed array, not repeatedly appended.
- Concatenation validation: 416 package unit cases pass, including a 1,000-literal
  sequence. All 363 CPython comparisons of prefix/quote/content combinations and
  logical-line joins matched acceptance and decoded values. Source typecheck,
  scoped lint, and selected workspace build passed. Mixing interpolated and
  ordinary literals still depends on the pending interpolated-string AST parser.
- Added lambda expression trees with positional-only, positional-or-keyword,
  keyword-only, variadic positional, and variadic keyword parameters. Defaults
  and bodies remain unevaluated expressions, including nested lambdas. Parameter
  ordering, separators, raw duplicate names, and default-placement rules are
  validated; lambda precedence permits conditional alternatives but rejects
  unparenthesized lambdas in arithmetic operands and conditional conditions.
- Lambda validation: four valid-syntax tests failed before implementation; all
  440 package unit cases now pass. A generated 9,361-case CPython compilation
  and parameter-tree comparison matched acceptance, parameter categories, and
  literal defaults without differences. Scoped lint, source typecheck, and selected workspace
  build passed. Identifier-normalized duplicate checks and runtime function/default
  evaluation remain pending.
- Added list/set/dictionary comprehensions and generator expression trees,
  including the sole-argument call form. Ordered for/async-for clauses preserve
  iterable and filter expressions. Loop target parsing validates tuple/list
  destructuring, starred targets, attribute/subscript targets, and forbidden
  `__debug__` assignments. Iterables and filters follow disjunction precedence.
  Reference: https://docs.python.org/3/reference/grammar.html (Python 3.14).
- Comprehension validation: eight positive tests failed before implementation;
  follow-up failing regressions covered `__debug__` and generator source spans.
  All 474 package tests pass. A 7,020-case CPython compilation comparison matched
  syntax acceptance, and 300 CPython AST comparisons matched collection forms,
  targets, clause order, async flags, and filters. The AST comparisons intentionally
  use parsing rather than compilation for async forms: enclosing async-context
  validation is pending the statement/scope pass. Scoped lint, source typecheck, and selected
  workspace build passed. Comprehension scopes, iteration, eager versus lazy
  evaluation, assignment-expression restrictions, and async execution remain
  implementation work; these checks establish syntax only.
- Added assignment-expression trees with unevaluated values and simple name
  targets. A named-expression reader is used only where the grammar allows bare
  `:=`, including displays, positional call arguments, and nonslice subscriptions.
  Dictionary keys and slice bounds require parentheses; keyword values, lambda
  bodies/defaults, conditionals, and comprehension filters keep expression or
  disjunction grammar. Grouped targets, chained bare assignments, non-name targets,
  and assignment to `__debug__` are rejected.
- Assignment-expression validation: 23 tests failed before implementation; all
  522 package tests now pass. 1,596 CPython parser acceptance comparisons matched,
  plus 36 compiled CPython AST comparisons covering value precedence and contextual
  placement. Scoped lint, source typecheck, and selected workspace build passed.
  This establishes grammar, not binding: comprehension iterable restrictions,
  iteration-variable rebinding checks, enclosing-scope binding, and normalized
  identifiers still need the semantic validation/runtime work.
- Added a post-parse expression validation pass for comprehension assignment
  restrictions. It rejects assignment expressions anywhere in iterable subtrees,
  iteration-variable rebinding across nested comprehensions, and CPython's ordered
  loop-target conflicts. Lambda defaults retain the surrounding context, while
  bodies establish a new binding context without bypassing iterable restrictions.
  A typed, exhaustive child enumerator visits syntax rather than reflecting over
  arbitrary objects or literal buffers; new expression variants require updating it.
- Scope validation: 16 initial tests and six follow-up target-conflict regressions
  failed before their implementations. All 557 package tests pass. A 1,100-case
  CPython compilation comparison matched acceptance across comprehension forms,
  nested lambdas/comprehensions, filters, targets, and iterable expressions.
  Scoped lint, source typecheck, and selected workspace build passed. Reference rules were
  checked against PEP 572 and CPython's symtable implementation; the latter exposed
  ordered conflicts involving names read by attribute/subscript targets.
  Normalized-name checks, class/global/nonlocal contexts, runtime binding, and
  complete semantic validation remain pending.
- Next:
  interpolated-string ASTs, parser-level NFKC
  normalization, the complete grammar/parser and evaluator, then runtime modules
  and safe-fs integration. Tokenization does not establish interpreter execution.
- Workspace lockfile registration and packaging integration remain pending.
- Package README creation awaits the requested permission under repository rules.
- No push or release was requested.
