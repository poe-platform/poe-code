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
- Added decoded code-point values to interpolated text tokens, alongside their
  retained content/source spelling. Ordinary and interpolated strings share escape
  decoding and warning formatting. Raw strings preserve backslashes, doubled braces
  stay literal, backslashes do not escape field braces, and format text uses the
  same decoder. Warning positions refer to the original source even after doubled
  braces or universal-newline normalization.
- Interpolated-text validation: seven tests failed before implementation. All 565
  package tests pass, including malformed escapes, surrogate preservation, raw
  prefixes, escaped CRLF, and warning callbacks. A 2,048-case CPython comparison
  matched decoded literal values and rejection of invalid escapes across f/t/raw
  prefixes and paired text fragments. Scoped lint, source typecheck, and selected workspace build
  passed. Interpolated expression-tree assembly, conversions, debug fields, adjacent
  interpolated literals, and runtime formatting/template construction remain pending.
- Added formatted/template string expression trees with ordered decoded text and
  replacement fields, explicit conversions, debug text, template expression spelling,
  tuple/starred fields, and recursively nested format specifications. Expressions
  remain unevaluated. The expression visitor reaches fields and nested format
  specifications so existing comprehension scope checks apply inside strings.
  Lexer comment-span callbacks let source retrieval omit actual comments without
  stripping hash characters inside string literals; retrieval uses binary search
  over ordered comment spans, not rescanning or retokenizing expressions.
- Interpolated-expression validation: five positive tests failed before implementation,
  followed by a failing regression for comment omission in debug/template spelling.
  All 582 package tests pass. A 990-case CPython compilation and AST comparison
  matched field values, conversions, debug text, template spelling, nested formats,
  and invalid-field rejection. Scoped lint, source typecheck, and selected workspace build passed.
  Reference: https://docs.python.org/3/reference/lexical_analysis.html#f-strings.
  Adjacent interpolated-literal concatenation, yield/await fields, runtime formatting,
  and template construction remain pending; these checks prove parser behavior only.
- Added one string-sequence reader for ordinary, byte, formatted, and template
  literals. Plain text may concatenate with formatted strings, while templates
  concatenate only with templates and bytes only with bytes. Sequences bind as
  one primary before trailers; empty/field-free formatted and template strings
  retain their distinct expression kind. Contiguous text runs are collected then
  copied once, with field order, debug metadata, code points, and source spans intact.
- Concatenation validation: eight positive tests failed before implementation;
  all 599 package tests now pass, including a 1,000-segment formatted/plain sequence.
  A 2,744-case CPython compilation and AST comparison of three-literal combinations
  matched acceptance, string kind, decoded text, field order, debug text, conversions,
  and format specifications. Scoped lint, source typecheck, and selected workspace build passed.
  Runtime string construction/formatting and template objects remain pending.
- Added a pinned Unicode 16 NFKC normalizer as the prerequisite for normalized
  identifier binding. Generated, hash-verified UnicodeData and normalization-property
  tables supply 5,913 decompositions and 961 canonical compositions, with algorithmic
  Hangul processing and stable combining-mark ordering. Long combining runs use
  stable sorting rather than quadratic insertion ordering, and output construction
  avoids unbounded host argument spreading. No host String.normalize is required.
  Unicode normalization is stable for characters assigned in both versions, but
  the repository's older supported Node versions may predate Unicode 16, so relying
  on host normalization alone would not meet the target repertoire.
- Normalization validation: the new normalizer test suite initially failed because
  the implementation was missing. All 617 package tests pass, including a test with
  host normalization disabled. All 99,825 NFKC checks across 19,965 official Unicode
  16 NormalizationTest rows pass, plus exhaustive comparison of 1,114,112 individual
  code points against CPython's Unicode 16 normalizer. Regeneration is byte-identical.
  Scoped lint, source typecheck, and selected workspace build passed. The parser still retains
  only raw identifier spelling; wiring normalized names into its AST, duplicate
  checks, forbidden-binding checks, and scope validation is the next step.
- Integrated pinned NFKC into name, attribute, parameter, and keyword-argument AST
  nodes. `spelling` retains source text; `name` is the normalized binding key.
  Keyword recognition still uses raw spelling, so compatibility spellings of
  keywords remain valid identifiers. Duplicate parameters/keywords, forbidden
  `__debug__` bindings, and comprehension scope conflicts now use normalized names.
  String values and template/debug source spelling are not normalized.
- Normalized-name validation: all 20 initial tests failed before implementation,
  followed by two failing regressions for forbidden explicit `__debug__` keyword
  arguments. All 639 package tests pass. A 1,350-case CPython compilation and AST
  comparison matched acceptance and normalized names across parameters, keywords,
  attributes, assignments, and comprehension targets, including canonical and
  compatibility-equivalent spellings. Scoped lint, source typecheck, and selected workspace build
  passed. This supplies binding keys and checks; runtime environments, function
  argument binding, and class/global/nonlocal semantics remain unimplemented.
- Added await, yield, and yield-from expression trees. Await consumes a primary
  before exponentiation; yield owns its comma-separated value list and is admitted
  by grouping and replacement-field grammar rather than as an unrestricted prefix.
  Empty yields, tuple unpacking, delegation operands, lambda bodies with grouped
  yields, and suspension expressions inside formatted/template fields are retained
  without execution. The child visitor reaches their values for scope checks.
- Suspension syntax validation: four positive tests failed before implementation;
  all 656 package tests pass. A 108-case CPython AST comparison matched acceptance
  and tree structure across operands, precedence, groups, and replacement fields.
  CPython compilation separately confirmed rejection of a lone starred yield value
  and acceptance of its tuple form. Scoped lint, source typecheck, and selected workspace build
  passed. Enclosing function/async checks, comprehension yield restrictions,
  generator/coroutine state machines, delegation, and await protocols remain pending.
  Grammar reference: https://docs.python.org/3/reference/grammar.html.
- Added comprehension yield-context validation. Bodies, filters, targets, and later
  iterables reject yield/yield-from; the first iterable retains the containing
  scope. Nested lambda bodies establish their own scope, while defaults remain in
  the surrounding context. The existing blanket assignment-expression restriction
  for iterable subtrees is preserved independently of this scope distinction.
- Comprehension suspension validation: 13 tests failed before implementation;
  all 676 package tests pass. A 540-case CPython compilation comparison, wrapped
  in a regular function, matched acceptance across collection forms, nested scopes,
  lambda defaults/bodies, fields, targets, filters, and first/later iterables.
  Scoped lint, source typecheck, and selected workspace build passed. Top-level/function/async
  validation and runtime generator/coroutine behavior still require implementation.
- Added public `parseModule` with module/statement AST types and initial simple
  statements: pass, expression statements, chained/destructuring assignments,
  augmented assignments, and annotated assignments. Logical lines and semicolon
  separators are consumed from the lazy token stream. Assignment target validation
  is shared with comprehensions, and augmented operations retain their target once
  rather than being rewritten into a duplicated expression. Token-cursor creation
  now shares comment/source plumbing between expression and module entry points.
- Annotation expressions are parsed and discarded, not stored in executable ASTs
  or subjected to expression-scope checks. Targets, optional values, and the simple
  name marker remain available for later binding semantics. This deliberately
  differs from Python's annotation evaluation/storage to meet the ignored-types
  requirement; function/type-parameter/type-alias syntax still needs implementation.
- Module validation: the new suite initially failed because the module entry point
  did not exist. All 713 package tests pass. A 1,020-case CPython compilation comparison
  matched acceptance, statement kinds, target counts, and annotation metadata;
  146 additional comparisons matched complete supported trees after omitting
  annotations. Scoped lint, source typecheck, and selected workspace build passed. Enclosing
  module/function/async validation, remaining simple statements, compound statements,
  execution, and safe-fs integration remain pending.
  Reference: https://docs.python.org/3/reference/simple_stmts.html.
- Added return, raise, assert, break, and continue syntax. Returns retain optional
  tuple/unpacked values; raise retains a separate exception and explicit cause;
  assertions retain their condition and optional message. An exhaustive statement
  expression enumerator reaches every executable operand while continuing to omit
  discarded annotations, so existing expression scope checks cover the new forms.
- Control-flow simple-statement validation: four positive tests failed before
  implementation; all 732 package tests pass. A 70-case CPython compilation and
  AST comparison matched acceptance and operands, with compilation wrapped inside
  a regular function and loop to isolate grammar from enclosing-context checks.
  Scoped lint, source typecheck, and selected workspace build passed. Function/loop placement,
  return unwinding, exception handling, assertion execution, and loop transfers
  remain semantic/runtime work.
- Added del, global, and nonlocal syntax. Declarations preserve ordered raw spelling
  and normalized binding names, including duplicates. Deletion retains explicit
  tuple/list target structure and shares target validation with assignment, with
  deletion-specific rejection of starred targets and forbidden normalized names.
  Executable target expressions remain visible to the expression-scope validator.
- Declaration/deletion validation: two positive tests failed before implementation;
  all 754 package tests pass. A 534-case CPython comparison matched syntax acceptance
  and AST structure/name lists. Deletion cases were compiled; declaration cases
  used AST parsing to isolate syntax from pending nonlocal-resolution and declaration
  ordering checks. Scoped lint, source typecheck, and selected workspace build passed. Actual
  deletion, global/nonlocal binding, and enclosing-scope validation remain pending.
- Added import and from-import syntax with dotted module components, normalized
  aliases, relative levels, star imports, and parenthesized/multiline from-import
  name lists. ASTs retain path components and alias spans without loading modules
  or touching the filesystem. Forbidden-name checks apply to the actual bound name,
  not unrelated components of an import path.
- Import validation: five positive tests failed before implementation; all 780
  package tests pass. A 560-case CPython compilation and AST comparison matched
  acceptance, module paths, aliases, relative levels, and star imports. Scoped lint, source
  typecheck and selected workspace build passed. Runtime module loading/caching,
  capability-aware safe-fs resolution, future directives, and scope restrictions
  on star imports remain pending.
- Added indented and single-line suites with if/elif/else and while/else ASTs.
  Suite parsing owns line separators and dedents, preserving nested else ownership;
  single-line suites admit only simple statements. Expression validation descends
  into all branch conditions and bodies, excluding ignored annotations as before.
- Compound-suite validation: four positive tests failed before implementation;
  all 797 package tests pass. A 205-case CPython AST-parser comparison matched
  syntax acceptance and nested body/else structure. Scoped lint, source typecheck,
  and the selected workspace build passed.
  This is grammar coverage, not loop execution or enclosing-scope validation.
- Added for and async-for syntax with shared assignment-target validation,
  starred/comma-separated iterables, single-line or indented bodies, and loop else
  suites. Executable expressions in targets, iterables, bodies, and else suites
  participate in expression validation. No iteration or async execution is claimed.
- For-loop validation: three positive tests failed before implementation; all 814
  package tests pass. A 768-case CPython compilation and AST comparison matched
  acceptance, target/iterable trees, async flags, and body/else membership. CPython
  cases were wrapped in an async function to isolate loop syntax from pending
  enclosing-function restrictions. Scoped lint, source typecheck, and the selected
  workspace build passed.
- Added try/except/except*/else/finally syntax with ordered handlers, normalized
  aliases, nested suites, and Python 3.14 unparenthesized exception lists. Rejects
  mixed regular/group handlers, non-final bare handlers, bare group handlers,
  forbidden alias bindings, and unparenthesized multiple types with an alias.
  Expression validation visits handler types and every suite.
- Try-statement validation: three positive tests failed before implementation;
  all 834 package tests pass. A 1,024-case CPython compilation and AST comparison
  matched syntax acceptance, exception type trees, normalized aliases, group flags,
  and handler/else/finally membership. Scoped lint, source typecheck, and the selected
  workspace build passed. Exception matching,
  exception-group splitting, unwinding, and except-star control-flow restrictions
  remain runtime/enclosing-scope work.
- Added with/async-with syntax, ordered manager expressions, validated assignment
  targets, parenthesized multi-manager headers, and nested suites. Ordered grammar
  alternatives distinguish manager-list parentheses from tuple, generator, named,
  and trailer-bearing expressions. The lazy cursor retains tokens during an
  alternative, replays failed alternatives without repeating lexer callbacks,
  preserves lexical errors, and releases consumed tokens after alternatives end.
- With-statement validation: three positive syntax tests and three token-replay
  tests failed before implementation; all 852 package tests pass. A 768-case
  CPython compilation and AST comparison matched acceptance, async flags, ordered
  context expressions, and target trees. CPython cases ran inside an async function
  to isolate syntax from pending enclosing-scope checks. Scoped lint, source
  typecheck, and the selected workspace build passed.
  Context-manager protocol calls, unwinding, suppression, and async execution
  remain runtime work.
- Added synchronous/async function definitions, ordered decorators (including
  named assignments), nested function suites, and shared function/lambda parameter
  parsing. Preserves positional-only, keyword-only, variadic parameters, defaults,
  and normalized names. Parameter/return annotations, including starred variadic
  annotations, are parsed and discarded rather than evaluated or validated as
  executable expressions. Defaults, decorators, and bodies remain executable ASTs.
- Function validation: four initial positive tests and an additional named-decorator
  test failed before implementation; all 875 package tests pass. A 2,136-case
  CPython compilation and AST comparison matched acceptance, async flags, parameter
  categories, normalized names, defaults, and decorator kinds. Scoped lint, source
  typecheck, and the selected workspace build passed. Generic type-parameter
  syntax, function symbol tables, closures, call binding, and execution remain pending.
- Added class definitions with normalized names, ordered decorators, nested suites,
  methods, and shared call-argument parsing for bases, unpacking, and metaclass
  keywords. Retains original argument order in the executable AST. Class headers
  require generator base expressions to be parenthesized even though calls accept
  bare generator clauses; this difference was found by CPython comparison and
  reproduced with a failing regression test before correction.
- Class validation: four positive tests failed before implementation, followed by
  the bare-generator regression; all 893 package tests pass. A 924-case CPython
  compilation and AST comparison matched acceptance, normalized class/keyword names,
  base and keyword expressions, and decorator trees. Scoped lint, source typecheck,
  and the selected workspace build passed. Generic class parameters,
  class scope rules, MRO, metaclass construction, descriptors, and execution remain
  pending.
- Added ignored generic type-parameter lists to functions, async functions, and
  classes. Parses bounds, constraints, defaults, TypeVarTuple unpacked defaults,
  ParamSpec defaults, trailing commas, and multiline lists. Enforces normalized
  duplicate names, forbidden bindings, default ordering, and variadic-bound grammar
  restrictions without retaining type expressions or introducing runtime bindings.
- Generic validation: three positive tests failed before implementation; all 915
  package tests pass. A 2,166-case CPython compilation comparison matched syntax
  acceptance and definition identity. Separate tests establish discarded type
  expressions and continued validation of executable defaults and class bases.
  Scoped lint, source typecheck, and the selected workspace build passed.
  Type aliases, the remaining grammar, and runtime
  implementation remain pending.
- Added ignored type-alias statements with normalized names, generic parameter
  lists, and parsed-but-discarded values. Soft-keyword recognition speculates only
  over the `type NAME` prefix, leaving ordinary type calls, subscripts, operators,
  annotations, and assignments intact. Alias nodes retain identity/spans but expose
  no executable expressions; this intentionally does not implement TypeAliasType
  objects or lazy alias evaluation under the requested ignored-types behavior.
- Type-alias validation: four positive tests failed before implementation; all 934
  package tests pass. A 512-case CPython compilation comparison matched syntax
  acceptance, statement kinds, and normalized alias names. Tests separately verify
  aliases in nested suites, discarded values, and continued validation of adjacent
  executable statements. Scoped lint, source typecheck, and the selected workspace
  build passed. Pattern matching, enclosing-scope
  validation, execution, and safe-fs integration remain pending.
- Added an internal structural-pattern AST and grammar reader for captures,
  wildcards, singletons, signed numeric/complex and adjacent string literals,
  dotted values, open/grouped/bracketed sequences, star captures, mappings/rest
  bindings, positional/keyword class patterns, alternatives, and as bindings.
  Pattern literals reject arbitrary expressions and interpolated strings.
- Pattern grammar validation: the new suite initially failed on the missing
  module; subsequent failing regressions covered nested-sequence preservation,
  sole-star list patterns, and underscore class/value-pattern rejection. All 966
  package tests pass. A 216-case CPython AST-parser comparison matched grammar
  acceptance and full pattern trees. Compilation-only binding restrictions were
  deliberately excluded from that comparison; cross-pattern capture validation,
  irrefutability, duplicate mapping keys, match-suite integration, and execution
  remain pending. Scoped lint, source typecheck, and the selected workspace build
  passed.
- Connected patterns to match/case statements with ordered guarded cases, indented
  case blocks, nested suites, named/tuple/unpacked subjects, and named guards.
  Header-only grammar alternatives preserve ordinary match/case identifiers.
  Executable expression enumeration includes subjects, pattern values, guards,
  and bodies. Capture validation rejects repeated normalized bindings, different
  binding sets across alternatives, multiple sequence stars, unreachable alternatives,
  and cases after an unguarded irrefutable pattern.
- Match validation: four positive tests failed before implementation; all 989
  package tests pass. A 792-case CPython compilation comparison matched syntax
  acceptance, subject/guard forms, case membership, and capture sets. Scoped lint,
  source typecheck, and the selected workspace build passed. Duplicate literal
  mapping-key checks, enclosing-scope rules,
  and actual structural matching/capture execution remain pending.
- Added compile-time duplicate literal mapping-key validation with Python numeric
  cross-type equality, exact integer/float comparisons, complex folding, signed
  zero, infinity, code-point strings, bytes, and None. Dynamic dotted keys are not
  evaluated statically. Each nested mapping maintains an independent key set.
  Complex pattern literals whose integer real part overflows float conversion are
  rejected, while the corresponding arbitrary-precision integer remains valid.
- Mapping-key validation: fourteen tests failed before key validation and one
  additional overflow regression failed before its correction; all 1,013 package
  tests pass. A 1,681-case CPython key-pair compilation comparison and 48 additional
  large-integer/complex comparisons matched acceptance. Scoped lint, source typecheck, and the
  selected workspace build passed. Dynamic-key collisions, structural matching,
  enclosing-scope validation, and interpreter execution remain pending.
- Added a separate internal statement-context validation pass over module ASTs.
  Checks return placement, break/continue loop ownership, loop-else boundaries,
  except-star exits, async-for/with function context, and module-only star imports.
  Function/class bodies reset enclosing loop and handler state. Loops nested inside
  an except-star handler can still use their own break/continue. Errors preserve
  the offending statement position and caller filename.
- Context validation: the new suite initially failed on the missing validator;
  all 1,041 package tests pass. A 1,008-case CPython compilation comparison matched
  acceptance across nested scopes, loops, handlers, and suites. Scoped lint, source
  typecheck, and the selected workspace build passed. This pass is intentionally
  separate from syntax parsing; expression
  placement (yield/await and async generators), symbol resolution, complete module
  validation orchestration, and execution remain pending.
- Extended context validation to yield/await placement and async-generator return
  restrictions. Function defaults, decorators, and class bases are visited in the
  enclosing scope; nested bodies and lambdas use their own scopes. Comprehension
  first iterables stay in the outer scope, while generator-expression bodies can
  be asynchronous independently of that scope. Async list/set/dict comprehensions
  still require an asynchronous enclosing context. Ignored annotations are not
  visited. Direct statement-expression enumeration supports scope-aware traversal.
- Expression-context validation: seventeen negative tests failed before the
  implementation; all 1,072 package tests pass. A 576-case CPython compilation
  comparison matched placement and generator-return acceptance across expressions,
  defaults, decorators, class bases, and nested scopes. Scoped lint, source typecheck,
  and the selected workspace build passed.
  Symbol resolution, complete public validation orchestration, and runtime
  functions/generators/coroutines remain pending.
- Added an internal lexical symbol collector with source-positioned read, binding,
  deletion, parameter, declaration, annotation, import, and outward-walrus events.
  Builds explicit function/class/lambda/comprehension scope trees. Defaults and
  decorators stay outside nested bodies; comprehension first iterables stay outside
  their scope. Attribute/subscript stores read their receiver/index expressions
  without inventing local bindings. Captures, handler aliases, and loop/with targets
  are collected; ignored type aliases/expressions introduce no symbols.
- Symbol collection validation: the initial suite failed on the missing collector;
  all 1,077 package tests pass. Sixty CPython symbol-table comparisons matched scope
  trees and read/assignment/parameter/import flags for directly comparable forms.
  Comparison excludes propagated entries without source occurrences, ignored-type
  synthetic annotation scopes, inlined list-comprehension tables, and outward-walrus
  parent flags; explicit lexical/outer-binding behavior is covered separately by
  tests. Scoped lint, source typecheck, and the selected workspace build passed.
  Global/nonlocal resolution, closure propagation, and declaration conflict checks
  remain the next analysis phase; symbol collection alone does not validate them.
- Added declaration-conflict validation over lexical symbol events. Rejects names
  used/assigned/deleted before global or nonlocal declarations, parameter conflicts,
  conflicting declaration kinds, annotation conflicts in either order, and module
  nonlocal declarations. Repeated compatible declarations remain valid; imports
  before a declaration are permitted as in CPython. Checks are scope-local and
  retain source positions and caller filenames.
- Declaration validation: the suite initially failed on the missing validator;
  all 1,104 package tests pass. A 616-case CPython compilation comparison matched
  declaration ordering/conflicts in functions and classes with enclosing bindings.
  Scoped lint, source typecheck, and the selected workspace build passed.
  Missing-nonlocal resolution, closure propagation,
  class-scope assignment-expression restrictions, public validation orchestration,
  and runtime execution remain pending.
- Added lexical binding resolution with local/global/free classifications, owner
  scopes, captured-cell sets, and closure forwarding through intervening scopes.
  Nonlocal declarations resolve against complete enclosing bindings, including
  later definitions, while excluding modules/class locals and respecting function
  global barriers. Class global declarations do not block method closures.
  Comprehension outward assignments resolve to their enclosing binding and are
  rejected in class bodies. Declaration validation runs before resolution.
- Resolution validation: the suite initially failed on the missing resolver; all
  1,114 package tests pass. A 160-case CPython symbol-table comparison matched
  nonlocal availability, function/class global barriers, and binding classifications.
  Scoped lint, source typecheck, and the selected workspace build passed.
  Private-name mangling, implicit __class__/super cells,
  remaining scope/compiler details, public validation orchestration, and runtime
  closure execution remain pending.
- Added normalized private-name mangling with lexical class context on symbol
  scopes. Methods, nested functions, lambdas, and comprehensions inherit that
  context; nested class headers use the outer context and their bodies establish
  their own. Preserves special double-suffix names, dotted names, and classes made
  only of underscores. Symbol occurrences/import bindings are mangled without
  mutating raw AST spelling. Parameter collisions introduced by mangling are
  rejected during declaration validation.
- Private-name validation: the new suite initially failed on the missing helper;
  all 1,126 package tests pass. A 110-case CPython symbol-table comparison matched
  scope-name trees and collision acceptance across class-name variants and nested
  callables. Additional CPython checks confirmed that tested keyword/pattern
  collisions are accepted, so no unsupported rejection was added. Scoped lint,
  source typecheck, and the selected workspace build passed. Runtime attribute/import
  use of lexical mangling, implicit __class__/super
  cells, and complete validation/execution orchestration remain pending.
- Added implicit __class__ cell analysis. Explicit references/nonlocals can bind to
  an enclosing class's implicit cell independently of class-namespace assignments
  or global declarations. Super name loads in callable/comprehension scopes record
  distinct implicit reads; module/class-body loads and augmented stores do not.
  Those reads participate in declaration ordering, and existing closure propagation
  forwards class cells through nested callables and nested class bodies.
- Class-cell validation: six tests failed before implementation; all 1,134 package
  tests pass. A 108-case CPython symbol-table comparison matched explicit/implicit
  class binding resolution and declaration acceptance, including shadowing and
  nested callable scopes. CPython code-object checks established the targeted
  class-cell behavior; analysis retains lexical requirements rather than emulating
  CPython's later closure-slot optimizations. Scoped lint, source typecheck, and
  the selected workspace build passed. Runtime
  class-cell initialization, super behavior, and public execution remain pending.
- Added future-directive validation for known Python 3.14 features and their
  module-prefix placement, allowing a leading string docstring, consecutive
  directives, and aliases while rejecting nested/misplaced or unknown features.
  Relative/dotted lookalikes remain ordinary imports. Lazy parser feature state
  enables Barry's <> comparison spelling, rejects != in that mode, and preserves
  canonical inequality ASTs in nested and interpolated expressions. Added a shared
  direct-statement child enumerator for context-independent validation traversals.
- Future validation: the initial suite failed on the missing validator; all 1,155
  package tests pass. A 328-case CPython compilation comparison matched feature
  placement/names and inequality spelling. Scoped lint, source typecheck, and the
  selected workspace build passed. Directive
  validation remains a separate analysis phase; inherited compile flags, runtime
  imports, and unified public analysis/execution orchestration remain pending.
- Added public analyzeModule orchestration, returning a shared module AST, declared
  future features, and resolved scope tree after parsing, future validation,
  control-flow validation, and declaration/binding resolution. Exported result,
  symbol, binding, and pattern types. Syntax-only parseModule remains available;
  analysis does not execute code, load imports, or resolve discarded annotations.
  Readonly result collections are API contracts, not isolation boundaries.
- Analysis API validation: all 13 new tests failed before implementation; all
  1,168 package tests now pass. Tests cover phase-specific source errors, ignored
  type syntax, closure ownership, isolated future state, and single-delivery lexer
  callbacks. Source typecheck, selected workspace build, and a built-export smoke
  check passed. Scoped lint passed.
- Started runtime arithmetic with exact integer divmod and correctly rounded
  integer true division. Quotient/remainder use Python floor semantics; true
  division rounds the exact bigint ratio to binary64 without independently
  converting operands, preserving signed zero and handling subnormal/tie/overflow
  boundaries. Internal numeric faults distinguish zero division and overflow;
  guest exception-object construction remains pending.
- Integer arithmetic validation: the suite first failed on the missing module;
  all 1,189 package tests pass, including 21 arithmetic cases and large signed
  quotient/remainder identity checks. A 2,568-case CPython comparison matched exact
  quotient/remainder values, errors, and IEEE-754 division bytes across generated
  operands up to thousands of bits and rounding boundaries. Added targeted checks
  where converting numerator or denominator first gives an incorrect result.
  Source typecheck, scoped lint, and selected workspace build passed. Reference:
  https://docs.python.org/3/reference/expressions.html . These internal primitives
  are not yet connected to expression execution or resource accounting.
- Added integer modular exponentiation for three-argument pow, including extended
  Euclidean modular inverses for negative exponents, negative-modulus result signs,
  modulus-one shortcuts, and Python ValueError faults for zero modulus or missing
  inverses. Repeated squaring reduces intermediate products, avoiding allocation
  of the unmodulated power. This is an internal primitive, not a guest builtin yet.
- Modular-power validation: the new suite failed on the missing module before
  implementation; all 1,212 package tests pass. The 23 new cases include exhaustive
  small signed combinations, a 4,097-bit exponent, and large inverse identities.
  A 6,474-case CPython comparison matched results and error names/messages across
  signed inputs, negative exponents, zero/unit moduli, and generated large integers.
  Scoped lint, source typecheck, and selected workspace build passed. Reference:
  https://docs.python.org/3/library/functions.html#pow . Cooperative execution
  budgeting and guest exception/builtin integration remain pending.
- Added floating-point true division and divmod runtime primitives. Divmod derives
  its quotient from the remainder with sign and rounding correction rather than
  flooring rounded true division; signed zero, subnormals, infinities, and NaNs
  follow CPython behavior. Zero divisors produce Python numeric faults even with
  non-finite numerators. Float overflow remains infinity rather than the integer
  true-division conversion error.
- Float division validation: the suite initially failed on the missing module;
  all 1,247 package tests pass, including 35 float cases. A 5,289-case CPython
  differential comparison matched quotient/remainder/true-division bits and error
  messages, excluding NaN payload/sign bits. Added a CPython-confirmed regression
  for quotient rounding correction from 26 to 27. Source typecheck and selected
  workspace build passed; scoped lint passed. References:
  https://docs.python.org/3/reference/expressions.html and
  https://github.com/python/cpython/blob/main/Objects/floatobject.c . Mixed numeric
  dispatch, guest values, and interpreter execution remain pending.
- Added checked integer-to-float conversion, float-to-integer truncation, and exact
  reduced float ratios. Binary64 decoding handles normals/subnormals and removes
  powers of two without decimal-string conversion. Non-finite conversions and
  integer overflow raise Python numeric faults with operation-specific messages;
  integer conversion preserves every integral bit across the finite float range.
- Numeric conversion validation: the suite first failed on the missing module;
  all 1,276 package tests pass, including 29 conversion cases and round-trip ratio
  checks across binary exponents. CPython comparisons matched truncation and
  ratios for 3,011 floats and bit-exact conversion/errors for 3,005 integers.
  Scoped lint, source typecheck, and selected workspace build passed. Reference:
  https://docs.python.org/3/library/stdtypes.html#float.as_integer_ratio . Numeric
  constructors, mixed-type dispatch, hashing, and rounding integration remain pending.
- Added ties-to-even integer and float rounding primitives. Float rounding uses
  exact rational scaling for decimal places instead of multiplying binary floats,
  preserves signed zero with explicit digits, and returns an integer when digits
  are omitted. Integer rounding stays exact beyond float range. Extreme ndigits
  are checked before power allocation; finite float scaling is bounded to the
  binary64 decimal range. Non-finite values and rounding overflow follow Python.
- Rounding validation: the suite first failed on the missing module; all 1,312
  package tests pass, including 36 rounding cases. CPython comparisons matched
  3,238 float and 3,000 integer rounding results/errors, including float bits except
  NaN payloads. Scoped lint, source typecheck, and selected workspace build passed.
  Reference: https://docs.python.org/3/library/functions.html#round . Guest round
  dispatch and __round__ protocol integration remain pending.
- Added exact mixed integer/float ordering and shared real numeric hashes using
  the fixed 64-bit Python hash modulus. Bigints are not converted to floats for
  comparison; finite float hashes use their exact ratios and modular inverses.
  Equal numeric values share hashes; negative-one hashes are remapped to negative
  two, and infinity has the Python hash constant. NaN ordering is explicitly
  unordered and its hash is deferred to guest object identity, not a numeric hash.
- Real comparison/hash validation: the new suite failed on the missing module;
  all 1,341 package tests pass, including 29 cases covering mixed precision,
  cross-type equality, collisions, signed zero, infinities, and NaN deferral.
  CPython comparisons covered hashes for 6,015 values (excluding identity-dependent
  NaN hashes) and 9,222 orderings. Scoped lint, source typecheck, and selected
  workspace build passed. Reference:
  https://docs.python.org/3/library/stdtypes.html#hashing-of-numeric-types . Guest
  dictionary/set lookup, complex/rational hashing, and identity allocation remain
  pending; numeric hashes alone do not establish collection semantics.
- Added exact slice normalization and immutable arithmetic range payloads. Bounds
  preserve None versus explicit negative indices, clamp correctly for either step
  direction, and retain arbitrary-precision cardinality. Range lookup and integer
  search use arithmetic without materialization; slicing preserves derived range
  attributes, including empty/singleton results, and equality compares sequences.
  Generalized the internal numeric fault carrier to PythonRuntimeError for shared
  operation errors including IndexError; this is still not the guest exception model.
- Sequence validation: the new suite failed on the missing module; all 1,360
  package tests pass, including 19 sequence cases with enormous bounds/ranges.
  CPython comparisons matched 3,240 slice normalizations, 1,944 range slices,
  48 index/search probes, and 36 equalities. Runtime-scoped lint, source typecheck,
  and selected workspace build passed. Reference:
  https://docs.python.org/3/library/stdtypes.html#ranges . Guest indexing/coercion,
  generic equality searches, len overflow checks, iterators, hashing, and list/
  tuple/string slice integration remain pending.
- Added immutable code-point string storage with copied private buffers, code-point
  iteration/indexing, exact slice normalization, and lexicographic comparison.
  Parsed escaped surrogate pairs stay distinct from supplementary characters;
  operations never round-trip through UTF-16. Contiguous full slices can reuse
  immutable storage; strided slices handle huge steps without numeric overflow.
- String-storage validation: the suite failed on the missing module first; a
  CPython comparison then exposed huge-index diagnostic differences, reproduced
  by a failing regression and fixed using the guest's signed 64-bit index check.
  All 1,384 package tests pass, including 24 storage cases. CPython comparisons
  matched 17,472 slices, 273 indices, and 1,521 comparisons across Unicode,
  surrogates, empty strings, and extreme bounds. Scoped lint, source typecheck,
  and selected workspace build passed. Reference:
  https://docs.python.org/3/library/stdtypes.html#text-sequence-type-str . This is
  internal storage, not complete guest str behavior; string methods, hashing,
  encoding, allocation limits, and guest object/protocol integration remain pending.
- Added bounded code-point substring search for find, rfind, and non-overlapping
  count. Search bounds preserve the distinction between start at and beyond the
  end for empty patterns. A separate KMP scanner keeps repetitive-prefix inputs
  linear and retains overlaps only for last-match searching; operations do not
  normalize Unicode or merge surrogate code points.
- Search validation: all 24 new tests failed before implementation; all 1,408
  package tests pass. CPython comparisons matched 8,424 input combinations across
  all three modes (25,272 results). Ad hoc indexed-read instrumentation on long
  repetitive nonmatches measured 79,988 reads for 10,000 haystack points and
  159,988 for 20,000, both within the checked linear bound. Scoped lint, source
  typecheck, and selected workspace build passed. Reference:
  https://docs.python.org/3/library/stdtypes.html#str.count . Guest string method
  dispatch, search allocation accounting, and other string operations remain pending.
- Added an internal execution meter and monotonic budget with explicit maximum
  steps/cumulative allocated bytes and optional AbortSignal. Charges validate safe
  integer inputs and commit atomically; limit/cancellation failures remain latched
  and use a host termination class separate from guest-operation faults. Usage
  snapshots are immutable, and abort reasons do not become guest error payloads.
- Instrumented string-search entry, prefix allocation, prefix fallback, and scan
  work through the meter interface. Allocation is charged before creating the
  temporary prefix table. Meters remain optional on internal primitives; there is
  no public safe execution entry yet. Other operations remain uninstrumented, and
  cumulative charged bytes are not a measurement of live heap memory. Synchronous
  checkpoints do not yield the event loop or provide preemptive cancellation.
- Budget validation: the suite initially failed on the missing module; all 1,424
  package tests pass, including 16 budget/search tests. An ad hoc sweep passed 486
  search budget boundary cases. Tests cover exact limits, atomic rejection, latched
  failure identity, invalid inputs, immutable snapshots, and cancellation before
  entry and during scanning. Source typecheck and selected workspace build passed;
  scoped source and test lint passed. Full runtime budget enforcement,
  allocation accounting, asynchronous scheduling, and guest catch behavior remain
  pending.
- Extended optional operation metering to code-point string construction, indexing,
  slicing, and comparison. Construction charges storage before allocation and
  copies/validates with per-point checkpoints. Contiguous slices charge their
  immutable copy; strided slices charge both intermediate and final buffers.
  Reused full slices charge entry work without allocation. Comparison and indexing
  account work without storage charges, including empty/invalid fast paths.
- String-meter validation: six new tests failed before implementation; all 1,430
  package tests pass. An ad hoc sweep passed 926 step/allocation boundary cases.
  Re-running the CPython storage comparison matched 17,472 slices, 273 indices,
  and 1,521 comparisons after instrumentation. Scoped lint, source typecheck, and
  selected workspace build passed. Internal iteration, numeric operations, other
  runtime operations, and object overhead remain unmetered. These counters cover
  explicit buffer allocations, not all host memory, and optional internal meters
  still need mandatory wiring through the eventual interpreter execution context.
- Added complete-buffer UTF-8 decoding with strict, ignore, replace,
  backslashreplace, surrogateescape, and surrogatepass behavior. Valid Unicode
  boundaries, noncharacters, BOM-as-content, malformed prefix consumption, and
  strict error spans/messages follow Python. Internal decode faults snapshot the
  input and retain encoding/start/end/reason metadata. Working/output buffers,
  decoding steps, and error snapshots are metered when a meter is provided.
- UTF-8 validation: the suite first failed on the missing module; all 1,454
  package tests pass, including 24 decoder cases. CPython comparisons matched
  76,293 byte inputs across six modes (457,758 results), covering every one-/two-
  byte input plus longer malformed/boundary cases. A separate budgeted decode of
  CPython-generated UTF-8 recovered every one of 1,114,112 Python code points,
  including surrogates, charging 2,228,226 steps and 22,011,392 buffer bytes.
  Scoped lint, source typecheck, and selected workspace build passed. Reference:
  https://docs.python.org/3/library/codecs.html#error-handlers . Incremental decoding,
  encoding, custom error-handler/codec registries, guest codec exceptions, and
  safe-fs text-stream integration remain pending.
- Added metered complete-buffer UTF-8 encoding with strict, ignore, replace,
  backslashreplace, xmlcharrefreplace, namereplace, surrogateescape, and
  surrogatepass policies. Surrogate runs produce Python-compatible error spans;
  surrogateescape restores valid escaped bytes before reporting any remaining
  unencodable run. Encoder faults retain immutable input and operation metadata.
  Working buffers and independently owned final output are charged before allocation.
- UTF-8 encoder validation: the suite first failed on the missing module; all
  1,476 package tests pass, including 22 encoder cases. CPython comparisons matched
  4,410 strings across eight policies (35,280 results), including every individual
  surrogate. Encoding all 1,114,112 Python code points with surrogatepass matched
  CPython byte-for-byte under a budget, charging 5,502,849 steps and 8,845,184 bytes.
  All 65,536 two-byte sequences round-tripped through surrogateescape. Scoped lint,
  source typecheck, and selected workspace build passed. Incremental codecs,
  registry/custom-handler dispatch, guest bytes/exception objects, and safe-fs
  text I/O remain pending.
- Added incremental UTF-8 decoding with pending-byte snapshots/restoration, reset,
  mutable error policy, and final flushing. The shared internal decoder now returns
  `{ text, consumed }` and supports non-final prefixes; its in-package callers were
  updated. Partial surrogate candidates follow CPython's deferral behavior in all
  modes. Decode/error/budget failures preserve the old pending state, and combined
  input remains intact in decode diagnostics. Buffer assembly, state snapshots,
  and pending-buffer copies are metered before allocation.
- Incremental validation: the new suite failed on the missing module; all 1,492
  package tests pass, including 16 incremental cases. CPython comparisons matched
  18,216 chunk sequences (54,648 output/error/state observations). Both final and
  non-final sweeps matched 76,293 inputs across six modes each (457,758 results per
  sweep), including every one-/two-byte input. An ad hoc budget sweep passed 600
  atomic-state boundary checks. Scoped lint, source typecheck, and selected
  workspace build passed. Reference:
  https://docs.python.org/3/library/codecs.html#incrementaldecoder-objects . Registry
  integration, other codecs, guest codec objects, and safe-fs text streams remain
  pending.
- Added a metered universal-newline layer over decoded code points, with optional
  CR/CRLF translation, trailing-CR buffering across empty/chunk boundaries, final
  flushing, observed-newline metadata, and pending-state restoration/reset.
  Other Unicode separators and individual surrogate points remain unchanged.
  Failed budget checks leave pending and observed state intact; output buffers
  are charged before allocation. Byte-codec state remains a separate layer.
- Newline validation: the new suite first failed on the missing module; all 1,509
  package tests pass, including 17 newline cases. Ad hoc CPython comparisons
  matched 7,422 chunk sequences (29,688 output/metadata/state observations), and
  4,320 step/allocation boundaries passed transactional-state checks. Scoped lint,
  source typecheck, and selected workspace build passed. Reference:
  https://docs.python.org/3/library/io.html#io.IncrementalNewlineDecoder . This is
  an internal universal-newline primitive, not yet a guest I/O object; specific
  newline modes, byte-codec composition, and safe-fs text streams remain pending.
- Added an internal UTF-8 text-decoding composition supporting all five read-side
  newline settings (`null`, empty, LF, CR, CRLF). Universal modes recognize newline
  forms and optionally translate; specific modes preserve decoded text without
  universal-newline buffering or metadata. Line extraction remains a stream concern.
  Byte state is staged until atomic newline processing succeeds, so decoding and
  budget failures preserve both layers. State-copy buffers are metered. Reset
  clears both layers together, and the current error policy applies to each call.
- Text-decoder validation: the new suite failed on the missing module; all 1,521
  package tests pass, including 12 composition cases with 200 budget boundaries.
  Ad hoc comparisons against CPython's composed incremental codecs matched 30,360
  chunk sequences (121,440 output/newline observations), covering five newline
  modes and four malformed-input recovery policies. A TextIOWrapper oracle also
  verified whole-read output and metadata for all newline settings. Scoped lint,
  source typecheck, and selected workspace build passed. Reference:
  https://docs.python.org/3/library/io.html#io.TextIOWrapper . This remains an
  internal UTF-8 decoding layer, not a full TextIOWrapper: line reading, writing,
  seeking/cookies, codec registry dispatch, and safe-fs integration remain pending.
- Added metered UTF-8 text-write preparation: read/write newline settings now have
  a write-side counterpart translating LF only, with an explicitly supplied guest
  platform line separator (host-independent LF default). Existing CR characters
  are preserved. The result carries independently owned bytes, original code-point
  count, and CR/LF presence for future line buffering. Encoding policies apply after
  translation, including translated input/error positions. Scans, translation
  working/copy buffers, and byte encoding are metered; inputs remain immutable.
- Text-write validation: the new suite failed on the missing module; all 1,545
  package tests pass, including 24 write cases and 300 budget boundaries. CPython
  TextIOWrapper comparisons matched 60,720 writes/errors across five newline
  settings, three supplied platform separators, and eight encoding policies.
  Non-default platform separators were modeled with the equivalent explicit
  TextIOWrapper newline setting. Scoped lint, source typecheck, and selected
  workspace build passed. Reference:
  https://docs.python.org/3/library/io.html#io.TextIOWrapper . Actual stream writes,
  partial-write handling, buffering/flush, platform configuration, guest objects,
  codec registry dispatch, and safe-fs integration remain pending.
- Inspected safe-fs's current FileSystem and semantic-capability contracts. The
  API exposes path-based byte/stream operations, not open file handles. Its
  `randomAccessWrite` declaration permits bounded observe-and-replace offset
  updates, not positional handles or concurrent-writer isolation. Integration
  must preserve these limits rather than infer guarantees from method presence.
- Added an internal open-mode parser yielding immutable action/binary/update
  settings. It accepts all supported modifier orderings, rejects duplicates,
  removed `U` and unknown flags, and preserves CPython's conflicting-mode and
  embedded-NUL diagnostic precedence. Scans are metered and recognized-character
  state remains bounded; this layer performs no I/O or guest argument conversion.
- Open-mode validation: the new suite failed on the missing module; all 1,584
  package tests pass, including 39 parser cases. An ad hoc CPython builtin-open
  comparison matched 66,437 modes, including all 76 accepted spellings. A throwing
  opener observed native flags without opening or creating files. Scoped lint,
  source typecheck, and selected workspace build passed. Reference:
  https://docs.python.org/3/library/functions.html#open . Guest argument conversion,
  open-option validation, capability mapping, descriptor lifetime/identity,
  buffering, and safe-fs operations remain pending. Parser metering covers scan
  work, not diagnostic strings or host object overhead.
- Added internal memory byte-stream storage for BytesIO/buffered-I/O foundations:
  owned snapshots, byte reads, LF-only bounded line reads, readinto, overwrites,
  zero-filled holes, exact signed-64-bit seeking, truncation, and idempotent close.
  Truncation preserves position and does not expand storage; empty writes beyond
  EOF do not extend it. Capacity grows geometrically, and discarded bytes cannot
  reappear when retained capacity is reused. Guest buffer exports are not exposed.
  Work/buffer charges precede mutation, including readinto targets and in-place
  writes. Unsupported host-index growth is rejected without attempting allocation.
- Memory-stream validation: the new suite failed on the missing module; all 1,601
  package tests pass, including 17 storage cases and 200 write-budget boundaries.
  CPython BytesIO comparisons matched 30,000 stateful operations, including results,
  errors, positions, contents, and closed-state behavior. An additional ad hoc
  sweep passed 4,800 budget/state boundaries, including retained-capacity holes.
  A 1,000-single-byte-write test passed within 4,096 cumulative allocation bytes;
  an unrepresentable-growth check verified unchanged state without allocation.
  Scoped lint, source typecheck, and selected workspace build passed. Reference:
  https://docs.python.org/3/library/io.html#io.BytesIO . This is internal storage,
  not a complete guest BytesIO object: buffer-view exports/pinning, protocols,
  iteration, aggregate methods, and safe-fs file objects remain pending. Optional
  internal meters require mandatory guest-context wiring; host object overhead
  and garbage-collection timing are not represented by buffer-allocation charges.
- Added internal pinned unsigned-byte views to memory streams. Indexed mutations
  are visible through stream reads/snapshots; returned view snapshots are owned
  copies. Arbitrary positive/negative-stride slices share storage and retain their
  own leases, including empty slices and children of released parents. Explicit
  release is idempotent, drops the storage reference, and remains available after
  budget termination. Outstanding leases reject writes (including empty writes),
  truncation, and close with Python-compatible BufferError diagnostics. Ordinary
  reads and seeking remain available. No unrestricted raw buffer is returned.
- Buffer-view validation: all 12 new tests failed before getbuffer implementation;
  all 1,613 package tests pass. CPython comparisons matched 9,000 nested slice,
  mutation, pinning, and release cases, including huge bounds/steps. An ad hoc
  sweep passed 300 budget/lease-cleanup cases without leaked pins. Scoped lint,
  source typecheck, and selected workspace build passed. References:
  https://docs.python.org/3/library/io.html#io.BytesIO.getbuffer and
  https://docs.python.org/3/library/stdtypes.html#memoryview . These are internal
  one-dimensional B-format views, not complete guest memoryview objects: formats,
  casting, readonly views, bulk assignment, guest protocols and deterministic
  guest-heap finalization remain pending. View-object overhead is not metered;
  explicit snapshot buffers and operational checkpoints are metered.
- Added read-only conversion and equal-structure bulk assignment to internal byte
  views. Read-only views retain independent leases, preserve access restrictions
  through slicing/conversion, and observe writes through other aliases. Mutation
  rejects read-only destinations before validating indices or sources. Assignments
  accept byte arrays and B-format views, including reversed/noncontiguous sources;
  complete source snapshots prevent corruption on overlapping writes. Snapshot
  allocation and all mutation work are admitted before destination changes.
- Readonly/assignment validation: all ten new tests failed before implementation;
  all 1,623 package tests pass, including 60 assignment budget boundaries. CPython
  comparisons matched 12,000 overlapping/strided/readonly assignments and their
  resulting shared data/errors. An additional sweep passed 720 budget cases plus
  failed-readonly-acquisition cleanup. Scoped lint, source typecheck, and selected
  workspace build passed. Reference:
  https://docs.python.org/3/library/stdtypes.html#memoryview . These operations
  remain restricted to internal one-dimensional unsigned-byte views; arbitrary
  format/shape casting, guest buffer negotiation, and heap finalization remain
  pending. Readonly access does not make the shared exporter immutable.
- Connected internal byte views to memory-stream readinto/write. Writable
  contiguous read targets receive only the available prefix; aliased targets use
  source snapshots and temporary leases are released even on budget failure.
  Contiguous readonly views are valid write sources, but no source is retained.
  Released/noncontiguous/readonly buffer diagnostics precede closed-stream checks
  where CPython's argument conversion requires it; own exported write sources
  still trigger the stream's pinning guard.
- Differential testing exposed incorrect empty-view contiguity: singleton views
  are contiguous irrespective of stride, but empty views require unit stride.
  Reproduced both failures in tests before fixing them. Views now preserve exact
  signed-64-bit stride composition and CPython slice-step clipping, including
  empty/singleton metadata and overflow in nested strides, without unsafe physical
  indexing or allocation for huge bounds.
- Buffer-I/O validation: the new suite failed before implementation; all 1,635
  package tests pass, including 12 integration cases and 80 aliased-read budget
  boundaries. After the contiguity correction, all 10,000 CPython buffer-I/O cases
  and 2,916 nested stride chains matched. A further 1,200 budget/state cases passed.
  Scoped lint, source typecheck, and selected workspace build passed. References:
  https://docs.python.org/3/library/io.html#io.BufferedIOBase.readinto and
  https://docs.python.org/3/library/stdtypes.html#memoryview.c_contiguous . These
  are internal B-format buffer operations; guest buffer negotiation, other formats,
  file-backed streams, and safe-fs integration remain pending.
- Added the first injected safe-fs boundary for bounded whole-file reads, ordinary
  and exclusive writes, and direct appends. Added the declared safe-fs workspace
  dependency using the build route's supported `*` range. The boundary requires
  an execution meter and maximum read size, forwards an optional AbortSignal,
  snapshots mutable write inputs before awaiting, and returns owned read buffers.
  Read accounting conservatively reserves the maximum adapter result before the
  call, then charges the returned copy; reservations are cumulative, not refunded.
- Global and selected-path capability denials are honored without treating unknown
  support as either authorization or rejection. Added failing regressions before
  enforcing global readonly/unsupported declarations against contradictory path
  metadata. Backend path confinement, permissions, storage quotas and operation
  semantics remain the injected adapter's responsibility. Existing FsError objects
  are preserved for later guest OSError translation. Cancellation is checked around
  awaits; completed external mutations are not rolled back or claimed atomic.
- Filesystem-boundary validation: the new suite failed on the missing module;
  all 1,653 package tests pass, including 18 boundary cases using safe-fs's actual
  in-memory adapter. An ad hoc model comparison passed 1,000 filesystem operations
  and 360 budget boundaries. Scoped lint, source typecheck, and the maintained
  selected build passed with the safe-fs/safe-python dependency closure; a built
  runtime check also verified global capability denial. No real files were touched
  by these runtime tests. Backend allocations/work beyond the reserved returned
  buffer are not counted by this boundary's execution meter.
  Guest file objects, imports, descriptor identity, filesystem exception conversion,
  streaming I/O and public extension wiring remain pending. This establishes an
  internal whole-file integration, not complete Python filesystem support.
- Connected whole-file UTF-8 text reads/writes to the injected safe-fs boundary.
  Read configuration validates before I/O, final decoding applies the selected
  newline/error policy, and all codec buffers share the boundary's execution
  budget. Write preparation returns original character counts and routes ordinary,
  exclusive, and append operations through the existing capability checks. Added
  a failing post-await cancellation regression before closing that check gap.
- Text-filesystem validation: all eleven initial tests failed before implementation;
  all 1,665 package tests pass, including twelve integration cases. CPython codec
  pipeline comparisons matched 2,400 cases through the actual safe-fs memory
  adapter; an additional 640 text/filesystem budget boundaries passed. Scoped lint,
  source typecheck, and the selected safe-fs/safe-python build closure passed. A
  compiled-runtime check verified cancellation after awaiting the binary boundary.
- These internal UTF-8 helpers encode before adapter mutation. They deliberately
  do not claim Python open()/TextIOWrapper or pathlib.write_text lifecycle semantics:
  guest file objects must separately model opening/truncation followed by writes,
  including failures after open. Other encodings, streaming text/file objects,
  filesystem guest exceptions and public API integration remain pending.
- Added default C3 method-resolution linearization over supplied base MROs, using
  class identity rather than names. It preserves local/inherited precedence,
  handles shared ancestors, rejects duplicate bases and visible inheritance cycles,
  and reports conflicting remaining heads with Python-compatible diagnostics.
  Existing base MROs are neither mutated nor recursively recomputed; the result is
  frozen. Tail-membership counts avoid repeated full-tail scans, with metered setup,
  cursor allocation, candidate selection, merge work, and conflict reporting.
- MRO validation: the suite failed on the missing module before implementation;
  all 1,675 package tests pass, including ten C3 cases. CPython comparisons matched
  5,000 generated class constructions (2,168 accepted), including exact MROs and
  rejection diagnostics. Shared chains of 5,000/10,000 ancestors took 35,009/70,009
  indexed input reads and 30,019/60,019 charged steps, respectively, with 12 charged
  cursor bytes each. Another 160 budget boundaries preserved all inputs. Scoped
  lint, source typecheck, and the selected dependency build passed. Reference:
  https://docs.python.org/3/howto/mro.html . Result arrays, maps, and host object
  overhead still require guest-heap accounting; cursor charges alone are not a
  full memory bound. Class objects/creation, metaclass MRO overrides, layout checks,
  full __bases__ graph mutation, attribute lookup, and super() remain pending.
- Added type-valued metaclass selection using concrete MRO identity membership,
  not virtual subclass hooks or matching names. It retains/promotes the current
  compatible candidate, rejects unrelated candidates with Python's diagnostic,
  and preserves CPython's sequential conflict behavior rather than searching later
  bases for a possible repair. Candidate/base traversal is metered and inputs are
  unchanged. Initial-candidate choice and non-type callable metaclasses remain the
  surrounding class-construction layer's responsibility.
- Metaclass validation: the suite failed on the missing module before implementation;
  all 1,685 package tests pass, including ten selection cases. Comparisons against
  CPython builtin class construction matched 4,680 candidate/base combinations
  across a multiple-inheritance metaclass hierarchy. Another 200 budget/input-
  preservation checks passed. Scoped lint, source typecheck, and the selected
  dependency build passed. Reference:
  https://docs.python.org/3/reference/datamodel.html#determining-the-appropriate-metaclass .
  Base-entry resolution, namespace preparation/execution, metaclass invocation,
  class object construction, descriptors, and interpreter execution remain pending.
- Added default instance-attribute descriptor precedence and mutation dispatch.
  Data getters precede instance storage; non-data getters follow it; setter/deleter-
  only descriptors do not override stored values on reads. Instance-held descriptor
  objects are returned without binding. Assignment/deletion dispatch through data
  descriptors, including AttributeError for a missing corresponding mutation slot.
  Lookup results distinguish absence from every possible stored value, and getter
  failures propagate without dictionary fallback. Dispatch is metered before calls.
- Descriptor validation: the suite failed on the missing module before implementation;
  all 1,700 package tests pass, including 15 precedence/dispatch cases. Comparisons
  against CPython's default object attribute operations matched 324 combinations
  of absent/callable/non-callable slots, class and instance presence, and get/set/
  delete behavior. Another 192 dispatch budget cases passed. Scoped lint, source
  typecheck, and the selected dependency build passed. Reference:
  https://docs.python.org/3/howto/descriptor.html . The caller must perform class-MRO
  lookup and resolve slots on the descriptor type; callbacks remain owned/metered
  by the eventual guest execution engine. Class objects, guest dictionaries/slots,
  override dispatch, __getattr__, class/super lookup and interpreter wiring remain
  pending. This dispatch kernel alone does not execute guest class definitions.
- Added default class-attribute lookup with metaclass data-getter precedence,
  class-MRO descriptor binding to None and the requested class, then metaclass
  non-data/raw fallback. Getter errors propagate without fallback. Added generic
  MRO namespace search preserving first-owner identity, present undefined values,
  and live namespace changes without caching. Both kernels checkpoint before
  namespace/descriptor callbacks; callback execution remains caller-metered.
- Class lookup validation: missing-module red test preceded implementation;
  all 1,715 tests in 76 files pass, including 15 new cases. An independent CPython
  comparison matched 216 combinations of absent/callable/non-callable metaclass
  slots, binding presence, and inherited class raw/descriptor values, including
  descriptor arguments and exception outcomes. Scoped lint, source typecheck,
  and the selected safe-fs/safe-python dependency build passed. Reference:
  https://docs.python.org/3/howto/descriptor.html . These remain internal kernels:
  guest class construction, descriptor-type slot resolution, overrides, __getattr__,
  super lookup, guest heap accounting and interpreter execution are still pending.
- Added bound-super attribute search through the current effective MRO after the
  anchor by identity. Earlier/anchor namespaces are not consulted, the first owned
  binding wins regardless of descriptor mutation slots, and getters receive the
  effective owner plus the bound instance (None for class-bound access). Missing
  anchors after MRO replacement produce a miss; searches do not cache namespaces.
  Traversal and descriptor calls are metered without slicing/copying the MRO.
- Super lookup validation: observed a missing-module red test, then all 1,724
  tests in 77 files passed. CPython comparisons matched 2,048 diamond-inheritance
  combinations of namespace absence/plain values/callable/non-callable getters,
  four anchors and instance/class binding, including descriptor argument identity
  and exception outcomes. A separate CPython check verified removed-anchor lookup
  after __bases__ mutation. Scoped lint, typecheck and dependency build passed.
  References: https://docs.python.org/3/library/functions.html#super and
  https://bugs.python.org/issue46182 . This is the internal bound lookup kernel,
  not the complete guest super type: argument/subtype validation, zero-argument
  frame/cell resolution, unbound binding, proxy-owned attributes, generic fallback
  and execution-engine integration remain pending.
- Added binary numeric special-method negotiation: same-type operands only try
  the forward method; unrelated types try forward then reflected; strict right
  subtypes get reflected priority only when overridden. A prioritized reflected
  method returning NotImplemented is not retried. Only the supplied singleton
  triggers fallback, so None/false/zero/undefined remain successful values.
  Exceptions propagate and every dispatch/override callback is checkpointed.
  Late method resolution remains possible after a prior method mutates a type.
- Binary dispatch validation: missing-module red test preceded implementation;
  all 1,733 tests in 78 files pass. CPython comparisons matched 2,688 cases across
  14 binary operators, three type relationships and absent/declining/successful/
  non-callable forward and reflected methods, including inherited reflected slots.
  Typecheck, scoped lint and the dependency build passed. References:
  https://docs.python.org/3/reference/datamodel.html#emulating-numeric-types and
  CPython v3.14.0 Objects/typeobject.c, method_is_overloaded/SLOT1BINFULL.
  Override detection deliberately remains a guest-aware callback: CPython can
  execute type attribute access and rich comparison there. This kernel does not
  yet provide that guest lookup, built-in numeric/sequence slot adaptation,
  in-place or rich-comparison dispatch, final operand diagnostics, or evaluator
  integration. Callback-internal work and heap use remain caller-accounted.
- Added rich-comparison negotiation separately from numeric binary ordering:
  strict right subtypes have reflected priority even without an override, and
  same-type/same-object comparisons can try both operand calls. Results remain
  arbitrary values, never implicitly coerced to booleans. Declined reflected
  calls are not retried and exceptions propagate. Added in-place negotiation
  before fresh binary fallback, retaining mutations on decline/error and accepting
  replacement results distinct from the original operand. All calls are metered.
- Comparison/in-place validation: both missing-module red tests were observed
  before implementation; all 1,747 tests in 80 files pass. CPython comparisons
  matched 288 cases across six comparisons and three type relationships, plus
  832 cases across thirteen in-place operators, including absent, declining,
  successful and non-callable methods. Scoped lint, source typecheck and dependency
  build passed. References: Python data model rich comparisons/augmented assignment
  and CPython v3.14.0 Objects/object.c do_richcompare. Final identity equality or
  unsupported-ordering fallback was normalized in the differential harness and
  remains caller-owned, as do reflected operator mapping, object.__ne__ behavior,
  guest slot lookup, callback execution/heap accounting, augmented-target storage,
  and evaluator integration. These internal dispatch functions alone do not
  execute guest expressions or augmented assignments.
- Added Python-function argument binding for all five parser parameter kinds.
  Positional-only names can flow into **kwargs without satisfying their positional
  slots; variadic parameter names are not ordinary keyword targets. Evaluated
  defaults retain identity and observe later replacements. Missing values are
  distinguished from present undefined/None, and **mapping names are not NFKC-
  normalized. Binding checks duplicate assignments and positional-only/unexpected
  keywords before excess/missing-argument errors, retaining keyword insertion order.
  Traversal is metered and input collections are unchanged; output variadics await
  guest tuple/dict packing and frame installation.
- Argument binding validation: missing-module red test preceded implementation;
  all 1,755 tests in 81 files pass. Generated CPython calls matched 7,560 cases
  over 216 signatures, including successful local values and primary TypeError
  messages/precedence. CPython's optional unexpected-keyword "Did you mean" suffix
  exposed an unimplemented diagnostic feature and was explicitly stripped only in
  the comparison harness; exact suggestion parity is NOT claimed. Scoped lint,
  source typecheck and dependency build passed. References:
  https://docs.python.org/3/reference/expressions.html#calls and
  https://docs.python.org/3/reference/compound_stmts.html#function-definitions .
  Signature validity is a caller precondition; defaults are evaluated values.
  Call-expression evaluation/unpacking, duplicate keyword assembly, non-string
  and guest str-subclass key handling, suggestions, guest collection allocation
  accounting, actual function/frame objects and evaluator wiring remain pending.
- Closed the unexpected-keyword suggestion gap found in the preceding increment.
  Added a reusable diagnostic-name matcher with CPython's weighted UTF-8 byte
  edit distance, ASCII case-change cost, first-candidate tie resolution, 750-item
  cutoff, and 40-byte nonmatching-region cutoff after shared affix trimming.
  The binder considers only positional-or-keyword and keyword-only names, not
  positional-only or variadic names. Unencodable surrogate strings suppress the
  optional hint; resource-limit failures remain fatal. Encoding reservations,
  the bounded distance workspace, and traversal/distance work are metered.
- Suggestion validation: the previously missing keyword hint was reproduced in a
  failing binder test before changes; the new module also failed before creation.
  All 1,761 tests in 82 files pass. The full 7,560-case argument-binding oracle
  now matches exact messages WITHOUT stripping suggestions, and 6,000 additional
  multilingual/random name cases matched CPython's _suggestions implementation.
  Scoped lint, source typecheck and dependency build passed. Reference:
  https://github.com/python/cpython/blob/v3.14.0/Python/suggestions.c and ceval.c
  unexpected-keyword handling. UTF-8 reservations conservatively charge three
  bytes per host UTF-16 unit; host container/string overhead remains outside those
  explicit buffer charges. Guest argument assembly, function objects/frames and
  evaluator execution remain pending; these diagnostics do not establish them.
- Began actual parsed-expression execution with an internal, generic guest-operation
  context and explicit continuation stack. Supported families now execute literals,
  names, unary/binary operations, attributes, walrus stores, logical operators,
  conditional expressions and comparison chains. Operand order is left-to-right;
  unselected branches are not visited; chained comparison middle operands execute
  once and final comparison values are not implicitly coerced. A required execution
  meter checks every AST/continuation step before guest operations. Unsupported
  families raise an explicit host UnsupportedExpressionError, not a guest error.
- Expression validation: observed missing-module red tests before implementation;
  differential checks then exposed context-sensitive truth-call mismatches, each
  reproduced with a failing regression test before correction. Branch tests,
  value-preserving logical tests and plain value contexts are distinct; not,
  comparison-chain results, walrus stores and conditional branch fallthrough
  preserve CPython's observable truth-conversion behavior. All 1,780 tests in 83
  files pass, including 19 new cases and a 20,000-node nonrecursive AST evaluation.
  CPython matched 6,000 generated expression executions/traces: 2,000 logical,
  2,000 with state-changing __bool__, and 2,000 mixed arithmetic/comparison cases.
  Scoped lint, source typecheck and selected dependency build passed. References:
  Python expression evaluation rules and CPython v3.14.0 Python/codegen.c.
- This is an execution-layer increment, NOT a complete/public Python interpreter.
  The context still supplies guest values, operations, scope-aware name resolution,
  internal callback metering and literal ownership. Continuation closure/stack heap
  accounting remains incomplete. Calls, containers, subscripts, comprehensions,
  lambdas, interpolation, await/yield, statement/frame execution and guest object
  construction remain to be wired and implemented. No host eval is used by the
  implementation; CPython eval is used only in independent differential checks.
- Added call-expression execution to the continuation evaluator. It evaluates the
  callee first, then positional/starred expressions before keyword/mapping
  expressions, even when a star appears textually after an explicit keyword.
  Each explicit keyword run is evaluated before merging with earlier mappings.
  A sole starred positional value is held for expansion after keyword processing,
  matching CPython's observable iteration/error order. Other star expansions are
  consumed in positional order. Callee callability and binding are delayed until
  invocation; nested calls retain independent argument-collection state.
- Call validation: nine execution tests failed on unsupported call nodes before
  implementation; all 1,789 tests in 84 files now pass. An integration case invokes
  the existing argument binder with evaluated call arguments. CPython matched
  3,400 generated call traces/results, including 400 larger argument lists and
  observable name loads, star iteration, mapping keys/getitem, duplicate failures
  and invocation. The prior 2,000 logical-expression traces still match. Scoped
  lint, source typecheck and selected dependency build passed. Reference:
  https://docs.python.org/3/reference/expressions.html#calls .
  A per-call guest collector still owns concrete iterable/mapping protocols,
  duplicate/key validation, guest tuple/dict allocation, actual callable dispatch
  and internal metering. beginCall is host-only preparation and must not run guest
  code or reject non-callables early. Call scheduling is implemented, but complete
  guest callables, frame execution, suspensions and heap accounting remain pending.
- Added subscription execution: object evaluation precedes key expressions;
  slice bounds execute lower/upper/step in order, with omitted fields distinguished
  from present undefined guest values. Slice construction does not eagerly apply
  __index__, constrain bounds or reject step zero. Comma/star keys form tuples,
  including trailing-comma singletons and empty starred tuples. Starred key
  iteration finishes before subsequent keys are evaluated, and each next call is
  a metered continuation. Failed expansion does not run later keys/getitem or
  implicitly close a caller-owned iterator. Final getitem follows key construction.
- Subscription validation: eleven execution tests failed on unsupported subscript
  nodes before implementation; all 1,800 tests in 85 files now pass. CPython matched
  3,100 generated key/results/traces, including 600 cases with potentially invalid
  starred values. The previous 3,000 call traces still match. Tests also exercise
  budget termination of infinite unpacking and preservation of iterator ownership.
  Scoped lint, source typecheck and the dependency build passed. Reference:
  https://docs.python.org/3/reference/expressions.html#subscriptions .
  The guest context still supplies tuple/slice objects, concrete __getitem__ or
  __class_getitem__ dispatch and iterator adaptation (including applicable length-
  hint behavior and guest exception conversion). Internal protocol work and guest
  allocations remain context-metered; continuation/key-buffer heap accounting,
  container literals, statements and complete guest objects remain pending.
- Added tuple/list display execution, sharing the existing sequence-item and
  starred-unpacking traversal with subscription keys rather than duplicating
  iterator control. Empty/singleton/nested displays preserve their shapes and
  element references; starred iterables are consumed before later elements.
  List construction asks the guest context for a fresh list. Displays now compose
  with existing name stores, call arguments and immediate subscriptions. Failed
  expansion stops later evaluation, and infinite unpacking is step-budget bounded.
- Sequence validation: eleven tests failed on unsupported tuple/list nodes before
  implementation; all 1,811 tests in 86 files now pass, including 5,000-level nested
  display AST execution without host recursion. CPython matched 2,500 generated
  nested-display results/traces with successful and failed unpackings. The prior
  2,500 subscription and 3,000 call traces still match. Scoped lint, source typecheck
  and selected dependency build passed. References: Python expression-list,
  list-display and iterable-unpacking rules. Tuple/list object semantics, guest
  allocation/length-hint accounting and concrete iterator adaptation remain owned
  by the context; the evaluator's temporary buffers/continuation heap still need
  complete accounting. Set/dict displays, comprehensions, statements, suspensions
  and the full guest object/frame model remain pending.
- Added set-display execution with guest set construction/add/update callbacks.
  Small initial unstarred groups are evaluated before construction/hashing;
  construction happens before evaluating the first starred operand. Subsequent
  values are inserted individually and star updates complete before later values.
  Displays above CPython's 30-item stack-use guideline use incremental insertion
  from the beginning, preserving observable hash/error ordering. Empty starred
  sets and fresh repeated displays are supported. Dispatch checkpoints precede
  construction, insertion, updates and final result retrieval.
- Set validation: eight tests failed on unsupported set nodes before implementation;
  all 1,819 tests in 87 files now pass. CPython matched 2,200 generated display
  results/traces with instrumented name loads, hash calls, iteration and hashing
  failures, including displays on both sides of the 30/31-item boundary. Scoped
  lint, source typecheck and dependency build passed. References: Python set-display
  rules; CPython v3.14.0 Python/codegen.c starunpack_helper_impl and
  Include/internal/pycore_compile.h _PY_STACK_USE_GUIDELINE.
  Concrete guest set hashing/equality/storage and optimized update semantics
  (including hash reuse for set/dict sources) remain context responsibilities,
  along with internal iteration and allocation metering. This adds evaluation
  scheduling, not a complete guest set object. Dictionary displays, comprehensions,
  statement execution and complete interpreter/resource accounting remain pending.
- Added dictionary-display execution, including empty dictionaries, explicit
  key/value entries and **mapping updates. Keys execute before their values;
  small explicit runs finish evaluation before hashing. Larger runs use
  incremental insertion, with CPython's 15/16-pair and 17-pair chunk boundaries
  preserved. Runs construct separate guest dictionaries before merging into an
  existing result, allowing hash reuse by the concrete implementation. Mapping
  updates overwrite prior values rather than applying call-keyword duplicate
  rejection. Errors stop subsequent key/value/mapping expressions.
- Dictionary validation: thirteen tests failed on unsupported dictionary nodes
  before implementation; all 1,832 tests in 88 files now pass. CPython matched
  2,600 generated dictionary results/traces with key/value loads, hashing, mapping
  keys/getitem, overwrites, invalid mappings and hashing failures, including long
  runs across chunk boundaries. Scoped lint, source typecheck and dependency build
  passed. References: Python dictionary-display rules and CPython v3.14.0
  Python/codegen.c codegen_dict/codegen_subdict. Concrete guest dictionary storage,
  hashing/equality/identity, optimized hash reuse and mapping protocol work remain
  context-owned, with internal metering required. Guest object/frame execution,
  comprehensions, suspensions and complete allocation accounting remain pending.
- Added iterator-driven assignment unpacking for exact-count and starred targets.
  Exact-count unpacking probes only one excess value before failing; starred
  unpacking collects leading values, a possibly empty middle list payload and
  trailing values in order. Shortages use the exact/minimum-count diagnostics.
  Errors preserve already-consumed iterator state without closing or restarting
  the iterator. Required checkpoints precede every next call and starred remainder
  preparation; invalid host target counts are rejected before input consumption.
- Unpacking validation: missing-module red tests preceded implementation; all
  1,844 tests in 89 files pass. CPython matched 2,184 exact/starred cases covering
  target counts, input lengths, injected iterator failures, full consumption traces,
  diagnostics and remaining iterator state. The adapter supplied the starred
  path's second iter/length-hint preparation at the matching point. Scoped lint,
  source typecheck and dependency build passed. Reference: Python assignment
  target-list rules. This is the generic adapted-iterator path, not built-in
  sequence fast paths. Actual target stores, recursive target traversal, guest
  starred-list construction, initial iterator acquisition, concrete remainder
  protocols and complete allocation accounting remain pending/context-owned.
- Added iterative assignment-target traversal for names, attributes, subscriptions,
  chained assignments and nested tuple/list/starred targets. Each level unpacks
  before storing its children; starred lists are created before child stores.
  Stores proceed left to right, retain earlier mutations after later failures,
  and resolve receivers/keys only when execution reaches their targets. Explicit
  checkpoints cover traversal and precede reference mutation. Statically validated
  targets are required; adapters own scope lookup and concrete guest protocols.
- Assignment-target validation: missing-module red tests preceded implementation;
  all 1,853 tests in 90 files pass, including a 5,000-level target without host
  recursion. CPython matched 2,200 generated nested/chained assignments, including
  partial-store traces, failures, starred values and final bindings. Source
  typecheck, scoped lint and selected dependency build passed. Guest reference evaluation,
  concrete object storage and complete temporary-buffer heap accounting remain
  pending/context-owned; this is not a complete statement interpreter.
- Added synchronous augmented-assignment execution: resolve the target once,
  load its current value, evaluate the RHS, dispatch the in-place operation with
  ordinary binary fallback, then write the result to the retained reference.
  Required checkpoints precede each guest stage. Errors stop subsequent work
  without rolling back in-place mutations, including write-back failures.
  Reference adapters retain receiver/key identity but perform live get/set lookup;
  lexical name destinations must remain distinct from load fallback locations.
- Augmented-assignment validation: missing-module red suite preceded implementation;
  all 1,879 tests in 91 files pass. Tests cover all 13 operators, name/attribute/
  subscript targets, RHS rebinding, undefined-valued adapters, stage failures and
  every dispatch-budget boundary. CPython matched 624 attribute/subscript traces
  across operators, self/new/fallback results and injected guest failures, including
  retained mutation and write-back outcomes. Scoped lint, source typecheck and selected build
  passed. Reference: Python 3.14 simple statements, augmented-assignment rules.
  This provides execution ordering, not concrete guest reference/protocol objects;
  suspended RHS execution and full frame/statement execution remain pending.
- Added an explicit-frame synchronous statement control-flow engine for ordered
  suites, if/elif/else, while/for, loop else, break/continue and return. For iterables
  are evaluated/acquired once; assignments precede each body execution. Exhaustion
  removes the loop frame before else, so transfers there target enclosing loops.
  Break skips else, continue resumes testing/iteration, and return exits the suite
  with a tagged completion. Bare return is distinct from a present undefined host
  payload. Transfers do not explicitly close for iterators. Parsed type aliases
  and scope declarations have no runtime action under the ignored-types policy.
- Statement validation: missing-module red suite preceded implementation. Seventeen
  focused tests cover normal/early exits, partial failure, retained target bindings,
  empty iterators, infinite-loop budgets and 10,000 nested blocks without host
  recursion. CPython matched 700 generated nested control-flow programs, including
  stateful condition/iterator traces, emitted effects, returns and injected errors.
  All 1,896 tests in 92 files pass; scoped lint, source typecheck and selected
  dependency build passed. Reference: Python 3.14 compound-statement rules.
  Branch-expression evaluation is a dedicated context contract to avoid duplicate
  guest truth conversions. Leaf execution and concrete guest operations remain
  adapter-owned; try/with/match/async for fail explicitly before operand effects.
  Exception unwinding, suspended execution, full frame integration and complete
  frame-heap accounting remain pending. This is not the complete interpreter.
- Exposed branch-context expression execution through an overload of the existing
  evaluator. The default remains value-producing; explicit branch mode propagates
  branching context from the root and returns a host boolean. Short-circuit truth
  results are reused without another guest conversion. Walrus/value boundaries
  still trigger the required later conversion; final truth conversion is metered
  and propagates guest errors. Statement contexts can now use the existing
  evaluator directly for conditions instead of evaluating then coercing a value.
- Branch-mode validation: seven failing tests preceded implementation; all 1,904
  tests in 92 files pass. Added stateful truth, not, conditional, comparison-chain,
  walrus, budget and statement-engine integration coverage. CPython matched 4,000
  branching-mode result/traces (stable and state-changing truth methods), plus
  2,000 value-mode regression traces. Scoped lint, source typecheck and selected
  dependency build passed. Concrete guest values/frames, remaining statement and
  expression families, suspension and complete heap accounting remain pending.
- Added explicit-frame try/finally unwinding for normal completion, break,
  continue, return and classified guest exceptions. Cleanup can replace a pending
  transfer or suppress a guest failure. Nested finalizers preserve inside-out
  ordering without host recursion. Exception-triggered cleanup installs active
  guest exception state through host-only enter/restore callbacks, enabling bare
  raise and adapter-owned automatic chaining; nested exits restore prior state.
  Unclassified host faults and execution-limit failures bypass guest finalizers.
  Fatal exits still restore host exception bookkeeping, including failure during
  cleanup; budget exceptions remain fatal even with an overbroad guest classifier.
- Finally validation: all thirteen new tests failed on unsupported try nodes before
  implementation. All 1,917 tests in 93 files pass, including 5,000 nested finalizers,
  exception identity/context, transfer replacement and fatal-budget restoration.
  CPython matched 2,000 generated nested control-flow/finalizer programs, comparing
  emitted effects, stateful tests, iterator traces, returns and guest errors.
  Scoped lint, source typecheck and selected dependency build passed. Reference:
  Python 3.14 compound statements, finally-clause rules. Except/except* handlers
  are still explicitly unsupported before try-body execution. Context managers,
  suspension, concrete guest exception objects/frames and complete heap accounting
  remain pending; this is not yet the complete interpreter.
- Added ordinary except-handler search, selected-handler execution and try else.
  Header expressions run in source order with the caught exception active; a
  matching handler alone binds its alias. Header/matching/binding failures leave
  the search and propagate outward. Else runs only after normal try-body completion
  and cannot be caught by the same handlers. Handler exit clears aliases rather
  than restoring previous bindings and restores enclosing exception state.
  Matching/class validation and scope-specific alias operations are adapter-owned.
- Except validation: thirteen new tests initially failed on unsupported try nodes.
  Targeted CPython custom-class-namespace probes then exposed the distinction
  between alias cleanup on normal/control exits and exceptional exits; four more
  red tests reproduced it before correction. Normal/return/break/continue restore
  prior exception state before cleanup, while exceptional exits retain the caught
  exception during cleanup. Failed alias binding does not trigger alias cleanup.
  All 1,939 tests in 94 files pass, including nested state, failure chaining,
  alias-cleanup errors caught outside, returns/transfers, and fatal restoration.
  CPython matched 2,000 generated nested handler/finalizer programs with active
  exception observations, header evaluation failures, exception context chains,
  loop traces and final outcomes. Scoped lint, source typecheck and selected build
  passed. Reference: Python 3.14 compound statements, except and else clauses.
  Except* remains explicitly unsupported. Concrete guest exception matching,
  scope storage, context managers, suspension, frame integration and full heap
  accounting remain pending; the complete interpreter is not yet implemented.
- Added synchronous with-statement execution with explicit manager-entry/exit
  frames. Managers enter left to right and leave right to left. Exit is captured
  before enter and registered after successful entry, before assigning an as target;
  a suppressed target-assignment failure skips remaining managers and the body.
  Exceptional exit runs with the exception active and truth-tests its result;
  suppression makes outer exits normal. Other transfers ignore the exit result.
  Exit/truth failures propagate through outer managers with restored bookkeeping.
  Fatal host/budget failures bypass guest exits. Adapters own implicit lookup,
  bound callbacks, exception type/value/traceback conversion and internal metering.
- With validation: thirteen tests initially failed on unsupported with nodes;
  all 1,954 tests in 95 files pass. Tests include entry/assignment/exit/truth
  failures, suppression, transfers, retained exit callbacks, undefined enter values,
  fatal budgets and 5,000 managers without host recursion. CPython matched 2,500
  generated nested manager/handler/finalizer programs with descriptor lookup,
  active-exception observations, failure chaining and outcome traces. Differential
  evidence corrected the lookup contract to CPython 3.14's observable exit-before-
  enter order (different from reference pseudocode). Scoped lint, source typecheck
  and selected dependency build passed. Reference: Python with-statement rules.
  Async with, except*, match, suspension, concrete guest object/frame integration
  and complete allocation accounting remain pending; the interpreter is unfinished.
- Added ordinary exception-type matching over opaque guest-class identities.
  Handler tuples are fully validated before matching, including entries after an
  otherwise matching class; nested tuples and non-exception classes raise the
  matching TypeError diagnostic. Tuple subclasses use internal storage without
  guest iteration/index/length hooks. Matching scans the raised type's actual MRO
  without virtual subclass hooks. Internal exception-class eligibility is separate
  from MRO membership because custom metaclasses can omit BaseException from a
  still-valid exception class's MRO. Empty tuples do not inspect the raised MRO.
- Matching validation: missing-module red suite preceded implementation. All
  1,971 tests in 96 files pass, including invalid trailing entries, custom MROs,
  tuple overrides, budgets and statement-engine integration where an outer handler
  catches a matching-validation TypeError. CPython matched 7,000 generated type/
  tuple targets over built-in and generated multiple-inheritance classes, checking
  match results and exact errors. The oracle armed virtual hooks only at header
  evaluation, separating matching from raise-time normalization's hook behavior.
  Scoped lint, source typecheck and selected build passed. Reference: Python
  ordinary except-clause rules. Concrete class metadata, raise normalization,
  exception-group matching and complete temporary-set heap accounting remain
  pending/adapter-owned, along with the remaining interpreter work.
- Added reusable handled-exception state with nested host-only enter/restore
  scopes and idempotent restoration. Automatic context linking operates after
  raise normalization, preserves explicit cause/suppression, leaves self-raises
  and no-active-exception cases unchanged, and overwrites previous implicit context
  when appropriate. Constant-space Floyd traversal removes an edge that would
  create a new cycle and terminates on unrelated pre-existing cycles. Internal
  metadata access bypasses guest attribute hooks; reads/writes are step-metered.
- Exception-state validation: missing-module red suite preceded implementation;
  all 1,981 tests in 97 files pass. Coverage includes nested isolated state,
  restoration, graph cycles, long-chain budgets and statement-finalizer integration.
  CPython matched every four-exception context graph across all raised/active
  choices, including no active exception: 12,500 cases comparing all resulting
  context links plus preserved causes and suppression flags. Scoped lint, source
  typecheck and selected build passed. Reference: CPython v3.14.0 Python/errors.c
  implicit context handling in _PyErr_SetObject. Restore callbacks require LIFO
  use; suspension/context switching, concrete guest exception storage and complete
  scope-closure allocation accounting remain pending with the full interpreter.
- Added synchronous raise-statement operand evaluation and initial exception
  construction. Exception and cause expressions execute before constructor calls;
  exception-class results must be exception instances. Invalid main/cause operands
  have distinct diagnostics, and bad constructor results format both class
  representations in order. Explicit cause mutation precedes final normalization;
  no from clause preserves prior cause, whereas from None requests suppression.
  Bare raise preserves the active instance/traceback path and reports RuntimeError
  when no handled exception exists. Final propagation retains the originally
  requested class for adapter-owned normalization rather than replacing it with
  the constructed value's type. Present cause payloads use a wrapper, preserving
  null/undefined host representations without confusing them with guest None.
- Raise validation: missing-module red suite preceded implementation; a further
  failing null-payload test preceded the explicit-cause wrapper correction. All
  1,996 tests in 98 files pass. CPython matched 2,160 combinations of operand kinds,
  constructor results/failures, representation failures, evaluation failures,
  active exception state and explicit causes, including events and final error
  diagnostics/metadata. Scoped lint, source typecheck and selected build passed.
  Reference: CPython v3.14.0 Python/ceval.c do_raise. Final normalization, guest
  exception object construction, automatic context attachment at the propagation
  boundary, traceback updates and suspension remain adapter/runtime work; the
  full interpreter is still unfinished.
- Added final normalization for validated raised instances. Ordinary subclass
  queries (including virtual hooks) decide whether to preserve the original
  instance. Otherwise the requested exception class is called with that instance
  as one argument; any exception-instance result is accepted without repeated
  reconstruction. Invalid results use the normalization-specific type-name
  diagnostic. Constructor failures receive best-effort normalization notes;
  guest repr failures use unknown arguments, and guest note-storage failures
  preserve the original failure. Unclassified host faults and fatal resource
  limits are never suppressed during diagnostic work.
- Normalization validation: missing-module red suite preceded implementation;
  all 2,009 tests in 99 files pass. CPython matched 1,440 combined raise/normalization
  cases spanning virtual-hook results/failures, replacement instances, invalid
  constructor returns, repr failures, invalid/failing note storage, active handled
  exceptions and explicit causes, comparing call traces and final metadata.
  Scoped lint, source typecheck and selected build passed. Reference: CPython
  v3.14.0 Python/errors.c _PyErr_SetObject and _PyErr_CreateException.
  Concrete subclass protocol dispatch, note storage, exception object/traceback
  integration and complete diagnostic allocation accounting remain adapter/runtime
  responsibilities; full interpreter execution is still unfinished.
- Added iterative del-target execution for names, attributes, subscriptions and
  nested tuple/list targets. Lists describe deletion order rather than unpacking
  values; empty nested lists are no-ops. References resolve only when reached and
  do not read the value being removed. Earlier deletions remain after a later
  failure. Explicit frames use space proportional to nesting depth, with required
  traversal and pre-mutation checkpoints; concrete scope/protocol work is adapted.
- Deletion validation: missing-module red suite preceded implementation; all
  2,016 tests in 100 files pass, including 10,000-level targets without host
  recursion and budget failure between reference resolution and deletion.
  CPython matched 3,000 generated nested name/attribute/subscript deletions,
  comparing full operation traces, failure status and remaining bindings/storage.
  Scoped lint, source typecheck and selected build passed. Guest storage/protocol
  semantics, complete frame allocation accounting and remaining full-interpreter
  integration are still pending.
- Connected ordinary/annotated assignment execution to RHS evaluation and target
  traversal. RHS values execute once before chained stores. Annotation expressions
  remain absent/ignored; without an RHS, names do nothing, attributes evaluate only
  their receiver, and subscriptions evaluate receiver/key expressions without a
  store or outer key-tuple/slice construction. Nested key tuples flatten, while
  slice bounds and list expressions execute normally. A shared iterative operand
  enumerator supports runtime metering and static placement validation.
- Assignment/annotation validation: missing-module red suite preceded execution
  work. Current-code probes reproduced erroneous acceptance of valueless starred
  keys before static validation was corrected; value-bearing annotations and stars
  inside executable list/slice-bound/receiver expressions remain accepted.
  All 2,035 tests in 101 files pass. CPython matched 1,800 generated annotated-target
  cases with RHS presence, nested keys/slices/stars, failures, exact syntax errors,
  store traces and ignored annotation expressions. A budget test covers deeply
  nested empty keys that yield no expressions. Scoped lint, source typecheck and
  selected build passed. Complete guest reference storage, frame-heap accounting,
  suspension and remaining full-interpreter integration remain pending.
- Added direct assertion execution to the statement engine with an explicit
  enable/optimization capability. Conditions use branching-context evaluation;
  messages execute only after failure and retain their identity as one argument.
  Absent messages are distinct from null/undefined payloads. The guest adapter
  supplies canonical builtin AssertionError construction and chaining; shadowed
  names are not resolved by the engine. Disabled assertions skip both operands.
- Assertion validation: all 14 new tests failed against the previous leaf-only
  implementation before runtime changes. All 2,049 tests in 102 files pass;
  60 CPython cases matched optimization, operand failures, message values,
  finally effects and a shadowed AssertionError name. Tests also cover capability
  absence and budgets stopping before message evaluation or failure construction.
  Scoped lint, source typecheck and selected workspace build passed. Concrete
  guest exception objects and full-interpreter integration remain pending.
- Added function definition-time execution: evaluate decorator expressions in
  source order before positional/keyword defaults, create the function without
  executing its body, apply decorators inside-out and store only the final result.
  Defaults retain identity in a fresh parameter-name map usable by argument
  binding. Arbitrary decorator results are allowed, and no early name binding or
  callability check is introduced. Parsed annotations/type bounds stay ignored.
  The adapter owns concrete function construction, globals/closure capture,
  metadata, guest calls and storage; async definitions pass their unchanged AST.
- Function-definition validation: a missing-module red suite preceded the
  implementation. All 2,066 tests in 103 files pass, including 17 new cases for
  ordering, failure boundaries, identity, normalized names and metering before
  every guest effect. CPython matched 350 sync/async cases spanning decorator and
  default counts, evaluation/application failures, defaults metadata and retained
  previous bindings. Scoped lint, source typecheck and selected build passed.
  Concrete callable objects, invocation frames, suspension and complete temporary
  heap accounting remain pending; this does not establish a working interpreter.
- Added concrete lexical frame storage driven by resolved scopes: fresh local
  bindings and owned cells per activation, shared nonlocal cells, transitive
  closure forwarding, owner validation and live global/builtin dictionary reads.
  Deletion empties shared cells, so siblings observe deletion and later rebinding.
  Missing locals raise UnboundLocalError; missing free/global names raise NameError
  with distinct diagnostics. Null/undefined guest payloads remain valid bindings.
  Source identifiers are mangled with their lexical class context. Module/class
  namespaces are explicitly rejected because they require different lookup rules.
- Lexical-frame validation: missing-module red suite preceded implementation.
  All 2,079 tests in 104 files pass, including 13 new cases for analyzed closures,
  sibling and invocation isolation, comprehension/lambda captures, mangling,
  missing/wrong-owner cells and budgets. CPython matched 7,500 mixed reads, writes
  and deletions over 300 independent local/nonlocal/global activations, including
  exact missing-name diagnostics. Scoped lint, source typecheck and selected
  workspace build passed. Guest frame objects, class/module namespaces, dynamic
  locals/exec behavior, invocation integration and full heap accounting remain
  pending; full Python execution is not established by these storage checks.
- Connected expanded argument binding to fresh function/lambda lexical frames.
  Positional/keyword/default values initialize locals and captured parameter cells;
  declared variadics receive builtin tuple/dictionary values, including fresh empty
  kwargs dictionaries. Defining globals/builtins and shared closure cells are
  retained. Source parameter/default names are privately mangled before binding,
  while supplied keyword strings are neither normalized nor mangled. Binding errors
  precede container construction. Async/generator bodies are not executed here.
- Function-frame validation: missing-module red suite preceded implementation.
  All 2,096 tests in 105 files pass, including 17 new cases for defaults identity,
  cell initialization, variadics, private/Unicode keywords, errors, scope rejection,
  budgets and feeding a bound argument into statement-return execution. CPython
  matched 1,152 ordinary/class-context calls with initialized parameter values and
  exact binding diagnostics. Scoped lint, source typecheck and selected build
  passed. Function objects, full body invocation, suspension/recursion controls and
  complete activation allocation accounting remain pending.
- Retained lexical function execution kinds from the existing control-flow and
  expression validation pass. Module analysis now exposes AST-identity-keyed
  function/lambda metadata for ordinary functions, generators, coroutines and
  async generators. Unreachable yields count; nested bodies stay separate, while
  defaults/decorators and comprehension outer iterables affect their owning scope.
  Ignored type expressions contribute no runtime functions or yield flags.
- Execution-kind validation: 25 new assertions failed before implementation;
  the existing async-generator return check stayed green. All 2,122 tests in 106
  files pass, with 26 classification tests and 96 CPython code-object flag/placement
  comparisons across nested functions/classes/lambdas and compound suites. Scoped
  lint, source typecheck, selected workspace build and final focused rerun passed.
  The metadata enables correct call dispatch; ordinary body invocation and
  suspended generator/coroutine execution still require implementation.
- Connected invocation to argument frames and analyzed execution kinds. Ordinary
  function bodies run through the statement engine; lambda bodies evaluate in
  value context. Bare/implicit returns produce the supplied guest None, while
  explicit null/undefined payloads retain identity. Generator/coroutine/async-
  generator calls bind arguments immediately and delegate unstarted-object creation
  to an optional suspension backend without preparing or executing the body.
  Missing backends fail explicitly; this is not a completed suspension runtime.
- Invocation validation: missing-module red suite preceded implementation. All
  2,142 tests in 107 files pass, including 20 new cases for return/finally behavior,
  activation-local loop bindings, lambdas, suspended dispatch, argument failure
  timing, absent backends and execution limits. CPython matched 90 calls spanning
  body effects, return values, finally cleanup, failures and unstarted-object call
  behavior. Source typecheck, selected build and scoped lint passed. Concrete guest
  callable objects, resumable execution, recursion/call-stack controls, tracebacks
  and full activation allocation accounting remain unfinished.
- Added shared execution-context call-depth tracking around ordinary function and
  lambda bodies. Rejected entry raises an internal RecursionError without changing
  the active stack. Invocation restores the caller in finally, including body
  adapter failures and fatal limits. Cleanup is unmetered/idempotent; out-of-order
  restoration is a host integration error. Unstarted suspended calls do not enter
  the body stack. Invocation contexts now require the shared call tracker.
- Call-stack validation: missing-module red suites preceded implementation. All
  2,156 tests in 108 files pass, including depth/current-frame tracking, invalid
  limits, excess-depth recovery, repeated/LIFO restoration, recursive invocation,
  guest-handler recovery and cleanup after fatal signals. Source typecheck, scoped
  lint and selected workspace build passed. The maximum is explicit runtime policy,
  not an exact emulation of CPython's process-global recursion counter. Conservative
  limits are required while nested calls still use host callbacks; stack-independent
  invocation, resumable execution, traceback objects and full heap accounting remain
  unfinished. This is not a complete host-stack safety boundary.
- Added module namespace storage with live local/global/builtin lookup, ordinary
  module dictionary storage and optional separate local mapping protocols. Explicit
  globals bypass local mappings for reads/writes/deletes. CPython probes confirmed
  that descendant global declarations also affect module name access, even inside
  unexecuted definitions; iterative scope scanning preserves this behavior and
  class-mangled global keys. Local deletion guest failures become NameError;
  lookup/store failures and host/fatal deletion errors propagate unchanged.
- Module-frame validation: missing-module red suite preceded implementation.
  All 2,172 tests in 109 files pass, including 16 new cases for lookup precedence,
  declaration propagation, live values, mangling, mapping failures, scope rejection
  and metering. CPython matched 2,400 mixed namespace operations across 200 scope,
  mapping-failure and initial-state configurations, including exact errors, mapping
  traces and final storage. Source typecheck, scoped lint and selected build passed.
  Class namespaces, module execution integration, guest exec/auditing, builtin
  selection/insertion and complete heap accounting remain pending.
- Added class-body storage with prepared mapping lookup, enclosing cells, explicit
  global/nonlocal mutation, private-name mangling and method-closure capture.
  Locally bound class names fall back to globals/builtins, not forwarded method
  cells. Owned __class__ construction cells stay separate from namespace entries
  and same-named enclosing cells; method captures select by lexical owner.
- Class-frame validation: missing-module red suite preceded implementation.
  CPython comparison then disproved the initial assumption that explicit nonlocal
  reads bypass the mapping. A corrected failing regression preceded the fix:
  class nonlocal reads are mapping-first, but writes/deletes target the cell.
  All 2,185 tests in 110 files pass, including 13 class-frame cases. CPython matched
  1,536 operations across 256 binding/mapping/state configurations, including exact
  failures, protocol traces and local/enclosing/global state. Source typecheck,
  final scoped lint and selected build passed. Class construction, metadata and
  __classcell__ protocol validation, guest object integration and complete heap
  accounting remain unfinished.
- Added class-header base resolution through ordinary __mro_entries__ lookup on
  non-types. Hooks receive the same original bases tuple; empty and multiple
  replacements are supported without recursively resolving or pre-validating
  replacement elements as classes. No replacement preserves tuple identity;
  a changed flag supports later __orig_bases__ installation. Returned tuples are
  validated before expansion, with observable subclass iteration delegated to a
  metered sequence-fast adapter rather than direct replacement storage reads.
- Base-resolution validation: missing-module red suite preceded implementation.
  All 2,198 tests in 111 files pass, including 13 new cases for ordering, identity,
  failures, nonrecursive expansion and an infinite replacement iterator budget.
  CPython's class builder matched 729 combinations of bases and failure modes.
  Probes corrected the adapter contract: tuple-subclass expansion materializes its
  iterator with list-extension protocols, not the original tuple subclass's length.
  Source typecheck, scoped lint and selected build passed. Concrete protocol
  adapters, full class-construction integration and allocation accounting remain
  unfinished.
- Connected resolved class bases to metaclass selection and __prepare__. Explicit
  non-type factories bypass metaclass conflict selection; absent metaclasses use
  the first base's type or builtin type. The metaclass keyword is removed from a
  fresh ordered map shared with subsequent construction. Prepare results use the
  internal mapping protocol flag, not an ABC check; callability of a non-type
  metaclass is deferred until construction. Missing prepare hooks allocate the
  builtin namespace. Invalid-result diagnostics use bounded UTF-8 type names.
- Preparation validation: missing-module red suite preceded implementation;
  CPython probes then produced three exact failing long-name regressions before
  200-byte, whole-character diagnostic truncation was added. All 2,214 tests in
  112 files pass, including 16 preparation tests. CPython's class builder matched
  120 metaclass/base/result/failure combinations. Source typecheck, scoped lint
  and selected build passed. Class body execution/construction/decorator wiring,
  concrete guest protocol adapters and full temporary allocation accounting remain
  unfinished.
- Added metaclass construction completion and original body-captured __class__
  cell validation. Type results must match a populated captured cell; empty cells
  produce the propagation RuntimeError and mismatches produce TypeError. Non-type
  metaclass results remain valid and skip cell validation. Diagnostics preserve
  Python name repr, value-repr order and formatting failures; construction and
  representation effects are never rolled back. Preparation now exposes a shared
  typed result for the construction stage.
- Construction-completion validation: missing-module red suite preceded work.
  All 2,230 tests in 113 files pass, including 16 new completion cases. CPython
  matched 240 combinations of metaclass result/cell state/name/representation
  behavior, including repr-triggered cell repair, exact errors, effect traces and
  final cell state. Source typecheck, scoped lint and selected build passed.
  Type.__new__ propagation/namespace validation, full class-body/decorator wiring,
  concrete guest objects and complete allocation accounting remain unfinished.
- Extracted shared call-argument evaluation into a host continuation protocol,
  retaining the expression engine's explicit evaluation stack. Ordinary lone-star
  calls still defer expansion until after keywords; class headers can declare
  their implicit positional body/name prefix so starred bases expand immediately.
  Positional/star grouping, whole explicit-keyword groups and early mapping/duplicate
  failures retain evaluation order. The existing collector type is re-exported for
  compatibility. This host generator is not guest Python generator support.
- Shared-argument validation: missing-module red suite preceded extraction.
  All 2,239 tests in 114 files pass, including eight new argument-protocol cases and
  a 4,001-level nested-call check without recursive host expression evaluation.
  After rebuilding, 3,000 existing CPython ordinary-call traces matched; 64 separate
  class-header traces matched prefix-sensitive expansion and failure timing. Source
  typecheck, scoped lint and selected build passed. Full class-definition stage
  wiring, concrete argument collectors, guest suspension and temporary allocation
  accounting remain unfinished.
- Added class-definition execution through the active builtin builder: decorator
  expressions precede builder lookup and header operands; the body callable and
  normalized name form the implicit positional prefix. Shared argument evaluation
  preserves starred-base timing. Builder results receive decorators in reverse
  order and bind only after success. Missing/overridden/non-callable builders retain
  their semantics; class bodies and ignored type syntax are not evaluated here.
- Class-definition validation: missing-module red suite preceded implementation.
  All 2,259 tests in 115 files pass, including 20 new lifecycle cases. CPython matched
  234 combinations of header ordering, decorators, builder availability/callability
  and injected failures, comparing effects, final bindings and exact errors. Source
  typecheck, scoped lint and selected build passed. The concrete builtin builder's
  connection to base resolution, prepared class frames and metaclass construction,
  guest object representation and complete heap accounting remain unfinished.
- Connected builtin class building across argument validation, original-base tuple
  assembly, base resolution, namespace preparation, body execution and construction.
  Successful bodies precede __orig_bases__ mapping assignment; only changed bases
  trigger that assignment, and failures preserve prior effects. The exact captured
  body cell reaches construction validation. Preparation/construction now accept a
  generic name representation, preserving guest string-subclass identity instead
  of reducing names to host strings. Existing host-string callers remain supported.
- Builtin-builder validation: missing-module red tests preceded implementation;
  an additional failing identity test demonstrated and fixed name-object loss.
  All 2,275 tests in 116 files pass, including 16 new builder cases. A differential
  probe matched 56 CPython combinations of base-resolution mode, string/subclass
  names and stage failures, comparing traces, results, exact errors and original-base
  namespace state. Typecheck, scoped lint and selected build passed. Lifecycle order
  was also checked against CPython 3.14 Python/bltinmodule.c:
  https://github.com/python/cpython/blob/3.14/Python/bltinmodule.c
  Concrete guest values, body-frame execution/metadata and full heap accounting
  remain unfinished. Directly supplied ordinary function bodies must honor their
  optimized-locals flags rather than treating every function as class-suite code.
- Added class-suite execution with ClassFrame storage, shared call-depth entry and
  unconditional host-frame restoration. The executor installs module, qualified
  name and first-line metadata, handles optimized-away docstrings, runs the suite,
  then publishes static attributes and the original captured class cell. Metadata
  stores honor class declarations and prepared mapping protocols. Function call
  contexts now require only the stack entry capability so mixed frame stacks can
  serve both functions and classes. Arbitrary functions directly supplied to the
  builtin builder still require separate code-flag-aware dispatch.
- Class-suite validation: missing-module red tests preceded implementation. A
  CPython probe and failing regression exposed Python 3.14 docstring cleaning;
  added metered tab expansion/common-indent removal preserving blank lines.
  All 2,291 tests in 117 files pass, including 16 new suite cases. CPython matched
  72 metadata/mapping/failure/optimization traces and 512 docstring cases. Source
  typecheck, scoped lint and selected build passed. Metadata ordering and docstring
  behavior were checked against CPython 3.14 Python/codegen.c and Python/compile.c.
  Qualified-name compilation, static-attribute tuple analysis, concrete guest
  statement protocols, builder/body binding and full allocation accounting remain
  unfinished; metadata inputs are required, not silently defaulted to empty values.
- Added lexical code qualified-name analysis to analyzeModule, keyed by exact
  SymbolScope identities. Function/lambda descendants receive <locals> components;
  classes preserve enclosing paths. Explicit global function/class definitions
  reset the path after private-name-aware declaration lookup, while nonlocal
  definitions retain lexical paths. Display names retain normalized source names,
  not mangled storage keys. Inlined list/set/dict comprehensions have no code-name
  entry, while generator expressions retain their code scope. The traversal uses
  an explicit work stack and precollects declarations per code scope.
- Qualified-name validation: all 12 new cases initially failed for missing metadata.
  All 2,303 tests in 118 files pass. CPython matched 252 compiled code-name trees
  combining nested classes/functions/async functions, lambdas/defaults, comprehension
  nesting, global declarations and private/normalized identifiers. Source typecheck,
  scoped lint and selected build passed. Rules were checked against CPython 3.14
  Python/compile.c compiler_set_qualname. Static-attribute analysis, concrete
  function/class value metadata, executor wiring and full runtime remain unfinished.
- Added class static-attribute analysis to analyzeModule, keyed by class scope
  identity. Ordinary stores to the literal self receiver contribute sorted,
  normalized, unmangled attribute names. Unpacking/for/with/comprehension targets
  count; augmented assignment, deletion, loads and valueless annotations do not.
  Ownership follows the enclosing code-class stack, excluding the current class
  code unit and accounting for comprehension inlining. Nested class-body stores
  can therefore belong to the enclosing class, while nested methods belong to
  their own class. Unreachable syntactically compiled stores remain represented.
- Static-attribute validation: 13 new tests initially failed for missing metadata.
  All 2,316 tests in 119 files pass. CPython matched 176 compiled class metadata
  trees across nested code scopes and assignment forms, including Unicode ordering,
  definition defaults and nested comprehension ownership. The oracle deduplicates
  repeated epilogue stores emitted on separate control-flow exits of one code unit.
  Source typecheck, scoped lint and selected build passed. Ownership rules were
  checked against CPython 3.14 Python/compile.c. Guest tuple materialization,
  function/class value metadata, full runtime wiring and allocation accounting
  remain unfinished.
- Connected analyzed class metadata to reusable compiled class bodies. Compilation
  validates exact scope metadata, materializes qualified-name/line/static-attribute
  constants, cleans or strips leading docstrings, and copies the executable suite
  without mutating the analyzed AST. Execution now consumes those constants and
  statements directly; it no longer allocates name/line/docstring values or slices
  the suite per activation. Static tuple identity is retained across activations,
  while class cells are fresh and module-name lookup remains live.
- Class-compilation validation: missing-module red suite preceded implementation.
  All 2,326 tests in 120 files pass, including ten new compilation tests and a
  repeated-activation identity check. Allocation-failure coverage moved to the
  compilation boundary; mapping failures remain covered during execution. The
  updated compile-and-execute path matched 72 CPython class-suite traces; 512
  docstring comparisons also passed. Source typecheck, scoped lint, selected build
  and generated declaration inspection passed. Whole-program compilation/caching,
  concrete guest code/value objects, builtin builder dispatch, complete docstring
  encoding validation and full allocation accounting remain unfinished.
- Validated and fixed compiler docstring encoding: retained docstrings reject
  surrogate code points after tab expansion but before indentation cleanup.
  Errors preserve the first contiguous surrogate span in expanded code-point
  coordinates and retain an independently owned immutable copy of the complete
  expanded text. Adjacent surrogate code points are never merged through a UTF-16
  round trip. Optimized-away docstrings bypass validation. Error-text buffers are
  charged before allocation and fatal budget failures take priority.
- Docstring encoding validation: CPython probes reproduced the mismatch, and all
  nine initial encoding cases failed before the fix. All 2,336 tests in 121 files
  pass, including ten new cases covering spans, ownership, optimization and limits.
  A 1,000-case CPython comparison matched cleaned values or complete encoding-error
  diagnostics and retained text across tabs, nulls, line breaks, supplementary
  characters and surrogate runs. Source typecheck, scoped lint and selected build
  passed. Concrete guest exception objects, whole-program compiler dispatch and
  complete host-string temporary allocation accounting remain unfinished.
- Added reusable function/lambda compilation metadata: exact analyzed scope and
  execution kind, normalized display name, lexical qualified name, decorator-aware
  first line, retained docstring and prepared suite/expression body. Shared suite
  compilation now handles class and function docstring cleaning, validation,
  stripping and statement copies. Defaults/decorators remain definition-time work.
  Invocation consumes compiled bodies; suspended activation adapters receive the
  same compiled code without executing it. Scalar constant allocation has a shared
  contract used by both function and class compilation.
- Function-compilation validation: missing-module tests preceded implementation;
  a separate failing invocation test reproduced incorrectly executed function
  docstring statements. All 2,351 tests in 122 files pass, including 13 compilation
  cases and two invocation regressions. CPython matched 184 function metadata
  compilations across nesting, optimization, coroutine/generator kinds, docs and
  lambdas. The comparison uses CO_HAS_DOCSTRING rather than guessing from the
  first string constant (a lambda may have a non-docstring string there). Existing
  72 class-suite traces and 512 docstring comparisons also pass. Source typecheck,
  scoped lint and selected build passed. Concrete function/code value objects,
  metadata mutation, whole-program compilation/caching, guest suspension and full
  allocation accounting remain unfinished.
- Added whole-program preparation of module suites and all analyzed function/class
  bodies. AST-identity code maps support definition adapters without recompilation
  or repeated scope searches. Traversal reaches defaults, comprehension children
  and unexecuted definitions; nested docstring failures therefore precede module
  execution. Added compiled module execution through ModuleFrame and the statement
  engine, with retained-docstring storage, live supplied namespaces, shared active
  frames and unconditional host restoration. Prior mutations are not rolled back.
- Program/module validation: missing-module red suites preceded implementation.
  All 2,365 tests in 124 files pass, including 14 new compilation/execution cases.
  CPython matched 144 compiled module/exec traces across separate locals, nested
  global declarations, retained/stripped/absent docstrings and mapping failures,
  comparing namespace state and exact errors. Source typecheck, scoped lint and
  selected build passed. This is not a standalone interpreter API: concrete guest
  values and leaf/expression wiring, comprehension execution, imports/builtin
  initialization, guest tracebacks and complete allocation accounting remain open.
- Added lambda creation to expression evaluation through an optional runtime
  factory. Defaults execute in the containing scope in parameter order, retaining
  original values and normalized unmangled keys; the body remains unexecuted.
  Fresh definition maps, default-side-effect preservation and factory failures
  follow function-definition semantics. Explicit continuations keep nested lambda
  defaults off the host evaluation stack and clear stale default truth state.
  Missing lambda capability fails before evaluating defaults.
- Lambda-expression validation: eight of ten initial cases reproduced the missing
  implementation (entry-limit and unavailable-backend checks already passed).
  All 2,376 tests in 125 files pass, including 11 new cases, a 4,001-level nested
  default check and an integration path through program compilation, lambda
  creation, argument binding and invocation. CPython matched 192 default-order,
  failure, walrus, nesting and branching cases. Source typecheck, scoped lint and
  selected build passed. Concrete guest function storage/metadata, closure factory
  wiring, suspension and complete definition/continuation heap accounting remain
  unfinished.
- Added shared internal function state for named definitions and lambdas. Creation
  retains compiled code and live defining global/builtin dictionaries, copies
  default/cell containers while preserving their values and cell identities, and
  validates required closure ownership without retaining unused cells. Initial
  name/qualified-name/doc/module metadata and fresh named-attribute storage are
  retained per definition. Module metadata is captured from globals.__name__ once;
  absent metadata maps to guest None without conflating guest undefined values.
- Function-state validation: missing-module red suite preceded implementation.
  All 2,387 tests in 126 files pass, including 11 new state/definition/frame cases;
  the lambda compilation-to-invocation test now uses shared state too. CPython
  matched 60 metadata/default/closure/live-dictionary cases across function kinds.
  Source typecheck, scoped lint and selected build passed. This payload is not
  guest-accessible JS storage: guest descriptors, default tuple/dictionary views,
  validated special-attribute writes, __code__ replacement, definition-time builtin
  selection, concrete guest function allocation and full heap accounting remain
  unfinished.
- Added builtin namespace protocol lookup alongside the internal dictionary fast
  path. Module, function and class frames preserve present undefined values,
  translate adapter-reported missing keys to NameError, and propagate other
  protocol failures. Function creation now resolves globals.__builtins__ once per
  definition when present, retaining the current namespace only when absent.
  Resolution adapters defer mapping support checks until lookup; previously
  created functions retain their selected namespaces after globals rebinding.
- Builtin-namespace validation: CPython probes confirmed custom mappings and
  deferred None/int subscription failures; all eight new regression cases failed
  before implementation. All 2,395 tests in 127 files pass. CPython matched 70
  dictionary/custom-mapping/missing/failure cases across module, function and class
  frames with local/global precedence. Source typecheck, scoped lint and selected
  build passed. Concrete guest builtin/module adapters, guest __builtins__ attribute
  exposure, builtin initialization and complete runtime/allocation integration
  remain unfinished. Resolver absence with an explicit builtin value is a host
  integration failure, not silent fallback or a guest exception.
- Added owned immutable byte storage as a concrete literal/value payload
  foundation, distinct from mutable/releasable buffer views. Input and exported
  arrays are copied; internal slicing adopts its freshly allocated output without
  a second copy. Exact 64-bit-model indexing, arbitrary-size slice strides and
  unsigned lexicographic comparison are metered. Required buffer allocations are
  charged before allocation, while host iteration exposes only byte numbers.
- Immutable-byte validation: missing-module red suite preceded implementation.
  All 2,409 tests in 128 files pass, including 14 new ownership, indexing, slicing,
  comparison and allocation cases. CPython matched 3,000 indexing/slicing/comparison
  operations over 1,000 generated cases, including huge indices/strides and exact
  error messages. Source typecheck, scoped lint and selected build passed. Concrete
  guest constant factories, bytes objects/methods/buffer exports and full host
  object/iterator allocation accounting remain unfinished.
- Added concrete immutable tagged constants for parser literals and compiled
  metadata: per-runtime singletons, distinct booleans/integers, arbitrary-size
  integers, floats/complex numbers, owned code-point strings/bytes and tuples with
  copied slots and shared member identities. The factory directly satisfies
  program compilation's constant interface. Logical record/slot allocation charges
  are explicit; retained bigint creation remains the caller's responsibility.
- Constant-value validation: missing-module red tests preceded implementation;
  all 2,429 tests in 129 files pass. CPython matched 1,004 literal values including
  exact floating-point bits, large integers, surrogate strings and bytes. Source
  typecheck, scoped lint and selected workspace build passed. Concrete
  guest type objects, methods, mutable collections and full heap accounting remain
  unfinished; these host records are not a guest property-access interface.
- Added metered truth slots for exact concrete builtin constants: singleton,
  numeric, string, bytes and tuple values. Numeric NaN is true, signed zeros are
  false, tuple members are not inspected, and Python 3.14 NotImplemented truth
  testing raises TypeError. Each test charges one step without payload allocation.
- Constant-truth validation: missing-module red tests preceded implementation.
  All 2,436 tests in 130 files pass; CPython matched 2,688 logical/conditional
  expression outcomes in value and branch modes, including identity-preserving
  short circuiting and exact errors. Typecheck, scoped lint and selected workspace
  build passed. User-defined/subclass __bool__/__len__ dispatch and concrete guest
  type integration remain unfinished; this helper is for exact builtin values.
- Added exact builtin constant unary operators (+, -, ~, not), preserving numeric
  unary-plus identity, arbitrary-size integer results, signed floating zeros and
  component-wise complex negation. Boolean arithmetic returns integer values;
  boolean inversion calls an explicit warning-policy hook before producing a
  result. Unsupported operands report Python type names and unknown operators
  remain host integration errors. Expression integration now uses this adapter.
- Constant-unary validation: missing-module red tests preceded implementation.
  All 2,445 tests in 131 files pass; CPython matched 2,444 unary results/errors and
  complete warning traces, including large integers, NaN and infinities. Typecheck,
  scoped lint and selected build passed. Guest warning filtering/locations,
  subclass dispatch, bigint payload allocation and size-dependent CPU accounting
  remain unfinished; tagged-result allocations and operation checkpoints alone
  do not establish complete resource containment.
- Added exact concrete numeric pair comparisons across bool, int, float and
  complex values, reusing exact real ordering without integer-to-float coercion.
  NaN bypasses no equality work even for identical objects; complex equality
  checks both components. Complex ordering and nonnumeric pairs decline with
  NotImplemented so callers retain reflected dispatch/error responsibilities.
  This combined builtin-pair kernel is not an exposed individual type dunder.
- Numeric-comparison validation: missing-module red tests preceded implementation.
  All 2,453 tests in 132 files pass; CPython matched 62,424 numeric comparisons,
  including integers beyond floating range, precision boundaries, signed zeros,
  NaN, infinities and complex components. Typecheck, scoped lint and selected
  workspace build passed. Individual guest type slots, subclass dispatch wiring,
  nonnumeric comparisons and size-dependent bigint CPU accounting remain pending.
- Added full comparison expressions for exact immutable builtin constants:
  identity, numeric pairs, Unicode code-point strings, unsigned bytes, singleton
  fallback and lexicographic tuples. Tuple members use identity before equality;
  direct NaN comparison retains non-reflexive numeric semantics. Explicit work
  frames avoid host recursion for nested tuples, with per-step budget checks.
  Unsupported ordering reports the actual unequal operand/member type names.
- Constant-comparison validation: missing-module red tests preceded implementation.
  All 2,462 tests in 133 files pass, including 5,000-level tuple equality and
  expression-engine chained comparisons. CPython matched 69,192 value/identity/
  ordering/error outcomes over shared tuple graphs and mixed constant kinds.
  Source typecheck, scoped lint and selected workspace build passed.
  Guest subclass dispatch, mutable-container comparisons, membership, stack heap
  accounting and size-dependent bigint CPU charges remain unfinished. Nested
  ordering can repeat equality work, bounded by the execution step budget.
- Added exact immutable builtin membership for strings, bytes and tuples, wired
  into expression integration tests. String search preserves code points; bytes
  accept subsequences or bounded integer/bool needles. Tuple membership uses
  member identity then concrete equality without coercing NotImplemented. Invalid
  needles/noncontainers retain Python diagnostics, including on empty containers.
  Owned bytes now search private buffers without copies using metered linear KMP
  for subsequences and a metered direct scan for single bytes.
- Membership validation: missing-module red tests preceded implementation.
  All 2,470 tests in 134 files pass; CPython matched 17,298 mixed constant membership
  outcomes and 2,000 generated byte-subsequence/integer searches. Tests verify KMP
  allocation/work bounds and fatal step exhaustion. Typecheck, scoped lint and
  selected workspace build passed. Guest __contains__/iteration
  fallback, index conversion and arbitrary buffer exporters remain unfinished.
- Added concrete integer subscription for immutable strings, bytes and tuples,
  wired into expression execution tests. Bool indices use 0/1; negative indices
  normalize only after signed 64-bit overflow checks. String results own exactly
  one code point, including surrogates; bytes return integer values and tuple
  members retain identity without result allocation. Receiver/key/range failures
  preserve Python's type-specific diagnostics and evaluation precedence.
- Integer-subscription validation: missing-module red tests preceded implementation.
  All 2,478 tests in 135 files pass; CPython matched 1,700 indexing outcomes across
  Unicode strings, bytes, tuples, nonsubscriptable receivers and invalid/huge keys.
  Source typecheck, scoped lint and selected workspace build passed.
  Concrete slices, user-defined index conversion/subscription and complete host
  allocation accounting remain unfinished.
- Added concrete immutable-sequence host iterators for strings, bytes and tuples,
  connected to expression starred unpacking. String items preserve code points;
  byte items are integers; tuple items retain their identities. Independent
  positions, decreasing length hints, stable exhaustion and source-reference
  release on observed exhaustion are explicit. Construction, next and length-hint
  calls checkpoint the budget; output strings/integers use the constant factory.
- Iterator validation: missing-module red tests preceded implementation. All 2,486
  tests in 136 files pass; CPython matched 300 iterator traces with 4,950 next and
  length-hint steps, including repeated exhaustion and surrogate strings. Source
  typecheck, scoped lint and selected workspace build passed. Guest
  iterator type objects, StopIteration conversion, special-method/legacy iteration
  dispatch and full iterator/result-record heap accounting remain unfinished.
- Added concrete slicing over evaluated slice components for immutable strings,
  bytes and tuples. Step validation precedes bound conversion; None/bool bounds,
  negative strides and arbitrary-size indices retain exact semantics. Full
  unit-stride slices reuse the source value; tuple selections preserve member
  identities. The constant factory now shares trusted immutable string/bytes
  storage while still copying mutable inputs, avoiding redundant payload copies
  when wrapping slice results. Temporary tuple slots are separately charged.
- Slice validation: missing-module and immutable-storage identity red tests
  preceded implementation. All 2,495 tests in 137 files pass; CPython matched 3,000
  slice outcomes including zero/invalid steps, oversized bounds and negative
  strides. Source typecheck, scoped lint and selected workspace build passed.
  Byte-slice accounting verifies one copied payload plus the tagged
  result. Guest slice objects/expression wiring, user-defined index conversion
  and complete host heap accounting remain unfinished.
- Added immutable concrete slice records with start/stop/step references and None
  defaults; construction intentionally does not validate or coerce components.
  Slices are truthy and compare through identity-aware component ordering on the
  explicit comparison work stack. Concrete subscription now recognizes slice keys,
  connecting evaluated slice syntax to sequence slicing through expression tests.
  Logical slice allocation charges include the record and three references;
  comparison charges its temporary component arrays without guest tuple records.
- Slice-value validation: seven new regression tests failed before implementation.
  All 2,502 tests in 138 files pass; CPython matched 141,512 mixed comparisons with
  slice values/shared components and 3,000 subscriptions through concrete slice
  keys. Typecheck, scoped lint and selected workspace build passed.
  Guest slice type descriptors, constructor-call binding, indices(), hashing,
  user-defined conversion and complete host heap accounting remain unfinished.
- Added concrete real-pair arithmetic for +, -, *, /, // and %, wired into
  expression tests. Bool/integer operations retain exact integer results except
  true division; mixed float operands convert before divisor validation. Exact
  integer-ratio division and Python float-divmod rounding reuse existing kernels.
  Nonreal operands decline before conversion for later complex/sequence dispatch.
- Arithmetic validation: missing-module red tests preceded implementation; a
  separate failing regression reproduced the stale integer divmod zero-division
  message. Local CPython 3.14.7 and official 3.14 longobject.c both confirmed the
  corrected "division by zero" diagnostic. All 2,513 tests in 139 files pass;
  CPython matched 16,854 numeric results/errors including exact floating bits
  (NaN payloads normalized), huge integers, overflow and zero-division precedence.
  Source typecheck, scoped lint and selected workspace build passed.
  Complex arithmetic, powers, bitwise operations, guest slot wiring, bigint payload
  allocation and size-dependent CPU metering remain unfinished.
- Added concrete integer bitwise &, | and ^ with arbitrary-size signed integer
  semantics. Two bool operands return canonical bool values; mixed bool/int pairs
  return integers. Other types decline without truth/numeric conversion so later
  reflected/set dispatch remains possible. Expression integration covers boolean
  identity and signed integer operations.
- Bitwise validation: missing-module red tests preceded implementation. All 2,520
  tests in 140 files pass; CPython matched 15,552 typed results and unsupported
  builtin pairs, including multi-thousand-bit signed integers. Source typecheck,
  scoped lint and selected workspace build passed. Shifts, set slots,
  guest type dispatch, bigint payload allocation and size-dependent CPU metering
  remain unfinished.
- Added concrete bool/int left and right shifts, connected to expression tests.
  Negative counts fail before zero shortcuts; bool results become integers and
  enormous right shifts retain signed floor behavior. Nonzero left shifts reserve
  ceil(count/8) growth bytes before host execution. Unrepresentable growth exhausts
  and latches even the largest supported budget; host bigint-size failures are
  fatal resource exhaustion rather than guest RangeError. This bounds shift growth,
  not original payload copies, temporary allocation or size-dependent CPU work.
- Shift validation: missing-module red tests preceded implementation; CPython
  matched 2,005 bounded/safe huge-count shift outcomes. Tests check growth charges,
  rejection before host allocation and fatal latching at both small and maximum
  budgets. All 2,529 tests in 141 files pass; source typecheck, scoped lint and
  selected workspace build passed. Guest type dispatch and full bigint resource
  accounting remain pending.
- Added concrete complex +, -, * and /, connected to expression integration.
  Python 3.14 mixed-real paths preserve imaginary signed zero and avoid artificial
  NaNs. Complex multiplication includes nonfinite recovery; division uses scaled
  ratios and infinity/zero recovery. Unsupported nonnumeric pairs decline before
  conversion, and zero division follows integer-to-float conversion precedence.
- Complex validation exposed 16 signed-zero/cancellation mismatches against the
  local CPython build despite direct source-formula agreement. Focused probes
  identified fused multiply-add rounding; failing regressions preceded an exact
  binary64 FMA kernel using bounded rational intermediates and one final rounding.
  Complex division now explicitly preserves that reference-build rounding without
  relying on JavaScript hardware fusion. The internal FMA returns hardware-style
  infinities/NaNs; it is not the public math.fma exception wrapper.
- All 2,541 tests in 143 files pass. CPython matched 93,636 complex arithmetic
  outcomes and 2,004 internal FMA outcomes, with exact finite bits/signed zeros and
  normalized NaN payloads. Source typecheck, scoped lint and selected build passed.
  Powers, guest numeric slot wiring, public math.fma error
  policy and full temporary-rational/host heap accounting remain unfinished.
- Added concrete concatenation for matching immutable strings, bytes and tuples,
  wired into expression tests. String concatenation preserves separate surrogate
  code points; bytes adopt a newly allocated output buffer; tuple slots preserve
  member identities. Empty operands reuse the other value. Mismatches decline so
  callers retain reflected dispatch and sequence-error responsibilities. String
  and tuple temporary copies are explicitly charged; eliminating those copies
  and full host object/array overhead accounting remain pending.
- Concatenation validation: missing-module red tests preceded implementation.
  All 2,548 tests in 144 files pass; CPython matched 3,000 generated string/bytes/
  tuple concatenations. Ownership, identity and pre-allocation budget checks pass.
  Source typecheck, scoped lint and selected workspace build passed. Guest sequence
  dispatch, repetition and complete resource accounting remain unfinished.
- Added concrete immutable sequence repetition in both operand orders, connected
  to expression tests. Integer/bool counts are validated against the signed 64-bit
  index model before empty shortcuts; zero/negative counts produce empty values,
  count one preserves identity and tuple copies repeat member references. String,
  bytes and tuple oversized-result diagnostics match their Python paths. Byte
  outputs adopt one buffer; string/tuple temporary copies are explicitly charged.
- Shared fatal allocation exhaustion now serves shifts and repetition, preserving
  ExecutionBudget latching for unrepresentable output sizes and host array limits.
  Repetition reserves payload/slot storage before host allocation; full object
  overhead and removal of string/tuple temporary copies remain unfinished.
- Repetition validation: missing-module red tests preceded implementation. All
  2,557 tests in 145 files pass; CPython matched 6,036 results/errors in both operand
  orders, including safe overflow probes. Source typecheck, scoped lint and selected
  workspace build passed. Guest index conversion, sequence slot
  dispatch and complete resource accounting remain unfinished.
- Removed redundant code-point buffer copies from string concatenation, repetition
  and strided slicing. Fresh generated buffers transfer through a module-private
  ownership capability; public constructor inputs still copy and validate, and an
  unrelated marker cannot bypass either operation. Contiguous slices still take
  independent copies rather than retaining views into an older backing buffer.
- Owned-string validation: allocation/identity regressions failed before the
  optimization, including a repeat that previously exceeded an exact one-buffer
  budget. The older strided-slice allocation expectation now reflects its actual
  single buffer. All 2,562 tests in 145 files pass; CPython rechecks matched 3,000
  concatenations, 6,036 repetitions and 3,000 slices. Source typecheck, scoped lint
  and selected workspace build passed. Tuple temporary copies and
  full host object/array overhead accounting remain unfinished.
- Removed temporary tuple arrays from concatenation, repetition and slicing.
  The constant factory supports trusted indexed readers that fill final slots
  directly, charges storage before invoking readers, and never exposes partially
  initialized arrays. Existing array input still copies and freezes its slots.
- Direct-tuple validation: allocation and reader regressions failed before the
  implementation; all 2,568 tests in 145 files now pass. CPython rechecks matched
  3,000 concatenations, 6,036 repetitions and 3,000 slices. Source typecheck,
  scoped lint and selected workspace build passed. Full host object/array
  overhead accounting remains unfinished.
- Added concrete bool/int three-argument modular power, including negative
  exponents, signed moduli and canonical integer results. Noninteger operands
  decline before numeric validation; full ternary reflected dispatch, float/type
  errors and the None-modulus two-argument route remain caller responsibilities.
  Semantics follow https://docs.python.org/3/library/functions.html#pow and local
  CPython 3.14 checks.
- Instrumented modular exponentiation and extended-Euclid inverse loops with
  cooperative checkpoints. Guest adapters supply a mandatory meter; existing
  trusted host numeric utilities retain an optional meter. Regressions reproduced
  ignored step limits and cancellation before implementation. All 2,578 tests in
  146 files pass, and 11,333 modular-power outcomes match CPython. Source
  typecheck, scoped lint and selected workspace build passed. Bigint payload
  allocation and size-dependent host CPU accounting remain unfinished.
- Added concrete bool/int ordinary exponentiation and expression-fixture wiring.
  Nonnegative powers remain exact integers, use metered repeated squaring and
  reserve product payload upper bounds before host multiplication. Trivial
  0/1/-1 bases avoid exponential work; unrepresentable result growth fails through
  the latched allocation budget. Negative powers preserve integer-to-float
  conversion order, signed underflow and Python 3.14's zero-power error.
- Integer-power validation: tests first reproduced the missing kernel; all 2,589
  tests in 147 files pass, including right-associativity/unary precedence and
  resource guards. Source typecheck, scoped lint and selected build passed.
  A 6,697-case CPython audit matched integer/error/signed-zero outcomes exactly.
  Its strict bitwise float comparison found 190 finite nonzero differences, each
  one ULP in this corpus. CPython uses platform libm pow while this path uses host
  JavaScript exponentiation; exact platform rounding parity is not established.
  Reference: https://github.com/python/cpython/blob/3.14/Objects/floatobject.c .
  Float/complex operand powers, full builtin dispatch, bit-length temporary
  storage, exponent shifts and size-dependent host CPU accounting remain pending.
- Added concrete immutable hashing with exact 64-bit numeric, complex, tuple
  and slice combiners. Equal numeric values share hashes across bool/int/float/
  complex; NaNs use their containing object's identity policy. Identity and
  seeded string/byte hashes are explicit trusted runtime policies, not guest
  callbacks or an implicit insecure default. Host hash results normalize to
  signed 64 bits and exclude the reserved -1 sentinel.
- Hash traversal uses a charged explicit stack, handles 10,000 nested tuples,
  preserves member order and failure propagation, and checks cancellation after
  trusted policies return. Tests first reproduced the missing module. All 2,597
  tests in 148 files pass; 12,004 numeric/nested immutable hashes matched CPython
  exactly. Source typecheck, scoped lint and selected workspace build passed. Reference:
  https://github.com/python/cpython/blob/3.14/Objects/tupleobject.c and the
  corresponding sliceobject.c/complexobject.c hash implementations.
  Default seeded payload hashing, guest __hash__ dispatch, mutable containers,
  caching and complete host temporary-allocation/CPU accounting remain pending.
- Added an explicit-key SipHash-1-3 policy for immutable byte/string payloads.
  It streams bytes without copying payload-sized buffers and reserves a fixed
  32-byte logical working state. Strings use minimal 1/2/4-byte code-point width
  across the whole value in the fixed little-endian model, preserving isolated
  surrogates. Empty payloads hash to zero; results exclude reserved -1.
  Runtime hosts must supply unpredictable key material; deterministic keys are
  explicit test inputs, never an implicit default.
- Seeded-payload tests first reproduced the missing implementation. All 2,603
  tests in 149 files pass. An 8,000-case CPython differential matched byte/string
  hashes exactly across four deterministic seeds, including block boundaries,
  byte-length footer wraparound and mixed Unicode widths. Source typecheck,
  scoped lint and selected workspace build passed. Reference:
  https://github.com/python/cpython/blob/3.14/Python/pyhash.c . The policy connects
  to the concrete hash context; host key generation and complete runtime setup,
  guest hash dispatch, mutable containers and full temporary-heap accounting
  remain unfinished.
- Added generic ordered key-map storage with supplied guest hash/equality
  operations, collision buckets and identity-or-equality matching. Overwrites
  retain the first key object/order; deletion and reinsertion append; explicit
  lookup records distinguish stored undefined from absence. Detached frozen
  snapshots expose no mutable storage. This is not yet a guest dict/view/iterator.
- Equality-side mutations revalidate candidate membership and bucket identity,
  restarting safely after deletion/replacement and observing value-only updates.
  Hash/equality errors propagate; failed storage reservations do not insert the
  requested item; pathological restart loops stop at the execution budget.
  Initial tests reproduced the missing implementation. All 2,612 tests in 150
  files pass; source typecheck, scoped lint and selected workspace build passed.
  A 10,000-operation CPython audit matched lookups, mutation results,
  original key identities and ordered snapshots, using both real seeded hashes
  and forced collisions across mixed concrete numeric/string/bytes/tuple/slice
  keys. Full guest container wiring, iteration semantics, method APIs, callback
  recursion control and complete host Map/Set heap accounting remain pending.
- Added single-lookup ordered-map setdefault/pop primitives. Defaults preserve
  existing values and key identity; pop returns a detached presence/value result,
  reserving result storage before removal. Shared insertion/removal internals
  preserve collision and order behavior without repeated guest hashing/equality.
  Empty-map pop skips hashing, verified against CPython; setdefault still hashes.
  Guest default arguments and KeyError translation remain in the future method
  layer, rather than overloading stored undefined as absence.
- Default/pop regressions failed before implementation. All 2,622 tests in 151
  files pass, covering single-hash calls, equality-triggered replacement, stored
  undefined, allocation rejection and empty-map error precedence. A 10,000-step
  CPython audit including default insertion/removal matched operation results and
  ordered snapshots under seeded hashes and forced collisions. Source typecheck,
  scoped lint and selected workspace build passed.
- Added forward ordered-map cursors with immediate state capture and trusted
  key/value/item projection. Value-only updates remain visible. Observed size
  mismatches latch RuntimeError; extra keys after the expected yield count cause
  one keys-changed error then exhaustion. Length hints observe current size
  without themselves latching errors. Exhaustion releases direct storage refs
  and remains terminal; projection errors advance past the selected entry.
- Iterator regressions first reproduced missing iteration support. All 2,631
  tests in 152 files pass; source typecheck, scoped lint and selected build passed.
  A CPython audit covered 1,512 traces / 34,902 next-and-length-hint observations:
  1,495 traces matched exactly, with 17 differences confined to size-preserving
  deletion/reinsertion at CPython table-compaction boundaries. The cursor follows
  live storage order rather than emulating those internal resize thresholds.
  Python explicitly permits RuntimeError or skipped entries during mutation:
  https://docs.python.org/3/library/stdtypes.html#dictionary-view-objects .
  Exact CPython mutation-trace parity is not established; guest views, reverse
  iteration, full container wiring and complete host heap accounting remain open.
- Added dictionary update-from-pairs execution with exact sequence fast paths
  and a generic fully materialized row path. Rows are consumed to completion
  before checking length; error messages include the correct row index/length.
  Earlier successful insertions persist after later failures, and failed rows
  do not trigger subsequent outer iteration or implicit iterator closing.
- Row conversion keeps initial iteration separate from list-style preparation
  (second iterator lookup and length hint). Initial guest TypeError becomes
  "object is not iterable"; preparation/next errors retain their original form.
  The supplied context owns guest protocols and exact list/tuple recognition;
  the helper charges retained temporary row slots and bounds infinite iterators.
- Pair-update tests first reproduced missing support. All 2,642 tests in 153
  files pass; source typecheck, scoped lint and selected workspace build passed.
  A 600-case CPython differential matched outcomes, partial mapping state and
  detailed iterator/preparation/hint/next traces. Mapping/keys dispatch, keyword
  updates, complete guest dict wiring and full temporary-heap accounting remain
  unfinished.
- Added generic dictionary source dispatch: optional keys lookup selects mapping
  versus iterable-pair updates, followed by a fresh lookup/call in the mapping
  branch. Arbitrary keys iterables materialize before any value fetch; exact
  list keys remain live, repeated keys fetch again, and prior inserts persist
  after retrieval failures. Initial noniterable-keys TypeError receives the
  source/result type diagnostic; later protocol errors propagate unchanged.
- Shared metered iterator collection between mapping-key and pair-row conversion
  without changing their distinct preparation or error boundaries. Tests first
  reproduced missing mapping dispatch. All 2,650 tests in 154 files pass; 240
  CPython mapping-update outcomes/protocol traces matched, and all 600 prior
  pair-update traces still match after the extraction. Source typecheck, scoped
  lint and selected workspace build passed. Exact-dict optimized
  merging, keyword updates and complete guest method/container wiring remain
  unfinished.
- Added LIFO ordered-map popitem storage with a linked tail and cached entry
  hashes, so removal requires no map scan or guest hash/equality calls. Normal
  delete/pop paths maintain both links; overwrite retains position; clear resets
  the tail. Returned pair storage is reserved before mutation. Empty storage
  returns absence for the future guest layer's popitem-specific KeyError.
  Entry reservations include the additional hash/link slots.
- Popitem regressions first reproduced missing support. All 2,659 tests in 155
  files pass, including key hash failures after insertion, middle/head/tail
  deletion, iterator invalidation, allocation rejection and bounded pop steps.
  Source typecheck, scoped lint and selected workspace build passed.
  A 10,000-operation CPython audit with popitem/default/pop and ordered snapshots
  matched under seeded hashes and forced collisions. The iterator re-audit keeps
  the previously documented 1,495/1,512 exact trace matches and the same 17
  size-preserving table-compaction differences. Guest methods/reverse iteration
  and full host heap accounting remain unfinished.
- Added shallow ordered-map copying that preserves live-entry order, original
  key/value references and cached hashes without guest hash/equality calls.
  Copies allocate fresh buckets, entries and links in the same runtime/hash-policy
  and budget domain; mutating either storage does not affect the other. Allocation
  failure leaves the source intact and never publishes a partial copy.
- Copy regressions failed before implementation. All 2,664 tests in 156 files
  pass; a 10,000-operation CPython audit with copy/default/pop/popitem matched
  copied and source state under seeded hashes and forced collisions. Source
  typecheck, scoped lint and selected workspace build passed. Guest
  dictionary method exposure and full host allocation accounting remain pending.
- Added reverse ordered-map cursors with constant-size creation, immediate tail
  capture, live value updates, length hints and latched observed size errors.
  Removed pending entries retain predecessor routes so cursors can skip them;
  new tail replacements are not visited. Cursor exhaustion/error releases its
  direct storage references. Key/value/item projection remains trusted host
  construction rather than guest method dispatch.
- Reverse-iterator tests first reproduced missing support. All 2,672 tests in
  157 files pass. A 1,512-trace / 34,902-observation CPython reverse audit matched
  1,495 traces exactly; the remaining 17 involve size-preserving mutations at
  CPython table-compaction boundaries, which these linked-storage cursors do not
  emulate. The 10,000-operation copy/default/pop/popitem audit still matches.
  Source typecheck, scoped lint and selected workspace build passed. Guest
  views/methods and complete native heap accounting remain unfinished.
- Added direct ordered-map updates with cached-hash reuse inside a shared
  operations-policy domain and destination rehashing across distinct policies.
  Self-updates are no-ops. Incoming values are captured before destination
  callbacks; existing destination key identities/order survive overwrites.
  Source size mutation raises "dict mutated during update" after the current
  successful insertion, while callback failures retain their original precedence.
- Direct-update regressions failed before implementation. All 2,679 tests in
  158 files pass. A 10,000-operation CPython audit including direct update,
  copy/default/pop/popitem matched results and ordered state under seeded hashes
  and forced collisions. Source typecheck, scoped lint and selected workspace
  build passed. Same-size source mutations still follow live storage
  ordering rather than CPython table-compaction details; full guest dictionary
  wiring and complete host heap accounting remain unfinished.
- Added insertion-order-independent ordered-map equality with an early size
  check, compatible cached-hash reuse and destination hashing for foreign hash
  policies. Values use identity before the supplied equality/truth operation,
  with the left value captured before right-key lookup callbacks. Missing keys
  remain distinct from stored undefined. No self-map shortcut suppresses
  colliding key comparisons; CPython probing confirmed those can still raise.
- Equality tests first reproduced missing support. All 2,687 tests in 159 files
  pass. A 10,000-operation CPython audit including equality against reversed-order
  copies matched results and ordered state under seeded hashes and forced
  collisions. Source typecheck, scoped lint and selected workspace build passed.
  Guest recursive-container comparison guards, comparison operator
  dispatch and complete host heap accounting remain unfinished.
- Added ordered-map key/value/item membership primitives. Key and separated-item
  lookups avoid presence-record allocation; item/value comparisons use stored
  values first and skip equality for identical values. Item tuple-shape checking
  remains the guest view caller's responsibility. Value membership uses the
  existing forward cursor, matching CPython's iteration fallback and size-change
  errors after failed equality-side mutations, rather than an unchecked scan.
- Membership regressions first reproduced missing methods. All 2,695 tests in
  160 files pass; source typecheck, scoped lint and selected build passed. A
  10,000-operation CPython audit including key/value/item membership matched
  outcomes and mapping state under seeded hashes and forced collisions. Full
  guest view objects, recursive dispatch and host heap accounting remain open.
- Added owned mutable list slots with indexed get/set/delete, append, clipped
  insertion, pop, clear, in-place reverse and detached frozen snapshots. Guest
  __index__ conversion remains outside storage. Signed-64-bit overflow and bounds
  errors distinguish subscription/assignment from insert/pop, including empty
  pop precedence. Slot growth and element-shift/reversal work are preflighted
  before mutation; elements retain identity and host input/output arrays do not
  alias owned storage.
- List regressions first reproduced missing storage. An additional failing test
  caught construction following a host element getter's source-array growth;
  construction now captures the reserved length once. All 2,707 tests in 161
  files pass, and 5,000 CPython mutable-list operation/error/snapshot comparisons
  match. Source typecheck, scoped lint and selected workspace build passed.
  List slices, iteration, extension, sorting, guest type integration,
  native spare-capacity/reallocation accounting and finalizers remain pending.
- Added live forward and reverse list cursors with constant-sized allocation and
  no element-slot copy. Forward cursors observe appended values and index shifts;
  reverse cursors capture their initial final index. A bounds failure during next
  permanently releases the source, while a zero length hint alone is not terminal.
  Budget checks precede cursor advancement; stored undefined is not exhaustion.
- Iterator regressions first reproduced missing methods. All 2,716 tests in 162
  files pass. A CPython audit matched 1,000 forward/reverse traces containing
  60,000 mutation and iteration operations. Source typecheck, scoped lint and
  selected workspace build passed. Guest iterator types, StopIteration
  conversion and complete native allocation accounting remain unfinished.
- Added mutable list slice reads, replacement and deletion using the existing
  exact-integer normalization. Reads create detached list slots; contiguous
  replacement grows/shrinks in place; extended replacement enforces exact size
  and traversal order. Self replacement snapshots before overwriting. Deletion
  compacts survivors in one ascending pass without a positions array, including
  negative and arbitrarily large strides. Existing cursors retain the same owned
  backing slots. Mutation work/growth is preflighted before changing slots.
- All 21 new slice tests first failed on missing methods; all 2,737 tests in 163
  files now pass. A 12,000-case CPython comparison matched reads, replacement,
  deletion, errors, self assignment and existing iterator observations. Source
  typecheck, scoped lint and selected workspace build passed. Guest
  slice component conversion, replacement iterable materialization and finalizer
  deferral remain the protocol layer's responsibility, not implemented by these
  storage methods. Complete host allocation accounting is still pending.
- Added exact-list extension and prepared-iterator streaming extension. The
  exact-list path captures the original count, including self-extension, and
  preflights slot growth without a temporary copy. The iterator path appends
  after each next call, preserves partial progress on iterator failure and does
  not implicitly close the iterator. Extending from a live iterator over the
  destination retains streaming behavior rather than using the self-list fast
  path; unbounded growth is terminated by the execution budget.
- Nine extension tests first failed on missing methods. All 2,746 tests in 164
  files pass; a 6,000-case CPython comparison matched exact/self extension,
  iterator-side mutations, next-call traces, failures and existing cursor
  observations. Source typecheck, scoped lint and selected workspace build passed.
  Guest iterable preparation, length-hint protocol evaluation,
  builtin method dispatch and complete native allocation accounting remain open.
- Added list index search, counting and first-match removal with identity before
  stored-first equality. Searches observe live slots after callback mutations;
  negative bounds use the starting length, while positive stops remain open to
  subsequent growth. Removal deletes the current numeric position after a
  successful comparison, even when the originally matched object moved, and
  succeeds without deletion if that position vanished during equality.
- All 17 search regressions first failed on missing support. All 2,763 tests in
  165 files pass. A 6,000-case CPython audit matched index/count/remove results,
  ordered equality traces, identity shortcuts, huge bounds, callback mutations
  and failures. Source typecheck, scoped lint and selected workspace build passed.
  The storage reports absence without constructing guest errors;
  guest __index__ conversion, reflected equality/truth dispatch, repr-sensitive
  index errors and builtin method wiring still belong to the unfinished runtime.
- Added list concatenation, fresh-list repetition and in-place repetition.
  Generated slots are filled directly without intermediate arrays; element
  identity is shared while newly returned lists own independent slots, including
  empty/one-repeat cases. In-place repetition retains the backing array for live
  cursors and preflights growth before mutation. Count conversion overflow is
  checked even for empty lists; signed-index product overflow is guest
  MemoryError, while native slot-limit growth triggers fatal allocation limits.
- All 13 arithmetic regressions first failed on missing methods. All 2,776 tests
  in 166 files pass; 6,016 CPython concatenation/repetition comparisons matched
  results, errors and existing cursor observations. Source typecheck, scoped lint
  and selected workspace build passed. Guest operand/reflected
  dispatch, __index__ conversion, finalizers and complete native heap accounting
  remain unfinished.
- Added a dedicated list rich-comparison module with all six operators. Initial
  size mismatch shortcuts equality/inequality only; identity skips element
  equality. Live lengths are rechecked after callbacks, and differing slots are
  read again for ordering so mutation is visible. Rich ordering results are
  returned unchanged, rather than coerced to booleans. Equal-prefix traversal is
  metered, including callback-driven growth.
- The comparison test suite first failed on its missing module; all 2,791 tests
  in 167 files now pass. An 8,000-case CPython audit matched all six operators,
  list mutations, callback order, exceptions and non-boolean rich results.
  Source typecheck, scoped lint and selected workspace build passed.
  Behavior was also checked against CPython 3.14 list_richcompare_impl. Guest
  recursive-comparison limits, reflected/type dispatch, finalizers and complete
  native allocation accounting remain unfinished.
- Added a metered stable natural-merge sorting kernel for subsequent list.sort
  and sorted integration. Source slots are captured before key callbacks; keys
  are evaluated once in input order. Ascending/strict-descending runs have linear
  detection; pairwise merging has O(n log n) worst-case work and O(n) temporary
  slots. Equal-key identities retain order, including reverse sorting. Source
  slots are not mutated on callback failure, and allocation/callback/merge work
  is charged. Exact CPython powersort/galloping comparison scheduling is not
  reproduced; inconsistent orderings and comparison-side effects may differ.
- The sorting suite first failed on its missing module. After correcting a
  parameterized-test argument shape, all 2,805 tests in 168 files pass. A
  6,000-case CPython audit matched stable output and key-call order for four key
  functions and both directions, with comparison-count bounds checked. Source
  typecheck, scoped lint and selected workspace build passed. Full
  list.sort temporary-empty/mutation/failure lifecycle, sorted iterable setup,
  guest protocol wiring and complete native allocation accounting remain open.
- Integrated stable sorting with mutable list storage's temporary-empty
  lifecycle. Original elements are hidden from callbacks while existing cursors
  keep the backing array. Growth marks modification even when undone; empty
  no-ops do not. Nested sorts preserve outer mutation detection. Successful
  mutation attempts restore sorted original elements and raise ValueError;
  callback failures retain their original exception and restore original slots.
  Restoration work/growth is prepaid so fatal budget rejection cannot interrupt
  the host-only restoration path. No guest cleanup runs during that path.
- All 13 lifecycle regressions first failed on missing sort support; all 2,818
  tests in 169 files pass. A 4,000-case CPython audit matched key-call list
  visibility, key failures, mutations/no-ops, nested sorts and existing cursors.
  Source typecheck, scoped lint and selected workspace build passed.
  Comparison failure restores original order rather than CPython's
  algorithm-dependent partial permutation. Exact comparison scheduling, guest
  method/reverse/key argument dispatch, sorted iterable preparation, finalizers
  and complete native allocation accounting remain unfinished.
- Added shared length-hint protocol handling for iterable preparation. A valid
  length takes precedence; length TypeError permits fallback. Hint descriptor
  lookup errors propagate, while hint call TypeError or NotImplemented returns
  the caller's default. Returned hint values require int/bool payloads rather
  than arbitrary __index__ conversion, with separate negative and signed-index
  overflow errors. Hints do not trigger allocation or bound actual iteration.
- The length-hint suite first failed on its missing module; all 2,834 tests in
  170 files pass. A 312-case CPython audit matched outcomes and length/descriptor/
  call traces, including bad length conversion, non-callable hints, descriptor
  failures and negative defaults. Source typecheck, scoped lint and selected
  workspace build passed. The context still supplies guest length slots,
  descriptor binding and exact integer extraction; iterable adapters, consumer
  reservation wiring and full guest runtime integration remain unfinished.
- Added a guest protocol iterator adapter with __iter__/next-slot validation and
  legacy indexed-sequence fallback. Returned iterators need a next slot, not a
  second iter call. Invalid results and explicit iter failures do not fall back.
  Custom guest StopIteration is translated per call without imposing permanent
  exhaustion; sequence fallback releases its source on IndexError/StopIteration.
  Other sequence errors retain the current index. Calls, result records and
  advancement are metered, without implicit iterator close behavior.
- The adapter suite first failed on its missing module; all 2,847 tests in 171
  files pass. A 1,000-trace CPython audit matched 12,000 next observations and
  dispatch/index traces across both protocols, including recoverable failures.
  Source typecheck, scoped lint and selected workspace build passed.
  Guest iterator type identity, StopIteration values, descriptor/type slot
  implementations, recursive-call limits, length-hint consumer preparation and
  complete native allocation accounting remain unfinished.
- Connected protocol iterators and length hints to list extension through a
  shared guest-source bridge. Exact lists, including self-extension, use owned
  slot copying; generic sources create their iterator first, evaluate the
  original source's length/hint next, then stream items. Preparation mutations
  and partial iteration progress remain visible on failure. Hints are validated
  but do not cause speculative capacity allocation; actual appended slots are
  charged. Huge valid hints therefore do not reproduce CPython preallocation
  MemoryError, consistent with treating hints as advisory rather than exact size.
- The bridge suite first failed on its missing module; all 2,856 tests in 172
  files pass. A 400-case CPython audit matched preparation and consumption order,
  target mutations, hint failures and partial progress for guest iterators and
  indexed sequence fallback. Source typecheck, scoped lint and selected workspace
  build passed. Guest method binding, type/descriptor slot implementations,
  further container consumer integration and complete heap accounting remain open.
- Connected iterable materialization and list sorting into a sorted-source
  pipeline. The source is fully consumed before sort-option preparation and
  reverse truth conversion; key calls follow preparation and never occur for
  empty inputs. Result slots are independent from source list slots while
  retaining element identities. Iteration failures suppress later option/key
  processing, and option failures still leave the source consumed.
- The sorted pipeline suite first failed on its missing module; all 2,864 tests
  in 173 files pass. A 1,200-case CPython audit matched consumption, option/reverse/
  key ordering, failures and stable results after correcting the audit's mock
  binder message for three keywords. Source typecheck, scoped lint and selected
  workspace build passed. Guest positional/keyword binding, key and
  reverse dispatch, result object wrapping, exact comparison scheduling and
  complete native allocation accounting remain unfinished.
- Added list.sort option binding for expanded calls, reusable after sorted's
  materialization phase. Total argument-count checks precede positional rejection;
  unknown-keyword validation and spelling suggestions precede reverse truth
  conversion. Reverse is converted once. Absent/None keys preserve identity;
  other keys remain unvalidated until an actual item invokes them, including
  empty sorts that never call a non-callable key. Guest callbacks retain context.
- The binder suite first failed on its missing module. All 2,878 tests in 174
  files pass, including direct composition with the sorted iterable pipeline.
  A 1,570-case CPython audit matched argument errors, keyword-order precedence,
  suggestions and reverse truth traces. Source typecheck, scoped lint (including
  the integration test) and selected workspace build passed. Guest builtin registration, sorted's
  outer positional binding, truth/call/comparison implementations and complete
  native allocation accounting remain unfinished.
- Added callable-sentinel iterator storage for iter(callable, sentinel), with
  eager callability validation and lazy calls. Sentinel-first equality skips
  identical results. Matches or callable StopIteration release state and latch
  exhaustion; equality StopIteration translates only that next call to done,
  permitting retry. Other call/equality failures propagate without rewinding
  callable state. Reentrant exhaustion during call/equality follows the distinct
  CPython paths, with metering before state changes and after guest callbacks.
- The callable-iterator suite first failed on its missing module; all 2,889 tests
  in 175 files pass. A 1,000-trace CPython audit matched 12,000 next observations
  and callable/equality traces; separate probes confirmed both reentrant cases.
  Source typecheck, scoped lint and selected workspace build passed after fixing
  two prefer-const test declarations; the full package suite passed again.
  Guest iter argument binding, iterator identity, StopIteration values, guest
  call/reflected equality implementations, recursion limits and complete native
  allocation accounting remain unfinished.
- Added zip iteration over prepared inputs, including strict length checking.
  Inputs advance left to right; partial rows consume earlier values but never
  invoke the tuple factory. A first-input exhaustion probes later inputs and
  consumes the unmatched value before a longer-input error; later exhaustion
  reports the shorter input. Singular/plural argument ranges match Python.
  Retries retain actual input positions without forced sticky exhaustion, and
  repeated references to one iterator support chunking semantics. Row slots and
  iterator calls are metered before consumption and tuple construction.
- The zip suite first failed on its missing module; all 2,903 tests in 176 files
  pass. A 1,500-trace CPython audit matched 18,000 next observations, strict
  mismatch errors, resumable input behavior and consumption order. Source
  typecheck, scoped lint and selected workspace build passed. Guest zip
  argument/strict truth binding, eager iterator creation, tuple wrapping/reuse,
  builtin registration and complete native allocation accounting remain open.
- Connected expanded guest zip calls to protocol iterator acquisition and strict
  row iteration. Keyword-count/unknown-name validation and spelling suggestions
  precede strict truth conversion; truth conversion precedes eager left-to-right
  iterator creation, including the zero-input case. Construction never consumes
  a value or queries a length hint and stops at the first iterable error. Tuple
  factory calls retain their host context; temporary iterator slots are charged.
- The constructor suite first failed on its missing module; all 2,912 tests in
  177 files pass. A 1,000-case CPython constructor/iteration audit matched keyword
  errors, strict truth, eager iterator order, input failures and resulting rows/
  mismatch errors. Source typecheck, scoped lint and selected workspace build
  passed. Guest builtin registration, iterator/tuple object wrapping,
  special-method dispatch implementations and complete heap accounting remain open.
- Added map iteration over prepared inputs, including Python 3.14 strict lengths.
  Extracted zip's row-consumption engine into shared ParallelIterator while
  retaining the ZipIterator export alias. Map produces a function result from
  each complete host argument row, without an intermediate guest tuple, and
  selects map-specific mismatch diagnostics. Function callability remains lazy;
  callback StopIteration ends only the current next call, permitting later rows.
  Other callback failures preserve consumed positions and fatal limits propagate.
- The map suite first failed on its missing module; all 2,924 tests in 178 files
  pass. A 1,200-trace CPython map audit matched 14,400 next observations and
  input/mapper traces. Both zip audits also passed after the shared-engine
  refactor: 1,500 iterator traces and 1,000 constructor/iteration cases. Source
  typecheck, scoped lint and selected workspace build passed. Guest map argument/
  strict binding, eager iterable acquisition, builtin/iterator object wiring,
  exception values and complete native allocation accounting remain unfinished.
- Connected expanded guest map calls to eager protocol iterator acquisition and
  mapping. Extracted strict-only keyword validation/truth conversion for shared
  use by zip and map. Map performs that phase before checking its minimum two
  positional arguments, then acquires each input left to right without pulling
  items or testing mapper callability. Mapping starts only on next; failures
  preserve the established phase and consumption ordering.
- The map constructor suite first failed on its missing module; all 2,932 tests
  in 179 files pass. A 1,200-case CPython map constructor/iteration audit matched
  strict-before-arity precedence, eager input order, lazy callability errors and
  subsequent rows/errors. Zip's 1,000-case constructor audit also passed after
  sharing strict binding. Source typecheck, scoped lint and selected workspace
  build passed. Guest builtin/iterator registration, concrete special-method
  dispatch, exception values and complete native allocation accounting remain open.
- Added lazy filter iteration over a prepared source. None and exact builtin
  bool use direct item truth; other predicates are called lazily and their
  results truth-tested while returning the original accepted item. Invalid
  predicates are not invoked for empty inputs. Source/callback stops end only
  the current next call; subsequent calls may resume. Other errors preserve
  consumed positions, and checkpoints bound infinite rejection loops and prevent
  further guest callbacks after a fatal limit.
- The filter suite first failed on its missing module; all 2,944 tests in 180
  files pass. A 1,200-trace CPython audit matched 14,400 next observations plus
  source, predicate and truth callback traces, including resumable stops and
  nonterminal failures. Source typecheck, scoped lint and selected workspace
  build passed. Filter argument binding/eager iterable construction, guest
  builtin/object registration, concrete truth dispatch and complete allocation
  accounting remain unfinished.
- Connected exact builtin filter argument binding to protocol iterator
  acquisition and lazy filtering. Keywords fail before positional arity; the
  two-argument call eagerly acquires its iterator without consuming values or
  validating predicate callability. Legacy indexed sources use the same protocol
  adapter; initialization failures and cancellation prevent later callbacks.
- The constructor suite first failed on its missing module; all 2,956 tests in
  181 files pass. A 400-case CPython constructor/iteration audit matched argument
  diagnostics, eager iterator errors, indexed fallback, lazy predicate calls and
  repeated next outcomes. Source typecheck, scoped lint and selected workspace
  build passed. Concrete guest builtin/type registration, subclass construction,
  truth/call dispatch, pickling and complete native allocation accounting remain
  open; this bridge does not establish a complete executable interpreter.
- Added enumerate iteration over prepared sources with exact bigint counters,
  including negative starts and crossing machine-integer bounds. Source stops
  and errors do not increment or force sticky exhaustion. The index is read
  after source advancement so reentrant next calls receive successive counters;
  result construction occurs after counter advancement. Guest pair factories
  own integer/tuple wrapping and their allocation charges.
- The enumerate suite first failed on its missing module; all 2,968 tests in
  182 files pass. A 1,000-trace CPython audit matched 12,000 outer next
  observations plus nested-next/source traces across large counters, resumable
  stops and failures. Source typecheck, scoped lint and selected workspace build
  passed.
  Constructor argument binding/index conversion, builtin/type registration,
  pickling, bigint payload/CPU and full heap accounting remain unfinished.
- Connected exact builtin enumerate calls to start conversion, eager protocol
  iterator acquisition and lazy indexed results. Supports positional arguments,
  iterable/start keywords in either order and the builtin's count/keyword error
  precedence. Explicit starts use the host-supplied guest index protocol before
  iterable acquisition; default zero does not invoke conversion. Cancellation
  after conversion prevents source callbacks, and pair factories retain context.
- The constructor suite first failed on its missing module; all 2,980 tests in
  183 files pass. A 352-case CPython constructor/iteration audit matched binding
  diagnostics, conversion/init ordering and failures, default and large starts,
  and resulting pairs. Source typecheck, scoped lint and selected workspace build
  passed.
  Concrete index-protocol dispatch, guest builtin/type registration, subclass
  construction, pickling and full bigint/heap accounting remain open.
- Added a reusable integer-index protocol kernel. Direct int/bool/subclass
  payloads bypass overridden methods; other values use a type-level index slot.
  Method results must already be integers (no recursive conversion or __int__
  fallback). Strict integer-subclass results route DeprecationWarning through
  the guest context, including warning-as-error propagation. Exact bigint
  results are neither truncated nor clipped to machine width.
- The protocol suite first failed on its missing module; all 2,992 tests in
  184 files pass. A 126-case CPython audit matched direct/method results,
  callback traces, invalid results and three warning policies across small and
  large integers. Source typecheck, scoped lint and selected workspace build
  passed. Concrete slot dispatch, warning infrastructure, integration into
  builtin contexts, bounded diagnostic type-name formatting and full bigint/
  heap accounting remain open.
- Corrected length-hint validation for negative __len__ payloads outside the
  signed machine range: negativity takes precedence over overflow and prevents
  hint fallback. Hint-result validation intentionally retains overflow-first
  behavior. A CPython probe and two failing regression cases demonstrated the
  mismatch before the check-order fix; four negative boundary regressions pass.
- All 2,996 tests in 184 files pass. The existing 312-case CPython length-hint
  audit and a new 120-case signed boundary audit both matched results/errors and
  callback traces. Source typecheck, scoped lint and selected workspace build
  passed. The planned reusable length-slot conversion and integration remain
  open; this correction does not establish that broader protocol implementation.
- Added optional length-slot conversion through the integer-index protocol.
  Missing slots return absence for consumer-specific fallback; lookup/call,
  conversion and warning failures propagate. Negative lengths fail before
  signed 64-bit overflow. Extracted object-preserving index resolution so a
  returned integer subclass retains its type in overflow diagnostics; existing
  integerIndex consumers still receive normalized bigint payloads.
- New length tests and index-object identity tests failed before implementation;
  all 3,011 tests in 185 files pass. A 180-case CPython length conversion audit
  matched values, errors, warnings and callback traces, and the 126-case integer
  index audit passed after refactoring. Source typecheck, scoped lint and selected
  workspace build passed. Concrete builtin/context integration, len/truth entry
  points, bounded diagnostic type names and complete bigint/heap accounting
  remain unfinished.
- Added guest truth conversion with exact bool/None fast paths, type-level bool
  lookup and shared optional length/index fallback. Explicitly disabled bool
  slots raise the distinct Python diagnostic. Present bool methods must return
  exact bools; invalid results, descriptor errors and call failures never fall
  back to length. Objects lacking both slots are true. Length conversion retains
  negative/overflow and index-warning behavior.
- The truth suite first failed on its missing module; all 3,025 tests in 186
  files pass. A 216-case CPython audit matched results, errors, warnings and
  bool/length/index callback traces across absent/disabled/malformed slots and
  warning policies. Source typecheck, scoped lint and selected workspace build
  passed. Concrete builtin slots, guest object/descriptor dispatch, execution
  context integration and full recursive-call/heap accounting remain open.
- Connected guest iteration and truth protocols in shared any/all reduction.
  Empty sources use their respective identities; the first decisive truth value
  stops consumption without closing the source or reading hints. Source stops
  mean exhaustion, while truth-raised StopIteration and other errors propagate.
  Length/index truth fallback is exercised through the composed protocols, and
  infinite non-decisive sources are bounded by execution checkpoints.
- The reduction suite first failed on its missing module; all 3,038 tests in
  187 files pass. A 1,200-case CPython audit matched results, errors, callback
  traces and remaining-source observations. Source typecheck, scoped lint and
  selected workspace build passed. Builtin argument binding/registration,
  concrete guest slot dispatch, bool wrapping and full heap/recursion accounting
  remain open.
- Added metered forward/reverse range iteration using existing validated integer
  progressions rather than duplicating range storage/arithmetic. The cursor
  captures start, stride and exact remaining count, yields bigint payloads and
  exposes exact hints without materializing or retaining the source progression.
  Empty/exhausted cursors remain done; huge ranges require only fixed cursor
  slots (bigint payload size accounting remains separate unfinished work).
- The range iterator suite first failed on its missing module; all 3,049 tests
  in 188 files pass. A 2,000-trace CPython audit matched 40,000 next observations
  and 40,000 associated length hints across forward/reverse, empty, descending
  and large-integer progressions. Source typecheck, scoped lint and selected
  workspace build passed. Guest range/iterator registration, integer wrapping,
  constructor binding, iterator state restoration/pickling and full bigint
  CPU/allocation accounting remain open.
- Connected expanded guest range calls to index conversion and existing exact
  progression arithmetic. Keyword rejection precedes one-to-three argument
  validation; explicit arguments convert left to right and stop at the first
  failure. One-argument calls use zero/unit defaults without guest conversion;
  zero step is rejected after conversion, including empty ranges. Direct integer
  subclass inputs normalize to bigint payloads without invoking overrides.
- The constructor suite first failed on its missing module; all 3,061 tests in
  189 files pass. A 1,200-case CPython audit matched range attributes/cardinality,
  diagnostics, index callback order and warning outcomes. Source typecheck,
  scoped lint and selected workspace build passed. Concrete guest range/type
  registration, protocol wrappers, hashing, state/pickling and full bigint
  CPU/allocation accounting remain unfinished.
- Added range contains/index/count searches with exact int/bool arithmetic and
  generic guest equality fallback. Floats, integer subclasses and user objects
  use element-first rich equality; generic count can observe multiple matches,
  while contains/index short-circuit. Missing-index diagnostics distinguish the
  arithmetic and sequence-search paths. Generic iteration and callbacks are
  metered, with signed-machine result overflow checks and no needle __index__
  conversion. Exact arithmetic indices can exceed machine width.
- The search suite first failed on its missing module; all 3,073 tests in 190
  files pass. A 3,000-case CPython audit matched search results/errors and guest
  equality/truth callback traces. Source typecheck, scoped lint and selected
  workspace build passed. Astronomical generic overflow paths were inspected
  against CPython source, not dynamically traversed; practical execution budgets
  terminate such scans first. Guest method registration, rich equality dispatch,
  result wrapping and full bigint/heap accounting remain unfinished.
- Added range hashing through the shared numeric/tuple hash implementation.
  A fixed three-slot canonical key uses exact cardinality, start for nonempty
  ranges and step only for ranges longer than one element; omitted fields use
  the runtime's None singleton. Equal empty/singleton/multi-element ranges thus
  share hashes despite irrelevant differences in their original attributes.
- The hash suite first failed on its missing module; all 3,080 tests in 191
  files pass. A 5,000-case CPython audit matched hashes across empty, singleton,
  descending and huge-integer ranges after supplying the same None identity
  hash. Source typecheck, scoped lint and selected workspace build passed. Guest range/hash
  registration, execution-wide identity policy and full bigint/host allocation
  accounting remain unfinished.
- Added indexed reverse iteration over live guest sequence slots with an
  already validated initial length. Item errors permanently exhaust/release the
  cursor; IndexError/StopIteration become done while other errors propagate
  once. Length-hint failures and zero hints do not exhaust it. Each operation
  captures its position before guest callbacks, retaining reentrant item/hint
  ordering, and next does not query current length.
- The reverse suite first failed on its missing module; all 3,092 tests in 192
  files pass. A 1,000-trace CPython audit matched 30,000 mutation/next/hint
  operations; two separate reentrant probes matched the tested callback/index
  behavior. Source typecheck, scoped lint and selected workspace build passed.
  Reversed constructor binding/special-method dispatch, guest iterator wrapping,
  state/pickling, exhaustive adversarial reentrancy and full allocation/recursion
  accounting remain open.
- Connected exact builtin reversed calls to custom special-method invocation
  and indexed sequence fallback. Keyword validation precedes positional arity;
  custom method results return unchanged without iterator validation. Disabled
  methods forbid fallback. For absent methods, sequence eligibility precedes
  eager validated length acquisition and guest iterator wrapping; no item is
  consumed during construction. Lookup/call/length failures retain precedence.
- The constructor suite first failed on its missing module; all 3,106 tests in
  193 files pass. A 288-case CPython constructor/iteration audit matched results,
  argument/protocol errors and callback order. Source typecheck, scoped lint and
  selected workspace build passed. Concrete builtin/descriptor/sequence dispatch,
  subclass construction, guest object registration, state/pickling and complete
  allocation/recursion accounting remain open.
- Added shared stable min/max selection over prepared iterators. Each item is
  keyed once, candidate keys compare on the left with the requested strict
  ordering, and ties retain the first original item. Empty inputs return an
  explicitly supplied default untouched or raise the Python empty-iterable
  error; defaults never participate in comparison. Key/comparison errors retain
  consumed progress and never close the source; checkpoints bound infinite input.
- The selection suite first failed on its missing module; all 3,120 tests in
  194 files pass. A 2,000-case CPython audit matched results/errors and input,
  key and comparison traces, including key-raised StopIteration. Source
  typecheck, scoped lint and selected workspace build passed. Expanded argument/
  keyword binding, guest iterable acquisition, concrete comparison dispatch,
  builtin registration and full heap/recursion accounting remain open.
- Connected expanded min/max calls to shared selection and guest iteration.
  A single positional argument is iterated; multiple arguments are candidates
  directly. Arity errors precede keyword count/name diagnostics (including
  spelling suggestions), then default/multiple-argument conflicts. None keys use
  identity, other keys remain lazily callable, and explicit defaults preserve
  their value even when the host representation is undefined.
- The call suite first failed on its missing module; all 3,131 tests in 195
  files pass. A 768-case CPython audit matched binding errors, defaults, key
  behavior and iteration/callback ordering. Source typecheck, scoped lint and
  selected workspace build passed. Concrete guest builtin/context registration,
  rich comparison dispatch and complete native iterator/result allocation and
  recursion accounting remain unfinished.
- Re-inspected module/expression execution: the public surface still exposes
  parsing/static analysis, while module execution requires host-supplied body
  adapters. There is no complete concrete execution context yet. Connected the
  existing real/complex arithmetic, integer powers/bitwise/shifts and immutable
  concat/repeat kernels through one constant binary dispatcher as groundwork for
  that context. Matched-operation failures propagate; unavailable families
  explicitly decline rather than masquerading as implemented behavior.
- The dispatcher suite first failed on its missing module; all 3,148 tests in
  196 files pass, including a parsed-expression evaluator integration test. A
  3,000-case CPython audit matched parsed numeric/tuple expressions through that
  evaluator/dispatcher composition. Source typecheck, scoped lint and selected
  workspace build passed. Float/complex powers, string formatting, guest/mutable
  object dispatch, concrete module contexts and complete resource accounting
  remain open. Existing platform-sensitive floating-power limitations persist.
- Established a concrete runtime value union/factory extending immutable scalar
  allocation with mutable lists, validated ranges and prepared iterators. List
  wrappers own fresh storage slots but preserve shared/cyclic members; immutable
  tuples can retain those mutable members. Slice construction now accepts generic
  runtime components without conversion. Range/iterator wrapping retains prepared
  state without expanding ranges or advancing iterators; wrappers are frozen and
  allocation is charged before publication.
- The value-model suite first failed on its missing module; all 3,155 tests in
  197 files pass. Source typecheck, scoped lint and selected workspace build
  passed. This is host-only storage groundwork, not a complete guest object
  model: dictionaries, sets, callable/user objects, guest type/protocol dispatch,
  concrete module contexts, safe-fs wiring and full heap accounting remain open.
- Connected concrete runtime values to exact builtin truth evaluation. Mutable
  lists use current size without visiting members or cycles; ranges inspect
  arbitrary-precision length without len() overflow, and iterators remain truthy
  before and after exhaustion without advancing. Existing scalar/tuple/slice
  behavior is reused, including NotImplemented's boolean-context error.
- The truth suite first failed on its missing module; all 3,162 tests in 198
  files pass, including parsed list short-circuit/branch integration. A 1,000-case
  CPython comparison matched 3,000 list/range/iterator truth results. Source
  typecheck, scoped lint and selected workspace build passed. This dispatch is
  exact-builtin only: subclass/user slots, the concrete execution context and the
  remaining full-interpreter/resource/safe-fs work remain unfinished.
- Connected exact runtime iteration to live list cursors, lazy integer-wrapped
  ranges, prepared iterator identity and immutable sequence cursors. Generalized
  the immutable cursor's tuple member type so mutable guest members retain
  identity without casts or copies. Invalid builtin receivers fail at acquisition;
  ranges do not expand ahead of demand and list exhaustion remains sticky.
- The iteration suite first failed on its missing module; all 3,171 tests in
  199 files pass, including parsed starred list/tuple expression integration.
  A 1,000-case CPython comparison matched range results and 10,000 mutation-sensitive
  list next results. Source typecheck, scoped lint and selected workspace build
  passed. Guest iterator types/StopIteration translation, arbitrary user iteration,
  concrete execution contexts, full heap/CPU accounting and safe-fs integration
  remain open; prepared host iterators are trusted adapters, not guest objects.
- Connected exact runtime subscription for mutable lists, arbitrary-precision
  ranges, mutable-member tuples and immutable strings/bytes. Slice step validation
  precedes bounds; full list slices own fresh slots while full immutable slices
  may retain identity. The runtime factory can adopt trusted owned list storage
  so slicing does not copy its result a second time. Range indexing/slicing stays
  arithmetic and does not apply fixed-size sequence index limits.
- The subscription suite first failed on its missing module, and the storage
  adoption regression failed before implementation. All 3,181 tests in 200 files
  pass, including parsed nested subscription/slice integration. A 3,000-case
  CPython comparison matched values, raw range attributes and errors across five
  sequence kinds. Source typecheck, scoped lint and selected workspace build
  passed. Guest __index__/__getitem__ slots, mutable assignment/deletion wiring,
  complete execution contexts, heap/CPU accounting and safe-fs integration remain
  unfinished. Trusted adopted storage must belong to the same execution meter.
- Connected exact list item assignment/deletion and slice replacement/deletion.
  Shared runtime slice conversion with subscription so zero-step/error ordering
  stays consistent. List replacements preserve self-alias handling; tuple and
  other iterable replacements materialize before target slot changes, then
  normalize against the current list size after iterator side effects. Iteration
  errors preserve those effects but do not partially assign; no implicit close.
  Immutable receiver and non-iterable replacement diagnostics follow the tested
  Python operation-specific wording.
- The mutation suite first failed on its missing module; all 3,190 tests in 201
  files pass. A 3,000-case CPython mutation comparison matched resulting lists
  and errors, including self replacement and iterator-driven changes. The
  3,000-case subscription regression also passed after sharing slice validation.
  Source typecheck, scoped lint and selected workspace build passed. Guest
  mutation/index slots, replacement length-hint dispatch, finalizers, concrete
  statement contexts, full resource accounting and safe-fs integration remain
  unfinished; this is exact runtime-value mutation, not arbitrary guest objects.
- Connected runtime unary operators: logical negation uses mutable/range/iterator
  truth without member traversal, while numeric signs/inversion reuse scalar
  behavior and warning policy. Invalid operand diagnostics do not inspect nested
  values. Parsed negative indices and negative slice steps now compose the unary
  adapter with runtime subscription, alongside value-mode not on list literals.
- The unary suite first failed on its missing module; all 3,197 tests in 202
  files pass. A 960-case CPython comparison matched results, operand errors and
  warning traces. Source typecheck, scoped lint and selected workspace build
  passed. Concrete guest iterator type names, overridden unary/truth slots,
  complete expression/statement contexts, full resource accounting and safe-fs
  integration remain unfinished; these adapters still cover exact runtime values.
- Connected exact runtime binary kernels for list concatenation/repetition,
  mutable-member tuple concatenation/repetition and existing scalar arithmetic.
  Generalized immutable concat/repeat member types instead of duplicating their
  slot algorithms. Lists always return fresh slots (even zero/one repetition),
  while tuple shortcuts retain immutable wrapper identity and shared members.
  Matched arithmetic/size errors propagate; unsupported operands and unavailable
  families explicitly decline for the unfinished guest reflected dispatcher.
- The runtime binary suite first failed on its missing module; all 3,205 tests in
  203 files pass, including parsed sequence arithmetic/subscription integration.
  A 3,000-case parsed-expression CPython comparison matched scalar/list/tuple/
  string results and repetition overflow errors. Source typecheck, scoped lint
  and selected workspace build passed. Reflected/subclass dispatch, final
  unsupported-operand diagnostics, float/complex powers, formatting, in-place
  operation wiring, full execution contexts/resources and safe-fs remain open.
- Connected exact list in-place addition/repetition with ordinary runtime binary
  fallback for immutable values. Direct self-extension duplicates original slots
  once; other iterables stream into the existing list, retaining partial progress
  on failure. Repetition preserves list identity and shared/cyclic members.
  Augmented-assignment integration verifies that a failed target write-back does
  not undo the preceding list mutation; live self-iterator growth is budget-bound.
- The in-place suite first failed on its missing module; all 3,213 tests in 204
  files pass. A 1,200-case CPython comparison matched resulting lists, identity,
  errors and iteration traces. Source typecheck, scoped lint and selected
  workspace build passed. Guest in-place/reflected slots, iterable length hints,
  finalizers, final unsupported-operand diagnostics, full concrete execution
  contexts/resource accounting and safe-fs integration remain unfinished.
- Unified immutable and mutable exact rich comparison in one explicit-stack
  engine, preserving the former constant entry point as a compatibility export.
  Lists use live slots and equality's length shortcut; tuples/slices share
  identity-aware member traversal. Range equality compares represented sequences.
  Direct NaN equality still differs from identity-skipped container members.
  Added a configurable comparison-depth policy (default 1,000) and logical frame/
  continuation charges; distinct cycles raise controlled RecursionError without
  consuming the host call stack. The 5,000-level legacy test explicitly requests
  a larger comparison policy and still verifies stack-independent traversal.
- The runtime comparison suite first failed on its missing module; all 3,221
  tests in 205 files pass, including allocation-limit latching and mixed deep
  containers. A 3,600-case CPython runtime comparison matched results/errors;
  69,192 immutable and 141,512 slice regression comparisons also passed. Their
  shared audit allocation caps were increased from 10 MB to 100 MB after the new
  frame charges exhausted the old aggregate caps; production budget enforcement
  remains enabled and directly tested. CPython cyclic-list probes confirmed self
  equality and distinct-cycle recursion errors. Source typecheck, scoped lint and
  selected workspace build passed. Guest rich slots, call-stack/shared recursion
  policy integration, exact iterator type names, full heap/CPU accounting, concrete
  execution contexts and safe-fs integration remain unfinished.
- Unified immutable and runtime membership while retaining the old constant
  entry point as a compatibility export. List/tuple/iterator membership uses
  identity-aware runtime equality and stops immediately after a match, preserving
  the unconsumed iterator tail. Exact integer/bool range needles use arithmetic;
  other range needles use numeric equality through iteration. String/byte
  containment retains specialized searches and validates arbitrary runtime needle
  types. Runtime iteration now requires only its used scalar factory interface.
- The membership suite first failed on its missing module; all 3,230 tests in
  206 files pass, including parsed nested mutable membership, cycles, iterator
  failure/no-close behavior and infinite-input limits. A 1,920-case CPython audit
  matched runtime membership results/errors and remaining iterator lengths; the
  17,298-case immutable regression passed. Source typecheck, scoped lint and
  selected workspace build passed. Guest contains/iteration slots, arbitrary
  buffer exporters, shared comparison-depth configuration, full concrete
  execution/resource accounting and safe-fs integration remain unfinished.
- Assembled a concrete exact-value expression context from the runtime operators,
  containment/comparison, iteration, factories and subscription. Namespace/object
  capabilities remain explicit supplied hooks whose receivers are retained;
  setup invokes no guest code. Parsed named expressions write through the bound
  namespace, and branching retains short-circuit semantics. Declined binary
  families now raise an explicit host implementation-gap error in this context
  rather than leaking NotImplemented as a successful expression result.
- The context suite first failed on its missing module; all 3,237 tests in 207
  files pass. A 3,000-case parsed CPython audit matched through the assembled
  context. Source typecheck, scoped lint and selected workspace build passed.
  This is not full module execution: concrete statement/reference wiring,
  functions/classes/call collectors, dictionaries/sets, guest protocol dispatch,
  final binary diagnostics, shared recursion policy, full resource accounting
  and safe-fs integration remain unfinished. Required object hooks make these
  gaps explicit rather than silently substituting partial implementations.
- Added subscript-reference evaluation to the existing expression continuation
  engine: it captures only the outer receiver/key without getitem, while nested
  subscriptions, slices and starred keys retain normal evaluation order. Added
  runtime name/attribute/subscript references that evaluate target operands once,
  defer reads, and use retained identities with current access/mutation hooks.
  List assignment/deletion reuse concrete mutation; no host attribute access is
  implicit. Retained references check the execution meter on every operation.
- Reference tests first reproduced unwanted outer getitem behavior and a missing
  runtime resolver. All 3,248 tests in 209 files pass. A 1,200-case CPython target
  capture/order audit matched, and the 3,000-case assembled expression regression
  passed. Source typecheck, scoped lint and selected workspace build passed.
  Concrete module statement assembly, guest subscription mutation slots, full
  object types/descriptors, closure/frame accounting and safe-fs integration remain
  unfinished; this supplies the reference bridge, not complete module execution.
- Assembled the concrete statement context around expression execution, target
  references, ordinary/annotated assignment, unpacking, augmented assignment and
  deletion. Existing statement traversal now runs compiled module loops/branches
  with exact runtime values. Annotation expressions remain ignored; bindings and
  list aliases retain Python assignment order. Non-iterable unpacking receives
  the assignment-specific diagnostic. Declined in-place operations cannot leak
  NotImplemented into target stores. Definition/import/raise and exception/
  manager/assertion capabilities remain explicit supplied hooks.
- The context suite first failed on its missing module; all 3,257 tests in 210
  files pass. An 800-case CPython compiled-module audit matched selected globals,
  retained aliases and errors through loops, unpacking, annotations and mutation;
  active module frames were restored after every case. Source typecheck, scoped
  lint and selected workspace build passed. This is an internal supported-
  statement execution path, not full Python: concrete functions/classes/imports,
  object/exception hooks, starred length hints, full temporary/heap accounting,
  public execution/SDK integration and safe-fs capability wiring remain unfinished.
- Added concrete function value records around the existing captured FunctionState
  model, retaining live globals, defaults, closure storage and mutable metadata
  without executing bodies during wrapping. Function values are truthy, compare
  by wrapper identity, reject iteration and decline unsupported arithmetic; host
  payload fields remain inaccessible through guest property lookup. Compiled
  function invocation now has an integration test using these records and the
  assembled concrete expression/statement contexts.
- All five new tests first failed on the missing factory method; all 3,262 tests
  in 211 files pass. A 768-case CPython compiled-function audit matched body
  results, defaults, variadic tuple arguments, positional-only/keyword binding
  errors and frame restoration. Source typecheck, scoped lint and selected
  workspace build passed. Guest call collectors, definition/lambda installation,
  function descriptors, keyword dictionaries, nested closure wiring, suspension,
  full heap/CPU accounting and safe-fs/public execution integration remain open.
- Extended the shared explicit-stack hash engine to concrete runtime values,
  retaining the constant hashing API as a compatibility export. Lists reject
  hashing directly or inside tuple/slice keys, without traversing cycles or later
  members. Functions/iterators use the supplied stable identity policy. Ranges
  hash a virtual canonical three-member tuple using the execution's None identity,
  avoiding range expansion and recursive host calls even when nested in keys.
- The runtime hash suite first failed on its missing module; all 3,268 tests in
  212 files pass. A 3,000-case CPython audit matched runtime range/compound hashes
  and unhashable-key errors; 12,004 immutable and 5,000 range hash regressions also
  passed, using the same None identity hash where required. Source typecheck,
  scoped lint and selected workspace build passed. Execution-wide identity/seed
  provisioning, concrete dictionary values/literals, guest __hash__ slots, full
  bigint/heap accounting and safe-fs/public execution integration remain open.
- Added concrete dictionary records retaining prepared ordered storage and its
  shared key/hash policy. Truth uses live size; iteration yields original keys
  with storage mutation checks; membership hashes and compares keys, not values.
  Numeric-equivalent keys retain the first key and insertion position. Dictionary
  values reject hashing directly or nested in immutable keys without traversing
  cyclic contents. Built-in unhashable membership errors identify the outer key
  type, while direct hashing retains its original diagnostic.
- The initial record tests failed on the absent factory, and added boundary and
  diagnostic tests reproduced silent scalar-comparison fallback and missing
  dictionary-key error context. All 3,276 tests in 213 files pass. A 1,200-case
  CPython dictionary audit matched key order/types, replacement, deletion,
  reinsertion, truth, membership and unhashable-list errors; the 3,000-case runtime
  hash regression also passed. Source typecheck, scoped lint and selected workspace build
  passed. Subscription, item mutation and dictionary value equality remain
  explicit unsupported-operation boundaries, not false scalar/sequence behavior.
  Dictionary literals, call keyword dictionaries, guest hash/equality slots,
  execution-wide hash policy provisioning and safe-fs/public execution integration
  remain unfinished; storage iterator compaction differences remain as logged.
- Implemented runtime dictionary equality and inequality through the existing
  explicit comparison stack. Ordered storage can suspend non-identical value
  pairs while retaining cached key hashes, captured values and live subsequent
  entries; its callback equality API now drives that same traversal. Dictionary
  insertion order is ignored, numeric-equivalent keys match, identical values
  bypass comparison, and distinct cycles consume the configured comparison-depth
  policy instead of overflowing the host call stack. Ordering remains a TypeError.
- Five new runtime tests first reproduced the unsupported comparison boundary.
  All 3,285 tests in 214 files pass, including 4,000 nested dictionary/tuple pairs,
  cyclic values, NaN identity, missing keys, suspended mutation and cancellation.
  A 2,400-case CPython audit matched 14,400 nested dictionary comparison outcomes;
  10,000 ordered-map operations and 3,600 runtime comparison regressions also
  matched. Source typecheck, scoped lint and selected workspace build passed.
  Dictionary subscription/mutation/literals, concrete calls and exception values,
  guest key slots and their recursion control, full temporary/heap accounting,
  public execution integration and safe-fs wiring remain unfinished.
- Implemented exact dictionary subscription, assignment and deletion through a
  shared key-operation dispatcher also used by membership. Each operation hashes
  once, retains first-key identity/order on overwrite, and treats hashable slices
  as keys without sequence-index validation. Missing-key faults now carry a frozen
  single-argument array retaining the original key; raising never calls repr.
  The internal host diagnostic is not guest KeyError formatting: concrete guest
  exception construction and str/repr rendering remain explicit unfinished work.
- All five initial access tests reproduced unsupported subscription/mutation.
  All 3,292 tests in 215 files pass, including compiled statement reads, writes,
  augmented list mutation, alias retention, deletion and frame restoration after
  a missing key. A 1,500-trace CPython audit matched 30,000 item operations,
  including KeyError arguments and unhashable-key diagnostics. Subscription and
  list-mutation audits each matched 3,000 cases; compiled-module and dictionary
  storage regressions also passed. Source typecheck, scoped lint and selected workspace build
  passed. Dictionary literals/constructors, concrete call keyword dictionaries,
  guest key slots, complete resource accounting and public execution/safe-fs
  integration remain unfinished.
- Connected optional guest length capabilities to runtimeLength and the len
  builtin. Non-native operands use the existing __len__/__index__ conversion,
  negative/overflow validation and warning policy. Missing slots use bounded
  guest type names; existing exact native container paths avoid guest callbacks.
- Six tests first exposed missing guest length dispatch. All 4,910 tests in 426
  files pass, covering direct/zero/negative/overflow lengths, index conversion,
  native bypass and missing-slot diagnostics. Forty-eight compiled programs
  match CPython values/errors and exact len/index traces in module, nested
  function and conditional execution. Typecheck, scoped lint and selected
  workspace build pass. Automatic builtin namespace assembly and concrete guest
  object adapters, plus broader SDK/safe-fs integration, remain unfinished.
- Added concrete dictionary literal construction and exact-dictionary ** unpacking.
  Expression bindings can supply the execution's shared key policy for the
  built-in builder or retain an explicit custom builder hook. Construction uses
  existing chunk/evaluation scheduling, preserves first keys and shared values,
  and reuses source hashes inside a shared policy domain. ** rejects non-mappings
  rather than accepting the iterable-pair constructor path. Compiled statements
  now have an integration test creating and unpacking dictionaries from source,
  then performing item mutation, alias-preserving augmentation and deletion.
- All six new display tests first failed because the concrete key-policy path
  was absent. All 3,298 tests in 216 files pass. A 2,400-case CPython audit matched
  parsed dictionary displays, nested access/equality, unpacking and errors;
  the 3,000-case assembled-expression regression also passed. Source typecheck
  scoped lint and selected workspace build passed. dict constructors/methods, arbitrary guest
  mapping slots, concrete call keyword dictionaries, complete exception rendering,
  full resource accounting and public execution/safe-fs integration remain open.
- Added concrete dictionary source updates and expanded dict() construction.
  Exact dictionaries reuse cached hashes in their shared policy domain; other
  current values feed the existing fully-materialized pair-update engine. Tuple
  rows reuse slots, list rows take metered snapshots, and iterator rows exhaust
  before shape validation. Earlier writes survive later errors without closing
  or advancing the outer iterator. Construction validates positional arity and
  applies already-validated keyword names after successful positional updates.
- The new suite first failed on its missing implementation module. All 3,307
  tests in 217 files pass, including malformed rows, iterator failures, infinite
  row termination, hash reuse and keyword overwrite order. A CPython audit matched
  2,400 concrete updates and 2,400 constructors; 600 pair-update traces and 10,000
  ordered-map operation regressions also passed. Source typecheck, scoped lint and selected
  workspace build passed. These are internal call-ready operations, not guest
  builtin/method registration. Guest mapping and length-hint slots, dict method
  call binding, concrete call collectors, full exception/resource accounting and
  public execution/safe-fs integration remain unfinished.
- Added concrete per-expression call collectors for positional arguments, starred
  iteration, explicit keyword groups and exact-dictionary ** merging. Ordered
  storage supports duplicate-rejecting merges without discarding cached hashes
  or overwriting prior values. Non-string keyword validation is deferred until
  expansion finishes and callability is checked. Lone-star scheduling now carries
  the distinction needed for its diagnostic. Keyword storage remains a runtime
  dictionary: host UTF-16 string maps can collapse distinct Python surrogate keys.
- The new collector suite first failed on its missing module; focused tests also
  reproduced absent duplicate rejection and incorrect non-callable/non-string
  error precedence before correction. All 3,317 tests in 218 files pass, including
  nested calls, deferred expansion, next errors and distinct surrogate keys.
  A 2,400-case CPython call audit matched collected arguments and expansion/keyword
  diagnostics; 10,000 ordered-map operations and 2,400 dictionary-display cases
  also matched. Source typecheck, scoped lint and selected workspace build passed. Callable
  presence, error formatting and invocation are still supplied runtime policies;
  concrete function invocation wiring, guest mapping/length-hint slots, full
  resource/exception accounting and public execution/safe-fs integration remain
  unfinished. Python keyword code points must remain intact through future
  function argument binding and **kwargs construction.
- Connected concrete collected calls to captured compiled functions. Argument
  binding, frame construction and invocation now preserve an optional original
  keyword-key type, using a separate exact-name/diagnostic adapter. Runtime calls
  retain original string records through matching and fresh **kwargs construction;
  surrogate-containing keys cannot accidentally match an astral source identifier.
  Positional tuples and keyword dictionaries share member values, while globals
  and closures remain live. Invocation uses current qualified-name metadata and
  the supplied shared frame-depth policy/body and optional suspension backend.
- Four generic-key tests first reproduced failed parameter matching, collapsed
  naming assumptions and wrong diagnostics; the concrete call suite then failed
  on its missing implementation module. All 3,326 tests in 220 files pass,
  including every parameter kind, surrogate keys, fresh kwargs, live globals,
  recursive calls and depth-error frame cleanup. A 1,536-case CPython audit matched
  collected source calls into compiled functions, results and binding failures;
  the prior 768-case function-call audit also passed. Source typecheck, scoped lint
  and selected workspace build passed. Function definition/lambda installation,
  concrete builtin/method dispatch, suspension backends, stack-independent call
  execution, full resource/guest exception accounting and public execution/safe-fs
  integration remain unfinished.
- Added concrete function-definition/lambda adapters against precompiled AST
  identities. Creation captures the defining namespace, selected builtin adapter,
  closure cells and evaluated defaults without running a body. The shared
  definition engine handles decorator evaluation/application and final name
  installation; decorator application now uses the concrete call collector.
  Lambda creation uses the same code/state path. Nested definitions preserve
  nonlocal cells after return, and failed decoration leaves earlier bindings intact.
- The new suite first failed on its missing adapter module. All 3,333 tests in
  221 files pass, including ignored annotations, mutable defaults, decorator order,
  lambda defaults/live cells, nonlocal mutation, recursion and definition of all
  suspended function kinds without executing them. A 1,200-module CPython audit
  matched definitions, closures, decorators, defaults, recursion and failure/frame
  cleanup; the 1,536-case collected-function-call audit also passed. Source
  typecheck, scoped lint and selected workspace build passed. Runtime context
  assembly remains explicit in integration harnesses; class/builtin/method
  dispatch, suspended execution, stack-independent calls, complete accounting and
  public execution/safe-fs integration remain unfinished.
- Added a reusable internal program-execution entry point assembling module,
  expression, statement, call, definition and lambda execution with one value/key
  policy, namespace set, call-depth policy and meter. Frame-scoped expression and
  statement hook factories retain their method owners. Exact functions dispatch
  through captured code and namespaces; other callables require explicit object
  capabilities. Nested definitions use the callee's captured builtin namespace
  when globals no longer supplies __builtins__, not the module's initial defaults.
- The suite first failed on the missing execution module. All 3,340 tests in 222
  files pass, including separate module locals, captured builtins, custom call
  capabilities, hook ownership, fatal cancellation and cleanup after unsupported
  leaves. A 1,300-module CPython audit matched the assembled runner's definitions,
  closures, decorators, defaults, recursion, captured builtins and failure cleanup.
  Source typecheck, scoped lint and selected workspace build passed. This remains
  an internal explicit-capability runner: complete object/class/builtin/import
  behavior, suspended execution, stack-independent calls, complete accounting and
  the public SDK/safe-fs integration remain unfinished.
- Added explicit builtin-function capability records. Frozen wrappers retain
  trusted synchronous implementations without invoking them or exposing host
  payload properties. The assembled runner recognizes these callables, preserves
  their method owner, passes the shared meter and uses their registered name for
  expansion diagnostics. Truth/hash/iteration/arithmetic dispatch now recognizes
  the new value kind. Bound-method descriptors/equality remain separate work.
- Added explicitly registered len as the first concrete builtin capability,
  handling exact list/tuple/dict/string/bytes/range lengths, positional/keyword
  validation and oversized ranges without member traversal. Tests first failed
  on the missing capability factory and len module. A cancellation regression
  also reproduced an extra diagnostic callback after cancellation; the call
  collector now checks between those callbacks and does not publish cancelled
  capability results.
- All 3,352 tests in 224 files pass. A 1,800-case CPython audit matched registered
  len calls, expansion errors, builtin truth and hashes using the supplied matching
  identity policy. Program (1,300), call-collection (2,400) and runtime-hash (3,000)
  regressions also passed. Source typecheck, scoped lint and selected workspace
  build passed. Builtin coverage is not complete; generic __len__/object slots,
  bound methods, class/import dispatch, suspension, complete accounting and public
  SDK/safe-fs integration remain unfinished. No filesystem capability is granted
  implicitly by builtin registration.
- Added immutable bound Python-method records retaining the exact function and
  instance, without executing or copying either. Method calls prepend the instance
  before ordinary function argument binding and use the function's captured
  namespaces/diagnostic identity. Equality compares function/instance identities;
  hashing xors the function hash with generic instance identity, so unhashable
  instances remain valid. Truth, iteration and arithmetic dispatch recognize the
  new value kind, and equivalent method dictionary keys merge correctly.
- The method and integration tests first failed on the absent factory. All
  3,358 tests in 225 files pass. A 960-case CPython MethodType audit matched calls,
  equality, binding errors and method hashes using matching identity policies;
  program (1,300), comparison (3,600) and runtime-hash (3,000) regressions also
  passed. Source typecheck, scoped lint and selected workspace build passed.
  Binding currently covers exact Python functions; general MethodType callable
  inputs, function __get__ argument handling, concrete types/instance attribute
  wiring, class construction, suspension, complete accounting and public SDK/
  safe-fs integration remain unfinished.
- Connected concrete Python-function descriptor binding to the existing instance
  and class precedence kernels. Exact functions supply their intrinsic non-data
  get slot, ignoring a function instance's own __get__ attribute. Class access
  retains the function; instance access creates a bound method unless instance
  storage shadows it. Other descriptor slots remain explicitly type-resolved by
  a supplied policy, retaining their owner. The function get kernel handles None
  instance/owner semantics after argument binding.
- The new bridge suite first failed on its missing module. Ten cancellation tests
  then reproduced attribute/MRO callbacks returning after cancellation; kernels
  now check after successful callbacks before returning or continuing lookup.
  All 3,373 tests in 227 files pass. A 1,200-case CPython audit matched 3,600 direct,
  instance and class lookup outcomes; bound-method (960) and assembled-program
  (1,300) regressions also passed. Source typecheck, scoped lint and selected
  workspace build passed. Concrete type/instance storage, MRO-to-attribute wiring,
  override/fallback slots, exposed descriptor-wrapper binding, class construction,
  suspension, full accounting and public SDK/safe-fs integration remain unfinished.
- Added immutable runtime inheritance layouts with copied bases and C3 MROs,
  retaining prepared live dictionary namespaces. Attribute resolution searches
  those namespaces in MRO order, preserves the defining owner and Python
  code-point keys, and resolves descriptor slots only for the winning value.
- The new suite first failed on its missing implementation. All 3,378 tests in
  228 files pass. A CPython differential audit matched 1,000 generated hierarchies
  containing 10,000 class-construction/live-lookup cases, including duplicate and
  inconsistent bases and namespace mutation. Source typecheck, scoped lint and selected
  workspace build passed. Layouts are host metadata, not guest type values;
  metaclass policy, mutable __bases__, concrete type/instance records, class
  construction, full accounting and public SDK/safe-fs integration remain pending.
- Added a concrete dictionary-backed name namespace shared by class-frame locals,
  builtin lookup and module exec locals. It converts source names to runtime string
  keys without extra normalization, preserves live storage and non-string entries,
  distinguishes missing names from None, and propagates dictionary policy faults.
  Class-frame writes/private mangling now have an integration test against the
  same dictionary subsequently searched by runtime MRO lookup.
- The adapter suite first failed on its missing module. All 3,384 tests in 229
  files pass, including assembled-program separate-local and captured-builtin
  integration. A 1,200-program CPython exec comparison matched separate dictionary
  locals/builtins, global routing, default capture and deletion; the 10,000-case
  inheritance audit also passed. Source typecheck, scoped lint and selected
  workspace build passed. This does not yet replace global Map storage, implement
  arbitrary prepared mappings or complete guest type/instance/class construction.
  Full accounting, suspension and public SDK/safe-fs integration remain pending.
- Added concrete guest cell records retaining shared closure storage, including
  class construction cells captured by methods. Exact cell_contents access raises
  ValueError for empty reads, shares assigned contents and permits repeated
  deletion. Cells are truthy and unhashable. Their six rich comparisons delegate
  directly to occupied contents, order empty cells first and use the existing
  explicit comparison stack/resource depth policy rather than host recursion.
- The cell suite first failed on its missing module. All 3,393 tests in 230 files
  pass, including 5,000 nested cells, cyclic comparison limits, NaN identity cases,
  class closure storage identity and mutation allocation/cancellation checks.
  A 2,000-case CPython audit matched 12,000 comparisons plus hash failures and
  cell_contents transitions. Runtime comparison (3,600), hash (3,000) and assembled
  program (1,300) differential regressions also passed. Source typecheck, scoped
  lint and selected workspace build passed. Cell wrappers still require object
  layer publication/caching and exposed descriptor/constructor binding; this is
  not full class-suite or type/instance construction integration. Full accounting,
  suspension and public SDK/safe-fs integration remain unfinished.
- Connected precompiled class suites to concrete runtime execution against a
  prepared dictionary. Shared frame assembly now handles module, lexical and class
  frames; class-defined methods/lambdas capture the proper cells while using their
  defining globals/builtins. Suite metadata and guest __classcell__ publication use
  the existing class-body lifecycle, with fresh cells per activation, live outer
  captures, method defaults/decorators and exception-safe call-stack restoration.
- The new class-suite suite first failed on its missing module. All 3,401 tests in
  231 files pass. A 1,200-case CPython audit matched namespace metadata, method
  results and partial writes after suite failures. Assembled-program (1,300) and
  separate dictionary-local/builtin (1,200) differential regressions passed.
  Source typecheck, scoped lint and selected workspace build passed. This executes
  prepared class suites, not full class statements: builder lookup/body callable
  representation, arbitrary prepared mappings, bases/metaclass/type construction,
  and concrete instance dispatch still need integration. Suspension, complete
  resource accounting and public SDK/safe-fs integration also remain unfinished.
- Class-body callable inspection exposed a cross-program code-ownership defect:
  a function defined by one compiled program failed when called by another if it
  created a nested def or lambda. Both initial reproductions failed with missing
  compiled code. Whole-program compiled functions now retain their originating
  function registry, and frame assembly follows that registry through ordinary
  and bound-method calls. Ownership is shared per code object rather than copied
  into every closure; standalone compiled code can retain an embedding resolver.
- All 3,407 tests in 231 files pass, including six cross-program regressions for
  nested definitions, lambdas, default lambdas, decorators and bound methods. A
  1,500-case CPython cross-program audit matched function factories and captured
  globals. Assembled-program (1,300) and class-suite (1,200) differential regressions
  also passed. Source typecheck, scoped lint and selected workspace build passed.
  Class-body callable representation and class-statement construction remain
  unfinished; this fixes a prerequisite rather than completing those features.
- Added precompiled class-body function code as an execution form of ordinary
  Python function values. Class statements now resolve __build_class__ from active
  builtins and pass the unexecuted body/name through the shared argument collector,
  retaining decorator/header ordering and builder overrides. Direct body calls
  bind zero parameters, execute class-scope code in defining globals, and return
  the exact published construction-cell wrapper or None. Class-body function docs
  remain None even when the class suite has a docstring. Nested function and class
  registries follow originating code across separately compiled programs.
- All seven initial integration cases failed at unsupported class dispatch before
  implementation. All 3,416 tests in 232 files now pass. A 1,500-case CPython audit
  matched overridden-builder class statements, direct class-body calls, metadata,
  closures and binding/suite errors. Assembled-program (1,300), prepared-class-suite
  (1,200) and cross-program function (1,500) differential regressions also passed.
  Source typecheck, scoped lint and selected workspace build passed. The default
  builtin __build_class__ backend, metaclass/type construction, arbitrary prepared
  mappings and instance dispatch remain unfinished; no default class builder is
  silently installed. Suspension, full resource accounting and public SDK/safe-fs
  integration remain unfinished as well.
- Generalized class preparation/construction/builder keyword maps to retain
  runtime key records. An explicit key policy recognizes the exact reserved
  metaclass name; all other keys flow unchanged through preparation and final
  construction. Existing host-string callers retain their default behavior.
  Non-string keys without a policy fail explicitly, and cancellation or policy
  failures stop before metaclass hooks. This avoids lossy host-string conversion
  of distinct Python surrogate-pair and astral keyword names.
- All four new tests failed before implementation: runtime metaclass keys were
  ignored and the new policy was never invoked. All 3,420 tests in 233 files pass.
  A 1,000-case CPython builder audit matched preparation/construction keyword key
  identity, order and values, including surrogate/astral and compatibility-character
  distinctions. The 1,500-case class-definition differential regression passed.
  Source typecheck, scoped lint and selected workspace build passed. Concrete default-builder,
  metaclass/type construction and arbitrary prepared mapping integration remain
  unfinished, as do suspension, full accounting and public SDK/safe-fs integration.
- Added an explicitly registered concrete __build_class__ builtin. It validates
  runtime keyword strings without replacing their key records, owns intrinsic
  function/name checks and reserved-key recognition, and drives the existing
  builder lifecycle through supplied base/metaclass/prepared-body capabilities.
  Capability method owners are retained. Integration tests execute real compiled
  class suites in prepared dictionaries and construct callable-metaclass results;
  cancellation and body failures cannot publish a class binding.
- The builtin suite first failed on its missing module. All 3,429 tests in 234
  files pass. A 1,200-case CPython audit matched full class-statement outcomes using
  the concrete builtin and supplied callable-metaclass policies, including method
  results and partial-failure namespaces. Keyword-identity (1,000) and overridden
  class-builder (1,500) differential regressions passed. Source typecheck, scoped
  lint and selected workspace build passed. Default type/metaclass objects,
  arbitrary prepared mappings and a unified prepared-body executor still need
  integration; the builtin requires explicit policies and is not silently
  installed. Suspension, full accounting and public SDK/safe-fs remain unfinished.
- Added a unified concrete prepared-builder body executor. Class code uses exact
  dictionary locals or an explicit custom mapping adapter; ordinary functions keep
  normal argument binding and optimized locals without consulting prepared locals.
  Returned cells retain shared storage, now separated from optional lexical owner
  metadata. Originating function/class registries follow the body across programs.
  The builtin integration uses this executor for real class suites and explicitly
  supplied ordinary functions, including standalone returned cells.
- The executor suite first failed on its missing module. A later test reproduced
  returning a cell after cancellation during the last mapping store; a completion
  checkpoint now rejects that return after stack cleanup. All 3,440 tests in 235
  files pass. CPython audits matched 1,000 ordinary-function builder calls and
  1,200 class statements through the unified executor, including argument errors,
  globals, returned cells and partial failures. Source typecheck, scoped lint and
  selected workspace build passed. Default type/metaclass/instance integration,
  full guest mapping protocols, suspension, complete accounting and public SDK/
  safe-fs integration remain unfinished; custom mappings still require a policy.
- Added concrete immutable type records retaining an inheritance layout and an
  explicit metaclass. A host-only self marker completes the type bootstrap cycle
  before publication. Type records participate in intrinsic identity comparison,
  hashing, truth and dictionary keys; class descriptors now accept actual type
  owners. Type callability reaches the explicit object invocation policy, while
  unsupported intrinsic arithmetic/iteration operations remain explicit failures.
- All seven initial tests failed on the absent type factory. All 3,449 tests in
  236 files pass, including custom metaclass references, live namespaces, inherited
  function descriptor ownership, identity keys and allocation limits. A 1,000-case
  CPython type-graph audit matched intrinsic comparisons, truth, iteration errors,
  MROs and dictionary identity using matching identity-hash policies. Runtime hash
  (3,000), comparison (3,600) and assembled-program (1,300) differential regressions
  passed. Source typecheck, scoped lint and selected workspace build passed.
  Canonical type publication/bootstrap registry, type construction, metaclass slot
  overrides and instance dispatch remain unfinished. Suspension, complete resource
  accounting and public SDK/safe-fs integration also remain unfinished.
- Added an execution-owned canonical type registry with object/type bootstrap
  records, weak layout-to-type ownership and lazy cached bases/MRO tuples.
  Repeated publication preserves type identity; conflicting metaclasses, foreign
  base layouts and impostor wrappers are rejected as host integration faults.
  Namespace mutation remains independent of immutable hierarchy metadata, and
  failed allocations do not publish records or cache incomplete tuples. Registry
  metadata now supplies real type MROs to class metaclass-selection tests.
- The registry suite first failed on its missing module. All 3,456 tests in 237
  files pass. A 1,000-case CPython type-graph audit matched intrinsic behavior and
  hierarchy metadata while additionally checking canonical publication, lookup
  and tuple caching. Source typecheck, scoped lint and selected workspace build passed.
  The registry does not install builtin methods or implement type.__new__, mutable
  __bases__, metaclass overrides or instance dispatch. Suspension, complete
  accounting and public SDK/safe-fs integration remain unfinished.
- Connected concrete default type attribute reads/writes/deletes to live class
  and metaclass MROs. Metaclass data descriptors take priority, class MRO entries
  shadow metaclass non-data descriptors, and class-owned descriptors do not
  intercept class writes. Receivers/owners retain canonical type identity; missing
  own-namespace deletion stays distinct from inherited values. The assembled
  interpreter integration reads/mutates attributes and calls a metaclass function
  bound to the class as its receiver.
- The new suite first failed on its missing module. All 3,464 tests in 238 files
  pass. An exhaustive 484-configuration CPython audit matched 2,420 read/write/
  delete outcomes and callback traces across get/set/delete slot combinations,
  inherited/own namespace placements, ordinary values, None and absent attributes.
  Source typecheck, scoped lint and selected workspace build passed. Dispatcher
  mutability checks, intrinsic metaclass descriptors, overridden __getattribute__/
  __getattr__, missing-name diagnostics and type construction remain unfinished.
  Suspension, full accounting and public SDK/safe-fs integration remain unfinished.
- Added concrete native getset-descriptor capabilities with intrinsic data slots,
  receiver applicability checks, class-access markers, read-only diagnostics and
  post-callback resource checkpoints. Explicit writable capabilities retain their
  callback owner. Bootstrap now installs type.__mro__ as a read-only native getset,
  returning the canonical cached hierarchy tuple and resisting class-dictionary
  shadowing. Descriptor records have intrinsic identity hashing/truth and reject
  unsupported arithmetic/iteration without traversing owner cycles.
- The new suite first failed on the missing descriptor implementation. All 3,472
  tests in 239 files pass. A 1,000-case CPython type-graph audit matched MRO reads,
  receiver checks and read-only errors alongside intrinsic type behavior. Type
  descriptor configurations (484/2,420 operations), function descriptor lookup
  (1,200/3,600 outcomes) and runtime hash (3,000) differential regressions passed.
  Source typecheck, scoped lint and selected workspace build passed. Other native
  type descriptors, exposed descriptor-wrapper argument binding/introspection,
  immutable-type mutation guards, type construction and instance dispatch remain
  unfinished, as do suspension, full accounting and public SDK/safe-fs integration.
- Added explicit immutable type metadata and marked bootstrap object/type immutable.
  Default type attribute mutation now rejects assignment and deletion before any
  metaclass descriptor lookup or namespace mutation, with metered Python-compatible
  diagnostics. Published user classes remain mutable; direct native descriptor
  operations retain their own receiver/read-only checks. The regression first
  failed because mutation reached descriptor lookup on object. All 3,475 tests in
  239 files pass; source typecheck, scoped lint and selected workspace build pass.
  CPython differential regressions passed for 484 descriptor configurations /
  2,420 operations and 1,000 MRO type graphs. Other intrinsic type metadata,
  construction, instance dispatch, suspension, full accounting and public
  SDK/safe-fs integration remain unfinished.
- Added live dictionary-backed mapping-proxy runtime values and the native
  type.__dict__ descriptor. Each read publishes a fresh read-only view sharing
  the current namespace. Exact runtime lookup, iteration, membership, length,
  truth, identity, rich comparison, hash delegation and mutation rejection now
  handle these views. Dictionary unions preserve operand order and produce fresh
  dictionaries; dict in-place union retains identity and accepts iterable pairs,
  while mapping-proxy in-place union rejects mutation. Mapping expansion collects
  keys before value retrieval, rehashes through the mapping protocol and rejects
  call duplicates before fetching values. Earlier writes survive later failures.
- Tests first failed on the absent proxy factory, then exposed cached-hash
  shortcut misuse, dictionary in-place identity loss and incorrect unsupported
  proxy-union errors. All 3,485 tests in 240 files pass; typecheck, scoped lint and
  selected workspace build pass. A 1,200-case CPython mapping-proxy trace audit
  matched live views, comparisons, unions, expansions and errors. Regressions
  passed for type descriptors (484 configurations / 2,420 operations), MRO
  descriptors (1,000 graphs), dictionary update/construction (2,400 each), call
  collection (2,400), binary expressions (3,000) and in-place list operations
  (1,200). Reference: https://docs.python.org/3/library/types.html#types.MappingProxyType.
  Arbitrary guest mapping proxies, exposed proxy methods/dictionary views,
  additional intrinsic type metadata, type construction, instance dispatch,
  suspension, full accounting and public SDK/safe-fs integration remain unfinished.
- Added live dictionary keys/values/items views, shared forward/reverse cursors,
  live length/truth and kind-specific membership. Item membership hashes only
  the key and permits unhashable values; value/item membership preserves member
  identity shortcuts. Keys/items compare as sets against other set-like views,
  yielding nested equality work into the existing depth-limited evaluator rather
  than recursing through host calls. Values views retain identity equality/hash;
  keys/items are unhashable. Subscription and item mutation reject all views.
- Added explicit bound read-method capabilities for exact dictionaries and their
  proxies: get, copy, keys, values, items and __reversed__. Argument validation
  precedes reads/allocations, get preserves absent-versus-None and uses one lookup,
  copies share members but not slots, and each view/cursor is newly published.
  Tests first failed on missing implementations; the assembled-program test
  exercises calls, loops, live views and copies through explicit attribute hooks.
  All 3,493 tests in 241 files pass; typecheck, scoped lint and selected workspace
  build pass. A 1,500-case CPython view/read-method audit matched membership,
  iteration, all pairwise view comparisons and argument errors. Regressions passed
  for mapping proxies (1,200), dictionary comparisons (2,400 / 14,400 outcomes),
  dictionary item operations (1,500 / 30,000 operations) and membership (1,920).
  Reference: https://docs.python.org/3/library/stdtypes.html#dictionary-view-objects.
  Set-producing view operations, set interoperability, isdisjoint, automatic
  method/mapping-descriptor discovery and guest builtin reversed registration
  remain unfinished. Existing iterator compaction differences remain tracked.
  Type construction, instance dispatch, suspension, full accounting and public
  SDK/safe-fs integration also remain unfinished.
- Added exact dictionary-view read attributes: each mapping read returns a fresh
  live mapping proxy, all three view kinds bind __reversed__, and keys/items bind
  isdisjoint. Disjointness validates arguments before iteration, short-circuits
  at the first match without consuming the remainder, handles identical views
  without hashing and chooses the smaller set-like view. Arbitrary iterables
  retain their own iteration/error behavior; item values need not be hashable.
  Post-next checkpoints catch cancellation even when an iterator reports done.
  Unknown names and values-view isdisjoint return absence for the dispatcher.
- Tests first failed on the missing attribute implementation. All 3,500 tests in
  242 files pass; typecheck, scoped lint and selected workspace build pass. A
  1,600-case CPython audit matched view attributes, argument errors, disjointness
  and remaining iterator contents; the prior 1,500-case view/read-method audit
  still passes. An assembled program exercises mapping access, bound calls and
  reverse iteration through explicit runtime attribute hooks. Set-producing view
  operations and set interoperability remain unfinished, as do automatic type
  descriptor installation, inherited object members, readonly-attribute mutation
  dispatch and bound-native-method identity/introspection. The full interpreter,
  accounting, suspension and public SDK/safe-fs integration are not complete.
- Added an explicitly registered reversed builtin for exact lists, tuples,
  strings, bytes, arbitrary-size ranges, dictionaries, mapping proxies and all
  dictionary views. Existing native cursors retain live-mutation behavior;
  indexed fallback preserves Python string code points and shared members. An
  optional explicit protocol context supports custom type-level __reversed__,
  disabled methods and sequence fallback while preserving callback ownership.
  Custom method results are returned without requiring iterator shape. Keyword
  validation uses the existing keyword-map size without copying keys.
- Tests first failed on the missing builtin. Additional failing tests exposed
  cancellation gaps after non-reversible type-name formatting and reverse-iterator
  exception classification; both now checkpoint before publishing an error or
  end-of-iteration result. All 3,510 tests in 243 files pass; typecheck, scoped lint
  and selected workspace build pass. A 1,800-case CPython audit matched 21,600
  next outcomes across exact sequences, huge ranges, mappings and live mutations.
  View-attribute (1,600) and view/read-method (1,500) regressions passed, and an
  assembled program invokes reversed through its ordinary builtin namespace.
  Automatic builtin/type registration, iterator subtype metadata/introspection,
  state restoration, set-producing view operations, full object construction,
  suspension, accounting and public SDK/safe-fs integration remain unfinished.
- Added exact-dictionary bound clear, pop, popitem, setdefault and update methods.
  Pop preserves stored None/default distinctions and original KeyError arguments,
  including the empty-dictionary no-hash path; setdefault hashes once and retains
  existing keys/positions. Popitem constructs its guest tuple before unlinking
  the latest entry, with a trusted non-mutating storage projection and a
  post-construction checkpoint, preserving storage on allocation/cancellation.
  Updates preserve exact keyword records, mapping/pair order and partial writes.
- Tests first failed on missing methods/projection support. A CPython trace audit
  exposed that native dict.update applies positional data before rejecting bad
  keyword names. New failing call-collection tests confirmed the mismatch. Native
  capabilities can now explicitly own keyword-name validation; only update opts
  in here, and ordinary call validation/duplicate detection remains unchanged.
  All 3,521 tests in 244 files pass; typecheck, scoped lint and selected workspace
  build pass. The corrected 1,800-case audit matched 43,200 mutation operations,
  errors, KeyError arguments and final ordered state. Regressions passed for
  dictionary item access (1,500 / 30,000 operations), update/construction (2,400
  each) and call collection (2,400). An assembled program exercises all five
  mutation methods through explicit dictionary-only attribute hooks. Native
  descriptor discovery/introspection, dict.fromkeys, remaining native calling
  conventions, full object construction, sets, suspension, accounting and public
  SDK/safe-fs integration remain unfinished.
- Added dictionary fromkeys construction with one shared default value, first-key
  identity/order preservation, exact-dictionary cached-hash merging and normal
  iteration for proxies/views/sequences. Ordered-map merging now accepts an
  explicit replacement value (including undefined) without changing ordinary
  update behavior. Self-source replacement is supported. An optional bound-class
  policy performs no-argument construction before iteration and dispatches every
  subclass setitem, including duplicates; exact dict results retain native paths.
  Construction/next/set callbacks have post-callback resource checkpoints.
- Tests first failed on missing construction and fixed-value merge support. All
  3,530 tests in 245 files pass; typecheck, scoped lint and selected workspace
  build pass. A 1,500-source CPython audit matched 3,000 exact/subclass fromkeys
  constructions, shared-default identity, callback traces, errors and partial
  state. Regression audits passed for dictionary mutations (1,800 / 43,200
  operations), update/construction (2,400 each) and mapping proxies (1,200).
  An assembled program calls fromkeys through explicit attribute dispatch.
  Full bound-class descriptor installation, native method identity/introspection,
  sets and their fast paths, object construction, suspension, accounting and
  public SDK/safe-fs integration remain unfinished.
- Added mutable set runtime values, concrete literal builders and exact set
  construction/update. Shared hash-key storage deduplicates by Python equality,
  retains members, uses cached hashes for exact set/dict sources and preserves
  partial insertion on iterable failure. Sets now have live truth/length,
  membership/error context, unhashability, set-specific iterator size errors and
  cached-hash equality/subset/superset comparisons. Set iteration order is not
  promised. Set-like dictionary views interoperate in comparisons/disjointness,
  including reflected dispatch and unhashable-item errors; fromkeys reuses exact
  set hashes. Literal execution is verified through explicit builder hooks.
- Tests first failed on the missing runtime. Follow-up failing tests exposed
  self-update equality work, missing view interoperability, redundant fromkeys
  hashing and incorrectly ordered reflected view comparisons; these are fixed.
  All 3,539 tests in 246 files pass; typecheck, scoped lint and selected workspace
  build pass. CPython audits matched 1,800 mutable-set cases and 1,200 mixed
  set/view cases, ignoring set iteration order. Regressions passed for views
  (1,500), view attributes (1,600), dictionary mutations (1,800 / 43,200 operations)
  and fromkeys (1,500 sources / 3,000 constructions). Frozen sets, mutable-set
  lookup-key conversion, set algebra and bound set methods remain unfinished.
  Automatic builtin registration, full object construction, suspension, complete
  accounting and public SDK/safe-fs integration also remain unfinished.
- Added exact mutable-set intersection (`&`) and in-place intersection (`&=`)
  using cached-hash storage. Results retain smaller-operand members, choosing
  the right operand on equal sizes; self intersections copy without guest
  hashing/equality. Foreign hash-policy domains use destination hashes.
  In-place computation precedes publication, preserves receiver/storage
  identity, and precharges the callback-free transfer. Failure does not publish
  partial results (independent callback mutations are not rolled back).
  A failing follow-up test exposed self-intersection restarting live iterators;
  self publication now preserves those cursors.
- Intersection verification: missing behavior was reproduced with failing tests;
  3,552 tests in 248 files pass, along with scoped lint, source typecheck and selected workspace
  build. A CPython 3.14 audit matched 1,800 binary/in-place cases for contents,
  retained member types and receiver identity, ignoring set iteration order.
  The 1,800-case mutable-set construction/comparison/update regression audit passes.
  Tests cover foreign hash policies, cancellation, transfer allocation failure,
  failure atomicity and adopted storage integrity. Distinct-operand,
  size-preserving in-place changes still use host live-storage cursor behavior,
  not CPython table-position semantics; iterator parity remains unfinished.
  Union, difference, symmetric difference, frozen sets, view algebra and bound
  set methods remain pending, alongside the broader runtime/integration scope.
- Added exact mutable-set union and symmetric difference (`|`, `^`, `|=`, `^=`).
  Set-specific storage merges reuse cached hashes, retain existing union members,
  preserve earlier in-place writes on failure and avoid dictionary-only source
  mutation errors. Symmetric difference preserves separate discard/add lookups
  and binary right-to-left comparison dispatch. Self union performs no guest
  comparisons; self in-place xor clears the receiver. Empty exact-set updates
  now copy validated keys without redundant collision comparisons, fixing a
  follow-up failing regression test in the existing construction/update path.
- Merge verification: initial tests reproduced the missing operators before
  implementation. All 3,569 tests in 250 files pass, as do scoped lint, source typecheck and
  selected workspace build. CPython audits matched 1,800 cases per operator
  (binary and in-place contents, retained member types and receiver identity),
  plus 16 callback direction/count/source-clearing cases. Set construction/update
  and intersection regressions matched 1,800 cases each. Set iteration order and
  CPython table-layout mutation behavior are not claimed by these audits.
  Difference, frozen sets, dictionary-view algebra and bound set methods remain
  pending, as do the broader runtime, suspension, accounting and SDK/safe-fs work.
- Added exact mutable-set difference (`-`, `-=`) with cached hashes and preserved
  left-member identity. Binary subtraction uses CPython's size-based choice
  between filtering and copy/removal; in-place subtraction pre-intersects a much
  larger source before removals. These choices preserve comparison direction
  and failure timing, not only final membership. Self in-place subtraction
  clears directly; streaming failures preserve prior removals, while failed
  pre-intersection does not publish removals. Foreign hash-policy destinations
  rehash probes, and cancellation is checked before committing removals.
- Difference verification began with four failing runtime tests. All 3,582 tests
  in 252 files pass, along with scoped lint, source typecheck and selected
  workspace build. CPython audits
  matched 1,800 binary/in-place value cases and 1,350 size-strategy/callback/
  failure cases; intersection and mutable-set regression audits cover 1,800
  cases each. A compiled program now executes all four binary and augmented set
  operators through the explicit set-builder hook and verifies alias identity.
  Frozen sets, mutable-set lookup conversion, dictionary-view algebra, native
  bound set methods and set iterator table-position parity remain pending,
  alongside the full object runtime, suspension, accounting and SDK/safe-fs work.
- Added frozen-set values with permanently sealed owned storage and cached,
  order-independent 64-bit hashes derived from stored member hashes. Sealing
  guards every mutation route, including callback-triggered sealing before a
  write; mutable copies remain independent. Exact construction accepts iterable
  inputs and returns an exact frozen input unchanged after argument validation.
  Frozen sets participate in truth/length, iteration, membership, comparisons,
  nested dictionary keys and all mixed set algebra. Result mutability follows
  the left operand; augmented frozen operations use binary fallback.
  Mutable-set membership probes now use equivalent frozen hashes without
  allocating replacement guest keys or making mutable sets generally hashable.
  Dictionary-view comparison/disjointness and fromkeys include frozen fast paths.
- Frozen-set verification: initial failing tests reproduced missing storage and
  runtime behavior. Follow-up failures caught missing fast paths and cancellation
  precedence on sealed in-place intersection; both are fixed. All 3,606 tests in
  254 files pass, along with scoped lint, source typecheck and selected workspace
  build. CPython audits matched 1,800 nested frozen-set cases (hashes, mixed
  algebra/comparisons and mutable probes) and 1,200 frozen-set/view cases.
  Regressions passed for mutable sets (1,800), merge callbacks (16) and difference
  strategy/callback failures (1,350). A view audit stalled waiting for stdin EOF;
  sampled stacks identified the transport wait, and a newline-framed JSON input
  completed the audit after terminating that specific diagnostic child.
  Native set/frozen-set methods, view-producing algebra, automatic builtin/type
  registration, iterator table-position parity, complete accounting, suspension
  and the full SDK/safe-fs integration remain unfinished.
- Added explicitly bound mutable-set methods: add, remove, discard, pop, clear
  and multi-source update. Key operations hash once; remove/discard accept
  mutable-set probes using equivalent frozen hashes, while insertion still
  rejects them. KeyError retains the original missing guest key. Pop returns an
  arbitrary existing member without hashing; no CPython pop-order promise is
  made. Argument validation precedes mutations and update keeps earlier writes
  when a later source or element fails. Compiled-program calls exercise all six
  methods through explicit attribute hooks and preserve receiver aliases.
- A failing regression test, backed by CPython execution, exposed a dictionary-
  only source-mutation error in set.update(dict). Set-specific merges now accept
  replacement payloads, retain dictionary-source collision comparisons and
  allow source clearing during equality without the spurious dictionary error.
  All 3,622 tests in 255 files pass, with scoped lint, source typecheck and selected workspace
  build. A 2,400-call CPython audit matched native method results, errors and
  partial state; pop used empty/singleton inputs to avoid assuming arbitrary
  selection order. Mutable-set and nested frozen-set regressions cover 1,800
  cases each. Remaining set algebra/relationship methods, frozen-set methods,
  dictionary-view algebra, automatic method/type registration, iterator parity,
  complete accounting, suspension and public SDK/safe-fs integration are pending.
- Added explicitly bound set/frozen-set copy, isdisjoint, issubset and issuperset.
  Mutable copies own fresh storage; exact frozen copies preserve identity.
  Exact set operands use cached hashes and smaller-side disjointness checks.
  Generic relationship inputs stream with method-specific short circuits;
  subset testing builds only the matching keys and stops after covering the
  receiver, while an empty receiver still consumes/hashes generic inputs.
  Generic relationship probes do not perform mutable-set-to-frozen conversion.
  Raw subset hashing errors and contextual superset/disjointness errors follow
  their distinct native paths. Iterator acquisition follows result allocation,
  and cancellation is checked before hashing pulled values.
- Relationship verification: tests first reproduced the missing methods. All
  3,640 tests in 257 files pass, with scoped lint, source typecheck and selected workspace
  build. A 2,400-case CPython audit covers both receiver kinds, method results,
  errors, copy identity and remaining iterator contents. The 1,800-case nested
  frozen-set regression audit also passes. Storage tests cover
  foreign hash domains, retained incoming member identity, allocation ordering
  and cancellation. Algebra-producing methods and their multi-source mutation
  forms, dictionary-view algebra, automatic descriptor/type installation,
  iterator parity, full accounting, suspension and SDK/safe-fs work are pending.
- Added multi-source set/frozen-set union and intersection methods, plus mutable
  intersection_update. Generic sources preserve native consumption, errors and
  short-circuit tails; empty intersections still process later arguments. Union
  skips original-receiver arguments without repeated equality work. Results are
  fresh even for zero-argument frozen operations. Intersection-update computes
  every stage before publication, preserving receiver identity and prior state
  on failure without rolling back mutations performed by input callbacks.
- Added a precharged, callback-free storage handoff that empties the private
  source and permits subsequent independent reuse. Sealed storage and transfers
  across hash-policy/execution-meter domains are rejected. A failing test caught
  the missing meter-domain check before the handoff was finalized. Existing
  in-place intersection shares this handoff and retains its self-cursor case.
- Multi-source verification: missing methods were reproduced before implementation.
  All 3,652 tests in 259 files pass, with scoped lint, source typecheck and selected workspace
  build; the strengthened collision/self-union test also passes. A 2,400-case
  CPython audit matches results, errors, identity and iterator remainders.
  Regressions cover binary/in-place intersection (1,800) and mutable-set methods
  (2,400). Difference/symmetric-difference methods and their mutation forms,
  dictionary-view algebra, automatic method/type registration, iterator parity,
  complete resource accounting, suspension and SDK/safe-fs work remain pending.
- Added set/frozen-set difference and symmetric_difference, plus mutable
  difference_update and symmetric_difference_update. Difference supports multiple
  inputs, preserves original member identity and keeps completed streaming
  removals on failure. Initial exact-dictionary difference uses cached hashes;
  dictionary difference-update intentionally rehashes iterated keys. Generic
  xor inputs are fully deduplicated before receiver mutation; exact set/dict
  sources use cached hashes and retain completed toggles on later failure.
  Iterated mutable-set keys are not converted into frozen removal probes.
  Private empty storage is allocated in constant space within the receiver's
  hash-policy/budget domain, avoiding a full receiver copy for xor preparation.
- Difference-method verification began with eight failing behavior tests. All
  3,663 tests in 260 files pass, with scoped lint, source typecheck and selected
  workspace build. A 3,200-call CPython audit matches results, errors, identity,
  self-input handling and iterator remainders. Regressions pass for multi-source
  union/intersection (2,400) and basic mutable-set methods (2,400). Tests cover
  cached-versus-rehashed dictionary paths, exact-source partial xor mutation,
  generic preparation failures and bounded empty-storage allocation.
  Dictionary-view algebra, automatic method/type installation, full native
  introspection, iterator table-position parity, complete accounting, suspension
  and public SDK/safe-fs integration remain unfinished.
- Added dictionary-key/item view union, intersection, subtraction and xor,
  including reflected iterable operands and fresh mutable results. Left proxy
  union forwards through its dictionary; right proxies remain generic iterables.
  Intersection preserves the exact mutable-set optimization and consumes all
  generic input members, without the set-method early-stop shortcut. Item-view
  xor compares values before tuple hashing, allowing equal unhashable values to
  cancel. Matching-item storage subtraction reuses hashes, retains incoming
  pairs across callbacks, checks cancellation and reports failed second lookups.
- Dictionary-view algebra verification began with nine failing behavior cases.
  All 3,676 tests in 262 files pass, with scoped lint, source typecheck and
  selected workspace build. A 2,400-case CPython audit matches results, errors and iterator
  remainders across all four operators and both directions. Regression audits
  pass for frozen-set/view relationships (1,200) and difference/xor methods
  (3,200). Automatic method/type installation, native introspection, iterator
  table-position parity, complete accounting, suspension and public SDK/safe-fs
  integration remain unfinished.
- Connected implemented dictionary, proxy, view and set/frozen-set instance
  methods to default runtime attribute lookup. Compiled module and function
  bodies can now call them without an external attribute dispatcher. Explicit
  hooks retain precedence for custom object policies. Lookup uses fixed Python
  member names, never host properties or prototype discovery; unavailable
  members raise guest AttributeError. Extracted capabilities retain their
  original receiver after name rebinding.
- Native-lookup verification started with five failing compiled-program cases.
  All 3,683 tests in 262 files pass, with scoped lint, source typecheck and
  selected workspace build. A 231-outcome CPython audit covers the implemented member families,
  readonly mutation exclusions and host-field rejection across seven receiver
  kinds. Full type-descriptor registration, inherited members, native method
  introspection, remaining container methods, builtin constructors, suspension,
  full resource accounting and SDK/safe-fs integration remain pending.
- Connected native set-display construction to expression contexts with a key
  policy. Compiled modules and nested function bodies now construct sets and
  starred unpackings without a custom builder. Explicit builders still take
  precedence, and contexts without a key policy must supply their construction
  capabilities. Native sets share the execution's dictionary hash/equality
  policy and resource meter.
- Set-display integration began with two failing compiled-program tests. All
  3,686 tests in 262 files pass, with scoped lint, source typecheck and selected
  workspace build. An 800-program CPython audit matches results, evaluation traces and
  failures, including small/large display evaluation timing, duplicate keys,
  dictionary unpacking and unhashable elements. An interrupted unpacking leaves
  later iterator elements unconsumed and does not publish its partial result.
  The 1,300-module closure/decorator/failure-cleanup regression audit also passes.
  Public constructors, full native descriptors/introspection, comprehension
  runtime integration, suspension, accounting and SDK/safe-fs remain pending.
- Connected nine native list methods to default attribute lookup: append,
  extend, insert, pop, clear, reverse, copy, count and remove. Methods validate
  arguments before mutation and use owned storage for bounded operations.
  Self-extension duplicates the original slots once; generic extension streams
  values, keeps earlier additions on failure and checks cancellation after each
  pull. Copy duplicates slots but preserves member identity. Insert/pop perform
  signed index conversion before touching storage, including empty-pop cases.
- List-method verification began with fourteen failing behavior tests. All
  3,701 tests in 263 files pass, with scoped lint, source typecheck and selected
  workspace build. A 2,400-call compiled-program CPython audit matches returned
  values, errors and receiver state across all nine methods, arity/keyword
  failures, nested members, self-extension and index overflow. Compiled-function
  tests exercise default method lookup; storage tests verify shallow identity,
  partial iterator failure and cancellation before adding a pulled element.
  The 800-program set-display execution regression audit also passes.
  List index/sort binding, guest index slots and length hints, native descriptors,
  finalizers, remaining builtins, suspension, accounting and SDK/safe-fs remain
  unfinished.
- Connected list.index to native lookup with positional value/start/stop binding.
  Both search bounds are converted before searching, including empty lists and
  excluded ranges. Arbitrarily large bounds saturate to the signed index width
  instead of raising insert/pop overflow errors. Native list search preserves
  identity shortcuts, structural equality, first-match positions and the Python
  3.14 fixed missing-value error without invoking representation callbacks.
- List-index verification began with seven failing tests. All 3,708 tests in
  263 files pass, with scoped lint, source typecheck and selected workspace build. A
  2,224-call compiled-program CPython audit matches results and errors across
  omitted/negative/huge/invalid bounds, nested lists and argument failures; the
  existing 2,400-call list-method regression audit passes. Unit coverage includes
  identical NaN lookup and bool/int equality. List sort binding, guest index
  slots, native descriptors/introspection, remaining builtins, suspension, full
  resource accounting and SDK/safe-fs integration remain pending.
- Connected list.sort to default native lookup and the frame's existing call
  capability. Guest key functions retain normal closure ownership, call binding
  and depth policy. Sort validates keyword-only key/reverse options, performs
  reverse truth conversion before hiding list contents, and skips key invocation
  for an empty list. The storage lifecycle restores contents after failures,
  discards temporary additions and reports mutation during key evaluation.
  Capability cancellation is checked before publishing a key result.
- Sort binding started with eight failing compiled-program tests. All 3,717
  tests in 263 files pass, with scoped lint, source typecheck and selected workspace build.
  A 1,800-program CPython audit matches returned values, stable ordering,
  original-order key traces, temporary-empty observations, key failures,
  argument errors and mutation state. A separate cancellation test verifies one
  key invocation and no subsequent result publication. The 2,400-call list-method
  regression audit passes. The existing sort kernel still differs from CPython's
  exact comparison scheduling and partial
  permutation on comparison failure; inconsistent comparators and NaN ordering
  require further parity work. Full descriptors, guest ordering/truth slots,
  remaining builtins, suspension, accounting and SDK/safe-fs remain unfinished.
- Connected tuple.count and tuple.index to native attribute lookup. Both scan
  immutable tuple slots directly, preserve identical-object matches (including
  NaN) and compare mutable members structurally. Index normalizes negative and
  oversized bounds after validation; list and tuple methods now share exact
  signed-width search-bound conversion without accepting explicit None.
- Tuple-method verification began with seven failing tests. All 3,724 tests in
  264 files pass, with scoped lint, source typecheck and selected workspace build. A
  2,264-call compiled-program CPython audit matches tuple search results, bounds
  and argument errors. The 2,224-call list-index regression audit passes after
  extracting common conversion logic. Tests cover bool/int equality, nested
  mutable members, NaN identity and keyword/arity rejection. Native type
  descriptors, guest index/equality slots, remaining builtin methods,
  comprehension/suspension integration, accounting and SDK/safe-fs remain
  unfinished.
- Connected range start/stop/step reads and count/index methods to native
  attribute lookup. Exact integer/bool searches use progression arithmetic and
  return arbitrary-precision indices without iteration or machine-length
  conversion. Other values use metered equality iteration, preserving the
  separate generic missing-index error and exhaustive count behavior. Search
  counters retain native signed-size overflow checks on their iterative paths.
- Range-member verification began with six failing tests. All 3,730 tests in
  265 files pass, with scoped lint, source typecheck and selected workspace build. A
  1,600-program CPython audit matches range member values, integer/float/complex
  searches and argument errors. The 231-outcome native-lookup regression audit
  passes. Tests prove huge integer lookup completes within
  a small step budget while a huge generic count terminates at its execution
  limit. Reverse-method binding, native member-object identity, descriptors,
  guest equality slots, remaining builtins, suspension, complete accounting and
  SDK/safe-fs integration remain unfinished.
- Connected list/range __reversed__ methods to native lookup with zero-argument
  validation. List cursors retain live slots and capture their initial reverse
  position; exhausted cursors do not resume after growth. Range cursors remain
  lazy over arbitrary-precision lengths. Forward range traversal, reversed()
  and direct range.__reversed__ now share one metered guest-integer adapter.
- Reverse-binding verification began with four failing tests. A test identity
  assertion initially consumed live cursors through Vitest's diagnostic deep
  comparison; inspecting the matcher confirmed this, and a boolean identity
  assertion preserves the cursors. Direct reverse-method and reversed-builtin
  CPython audits each pass 1,800 cases / 21,600 next outcomes; the forward
  range/list regression passes 1,000 cases / 10,000 mutation-sensitive results.
  All 3,734 tests in 265 files pass, with scoped lint, source typecheck and selected workspace
  build; the range cursor remains constant-space even beyond machine-sized lengths.
  Native iterator types/introspection, pickle/state restoration, range member
  identity, full resource accounting, remaining builtins and SDK/safe-fs remain
  pending.
- Connected str.find/rfind/index/rindex/count to native attribute lookup and the
  metered Unicode code-point search engine. The binding validates needle type
  before bounds, accepts None only for text-search bounds, saturates huge bounds
  and preserves empty-needle/start-beyond-end behavior. Count remains
  nonoverlapping; indexing does not reinterpret astral characters or lone
  surrogates as UTF-16 positions. List/tuple search bounds remain None-rejecting.
- String-search verification began with nine failing tests. A CPython audit
  caught the special invalid-None needle diagnostic, reproduced by an exact
  message test before correction. The 2,440-call compiled-program audit now
  matches code-point results, bounds and errors, and the 2,264-call tuple-search
  regression passes. All 3,743 tests in 266 files pass, with scoped lint, source typecheck
  and selected workspace build. Other string methods, native descriptors, guest index
  slots, remaining builtins, suspension, accounting and SDK/safe-fs remain
  unfinished.
- Connected str.startswith/endswith with individual and tuple candidates.
  Bounds are validated before candidate inspection; tuple validation stops at
  the first successful match and reports invalid members only when reached.
  The code-point boundary matcher handles empty candidates and out-of-range
  starts without slicing or scanning unrelated text. First/last-point checks
  reject mismatches before traversing an affix's interior.
- Affix verification began with six failing tests, including a zero-allocation,
  small-step-budget check against a long receiver. All 3,749 tests in 268 files
  pass, with scoped lint, source typecheck and selected workspace build. A 1,936-call compiled
  CPython audit matches Unicode results, tuple short-circuiting, bounds and
  errors; the 2,440-call string-search regression also passes. Additional string
  methods, native descriptors, guest index slots, remaining builtins,
  comprehension/suspension integration, accounting and SDK/safe-fs are pending.
- Connected str.removeprefix/removesuffix/partition/rpartition to native lookup.
  Boundary removal uses direct affix matching and retains the exact receiver
  when unchanged. Partitioning finds the first/last separator, preserves the
  supplied separator object and places the original receiver on the appropriate
  side when absent. Empty separators fail; empty removal arguments are no-ops.
  Returned slices retain code-point semantics, including lone surrogates.
- Cut-method verification began with eight failing tests. All 3,757 tests in
  269 files pass, with scoped lint, source typecheck and selected workspace build. Tests
  inspect returned code points directly, verify receiver/separator identity and
  preserve the distinct None diagnostics. A 1,244-call compiled-program CPython
  audit matches code points, receiver identity and errors. The prefix/suffix regression audit
  passes 1,936 compiled calls. Remaining text methods, global string interning,
  native descriptors, guest object slots, remaining builtins, suspension,
  accounting and SDK/safe-fs remain unfinished.
- Connected str.join to native lookup. Generic iterables are fully materialized
  before member validation, preserving later iterator failure precedence over
  an invalid earlier element. Acquisition-only TypeErrors become the native
  noniterable diagnostic; errors from next remain intact. Singleton exact
  strings retain identity. A storage pre-pass computes final size and fills one
  owned code-point buffer, avoiding repeated concatenation and surrogate merging.
- Join verification began with six failing method tests. All 3,767 tests in
  271 files pass, with scoped lint, source typecheck and selected workspace
  build. The 1,244-call removal/partition regression also passes. A 1,200-call compiled
  CPython audit matches code points, iterable forms and errors. Tests cover
  full consumption on bad elements, iterator failure precedence, cancellation
  after next, singleton identity and exact output-buffer allocation with linear
  work. Guest length hints, string subclasses/interning, remaining string
  methods and builtins, suspension, full accounting and SDK/safe-fs remain
  unfinished.
- Connected str.strip/lstrip/rstrip to native lookup. Default/None arguments
  use Python Unicode whitespace rather than host trim rules; explicit chars
  are indexed once as a metered code-point set. Boundary scans avoid touching
  unchanged interiors, preserve exact receiver identity and make one final
  slice only when changed. Lone surrogates remain intact.
- Strip verification began with seven failing tests. All 3,777 tests in 273
  files pass, including bounded-work and unique-set-allocation checks, with
  scoped lint, source typecheck and selected workspace build. A
  1,818-call compiled CPython audit matches results, identity and diagnostics;
  exhaustive classification agrees for all 1,114,112 Unicode code points.
  Remaining native string methods, subclasses/interning, object protocols,
  builtins, suspension, full accounting and SDK/safe-fs remain unfinished.
- Connected str.splitlines to native lookup. The linear code-point scanner
  recognizes all Python line boundaries, consumes CRLF together, retains
  optional terminators and avoids a spurious trailing empty line. It builds
  owned list slots directly and retains the exact receiver when one unchanged
  line is returned. keepends uses runtime truth conversion, including empty
  input, and accepts its native keyword spelling.
- Splitlines verification began with six failing tests. A 2,104-call compiled
  CPython audit caught and reproduced the keyword-only excess-argument
  diagnostic before correction; all audited code points, identities and errors
  now agree. All 3,785 tests in 274 files pass, including scan-budget termination
  and linear-work/output-allocation checks, with scoped lint, source typecheck
  and selected workspace build. The 1,818-call strip regression
  also passes. Guest truth slots, native descriptors/subclasses, remaining text
  methods and builtins, suspension, full accounting and SDK/safe-fs are pending.
- Connected str.split/rsplit to native lookup. Explicit separators retain
  empty fields and select nonoverlapping matches from the requested end;
  whitespace splitting coalesces Python whitespace and preserves the correct
  untouched remainder at maxsplit. Options accept positional/keyword forms,
  validate maxsplit before separator type, and enforce signed-size limits.
- Added a directional, lazy substring matcher that builds one prefix table
  per scan, shares prefix construction with existing search, and indexes
  backwards without reversing/copying input. String storage emits pieces in
  traversal order; owned list storage restores forward order for rsplit.
- Split verification began with nine failing tests. A 3,038-call compiled
  CPython audit reproduced and corrected zero-limit whitespace-copy identity
  and NotImplemented diagnostics; all audited results/identities/errors match.
  All 3,803 tests in 276 files pass, including repetitive-prefix work bounds,
  one-table allocation, early reverse termination and zero-limit no-search
  checks, with scoped lint, source typecheck and selected workspace build.
  The 2,440-call existing search regression passes. Global string
  interning, guest index slots, remaining text methods/builtins, suspension,
  full accounting and SDK/safe-fs remain unfinished.
- Connected str.replace to native lookup, including positional-only old/new,
  the count keyword, signed-size count validation, empty-pattern insertion,
  leftmost nonoverlapping matches and no rescanning of replacement text.
  The storage kernel counts selected matches then fills one exact output
  buffer in a second bounded scan, without retaining all match positions.
- Replacement verification began with seven failing tests. All 3,814 tests
  in 278 files pass, with scoped lint, source typecheck and selected workspace
  build. The 3,038-call split regression also passes. Unit checks cover
  exact same-object no-ops versus distinct equal replacement strings, Unicode
  code points, one output-buffer allocation and linear work. A 2,616-call
  compiled CPython audit passes with explicit aliasing for equal old/new text.
  The separate literal-based audit exposes an unresolved compiler constant
  pooling gap: repeated equal literals can be distinct runtime objects, changing
  replacement identity. That strict audit is not a pass and must be rerun after
  literal pooling/interner work. Guest index slots, subclasses, remaining text
  methods/builtins, suspension, full accounting and SDK/safe-fs remain pending.
- Added per-compilation scalar literal pooling with type-separated keys and
  code-point-safe string/byte keys. Repeated literal nodes share immutable
  values across activations, nested functions/defaults/lambdas and repeated
  module execution. Function code carries its originating pool across program
  boundaries; standalone code without a pool retains its unpooled adapter path.
  Runtime-created strings are not implicitly interned. Traversal excludes
  consumed docstrings and the parser's discarded annotation expressions.
- Literal-pool verification began with five failing compiled identity tests;
  a sixth regression reproduced accidental caller-pool use by standalone code.
  All 3,828 tests in 279 files pass, with scoped lint, source typecheck and
  selected workspace build.
  The previously failing strict 2,616-call replacement audit now passes without
  explicit-alias substitutions. Another 1,200 compiled pooling programs and
  1,500 cross-program function-factory regressions match CPython. The 1,300-case
  assembled-runtime regression also passes. Tests cover
  type distinctions, separate compilations, undefined guest values, immutable
  parser-buffer copies and preallocation budget checks. Compound constant
  folding, metadata/docstring pooling, global interning, remaining native
  methods/builtins, suspension, full accounting and SDK/safe-fs remain pending.
- Connected str.center/ljust/rjust/zfill to native lookup. Widths count code
  points; fill validation precedes unchanged-output shortcuts. Center uses
  Python's odd-padding parity rule, and zfill preserves only an ASCII leading
  sign. One final buffer holds padding and source points, retaining lone
  surrogates. Oversized output fails through the execution budget.
- Consolidated exact signed-size conversion for padding, split and replacement;
  search-bound saturation remains a different operation. Padding began with
  13 failing method tests. All 3,851 tests in 281 files pass, including exact
  one-buffer allocation, linear-work, budget termination and invalid-code-point
  kernel checks. A 2,460-call compiled padding audit matches CPython; split
  (3,038 calls) and strict replacement (2,616 calls) regressions also pass.
  Scoped lint, source typecheck and selected workspace build pass. Guest index slots,
  subclasses/global interning, remaining native methods/builtins, suspension,
  complete accounting and SDK/safe-fs remain unfinished.
- Connected str.expandtabs to native lookup with default/keyword tabsize,
  signed 32-bit C-int validation, zero/negative removal and exact unchanged
  receiver identity. Only CR/LF reset columns; every other non-tab code point
  occupies one column regardless of display width. A sizing pass precedes one
  output-buffer allocation, with checkpoints inside expanded space runs.
- Extracted exact integer index conversion from signed-size narrowing so C-int
  and signed-size callers share type diagnostics without sharing overflow rules.
  Tab expansion began with eight failing tests. All 3,866 tests in 283 files
  pass, including exact output allocation, linear-work, early allocation failure
  and in-expansion step-limit tests. A 2,413-call compiled CPython audit matches
  code points, receiver identity and diagnostics. The 2,460-call padding
  regression, scoped lint, source typecheck and selected workspace build also pass.
  Guest index slots, native
  subclasses/global interning, remaining text methods/builtins, suspension,
  full accounting and SDK/safe-fs remain pending.
- Connected str.isascii/isspace/isidentifier to native lookup with no-argument
  validation, empty-string distinctions, short-circuit scans and no copied
  string storage. Identifier checks reuse Unicode 16 parser tables without
  keyword rejection or normalization; whitespace reuses the stripping predicate.
- Classification began with nine failing tests. The full Unicode audit confirms
  identifier-start, identifier-continue and whitespace behavior for all 1,114,112
  code points. A new test's outdated join-control assumption was corrected
  against CPython 3.14 (continuation allowed, initial position rejected), with
  no change to the existing matching tables. All 3,875 tests in 284 files pass,
  including early-exit and scan-budget checks; 2,412 compiled classification
  calls match CPython results and diagnostics. The 1,818-call strip regression,
  scoped lint, source typecheck and selected workspace build pass. Remaining Unicode classification
  and case mappings, other native methods/builtins, subclasses/global interning,
  suspension, full accounting and SDK/safe-fs remain unfinished.
- Connected str.isalpha/isdecimal/isdigit/isnumeric/isalnum/isprintable using
  1,800 generated Unicode 16 category/numeric intervals. The hash-pinned
  DerivedNumericType input includes Unihan numeric values; category ranges
  distinguish letters from broader alphabetic properties and printable ASCII
  space from other separators. Binary lookup is metered without per-call storage.
- This increment began with failing method and missing-generator tests. All
  3,900 tests in 286 files pass, including malformed generator ranges, generated
  interval invariants, empty strings, invalid code points and lookup budgets.
  All 1,114,112 code points match CPython across the six predicates, and 3,624
  compiled calls match results and errors. Scoped lint, source typecheck and selected
  workspace build pass. Unicode case mappings, other native methods/builtins,
  subclasses/global interning, suspension, full accounting and SDK/safe-fs
  remain unfinished.
- Connected str.islower/isupper/istitle using pinned Unicode 16 derived
  Lowercase/Uppercase properties and the Lt category. Empty or entirely uncased
  strings return false; titlecase scans track cased runs, resetting at uncased
  marks/digits/punctuation rather than applying linguistic word segmentation.
  No host case conversion or per-scan string copy is used.
- Eight method tests and one generator test first reproduced the missing
  behavior. Exhaustive checks match CPython for all 1,114,112 individual code
  points and 3,612 compiled method calls, including argument diagnostics.
  All 3,913 tests in 286 files, scoped lint, source typecheck and the selected
  workspace build pass. Added generated case-interval invariants, malformed
  range rejection and cased/uncased scan-budget tests. Unicode case transformations, other native
  methods/builtins, subclasses/global interning, suspension, full accounting
  and SDK/safe-fs remain unfinished.
- Connected str.upper/casefold with 3,109 full Unicode 16 mappings from
  hash-pinned UnicodeData, SpecialCasing and CaseFolding inputs. Full mappings
  override simple uppercase values; folding uses common/full rather than
  simple-only or locale-specific Turkic rows. Transformation preflights size
  before one output buffer and preserves individual surrogate code points.
  Only empty receivers retain guest identity, including unchanged nonempty text.
- Six native method tests and four storage tests first failed for missing
  behavior; generator tests first failed for the absent compiler. All 3,926
  tests in 289 files pass, including exact allocation and both-pass execution
  budgets. Every one of 1,114,112 code points matches CPython for both methods;
  3,608 compiled calls match output, receiver identity and argument errors.
  Scoped lint, source typecheck and selected workspace build pass.
  Contextual lowercase/title/capitalize/swapcase, remaining native methods and
  builtins, subclasses/global interning, suspension, full accounting and
  SDK/safe-fs remain unfinished.
- Connected str.lower with 1,460 full default lowercase mappings and generated
  Unicode 16 Cased/Case_Ignorable intervals. Contextual Greek final sigma reads
  the original storage, skipping case-ignorable points before cased checks even
  when both properties hold. Sigma is not ignorable, so neighboring context
  scans revisit only their intervening runs and total work remains linear.
- Six method/generator tests and two storage tests first reproduced missing
  lowercase/context behavior. All 3,934 tests in 289 files pass, including
  exact expanded allocation, long-run work bounds and context-scan budgets.
  Every one of 1,114,112 code points matches CPython in isolation and in four
  sigma contexts (4,456,448 contextual transformations); 3,604 compiled calls
  match output, identity and errors. The 3,608-call upper/casefold regression,
  scoped lint, source typecheck and selected workspace build pass.
  Title/capitalize/swapcase, remaining native
  methods/builtins, subclasses/global interning, suspension, full accounting
  and SDK/safe-fs remain unfinished.
- Connected str.title/capitalize/swapcase with 1,479 full Unicode 16 title
  mappings. Title follows original cased runs, capitalize titlecases only the
  first code point, and swapcase distinguishes upper/lower from titlecase-only
  characters. Both sizing and output passes share mapping selection; contextual
  sigma still reads original storage and all output uses one exact-size buffer.
- Eighteen method/generator tests and three storage tests first failed for
  missing behavior. All 3,955 tests in 289 files pass, including expanded title
  allocation, uncased boundaries and sigma cases. Each method matches CPython
  for all 1,114,112 individual code points and four sigma contexts apiece
  (13,369,344 contextual transformations total); 3,612 compiled calls match
  output, receiver identity and errors. The 3,608-call upper/casefold and
  3,604-call lowercase regressions pass. Scoped lint, source typecheck and the
  selected workspace build pass. Remaining text/bytes/numeric methods, native
  builtins, subclasses/global interning, suspension, full accounting and
  SDK/safe-fs remain unfinished.
- Connected bytes.upper/lower/title/capitalize/swapcase using ASCII-only
  transformation of immutable byte storage. Output has exactly the input length,
  is charged before its single allocation, and never changes non-ASCII bytes.
  Nonletters (including bytes above 127) break title words; empty bytes retain
  receiver identity while unchanged nonempty results are separate guest objects.
- Native/storage tests reproduced the missing methods. Three new fixtures were
  corrected to supply required explicit budgets. All 3,978 tests in 291 files
  pass, including allocation refusal, per-byte execution limits and immutable
  output exports. All 65,536 byte pairs match CPython across five methods
  (327,680 transformations); 4,305 compiled calls match output, identity and
  diagnostics. Scoped lint, source typecheck and selected workspace build pass.
  Remaining bytes/text/numeric methods, native builtins, subclasses/global
  interning, suspension, full accounting and SDK/safe-fs remain unfinished.
- Connected bytes.isascii/isspace/isalpha/isalnum/isdigit/islower/isupper/istitle
  with short-circuit scans over immutable storage and no copied buffers. Only
  isascii accepts empty input. Whitespace is the six ASCII space bytes; case
  checks ignore nonletters but require a cased ASCII byte, and nonletters reset
  title state. Unicode-only predicates remain unavailable on bytes.
- Eighteen new tests failed before the methods were connected. All 3,998 tests
  in 292 files pass, including short-circuit allocation and long uncased scan
  budgets. Every byte pair matches CPython across all eight native predicates
  (524,288 calls), and 5,088 compiled calls match results and errors. The
  4,305-call bytes-casing regression, scoped lint, source typecheck and selected
  workspace build pass. Remaining bytes/text/numeric methods, native builtins,
  subclasses/global interning, suspension, full accounting and SDK/safe-fs
  remain unfinished.
- Connected bytes.find/rfind/index/rindex/count with byte-string and integer
  needles, saturating/None slice bounds, empty-pattern boundary semantics and
  nonoverlapping counts. Bounds are validated before the needle, matching bytes
  rather than str call ordering. Invalid integers and missing index results use
  the bytes-specific diagnostics. Integer needles scan without temporary
  allocation; byte-string searches reuse the bounded linear substring kernel.
- Fourteen native/storage tests first failed for missing searches. All 4,012
  tests in 294 files pass, including repetitive-pattern work bounds, prefix-table
  allocation, impossible windows and integer scan budgets. A 6,350-call compiled
  CPython audit matches results, bounds and diagnostics; the 2,440-call string
  search regression, scoped lint, source typecheck and selected workspace build
  pass. Guest index/buffer protocols, remaining bytes/text/numeric methods,
  native builtins, subclasses/global interning, suspension, full accounting and
  SDK/safe-fs remain unfinished.
- Connected bytes.startswith/endswith with bounded unsigned-byte comparisons,
  empty-affix semantics and lazy tuple alternatives. Bound conversion precedes
  candidate inspection; a match suppresses later invalid tuple members, whose
  diagnostics otherwise differ from an invalid top-level argument. Storage
  compares only the requested edge, checks first/last bytes before interiors,
  and allocates no slices or temporary buffers.
- Eight native/storage tests first failed for missing affix support. All 4,020
  tests in 296 files pass, including early mismatch and interior scan budgets.
  A 3,624-call compiled CPython audit matches bounds, tuple short-circuiting,
  results and diagnostics; the 1,936-call string-affix regression, scoped lint,
  source typecheck and selected workspace build pass. Guest buffer/index protocols, remaining
  bytes/text/numeric methods, native builtins, subclasses/global interning,
  suspension, full accounting and SDK/safe-fs remain unfinished.
- Connected bytes.removeprefix/removesuffix/partition/rpartition through existing
  immutable byte boundary/search/slice operations. Unchanged removal retains the
  receiver; partition retains the supplied separator, shares empty sides of a
  full match, and retains the empty receiver in all three absent-match slots.
  Empty partition separators and non-byte arguments use bytes diagnostics.
- Twelve tests first failed for missing methods. All 4,032 tests in 297 files
  pass. A 3,244-call compiled CPython audit matches values, receiver/separator
  identities and errors; the 1,244-call string-cut regression, scoped lint,
  source typecheck and selected workspace build pass. This does
  not establish global empty/one-byte caching: for example, CPython reuses the
  one-byte separator as the right slice in b'aa'.partition(b'a'), while current
  byte factories/slices still create separate records. Address cache-aware
  literal/result construction without incorrectly caching case-transform
  results, which must remain fresh even for one byte. Guest buffer protocols,
  remaining bytes/text/numeric methods, native builtins, suspension, full
  accounting and SDK/safe-fs also remain unfinished.
- Added a runtime-scoped lazy cache for the 257 empty/one-byte values, with an
  explicit fresh-result identity policy. Cache map/entry storage is charged
  before publication and hits allocate no records. Independent parsed literals,
  contiguous partial slices and partition/removal sides now share canonical
  values; nonempty casing and one-byte strided slices remain fresh. Full
  unit-stride nonempty slices retain their receiver, including fresh receivers.
- Six new tests first reproduced the cache gap. The initial differential audit
  then exposed CPython's fresh zero-repeat empty bytes, reproduced in another
  failing unit test. Repetition now preserves that distinction; empty slices
  and casing canonicalize, unchanged removals retain the fresh receiver, and
  missing partitions retain only its appropriate side. All 4,040 tests in 298
  files pass. A 6,461-case compiled audit matches CPython byte values and identity
  across all 256 bytes, fresh/canonical construction, slicing, repetition,
  concatenation, casing, removal and partitioning. The stricter 3,244-call
  partition-side identity audit, 4,305 casing calls, 1,200 literal-pooling
  programs, scoped lint, source typecheck and selected workspace build pass.
  String/integer interning,
  compound constant folding, future bytes constructors/methods and buffer
  protocols, full accounting, suspension and SDK/safe-fs remain unfinished.
- Connected bytes.join using existing iterator collection and an exact-size
  immutable byte join kernel. Generic iterables are exhausted before member
  validation, preserving next-error precedence and immediate post-next
  cancellation. Validated parts are copied into one output buffer after size
  checks. A singleton bytes member retains identity, including a fresh empty;
  multi-item nonempty results stay fresh and empty output is canonical.
- Twelve native/storage tests first failed for missing join support. All 4,052
  tests in 300 files pass, including exact allocation, immutable exports,
  generic iteration errors and copy-loop budgets. A 5,304-call compiled CPython
  audit matches values, identity, container forms and errors; the 1,200-call
  string-join regression, scoped lint, source typecheck and selected workspace
  build pass. Guest buffer protocols,
  length hints, remaining bytes/text/numeric methods and native builtins,
  string/integer interning, suspension, full accounting and SDK/safe-fs remain
  unfinished.
- Connected bytes.strip/lstrip/rstrip with the six ASCII whitespace bytes or
  a custom byte set indexed once in a fixed 256-byte table. Scans visit only
  relevant boundaries before one final slice; empty custom sets and unchanged
  results retain the receiver, including fresh empty/one-byte objects. Changed
  small results use canonical byte construction. Shared ASCII whitespace also
  backs bytes.isspace without changing Unicode string whitespace behavior.
- Fourteen native/storage tests first failed for missing methods. All 4,066
  tests in 302 files pass, including bounded custom-set memory, edge-scan work
  limits and unchanged-interior shortcuts. A 6,084-call compiled CPython audit
  matches byte values, identity and diagnostics. The 1,818-call string-strip
  regression, exhaustive 524,288-call bytes-classification regression, scoped
  lint, source typecheck and selected workspace build pass. Buffer protocols,
  remaining bytes/text/numeric methods and native builtins, string/integer
  interning, suspension, full accounting and SDK/safe-fs remain unfinished.
- Connected bytes.splitlines through the existing text method's shared argument
  handling and metered scan. Bytes recognize CR/LF/CRLF only; text retains its
  additional Unicode boundaries. Unsplit nonempty receivers retain identity,
  partial byte lines use canonical construction, and terminal boundaries do
  not append an extra empty line.
- Six native tests reproduce missing bytes support and now pass. All 4,072
  tests in 303 files pass. A 4,716-call compiled CPython audit matches byte
  values, receiver identity and diagnostics; the 2,104-call string splitlines
  regression, scoped lint, source typecheck and selected workspace build also
  pass. Remaining bytes/text/numeric methods, buffer
  protocols, native builtins, suspension, full accounting and SDK/safe-fs
  integration remain unfinished.
- Connected bytes.expandtabs with shared text/byte argument validation and an
  exact-size immutable byte buffer. Only CR/LF reset tab columns; every other
  byte counts once. Nonpositive sizes remove tabs. Bytes produce fresh nonempty
  results even without tabs, unlike strings, and canonical empty results.
- Seven native tests first failed for missing support; two additional storage
  checks cover exact allocation, immutable exports, output-fill checkpoints and
  unrepresentable lengths. All 4,081 tests in 304 files pass. A 5,498-call
  compiled CPython audit matches byte values, identity and diagnostics; the
  2,413-call string-expandtabs regression, exhaustive 262,144 byte-pair
  transformations, source typecheck, scoped lint and selected workspace build
  pass. Remaining methods, buffer protocols, native
  builtins, suspension, full accounting and SDK/safe-fs remain unfinished.
- Connected bytes.center/ljust/rjust/zfill with shared text/byte call validation
  and one exact-size owned byte buffer. Centering uses Python's odd-padding
  placement; zfill moves zeros after an initial ASCII sign only. Unchanged
  receivers retain identity, including fresh empty bytes; padded outputs stay
  fresh, including one-byte results. Fill validation precedes no-op shortcuts.
- Six native tests first reproduced missing methods. Added exact allocation,
  immutable export, no-allocation shortcut and byte-domain checks. The compiled
  audit exposed the bytes-only None fill diagnostic, which now has an exact
  regression. A total of 8,376 compiled calls, 2,460 string regression calls and
  196,608 exhaustive source/fill-byte transformations match CPython. All 4,088
  tests in 305 files, scoped lint, source typecheck and selected workspace build
  pass. Remaining
  methods, buffer protocols, native builtins, suspension, full accounting and
  SDK/safe-fs remain unfinished.
- Connected bytes.replace with metered nonoverlapping KMP scans and one final
  byte buffer. Empty patterns insert at boundaries, count limits bound matches,
  and zero counts/no matches retain the receiver. Equal nonempty replacements
  still produce fresh bytes, unlike the string identity shortcut. Changed
  empty results are canonical; byte calls reject count keywords.
- Eight native/storage tests first failed for missing support. All 4,096 tests
  in 306 files pass, including precise search/output allocation, immutable
  exports, repetitive-search checkpoints and expansion limits. A 6,097-call
  compiled CPython audit matches byte values, identity and errors; 33,075
  exhaustive binary-pattern replacements and the 2,616-call string replacement
  regression, scoped lint, source typecheck and selected workspace build also
  pass. Remaining methods, buffer protocols, native builtins,
  suspension, full accounting and SDK/safe-fs remain unfinished.
- Connected bytes.split/rsplit with shared text/byte argument binding, metered
  directional KMP scans for explicit separators and ASCII-only whitespace
  scanning. Results preserve forward order after reverse scans. Unsplit byte
  receivers retain identity; zero-limit whitespace remainders copy and partial
  empty/single-byte results use canonical construction.
- Eight native tests first reproduced missing support. All 4,104 tests in 307
  files pass, covering reverse overlaps, whitespace remainders, keyword errors,
  maxsplit validation precedence and scan budgets. A 6,880-call compiled CPython
  audit matches byte values, receiver/cache identity and diagnostics; 19,050
  exhaustive short-pattern splits, 3,038 string regression calls, scoped lint,
  source typecheck and selected workspace build pass. Remaining methods,
  buffer protocols, native builtins, suspension, full accounting and SDK/safe-fs
  remain unfinished.
- Connected bytes.translate with positional table validation, optional delete
  keyword, original-byte deletion before mapping and a fixed 256-byte deletion
  lookup. A sizing scan detects unchanged results before one exact output
  allocation. Unchanged receivers retain identity, including fresh empty bytes;
  changed nonempty results are fresh and changed empty results canonical.
- Seven native/storage tests first reproduced missing support. All 4,111 tests
  in 308 files pass, including full byte mappings, validation precedence,
  duplicate deletion entries, bounded lookup storage, immutable exports and
  scan budgets. A 3,441-call compiled CPython audit and 262,144 exhaustive
  byte-pair translations match values, identity and diagnostics. Scoped lint,
  source typecheck and selected workspace build pass. Remaining
  methods, buffer protocols, native builtins, suspension, full accounting and
  SDK/safe-fs remain unfinished.
- Added a receiver-independent bytes.maketrans callable and immutable table
  constructor. The operation initializes one identity table, applies ordered
  overrides with last duplicate winning, validates equal lengths and returns
  a fresh 256-byte table. Existing instance attribute lookup exposes it;
  native type-level registration remains part of unfinished builtin work.
- Seven native/storage tests first reproduced missing support. All 4,118 tests
  in 309 files pass, including full-domain maps, duplicate overrides, ignored
  receiver, exact allocation, immutable exports and mapping-loop budgets.
  A 2,409-program compiled CPython audit checks table contents and translation
  integration; the 3,441-call translation regression, scoped lint, source
  typecheck and selected workspace build pass. Remaining methods, buffer
  protocols, native builtins, suspension, full accounting and SDK/safe-fs remain
  unfinished.
- Connected bytes.hex with ASCII str/bytes separators, positive right-grouping,
  negative left-grouping and zero-group suppression. Output goes directly into
  one exact-size code-point buffer. Validation preserves C-int group bounds,
  length-before-type separator errors and keyword duplication checks. Extracted
  exact-value length lookup from len for reuse without invoking a guest builtin.
- Seven native/storage tests first reproduced missing support. All 4,125 tests
  in 310 files pass, including all byte digits, grouping edges, validation order,
  allocation and loop budgets. A 3,621-call compiled CPython hex audit, 327,680
  exhaustive byte-pair conversions and the 1,800-call len regression pass.
  Scoped lint, source typecheck and selected workspace build also pass.
  String interning, remaining methods, buffer protocols, native builtins,
  suspension, full accounting and SDK/safe-fs remain unfinished.
- Added exact bytes.fromhex decoding for str and bytes inputs, accessible via
  instance lookup. Text first checks for non-ASCII code points, while bytes
  parse directly; both preserve Python 3.14 odd-digit and invalid-position
  errors. ASCII whitespace is allowed only between complete digit pairs.
  Two metered decoder passes size and fill one output buffer; empty/single-byte
  output is canonical. Native type/subclass registration remains unfinished.
- Seven native/storage tests first reproduced missing support. All 4,132 tests
  in 311 files pass, including byte-domain decoding, whitespace, Unicode error
  precedence, identity, exact allocation, immutable exports and work limits.
  A 4,463-call compiled CPython audit, 131,072 exhaustive byte/text-pair result
  and error comparisons, and the 3,621-call hex regression pass. Scoped lint,
  source typecheck and selected workspace build pass. Remaining methods, buffer
  protocols, native builtins, suspension, full accounting and SDK/safe-fs remain
  unfinished.
- Connected int.bit_length/bit_count, including bool receivers and int-specific
  call diagnostics. A shared hexadecimal-digit kernel measures absolute
  magnitudes without repeated whole-BigInt shifts. Population count scans are
  metered; zero avoids conversion. Host BigInt exposes no size metadata, so
  temporary string storage is charged after conversion. Preallocation charging
  and interruption inside that host conversion remain representation-level work.
- Five native tests first reproduced missing support. All 4,137 tests in 312
  files pass, including both signs, nibble boundaries, sparse/dense 10,000-bit
  values, bool result types and temporary-storage/scan limits. A 2,432-program
  compiled CPython audit and 262,146 exhaustive signed integer bit metrics pass.
  Scoped lint, source typecheck and selected workspace build also pass.
  Remaining numeric/text methods, buffer protocols, native builtins, suspension,
  full accounting and SDK/safe-fs remain unfinished.
- Connected int/bool/float.as_integer_ratio through the existing exact binary64
  decoder. Integer numerators retain receiver identity, bool numerators become
  ints, signed zero becomes 0/1, and non-finite values preserve Python errors.
  The decoder now accepts an optional meter for reduction-loop checkpoints,
  bounded decoding storage and result payload charging. Complete host BigInt
  object-overhead accounting remains unfinished.
- Five native tests first reproduced missing methods. All 4,142 tests in 313
  files pass, including subnormal/minimum and maximum floats, exact decimal
  binary ratios, argument precedence, integer identity and reduction budgets.
  A 2,726-program compiled CPython audit compares exact integer outputs and
  20,480 binary64 exponent-boundary cases match ratios/errors. Scoped lint,
  source typecheck and selected workspace build pass. Remaining numeric/text
  methods, buffer protocols, native builtins, suspension, full accounting and
  SDK/safe-fs remain unfinished.
- Connected int/bool/float.is_integer with canonical boolean results. Exact
  ints/bools return true in constant work regardless of magnitude; binary64
  floats require finite integral values, including both signed zeros. Call
  diagnostics use int for bool inheritance and float for floating receivers.
- Three native tests first reproduced missing support; a cancellation check
  already passed at attribute lookup. All four now pass, with all 4,146 tests
  in 314 files passing. A 2,726-program compiled CPython audit matches results,
  canonical bool identity and diagnostics across large integers, arbitrary
  finite float bit patterns and non-finite inputs. Scoped lint, source typecheck
  and selected workspace build pass. Remaining numeric/text
  methods, buffer protocols, native builtins, suspension, full accounting and
  SDK/safe-fs remain unfinished.
- Connected int/bool/float/complex.conjugate. Exact int/float receivers retain
  identity, including non-finite floats; bool returns int. Complex results are
  fresh, preserve the real component and negate only the imaginary component,
  including signed-zero behavior. Call errors preserve inherited int naming.
- Four native tests first reproduced missing support. All 4,150 tests in 315
  files pass, including signed-zero and non-finite component combinations. A
  3,926-program compiled CPython audit matches values, receiver identity and
  diagnostics, comparing finite floating/complex components by binary64 bits.
  Scoped lint, source typecheck and selected workspace build pass.
  Remaining numeric/text methods, buffer protocols, native builtins, suspension,
  full accounting and SDK/safe-fs remain unfinished.
- Added numeric real/imag attributes and int/bool numerator/denominator through
  a dedicated numeric lookup module. Exact int real/numerator and float real
  retain receiver identity; bool components are ints. Float imaginary parts
  are fresh positive zero; complex components are fresh floats preserving
  signed zeros and non-finite values. Unsupported names still use normal errors.
  General small-integer interning remains unfinished, including repeated zero/
  one attribute identity; no attribute-specific cache was introduced.
- Four tests first reproduced missing attributes; absent-name/cancellation
  checks already passed. All 4,155 tests in 316 files pass. A 3,907-program
  compiled CPython audit checks exact values, receiver/fresh-float identity and
  diagnostics; the 3,926-program conjugation regression also passes. Scoped lint,
  source typecheck and selected workspace build pass. Remaining
  numeric/text methods, buffer protocols, native builtins/descriptors, suspension,
  full accounting and SDK/safe-fs remain unfinished.
- Connected float.hex using direct binary64 exponent/fraction extraction, with
  thirteen fractional hexadecimal digits for nonzero finite values. Signed zero
  uses the short zero spelling; subnormals keep exponent -1022; infinities and
  NaNs use Python spellings. Formatting reserves bounded temporary storage and
  avoids decimal conversion/rounding.
- Four native tests first reproduced missing support. All 4,159 tests in 317
  files pass. A 3,614-program compiled CPython audit and 20,480 binary64
  exponent-boundary formatting cases match exact output and call diagnostics.
  Scoped lint, source typecheck and selected workspace build pass.
  Remaining numeric/text methods, string interning, buffer protocols, native
  builtins, suspension, full accounting and SDK/safe-fs remain unfinished.
- Added float.fromhex parsing and instance-accessible exact-float class operation.
  The parser accepts optional prefixes/exponents, ASCII edge whitespace and
  signed non-finite spellings. It keeps at most sixteen leading hexadecimal
  digits plus a sticky discarded tail, saturates exponents beyond possible
  input-length cancellation, and reuses exact ties-to-even ratio rounding.
  Working numeric storage stays bounded for long coefficient/exponent text;
  signed underflow and overflow diagnostics match Python. Native type/subclass
  registration remains unfinished.
- Six parser tests initially failed to load the missing module; two native tests
  then reproduced missing method support. All 4,167 tests in 319 files pass,
  including normal/subnormal ties and a 4,000-digit coefficient under a bounded
  working budget. A 24,160-case CPython parser audit matches exact binary64 bits
  and errors; 2,409 compiled programs match native values, fresh-result identity
  and call errors. Scoped lint, source typecheck and selected workspace build
  pass. Remaining numeric/text methods, native builtins, buffer protocols,
  suspension, full accounting and SDK/safe-fs remain unfinished.
- Connected int/bool.to_bytes with default one-byte big-endian unsigned output,
  keyword-only signed truth conversion, both byte orders and Python validation
  precedence. The immutable writer scans hexadecimal magnitude digits, validates
  signed boundaries and carries two's complement from the low byte into one
  final buffer. Nonempty output stays fresh; zero-length output is canonical.
  BigInt temporary-text charging remains post-conversion pending size metadata.
- Seven native tests first reproduced missing support. All 4,174 tests in 320
  files pass, including zero-length restrictions, negative limits, sign extension,
  call binding and output work/allocation budgets. A 5,131-program compiled
  CPython audit and 49,248 power-boundary conversion cases match byte values,
  output identity and errors. Scoped lint, source typecheck and selected
  workspace build pass. Remaining numeric/text methods, buffer protocols,
  native builtins, suspension, full accounting and SDK/safe-fs remain unfinished.
- Added the immutable byte-to-integer storage decoder for upcoming from_bytes
  integration. It skips redundant sign-extension bytes, forms the remaining
  hexadecimal magnitude once and performs one BigInt parse. Negative input uses
  complemented magnitude -value-1 rather than constructing a large power of two.
  All-zero and all-0xff signed inputs need no temporary magnitude allocation;
  other inputs reserve text/payload storage before conversion. Complete host
  BigInt object-overhead accounting remains unfinished.
- Five storage tests first failed for the missing decoder. All 4,179 tests in
  321 files pass, including endian/sign boundaries, large round trips, unchanged
  input storage, sign-extension fast paths and work/allocation limits. A 269,344
  case CPython audit covers every byte pair in both endian/signed modes plus
  longer inputs with exact integer comparisons. Scoped lint, source typecheck
  and selected workspace build pass. Native iterable-aware from_bytes
  binding is not yet implemented. Remaining native builtins, numeric/text
  methods, buffer protocols, suspension, full accounting and SDK/safe-fs remain
  unfinished.
- Added native integer/bool instance access to from_bytes, with named bytes,
  default big endian, keyword-only signed truth and Python validation order.
  Iterable input is checked one element at a time without consuming or closing
  the remainder on an invalid byte; cancellation is checked after every pull.
  Bool receivers construct canonical boolean results. Immutable storage now
  accepts validated number arrays without silently wrapping invalid elements.
- Seven new tests first reproduced missing support. All 4,186 tests in 322
  files pass; 4,872 compiled CPython comparison programs match exact integers,
  boolean results and errors. Scoped lint, source typecheck and selected
  workspace build pass. The audit
  separately confirmed missing explicit list.__iter__ lookup; that case is not
  counted as passing. Prepared iterator conversion is covered by unit tests.
  Guest __bytes__, buffer and index protocols, class-level native registration,
  explicit iterator slots, full accounting and SDK/safe-fs remain unfinished.
- Added explicit __iter__ bindings for exact builtin sequences, mappings, views,
  sets and prepared iterators, plus iterator __next__. Containers acquire fresh
  cursors; iterators return themselves without advancing. Pulls preserve source
  exceptions, check cancellation before publishing results, and translate host
  exhaustion into the internal StopIteration fault. Existing storage adapters
  retain live mutation, sticky exhaustion and dictionary-size diagnostics.
- Six tests first reproduced missing slots. All 4,194 tests in 323 files pass,
  including mapping-proxy and frozen-set access, argument precedence, cursor
  identity and post-pull cancellation. A 2,675-program compiled CPython audit
  matches values, identity and errors. The expanded 4,875-program from_bytes
  audit now includes the previously failing explicit list iterator case. Source
  typecheck, scoped lint and selected workspace build pass. Full guest exception objects,
  native method-wrapper types/introspection, iterator type registration,
  __length_hint__, guest protocol dispatch and generator return values remain
  unfinished, as do complete resource accounting and SDK/safe-fs integration.
- Added explicitly registerable iter/next builtin capabilities. Exact iterable
  inputs use existing runtime adapters and prepared iterators retain identity.
  next preserves a supplied default's identity, distinguishes non-iterators,
  and handles exhaustion without suppressing unrelated exceptions. Two-argument
  iter reuses CallableIterator with explicit callability/call/equality/exception
  capabilities rather than duplicating cursor logic or discovering host methods.
- Eight new binding tests first failed for the missing builtin module. All
  4,202 tests in 324 files pass; 3,720 compiled CPython programs match values,
  iterator/default identity, lazy sentinel stopping and errors. The established
  sentinel adapter's reentrancy tests remain passing and its code is unchanged.
  Typecheck, scoped lint and selected workspace build pass. One-argument guest
  __iter__/indexed fallback, guest __next__,
  native namespace registration and retained equality-StopIteration payloads
  remain unfinished. The existing host adapter normalizes those equality faults
  to a non-latched done result; this does not establish full exception fidelity.
  Full accounting, suspended execution, object integration and SDK/safe-fs work
  remain outstanding.
- Connected iter/next builtin bindings to optional explicit guest iteration
  protocols. iter returns a validated guest iterator unchanged, without a second
  iter lookup; absent iter alone enables indexed fallback. Extracted the indexed
  cursor from ProtocolIterator so both bindings share retry/sticky-exhaustion
  behavior without duplicated guest lookup. Exact builtin paths remain direct.
  Guest next requires only the next slot, preserves returned values and raised
  exception objects, recognizes configured StopIteration subclasses when given
  a default, and checks cancellation after callbacks/classification.
- Eight new tests first reproduced the missing protocol integration. All 4,210
  tests in 325 files pass; the final binding adjustment also passes all 29 focused
  builtin/protocol tests. A 1,000-scenario CPython audit matches 12,000 guest and
  indexed builtin next observations and callback traces; the corresponding host
  adapter regression audit also matches all 12,000 observations. The 3,720
  compiled builtin regression programs remain passing. Source typecheck, scoped
  lint and selected workspace build pass. Full native registration,
  object-slot wiring into all expression/statement iteration, host-adapted
  StopIteration payloads, suspended execution, full accounting and SDK/safe-fs
  integration remain unfinished.
- Added typed, per-pull completion metadata so host adapters can signal done
  while retaining a classified guest exhaustion object for explicit next and
  __next__ calls. Callable equality faults and guest ProtocolIterator faults now
  preserve identity/payload; callable termination and indexed sequence termination
  still discard payloads as CPython does. Defaults consume exhaustion normally.
  Sentinel exception classification now checks cancellation before returning or
  committing exhaustion. Metadata is not retained in persistent cursor state.
- Three new tests first reproduced payload loss and missed post-classification
  cancellation. All 4,215 tests in 326 files pass. Two 1,000-scenario CPython
  audits match 24,000 explicit next observations, including exception messages,
  retries and source/callback traces. Scoped lint, source typecheck and selected
  workspace build pass. A follow-up CPython probe confirms that map, filter,
  enumerate and non-strict zip must forward source exhaustion payloads; their
  existing host combinators still discard this metadata and need integration.
  Strict zip/map instead discard source exhaustion payloads during mismatch
  checking. Full guest object wiring, builtin registration, suspended execution,
  complete accounting and SDK/safe-fs integration remain outstanding.
- Forwarded source completion records through enumerate, filter, non-strict
  map and non-strict zip without copying them or imposing sticky exhaustion.
  Map callbacks and filter predicate/truth callbacks retain classified guest
  exhaustion objects for explicit next calls. Strict parallel traversal still
  discards source exhaustion payloads during length checks, but does not discard
  mapper callback payloads. Map/filter exception classification now checks
  cancellation before publishing completion metadata.
- Ten new tests first reproduced lost metadata and missed cancellation checks;
  two strict-mode tests confirmed existing mismatch behavior. All 4,227 tests
  in 327 files pass. Four CPython audits match 4,900 scenarios and 58,800 next
  observations, including source/callback payloads, strict mismatch diagnostics,
  retries, input consumption order and enumerate reentrancy. Source typecheck,
  scoped lint and selected workspace build pass. Native constructor bindings
  for these combinators, full guest object wiring/registration, suspended
  execution, complete accounting and SDK/safe-fs integration remain unfinished.
- Added the explicitly registerable enumerate binding with positional/named
  iterable/start arguments, observed Python keyword diagnostic precedence,
  unbounded integer/bool starts and optional guest index conversion. Start is
  converted before eager iterator acquisition. Pair production remains lazy and
  preserves member identity and source completion metadata. runtimeIterate now
  accepts an optional guest protocol for non-builtin inputs, reusing the existing
  ProtocolIterator rather than duplicating slot resolution in the constructor.
- Eight new tests first failed for the missing binding. All 4,235 tests in 328
  files pass; the final pair-factory adjustment also passes all eight focused
  tests. A 3,269-program compiled CPython audit matches enumerate values and
  errors, including very large positive/negative starts and keyword permutations.
  The 3,720-program iter/next regression audit remains passing. Source typecheck,
  scoped lint and selected workspace build pass. Native enumerate
  type registration, subclass construction and tuple reuse remain separate
  work, alongside other combinator bindings, full guest object wiring, suspended
  execution, complete accounting and SDK/safe-fs integration.
- Added the explicitly registerable zip binding, sharing the existing strict
  option validator/suggestions and parallel traversal kernel. A metered adapter
  validates native keyword counts before translating the sole keyword. Strict
  truth conversion precedes eager left-to-right iterator acquisition, including
  zero-input calls; traversal and guest tuple allocation remain lazy. Optional
  guest iteration and truth capabilities preserve callback ownership. Existing
  strict mismatch diagnostics and exhaustion payload rules remain intact.
- Seven new tests first failed for the missing binding. All 4,242 tests in 329
  files pass. A 3,486-program compiled CPython audit matches values and errors
  across strict lengths, zero/many inputs, keyword spelling/precedence, prepared
  cursors and live list mutation. Source typecheck, scoped lint and selected
  workspace build pass. Native zip type registration, subclasses and
  tuple reuse remain separate work, alongside remaining combinator bindings,
  full guest object wiring, suspended execution, complete resource accounting
  and SDK/safe-fs integration.
- Added the explicitly registerable map binding with strict-option validation
  before positional arity checks and eager left-to-right input acquisition.
  Mapper dispatch stays lazy: empty inputs and strict mismatches do not perform
  callability checks before a complete row exists. The explicit call capability
  supports guest/native functions; the existing kernel preserves mapper results,
  callback exhaustion payloads and resumability. Optional guest iteration/truth
  callbacks retain their context ownership.
- Seven new tests first failed for the missing binding. All 4,249 tests in 330
  files pass. A 3,549-program compiled CPython audit matches values and errors
  for lambdas, defined guest functions, bound native methods, variadic/invalid
  arity, strict lengths, keyword precedence and live input mutation. Source
  typecheck, scoped lint and selected workspace build pass. Native map type
  registration/subclass construction, filter binding, full guest object wiring,
  suspended execution, complete resource accounting and SDK/safe-fs integration
  remain unfinished.
- Added the explicitly registerable filter binding with keyword rejection before
  arity checks, eager input acquisition and lazy predicate/truth calls. None and
  an explicitly supplied exact bool identity use truth-only filtering; another
  callable named bool does not. Original accepted members retain identity.
  Optional guest iteration/truth capabilities reuse the existing filtering kernel,
  including callback exhaustion payloads, resumability and cancellation checks.
- Seven new tests first failed for the missing binding. All 4,256 tests in 331
  files pass. Source typecheck, scoped lint and selected workspace build pass.
  The compiled audit separately reproduced unimplemented string percent
  formatting: filter(lambda x: x % 2, "aa0aaaa0aa") raises an internal unsupported
  binary-expression error instead of Python's string-formatting TypeError. Those
  cases are not counted as passing; string-comparison predicates replace them
  in the focused filter audit, whose 3,411 compiled programs match CPython values
  and errors for truth-only predicates, lambdas, defined functions and bound native
  methods. String/bytes formatting, native type registration,
  subclasses, full guest object wiring, suspended execution, complete resource
  accounting and SDK/safe-fs integration remain unfinished.
- Started percent-formatting support with a shared lazy code-point/byte grammar
  scanner. It emits original-source literal/key spans, mapping-start boundaries,
  flags, bounded static widths/precisions, dynamic operands and raw conversions.
  Event boundaries allow mapping checks and star-argument conversions before
  later syntax failures; unknown conversion validation waits for argument binding.
  Single h/l/L modifiers and nested mapping-key parentheses follow Python grammar.
  No token array or copied literal/key text is retained by the scanner.
- Eight new tests first failed for the missing scanner. All 4,264 tests in 332
  files pass. An 8,000-case CPython comparison validates scanner events through
  an audit-only string-field consumer, covering flags, dynamic dimensions,
  precision, mapping keys and escaped percents for both storage input forms.
  Source typecheck, scoped lint and selected workspace build pass. This does not
  implement runtime percent formatting: argument consumption/conversion, numeric
  and repr/string formatting, output construction and binary dispatch remain
  unfinished, and the previously recorded string-percent failure remains open.
  Full guest object wiring, native registration, suspended execution, complete
  accounting and SDK/safe-fs integration also remain outstanding.
- Added incremental percent-format operand binding over the scanner. It handles
  tuple versus scalar consumption, mapping eligibility/lookup boundaries, mapped
  tuple values as single operands, dynamic width/precision integer restrictions,
  native integer overflow diagnostics and delayed surplus-argument checks.
  The original mapping remains available after positional consumption. Negative
  dimensions normalize with CPython's signed-minimum width behavior. Mapping
  and integer callbacks are explicit and checked before publishing bound fields.
- Eight new tests first failed for the missing binder. All 4,272 tests in 333
  files pass. An 8,049-case CPython comparison uses an audit-only string consumer
  to verify binding results and syntax/mapping/star/surplus error precedence.
  Source typecheck, scoped lint and selected workspace build pass. The scanner's
  literal/key event type is now separately discriminated for safe event reuse.
  Runtime mapping classification, representation/numeric conversion, output
  construction and binary dispatch still need implementation; the original
  string-percent failure is not yet fixed. Full guest object wiring, native
  registration, suspended execution, complete accounting and SDK/safe-fs
  integration remain unfinished.
- Added concrete runtime percent-binding policies for tuple operands, exact
  bool/int star dimensions, native mapping eligibility and explicit guest
  tuple/integer/mapping capabilities. Mapping keys retain their original byte or
  code-point storage, including separate surrogate code points. Missing keys
  retain PythonKeyError guest arguments without premature exception rendering.
- Seven new tests first failed for the missing runtime binding module. All 4,279
  tests in 334 files pass. An 8,049-case CPython comparison validates concrete
  runtime operand binding with an audit-only string consumer. Source typecheck,
  scoped lint and selected workspace build pass. Production representation and
  numeric conversion, output construction and percent binary dispatch remain
  unfinished; the original string-percent failure remains open. Full guest
  object wiring, native registration, suspended execution, complete accounting
  and SDK/safe-fs integration also remain outstanding.
- Added nonnumeric text/byte field rendering to immutable storage. Normalized
  precision truncates before minimum-width space padding. Both operations share
  one preflighted owned buffer, preserve unchanged storage, meter copying and
  padding, and reject unrepresentable allocation before narrowing dimensions.
  Text dimensions count code points, including separate surrogates; byte fields
  preserve every byte without decoding. Numeric fields require separate rules.
- Twelve new tests first failed for the missing field operations. All 4,291
  tests in 336 files pass. CPython comparisons through native percent binding
  match 2,401 text-field outputs and 179,046 byte-field outputs (%s/%b), covering
  precision, width, alignment, ignored nonnumeric flags, Unicode and every byte
  value. The audit assembles literals and fields explicitly; production output
  assembly, conversion/representation and binary dispatch remain unfinished.
  Source typecheck, scoped lint and selected workspace build pass. The original
  string-percent failure remains open. Full guest object wiring, native
  registration, suspended execution, complete accounting and SDK/safe-fs
  integration remain outstanding.
- Added immutable string repr/ascii rendering. It selects Python's quote style,
  uses short escapes only for tab/newline/carriage return, and writes fixed-width
  lowercase hexadecimal escapes for other nonprintable code points. Pinned
  Unicode printability controls repr; ascii mode also escapes printable non-ASCII
  points. Separate surrogate code points remain separate. Two metered scans size
  and fill one owned buffer without temporary character strings or UTF-16 storage.
- Nine new tests first failed for the missing representation operation. All
  4,300 tests in 337 files pass. CPython matches all 2,228,224 single-code-point
  repr/ascii outputs across Unicode, all 131,072 Latin-1 two-point outputs and
  8,232 repr/ascii percent-field outputs through native binding and field rendering.
  Source typecheck, scoped lint and selected workspace build pass. Native repr
  registration, other value representations, numeric conversion, production
  formatting assembly and percent binary dispatch remain unfinished. The original
  string-percent failure remains open; full guest object wiring, suspended
  execution, complete accounting and SDK/safe-fs integration remain outstanding.
- Added bytes representation as immutable text, including the b prefix,
  whole-input quote selection, short whitespace escapes and two-digit hexadecimal
  escapes for controls and every high byte. No byte decoding occurs. Text and
  bytes now share a dedicated metered quoted-buffer renderer; CodePointString
  takes sole ownership of its preflighted output without a second buffer copy.
- Seven new tests first failed for the missing bytes representation factory.
  All 4,307 tests in 338 files pass. CPython matches 131,072 bytes repr/ascii
  outputs for every byte pair and 12,348 bytes-as-text %s/%r/%a field outputs
  through native binding and field rendering. After the shared-renderer
  extraction, all 2,228,224 Unicode single-point and 131,072 Latin-1 pair string
  repr/ascii comparisons still pass. Source typecheck, scoped lint and selected
  workspace build pass. Native representation registration, other value
  representations, numeric conversion, production formatting assembly and
  percent binary dispatch remain unfinished. The original string-percent failure
  remains open; full guest object wiring, suspended execution, complete accounting
  and SDK/safe-fs integration remain outstanding.
- Connected exact native string/bytes __str__ and __repr__ to explicit attribute
  lookup. str.__str__ returns the exact receiver; other paths return metered
  immutable representation text. Bound-call validation rejects keywords before
  positional counts with Python's wrapper diagnostics. Internal storage helpers
  remain inaccessible as guest attributes. Native method-wrapper introspection
  and guest subclass dispatch remain separate work.
- Six new tests cover rendering, identity, argument precedence, cancellation
  and storage encapsulation; five first failed with missing native attributes
  and the encapsulation check already passed. All 4,313 tests in 339 files pass.
  A 3,208-case compiled Python comparison matches CPython output code points,
  receiver identity and errors, including saved bound methods and chained
  representations. Source typecheck, scoped lint and selected workspace build
  pass. General repr/str builtin registration, other value representations,
  numeric conversion and percent formatting assembly/dispatch remain unfinished.
  The original string-percent failure remains open; full guest object wiring,
  suspended execution, complete accounting and SDK/safe-fs integration remain
  outstanding.
- Added shared signed integer digit conversion for binary, octal, decimal and
  hexadecimal output without prefixes. Decimal output defaults to a 4,300-digit
  limit, excludes the sign, and supports an explicit caller limit or zero to
  disable it. Bit-length bounds and an exact threshold reject oversized decimal
  values before decimal conversion; power-of-two radices remain exempt. Output
  storage and work are conservatively reserved before host conversion.
- Seven initial tests first failed for the missing converter; an additional
  admission test proves host decimal conversion is not called after failed
  allocation admission or a digit-limit rejection. All 4,321 tests in 340 files
  pass. A 3,416-case CPython comparison validates all supported radices, signed
  values and decimal-limit boundaries. Source typecheck, scoped lint and selected
  workspace build pass. sys setting registration/minimum validation, runtime
  representation integration and percent formatting remain unfinished. Existing
  BigInt size inspection still charges temporary hex storage after conversion,
  and host BigInt conversion cannot yield mid-operation; complete representation
  accounting remains open. Full guest object wiring, suspended execution and
  SDK/safe-fs integration also remain outstanding.
- Extended native __str__/__repr__ binding to exact integers and booleans.
  Integers use the shared decimal converter without binary64 narrowing; bools
  return True/False names. Decimal limits apply at invocation after wrapper
  argument validation, not when retrieving a bound method. Renamed the existing
  text factory/tests to scalar representation so text, bytes, ints and bools
  share bound-call validation rather than duplicating it.
- Five new tests first failed with missing native integer/bool attributes.
  All 4,326 tests in 340 files pass. A 3,236-case compiled Python comparison
  matches integer/bool output, identity and errors, including decimal-limit
  boundaries and chained representations; all 3,208 compiled text/bytes
  regression cases still pass. Source typecheck, scoped lint and selected
  workspace build pass. General repr/str builtin registration, other scalar and
  container representations, configurable runtime sys digit limits and percent
  formatting assembly/dispatch remain unfinished. Full guest object wiring,
  suspended execution, complete BigInt/resource accounting and SDK/safe-fs
  integration remain outstanding.
- Added integer percent-field rendering for d/i/u/o/x/X over the shared digit
  converter. It handles signs, alternate octal/hex prefixes, uppercase digits,
  precision zeroes, width zeroes/spaces and left alignment in one preflighted
  owned code-point buffer. Python's zero-at-zero-precision behavior and combined
  precision/zero-width padding are preserved. Output dimensions remain bigint
  until bounded; decimal conversion limits exclude formatter-inserted zeroes.
- Eight initial tests first failed for the missing renderer, and an additional
  exact-budget test verifies buffer adoption without another copy. All 4,335
  tests in 341 files pass. CPython matches 88,704 integer fields through native
  binding across all flag combinations and dynamic dimensions, plus 48 fields
  with precision beyond the decimal conversion digit limit. Source typecheck,
  scoped lint and selected workspace build pass. These comparisons assemble
  literals/fields in the audit: runtime operand conversion, byte-output numeric
  storage, floating formatting and production percent assembly/dispatch remain
  unfinished. Full representation builtins, guest object wiring, suspended
  execution, complete accounting and SDK/safe-fs integration remain outstanding.
- Added direct byte storage for integer percent fields. The existing formatter
  now accepts the trusted output-buffer constructor, so text and bytes share
  all sign/prefix/precision/padding logic while reserving the correct element
  size. ImmutableBytes adopts one fresh byte buffer with no intermediate
  code-point buffer; the digit converter's temporary host strings are unchanged.
  Factory defaults now defer to the shared renderer's decimal-limit default.
- Six new tests first failed for the missing byte-field factory. All 4,341 tests
  in 342 files pass, including an exact-budget check for one byte per final output
  position. CPython matches 88,704 byte fields and 48 large-precision byte fields
  through native binding; all 88,704 text-field regression comparisons also pass.
  Source typecheck, scoped lint and selected workspace build pass. Runtime
  operand conversion, floating formatting and production percent assembly and
  binary dispatch remain unfinished. Full representation builtins, guest object
  wiring, suspended execution, complete accounting and SDK/safe-fs integration
  remain outstanding.
- Added context-driven integer percent operand conversion. Decimal conversions
  accept exact floats and prefer __int__ before __index__; octal/hex use indexing
  only. Direct int/bool/subclass payloads bypass overrides. Strict-subclass method
  results warn, conversion TypeErrors become percent-specific diagnostics, other
  exceptions retain identity, and fatal execution limits bypass classification.
- Nine new conversion tests first failed for the missing module. Two additional
  failing index-protocol tests validated a related diagnostic mismatch: Python
  bounds these type names to 200 UTF-8 bytes, dropping incomplete characters.
  A shared metered helper now applies that rule to index errors/warnings and
  percent conversion diagnostics. All 4,352 tests in 343 files pass. Context-level
  CPython comparisons match 3,000 text-format and 3,000 bytes-format conversions,
  including slot call order, errors, long Unicode type names, subclass warnings
  and warning-as-error behavior. Source typecheck, scoped lint and selected
  workspace build pass. Runtime value adapters, full guest slot registration,
  floating formatting and production percent assembly/dispatch remain unfinished.
  Full representation builtins, suspended execution, complete accounting and
  SDK/safe-fs integration remain outstanding.
- Added the concrete runtime adapter for integer percent conversion. It extracts
  native int/bool/exact-float payloads, preserves explicit guest hook ownership,
  and supports guest subclass payloads, conversion slots, type names, TypeError
  classification and warning policies. It never probes instance attributes,
  parses numeric text/bytes or coerces host objects. Guest hook configurations
  require a warning handler; native-only contexts cannot produce slot warnings.
- Six new tests first failed for the missing adapter. All 4,358 tests in 344
  files pass. CPython comparisons using actual RuntimeValues match 3,000 text
  and 3,000 bytes-format integer conversions, including slot order, errors,
  Unicode type diagnostics and warning filters. Source typecheck, scoped lint
  and selected workspace build pass. Full guest slot registration, character
  and floating formatting, general representations and production percent
  assembly/binary dispatch remain unfinished. Suspended execution, complete
  resource accounting and SDK/safe-fs integration also remain outstanding.
- Added context-driven %c operand conversion. Text accepts one Unicode code
  point (including surrogates) or an index in range(0x110000); bytes accepts a
  single bytes/bytearray payload or an index in range(256). Payload length errors
  take precedence over index overrides. Text remaps index TypeErrors while
  bytes preserves errors from present index slots. A shared index-result
  validator preserves warning policy without performing another slot lookup.
- Nine initial tests first failed for the missing converter. Differential
  checks exposed a separate %c diagnostic rule: full qualified type names,
  unlike integer formats' bounded tp_name diagnostics. Two additional failing
  regression tests drove a distinct qualified-name capability. All 4,369 tests
  in 345 files pass. CPython matches 706 character conversions covering payload
  precedence, ranges, bytearray capabilities, Unicode/qualified type names,
  slot failures and warnings. All 3,000 integer-conversion regression comparisons
  still pass. Source typecheck, scoped lint and selected workspace build pass.
  Runtime adapters, concrete bytearray storage, floating formatting and production
  percent assembly/dispatch remain unfinished. Full representations, guest object
  wiring, suspended execution, complete accounting and SDK/safe-fs integration
  remain outstanding.
- Connected character conversion to concrete runtime values. The renamed shared
  runtime percent-conversion context now serves integers and characters, reusing
  index slots, exact payload rules and warning policies. It exposes native str
  and bytes storage plus explicit guest string/bytearray capabilities and a
  separate qualified-name hook; no __str__/__int__ fallback is used for %c.
- Six new tests first failed because the integer-only adapter lacked character
  capabilities. All 4,375 tests in 346 files pass. CPython comparisons using
  RuntimeValues match 732 character conversions, and both 3,000-case text/bytes
  integer-conversion regression audits still pass after the context rename.
  Source typecheck, scoped lint and selected workspace build pass. Concrete
  bytearray storage, full guest slot registration, floating formatting and
  production percent assembly/dispatch remain unfinished. Full representations,
  suspended execution, complete accounting and SDK/safe-fs integration remain
  outstanding.
- Added percent-format storage assembly over incremental argument binding.
  Literal slices and fully rendered callback fields are collected in source
  order and joined once; no repeated concatenation is used. Conversion failures
  precede later grammar/surplus failures, callback results are checked before
  publication, incompatible output storage is rejected, and retained references
  and final storage are metered. Raw immutable storage sharing does not define
  guest object identity; wrapping/canonicalization remain runtime responsibilities.
- Eight new tests first failed for the missing assembler. All 4,383 tests in
  347 files pass. CPython matches 88,704 assembled integer text outputs, 88,704
  integer bytes outputs and 8,049 assembled text binding/error-order cases through
  explicit field converters. Source typecheck, scoped lint and selected workspace
  build pass. Default runtime field dispatch, floating formatting, representation
  protocols, guest identity wrapping and binary percent integration remain
  unfinished. Full guest objects, bytearray storage, suspended execution, complete
  accounting and SDK/safe-fs integration also remain outstanding.
- Added unsupported percent-conversion diagnostics for text and bytes, called
  only after operand binding. Text retains U+001F through U+007E; bytes retain
  ASCII controls and reproduce CPython's signed high-byte diagnostic overflow.
  Unicode offsets remain code-point based, and missing operands win over an
  unsupported conversion. Host metadata and cancellation are checked first.
- Six missing-module tests drove the helper; a CPython differential audit found
  the U+001F boundary and a seventh failing regression drove its correction.
  All 4,390 tests in 348 files pass. CPython matches 10,964 unsupported-code and
  missing-operand cases across all byte values and sampled Unicode, including
  surrogates. Source typecheck, scoped lint and selected workspace build pass.
  Default runtime field dispatch, floating formatting, representation protocols,
  guest identity wrapping and binary percent integration remain unfinished.
  Full guest objects, suspended execution, complete accounting and SDK/safe-fs
  integration also remain outstanding.
- Added floating percent operand conversion with explicit float/index slots.
  Float subclass payloads bypass overrides; integer subclass float overrides
  remain honored. No numeric text parsing or __int__ fallback is performed.
  Strict float/index results follow guest warning policy. Text preserves faults;
  bytes remaps guest conversion exceptions, including overflow and guest
  BaseException subclasses, while fatal limits and host failures propagate.
  Shared UTF-8 diagnostic truncation now accepts the float protocol's 50-byte
  precision as well as the existing 200-byte default.
- Eight tests cover payloads, slot priority, invalid results, warnings, overflow,
  guest/host exception separation, cancellation and diagnostic boundaries; the
  initial test run failed for the missing converter. All 4,398 tests in 349 files
  pass. CPython matches 768 text/bytes slot and warning combinations, including
  long Unicode names and disabled methods. Source typecheck, scoped lint and
  selected workspace build pass. Runtime float conversion adapters, actual
  floating rendering, default field dispatch and binary percent integration
  remain unfinished. Full guest objects, suspended execution, complete accounting
  and SDK/safe-fs integration remain outstanding.
- Connected floating percent conversion to RuntimeValues and the shared runtime
  conversion context. Native float/int/bool payloads, guest float/index slots,
  strict subclass warnings and guest BaseException classification are exposed
  without attribute probing or text parsing. Separate exact-float and
  float/subclass payload capabilities preserve __int__ override behavior for
  integer formatting while bypassing __float__ overrides for float formatting.
- Six runtime tests first failed on missing float capabilities. All 4,404 tests
  in 350 files pass. CPython matches 768 runtime floating conversion cases;
  3,000 integer and 732 character runtime regression comparisons also pass.
  Source typecheck, scoped lint and selected workspace build pass. Actual float
  rendering, default field dispatch, guest identity wrapping and binary percent
  integration remain unfinished. Full guest objects, suspended execution,
  complete accounting and SDK/safe-fs integration remain outstanding.
- Added exact unsigned fixed-point binary64 digit rendering. It scales the exact
  integer ratio and rounds once with ties to even, without host toFixed or
  scientific-notation fallback. Arithmetic precision is capped at binary64's
  1,074-place terminating fractional expansion; larger output precisions append
  zeros. Requested output and bounded arithmetic temporaries are precharged.
- Seven tests first failed for the missing renderer. All 4,411 tests in 351 files
  pass. CPython matches 10,207 fixed-point outputs covering random binary64 bits,
  subnormals, exact rounding ties, maximum finite values and precision through
  5,000 places. Source typecheck, scoped lint and selected workspace build pass.
  Sign/nonfinite rendering, scientific/general formats, field padding, default
  dispatch and binary percent integration remain unfinished. Full guest objects,
  suspended execution, complete accounting and SDK/safe-fs integration remain
  outstanding.
- Added exact significant-digit binary64 rounding with normalized decimal
  exponents for scientific/general format consumers. A bounded terminating
  decimal coefficient determines exponent and ties-to-even rounding, including
  carry across powers of ten. Precision beyond the coefficient pads zeros
  without growing BigInt operands. Output and arithmetic are precharged.
- Seven missing-module tests drove the implementation. All 4,418 tests in
  352 files pass. CPython matches 32,327 significant-digit outputs, including
  random binary64 values, subnormals, ties, neighboring values around decimal
  powers and precision through 5,001 digits. Source typecheck, scoped lint and
  selected workspace build pass. Scientific/general layout, sign/nonfinite
  rendering, field padding, default dispatch and binary percent integration
  remain unfinished. Full guest objects, suspended execution, complete accounting
  and SDK/safe-fs integration remain outstanding.
- Added unsigned e/E/f/F/g/G percent magnitude layout over exact digit renderers.
  General notation uses the rounded exponent; alternate form preserves decimal
  points and significant zeros. Exponents include signs and at least two digits.
  Nonfinite spelling follows case without precision-proportional allocation.
  General output without # caps internal precision at the exact binary64
  coefficient bound instead of allocating trailing zeros only to remove them.
- Seven missing-module tests drove the renderer. All 4,425 tests in 353 files
  pass. CPython matches 26,160 magnitude outputs across all six codes, alternate
  form, random binary64 values, rounding boundaries, nonfinite values and
  precision through 5,000 places. Source typecheck, scoped lint and selected
  workspace build pass. Sign handling, field padding, default dispatch and binary
  percent integration remain unfinished. Full guest objects, suspended execution,
  complete accounting and SDK/safe-fs integration remain outstanding.
- Added floating percent fields for text and bytes, with shared sign and width
  handling over exact magnitude rendering. Signs precede zero padding; left
  alignment overrides zero padding. Negative zero and negative rounded-to-zero
  values retain signs, NaN sign bits are ignored, and nonfinite magnitudes use
  percent formatting's zero padding. Storage classes adopt one final correctly
  sized byte/code-point buffer without a second copy.
- Eight tests first failed on missing storage entrypoints. All 4,433 tests in
  354 files pass. CPython matches 13,840 assembled text/bytes floating fields
  through runtime operand binding and conversion, covering all flag combinations,
  random binary64 values, widths, precisions, negative zero and signed NaNs.
  Source typecheck, scoped lint and selected workspace build pass. Default field
  dispatch, representation protocols, guest identity wrapping and binary percent
  integration remain unfinished. Full guest objects, suspended execution,
  complete accounting and SDK/safe-fs integration remain outstanding.
- Added non-ASCII escaping of already-produced representation text for ascii()
  and percent %a consumers. ASCII controls, quotes and backslashes remain literal;
  non-ASCII points use lowercase hex x/u/U escapes without combining surrogates.
  ASCII-only immutable storage is shared, while changed output is preflighted
  and adopted from one exact-sized buffer.
- Six tests first failed on the missing storage operation. All 4,439 tests in
  355 files pass. Chunked output hashes match CPython ascii() over custom repr
  output for all 1,114,112 Unicode code points, including controls and surrogates.
  Source typecheck, scoped lint and selected workspace build pass. Representation
  slot dispatch, default percent field dispatch, guest identity wrapping and
  binary percent integration remain unfinished. Full guest objects, suspended
  execution, complete accounting and SDK/safe-fs integration remain outstanding.
- Added str/repr/ascii representation protocol dispatch over explicit type-level
  slots and a runtime-owned default repr capability. Exact str conversion keeps
  identity; returned str subclasses are accepted without warnings or recursive
  conversion. ASCII results retain identity when no escaping is needed and use
  exact str construction otherwise. Invalid repr results reached through str
  receive the str return-type diagnostic; slot exceptions propagate unchanged.
- Seven tests first failed for the missing dispatcher. All 4,446 tests in
  356 files pass. CPython matches 672 slot/result/identity/error combinations,
  including disabled slots, strict string subclasses and long Unicode type
  names. Source typecheck, scoped lint and selected workspace build pass. Native
  and container representation slots, recursion guards, runtime adapters, default
  percent field dispatch, guest identity wrapping and binary percent integration
  remain unfinished. Full guest objects, suspended execution, complete accounting
  and SDK/safe-fs integration remain outstanding.
- Connected representation protocol dispatch to RuntimeValues. Existing exact
  str/bytes/int/bool slot operations are shared with explicit bound methods;
  guest str payloads, str/repr slots, diagnostic type names and default repr
  policy remain explicit capabilities. Native/container kinds without implemented
  slots are not assigned invented representations. Escaped guest-subclass results
  become exact native strings while unchanged results preserve identity.
- Seven tests first failed for the missing runtime adapter. All 4,453 tests in
  357 files pass. CPython matches 672 runtime representation cases; 3,208 compiled
  text/bytes and 3,236 compiled integer/bool explicit-method regressions also pass
  after extracting shared native operations. Source typecheck, scoped lint and
  selected workspace build pass. Other native/container representation slots,
  recursion guards, default percent field dispatch, guest identity wrapping and
  binary percent integration remain unfinished. Full guest objects, suspended
  execution, complete accounting and SDK/safe-fs integration remain outstanding.
- Added default text percent-field dispatch for integer, floating, character and
  str/repr/ascii conversions over the existing protocols and storage renderers.
  Representation precision is applied after conversion; character precision and
  numeric flags are ignored. Unmodified representation objects retain identity
  for the eventual whole-expression wrapper. Unsupported-code errors use the
  bound source offset after argument consumption.
- Seven tests first failed for the missing dispatcher. All 4,460 tests in
  358 files pass. CPython matches 5,018 mixed text formats through runtime values,
  argument binding, default field dispatch and output assembly, with guaranteed
  code coverage, dynamic widths/precisions, negative zero, surrogate code points
  and missing/surplus/error precedence cases. Source typecheck, scoped lint and
  selected workspace build pass. Whole-expression identity wrapping, bytes field
  dispatch, other native/container representations and binary percent operator
  integration remain unfinished. Full guest objects, suspended execution,
  complete accounting and SDK/safe-fs integration remain outstanding.
- Added whole-expression text percent wrapping over field dispatch and assembly.
  It preserves a literal-only source (including string subclasses) or a sole
  unchanged field-result object, prioritizes the field when source/result share
  storage, and creates a new exact string for combined output. Candidate identity
  is published only after grammar and surplus checks finish. Binding callbacks
  retain their original context receiver.
- Six tests first failed for the missing wrapper. All 4,466 tests in 359 files
  pass. CPython matches 5,018 mixed formats through the whole-expression wrapper
  and 120 source/result subclass identity cases. Source typecheck, scoped lint
  and selected workspace build pass. Binary percent operator integration remains
  unconnected; the original filter/string-percent gap is still open. Bytes field
  dispatch, other native/container representations and global string
  canonicalization remain incomplete. Full guest objects, suspended execution,
  complete accounting and SDK/safe-fs integration remain outstanding.
- Connected exact string percent formatting to runtime binary operations before
  operand-family guards, allowing positional tuples and dictionary/mapping-proxy
  operands. Normal parsed-expression and in-place fallback paths now use the
  whole-expression wrapper. Unimplemented native/container representation slots
  remain explicit host implementation gaps instead of fabricated guest output.
- Six of seven new tests failed before connection. All 4,473 tests in 360 files
  pass. CPython matches 5,018 mixed formats through the runtime binary operator.
  The original filter/string-percent gap is now closed: all 3,411 compiled filter
  programs, including string operands in lambda modulo, match CPython values and
  errors. Source typecheck, scoped lint and selected workspace build pass. Bytes
  percent dispatch/operator integration, other native/container representations,
  guest reflected slots and global string canonicalization remain incomplete.
  Full guest objects, suspended execution, complete accounting and SDK/safe-fs
  integration remain outstanding.
- Added native None, Ellipsis and NotImplemented str/repr slots and connected
  them to implicit representation and percent formatting. A shared scalar
  capability guard keeps explicit attribute lookup and runtime representation
  dispatch synchronized. Method argument validation and cancellation behavior
  reuse the existing native scalar path.
- Five tests first failed on missing singleton methods/representations. All
  4,478 tests in 361 files pass. CPython matches 4,644 compiled singleton method
  calls and percent formats across flag, width, precision and argument-error
  combinations. All 672 runtime representation protocol comparisons still pass.
  Source typecheck, scoped lint and selected workspace build pass. Floating and
  container representations, bytes percent dispatch/operator integration, guest
  reflected slots and global string canonicalization remain incomplete. Full
  guest objects, suspended execution, complete accounting and SDK/safe-fs
  integration remain outstanding.
- Added shortest round-trip float representation with Python's fixed/scientific
  thresholds, exponent spelling, integral .0 suffix, negative zero and nonfinite
  names. The host supplies shortest digits; bounded layout normalization removes
  insignificant integral zeros before scientific output. Connected the renderer
  to native float str/repr slots and percent s/r/a conversion.
- Six missing-module tests drove digit rendering; four further tests failed on
  missing native float methods before slot integration. All 4,488 tests in
  363 files pass. CPython matches 333,408 shortest representations covering random
  binary64 bits, every exponent and decimal-power neighbors, plus 3,915 compiled
  float method/percent programs covering parsing, runtime conversion and output.
  Source typecheck, scoped lint and selected workspace build pass. Complex and
  container representations, bytes percent dispatch/operator integration, guest
  reflected slots and global string canonicalization remain incomplete. Full
  guest objects, suspended execution, complete accounting and SDK/safe-fs
  integration remain outstanding.
- Added complex repr/str rendering and native slot/percent representation wiring.
  Components use shortest float digits without integral .0 suffixes. Positive-zero
  real components are omitted; negative-zero components and imaginary signs are
  preserved, while NaN sign bits are ignored. Numeric percent conversions still
  reject complex operands rather than discarding their imaginary components.
- Five missing-module renderer tests and three failing native-slot tests drove
  implementation; a numeric-rejection regression already passed. All 4,497 tests
  in 365 files pass. CPython matches 100,144 complex representations and 5,144
  runtime method/percent cases, including signed zeros, nonfinite combinations,
  arbitrary binary64 components and truncated/padded representations. Source
  typecheck, scoped lint and selected workspace build pass. Container
  representations, bytes percent dispatch/operator integration, guest reflected
  slots and global string canonicalization remain incomplete. Full guest objects,
  suspended execution, complete accounting and SDK/safe-fs integration remain
  outstanding.
- Added native range str/repr and percent representation support using stored
  start/stop/step values, omitting only step=1. Empty ranges preserve their original
  bounds; huge cardinalities require neither iteration nor guest len(). Integer
  decimal conversion limits apply to each displayed component. Renamed the shared
  scalar representation module/exports to native representation to cover ranges
  without duplicated slot validation or lookup guards.
- Five tests first failed on missing range methods and formatting. All 4,502
  tests in 366 files pass. CPython matches 3,024 range method/percent cases covering
  empty/descending/huge ranges and decimal-limit boundaries. Source typecheck,
  scoped lint and selected workspace build pass; no stale renamed imports remain.
  Recursive container representations, bytes percent dispatch/operator integration,
  guest reflected slots and global string canonicalization remain incomplete.
  Full guest objects, suspended execution, complete accounting and SDK/safe-fs
  integration remain outstanding.
- Added a metered active-path representation stack for upcoming recursive
  container renderers. It detects identity cycles without treating repeated
  siblings as recursive, bounds new nesting with an explicit execution policy,
  precharges entries before mutation, and provides idempotent LIFO cleanup that
  remains usable after fatal budget failures. Its depth limit is not claimed to
  reproduce CPython's process/C-stack threshold.
- Eight tests first failed for the missing guard. All 4,510 tests in 367 files
  pass. With an audit-only list renderer, cycle-marker behavior matches CPython
  for 2,000 shared/cyclic graphs and 9,000 roots. This validates the guard, not
  production list representation integration. Source typecheck, scoped lint and
  selected workspace build pass. Recursive container renderers, bytes percent
  dispatch/operator integration, guest reflected slots and global string
  canonicalization remain incomplete. Full guest objects, suspended execution,
  complete accounting and SDK/safe-fs integration remain outstanding.
- Added a generic list representation kernel over live ListStorage and the
  shared representation protocol/active-path guard. It renders repeated siblings
  fully, marks cycles, observes element-repr mutations, checks emptiness before
  recursive reentry, preserves separate surrogate code points, restores guard
  state on failure and assembles a single final output buffer from metered parts.
  Native list slots and percent/operator dispatch are not yet wired to this helper.
- Six tests first failed on the missing module. All 4,516 tests in 368 files
  pass. The production helper matches CPython for 2,000 shared/cyclic graphs
  (9,000 roots); direct CPython probes confirm append/delete/clear and empty-reentry
  behavior. Source typecheck, scoped lint and selected workspace build pass.
  Other container representations, bytes percent operator integration, full guest
  objects, suspended execution, complete accounting and SDK/safe-fs integration
  remain outstanding.
- Wired native list __str__/__repr__ and text percent s/r/a formatting to the
  production renderer. Nested list slots share guest hooks and a lazily allocated
  active-path guard, retaining mutation semantics and exception cleanup. Explicit
  native methods validate arguments before rendering. A conservative 100-frame
  representation limit bounds current host callbacks; this is not CPython's
  process recursion threshold or the final configurable/trampolined execution model.
- Four new runtime tests first failed on missing support; a fifth checks live
  clearing/reentry and recovery after guest failure. Updated the old unsupported
  list assertion to require its now-implemented result while retaining an unresolved
  type assertion. All 4,521 tests in 369 files pass. Native methods and percent
  formatting match CPython across 2,000 cyclic/shared graphs (9,000 roots), plus
  2,000 compiled nested-list programs with mixed native elements. Source typecheck,
  scoped lint and selected workspace build pass. Tuple/dict/set representations,
  bytes percent operator integration, full guest objects, suspended execution,
  complete accounting and SDK/safe-fs integration remain outstanding.
- Added metered tuple representation and native str/repr plus percent s/r/a
  integration. Empty and singleton syntax, tuple-specific cycle markers, shared
  list/tuple paths, repeated sibling identities, guest element hooks, mutation of
  later mutable elements and exception cleanup are preserved. Tuple formatting
  operands retain their existing unpacking semantics; a tuple representation as
  one percent operand must still be wrapped in the argument tuple.
- Five new tests first failed on missing tuple support. All 4,526 tests in 370
  files pass. Native method/percent results match CPython across 2,000 mixed
  list/tuple graphs (11,000 roots), plus 2,000 compiled nested-tuple programs with
  mixed native elements. Source typecheck, scoped lint and selected workspace
  build pass. Dict/set representations, bytes percent operator integration, full
  guest objects, suspended execution, complete accounting and SDK/safe-fs
  integration remain outstanding.
- Added a generic metered dictionary representation renderer with an explicit
  trusted live-cursor contract. It captures key/value pairs before guest repr,
  renders keys before values, preserves code points, checks cycles before empty
  traversal and restores active paths on cursor/representation failure without
  invoking cursor close. This is not native dictionary integration yet.
- CPython probes established that repr permits dictionary size mutation and
  reads later pairs live, while retaining the current value across key repr.
  Clearing an active owner and reentering repr yields the recursive marker, not
  an empty dict. Clear-and-refill retains the numeric traversal position and
  skips earlier new slots. OrderedKeyMap's ordinary iterator rejects size changes;
  a raw positional cursor (including deletion holes and compaction behavior) is
  required before wiring this renderer into native dictionary slots. Neither a
  snapshot nor the current host Set iterator is an adequate substitute.
- Five tests first failed on the missing renderer. All 4,531 tests in 371 files
  pass. The production renderer matches CPython for 2,000 dictionary graphs
  (9,000 roots) using audit-only row cursors; this does not verify OrderedKeyMap
  traversal or native dictionary formatting. Source typecheck, scoped lint and selected
  workspace build pass. Native dict/set representations, bytes percent operator
  integration, full guest objects, suspended execution, complete accounting and
  SDK/safe-fs integration remain outstanding.
- Added DictionaryEntrySlots for incrementally built combined general-key
  dictionaries: identity-indexed entries, deletion holes, live numeric scans,
  clear/refill position behavior, insertion-triggered compaction and LIFO
  truncation without refunded capacity. Compaction is fully precharged before
  publishing storage. Empty pop avoids repeatedly scanning tombstones.
  The bookkeeping follows the
  [CPython 3.14 dictionary implementation](https://raw.githubusercontent.com/python/cpython/v3.14.0/Objects/dictobject.c).
  This is an independent storage component, not yet attached to OrderedKeyMap.
- Six tests first failed on the missing component; an additional failing
  checkpoint-count test exposed empty-pop rescanning and drove the constant-time
  fix. All 4,538 tests in 372 files pass. Direct CPython PyDict_Next comparison
  matches 2,000 incremental integer-key mutation histories (439,000 operations),
  including cursor positions, values, contents, overwrites, deletion, pop, clear,
  insertion and compaction. Source typecheck, scoped lint and selected workspace build pass.
  Presized/bulk and split/shared-key layouts, Unicode-to-general transitions,
  OrderedKeyMap integration and native dict representation remain incomplete.
  Set representation, bytes percent operators, full guest objects, suspended
  execution, complete accounting and SDK/safe-fs integration remain outstanding.
- Added exact-string/general layout tracking to DictionaryEntrySlots. A missing
  non-exact-string key compacts a string-key layout even with spare capacity;
  general layouts remain general until clear, while payload overwrites preserve
  positions and layout. Failed conversion precharges leave both unchanged.
- Five new tests initially failed on missing conversion behavior. Differential
  testing caught a version-sensitive rule: the initially consulted 3.14.0 source
  converted before lookup, but the installed interpreter and matching
  [CPython 3.14.7 source](https://raw.githubusercontent.com/python/cpython/v3.14.7/Objects/dictobject.c)
  convert only when adding a missing key. Removed the premature pre-lookup API
  and corrected the overwrite test against that evidence.
- All 4,543 tests in 372 files pass. CPython PyDict_Next positions and contents
  match 2,000 mixed exact-string/string-subclass/general-key histories (439,000
  operations), including subclass overwrites, deletion holes, clear and
  compaction. The 439,000-operation integer-key regression also passes. Source
  typecheck, scoped lint and selected workspace build pass. Presized/bulk and split/shared-key
  layouts, OrderedKeyMap integration, native dict/set representation, bytes
  percent operators, full guest objects, suspended execution, complete accounting
  and SDK/safe-fs integration remain incomplete.
- Added bounded constructor presizing to DictionaryEntrySlots, including initial
  exact-string/general layout selection. Tiny hints keep the normal empty-table
  behavior; larger hints reserve entry capacity with CPython's maximum presize
  cap. Clear discards the reservation. Reserved references are charged before
  publication, without allocation proportional to arbitrarily large hints.
- Four new tests failed on missing reservation/validation behavior and two
  behavior regressions already passed. All 4,549 tests in 373 files pass. Direct
  CPython _PyDict_NewPresized/PyDict_Next comparison matches 2,000 histories
  (439,000 operations), including hints through Number.MAX_SAFE_INTEGER. A
  further 2,000 histories (439,000 operations) match _PyDict_FromItems exact-string
  presizing with duplicate input keys; reservation uses supplied item count, not
  just distinct keys. The 439,000-operation unpresized mixed-layout regression
  also passes. Source typecheck, scoped lint and selected workspace build pass.
  OrderedKeyMap integration, bulk merge/copy policies, split/shared-key layouts,
  native dict/set representation, bytes percent operators, full guest objects,
  suspended execution, complete accounting and SDK/safe-fs integration remain
  incomplete.
- Connected DictionaryEntrySlots to opt-in OrderedKeyMap dictionary storage via
  trusted exact-string classification and constructor presizing options. Raw
  numeric scans capture key/value pairs without hashing or guest iterator size
  checks. Insert/delete/popitem/clear, copies, updates, derived key collections
  and same-layout ownership transfers keep both indexes coherent. Set-backed
  maps can retain the existing storage without dictionary-position overhead.
  Bulk copy/update still use their existing construction policies, not every
  CPython bulk-layout optimization; native dictionary construction/slots are not
  yet wired to the new options and scan API.
- Six tests first failed on missing positional integration; two further tests
  cover derived collections and 100 checkpoint-failure boundaries across insert,
  delete, popitem, clear and transfer. All 4,557 tests in 374 files pass. Actual
  configured OrderedKeyMap storage matches CPython across 2,000 presized mixed-key
  histories (439,000 operations). Its positional storage plus the production
  dictionary renderer matches 2,000 recursive dictionary graphs (9,000 roots),
  using audit-only context/cursor wiring rather than native runtime dispatch.
  Source typecheck, scoped lint and selected workspace build pass. Bulk layout policies,
  split/shared-key layouts, native dict/set representation, bytes percent
  operators, full guest objects, suspended execution, complete accounting and
  SDK/safe-fs integration remain incomplete.
- Enabled positional storage at native dictionary creation sites using one
  shared exact-string layout policy: displays, dict() construction, default
  fromkeys, call keyword collectors, function-bound **kwargs, builder-body calls
  and bootstrap type namespaces. Explicit initial display runs presize from the
  full pair count and key types, including duplicate keys. Native set constructors
  and transient keyword merge groups remain outside dictionary positional storage.
  Adoption of host-prepared maps retains identity and does not fabricate missing
  insertion history; such hosts must configure positional storage at creation.
- Five new construction tests first failed on disabled positional storage, and
  another regression checks function-bound keyword dictionaries. All 4,563 tests
  in 375 files pass. CPython raw entry positions match 1,476 compiled dictionary
  display/mutation programs, including duplicate runs, string/integer layouts,
  deletions, insertions and large literal construction chunks. Source typecheck,
  scoped lint and selected workspace build pass. Native dict representation
  dispatch, remaining bulk-layout policies, split/shared-key layouts, set repr,
  bytes percent operators, full guest objects, suspended execution, complete
  accounting and SDK/safe-fs integration remain incomplete.
- Wired native dictionary __str__/__repr__ and percent s/r/a formatting to the
  production renderer through a metered positional cursor adapter. Dict/list/
  tuple rendering shares one active-path guard and guest element hooks. Current
  key/value pairs survive key-repr mutation, later pairs are read live, and clear/
  refill continues from the saved position. Empty recursive reentry and failures
  retain dictionary-specific marker/cleanup behavior. Mapping percent lookup and
  explicit native method argument validation remain intact.
- Five tests first failed on missing native dictionary support. All 4,568 tests
  in 376 files pass. Native methods and percent fields match CPython for 2,000
  recursive dictionary graphs (9,000 roots), plus 2,000 compiled nested-dictionary
  programs with mixed native elements. These checks use native runtime dispatch,
  not audit-only representation wiring. Source typecheck, scoped lint and
  selected workspace build pass. Host-adopted maps must have been configured for
  positional storage; missing history is not reconstructed. Remaining bulk-layout
  policies, split/shared-key layouts, set/frozenset representation, bytes percent
  operators, full guest objects, suspended execution, complete accounting and
  SDK/safe-fs integration remain incomplete.
- Added native representation for the current dictionary-backed mapping proxies.
  Str delegates to the mapping's str; repr adds metered mappingproxy(...) framing
  around its repr in one final code-point buffer. Underlying dictionary guards
  remain shared through proxy cycles, preserving guest hooks, live mutation and
  failure cleanup. Percent s/r/a uses the same native paths and field rules.
- Four runtime tests first failed on missing proxy support. All 4,572 tests in
  377 files pass. Native methods/percent formatting match CPython across 2,000
  proxy/dictionary graphs (9,000 roots), and 2,000 compiled programs obtain proxies
  through dictionary-view mapping attributes and render mixed native contents.
  Source typecheck, scoped lint and selected workspace build pass. Arbitrary
  guest-mapping proxy construction, remaining dictionary bulk-layout policies,
  split/shared-key layouts, set/frozenset representation, bytes percent operators,
  full guest objects, suspended execution, complete accounting and SDK/safe-fs
  integration remain incomplete.
- Added native str/repr and percent s/r/a for dictionary keys, values and items
  views. A guarded shallow list snapshot captures all entries and item tuples
  before any element repr runs; recursive views emit bare ellipses, even when
  guest repr clears the active view. Framing preserves code-point storage and
  the shared representation stack is restored on failures.
- Five tests first failed on missing native view support. All 4,577 tests in
  378 files pass. Native methods and percent fields match CPython 3.14.7 across
  2,000 mixed view/dictionary graphs (9,000 roots), plus 2,000 compiled programs
  with mixed native contents and Unicode fields. Source typecheck, scoped lint and selected
  workspace build pass. Full guest objects, set/frozenset representations,
  remaining dictionary layout policies, bytes percent operators, suspended
  execution, complete accounting and SDK/safe-fs integration remain unfinished.
- Added the bytes percent b/s conversion kernel with explicit native bytes,
  bytearray snapshot, bound __bytes__, and buffer-copy capabilities. Native
  subclasses bypass overrides; slot results must be bytes, not bytearrays;
  absent slots permit buffer extraction. Integer lengths and iterable indices
  are rejected, unlike ordinary bytes construction. Guest call/buffer errors and
  fatal limits propagate, with checks after each supplied capability.
- Seven tests cover conversion ordering, result validation, bounded diagnostics,
  failures and cancellation. All 4,584 tests in 379 files pass; typecheck, scoped lint and
  selected workspace build pass. A 192-case CPython comparison verifies bytes/
  bytearray subclasses, present/absent/non-callable slots, result types and
  contiguous/strided/failing buffer hooks, including guest call traces.
- Descriptor lookup failure parity remains unresolved: CPython 3.14.7 replaces
  a raising __bytes__ descriptor's error with the b diagnostic for non-exporters,
  or may leak pending-error state into buffer calls and produce SystemError.
  This capability kernel currently propagates lookup exceptions. Full native
  bytes percent field rendering/operator dispatch and guest buffer adapters are
  still pending; this is not a completed bytes percent implementation.
- Added bytes percent field dispatch for integer/float codes, c, b/s and r/a.
  Numeric fields use owned byte buffers; b/s retain raw bytes, while both r/a
  perform ASCII representation before byte precision/padding. Character fields
  ignore precision and numeric flags. Unsupported codes retain byte-specific
  diagnostics. A metered trusted-ASCII storage conversion avoids UTF-16 and
  intermediate host strings; non-ASCII input is an invariant failure.
- Eight tests cover all conversion codes, Unicode/surrogates, raw high bytes,
  field flags, mixed assembly, invalid inputs and cancellation/allocation limits.
  All 4,592 tests in 381 files pass; typecheck, scoped lint and selected workspace build pass.
  The renderer plus existing binder matches CPython for 5,018 mixed formats,
  including dynamic widths/precisions, invalid operands and surplus arguments.
  Native bytes percent wrapper/operator wiring remains pending. CPython probes
  confirm even unchanged multi-byte literal formats and sole b/s fields produce
  fresh guest bytes objects; do not reuse text formatting's identity policy.
- Connected bytes percent formatting to native runtime binary dispatch before
  operand-family guards. The complete wrapper validates binding/surplus before
  constructing exact bytes output, preserving small-bytes canonicalization but
  not multi-byte source/operand identity. Native conversion contexts now expose
  explicit guest bytes-subclass, bytearray-snapshot, __bytes__ and buffer hooks.
  Existing expression and in-place execution routes use the same operation.
- Four native integration tests first failed on absent operator support; two
  further tests verify guest capabilities and post-construction cancellation.
  Updated the old text-modulo test's deliberately unsupported bytes expectation
  to its now-supported canonical bytes result. Native operator dispatch matches
  CPython for 5,018 mixed formats; 2,000 compiled programs additionally verify
  bytes mapping keys, mixed native representations and in-place percent.
  All 4,598 tests in 382 files pass. Typecheck, scoped production lint and selected workspace build pass.
  Raising __bytes__ descriptor parity, guest object/buffer adapters and the wider
  interpreter/SDK/safe-fs work remain incomplete.
- Added callable repr/ascii builtin adapters with positional-only arity and
  keyword-first validation. Both require an execution-owned representation
  context, retaining guest hooks, default-object policy, result identity and
  shared recursion guards across nested calls. Registration is explicit like
  the other current builtin adapters; str remains separate type-constructor work.
- Five tests cover native Unicode output, arguments, guest result validation,
  nested repr/ascii guard sharing, failures and cancellation. A 2,000-program
  CPython audit registers both builtins in the actual compiled execution's
  namespace and verifies direct/aliased calls over mixed native containers and
  dictionary views. All 4,603 tests in 383 files pass. Typecheck, scoped lint and selected workspace build pass. Full builtin
  namespace assembly, remaining native representations, guest objects, suspended
  execution and SDK/safe-fs integration remain unfinished.
- Added formatted-string evaluation on the existing continuation stack, with
  an explicit metered frame stack for nested format specifications. Field
  expressions yield back to ordinary expression execution; explicit conversion
  precedes nested format-spec evaluation as in CPython 3.14. Debug labels,
  absent versus empty specs, sequential fields and conditional truth survive.
  Formatting, result validation and string assembly remain explicit capabilities,
  now propagated through runtime expression/program hooks. Templates remain a
  distinct unsupported execution family, not silently rendered f-strings.
- Five tests first failed on absent f-string evaluation/capability plumbing.
  All 4,608 tests in 383 files pass; typecheck, scoped lint and selected workspace
  build pass. A 160-case CPython audit matches evaluation output and guest
  conversion/format call traces using audit formatting capabilities. A further
  1,000 compiled programs verify runtime-hook plumbing with supplied empty-spec
  formatting and existing native representation capabilities. Neither audit
  establishes native __format__ or format-mini-language implementation; those,
  template objects, suspended execution and SDK/safe-fs integration remain pending.
- Added the internal object-formatting protocol: validate str/subclass specs,
  bypass lookup for exact str/int with empty specs, supply omitted empty specs,
  perform type-level __format__ lookup and preserve valid str/subclass result
  identity. Missing methods differ from non-callable methods and lookup errors;
  the slot owner, not the protocol, supplies inherited object formatting.
  Internal invalid specs use SystemError (added to runtime fault typing), unlike
  the public format() builtin's argument parser, which remains to be implemented.
- Six tests cover fast paths, spec/result identity, bounded diagnostics, failures
  and cancellation. All 4,614 tests in 384 files pass. A 90-case audit calls
  CPython's internal PyObject_Format and compares results, identity and traces
  for object/str/int subclasses, valid/invalid specs, result subclasses, disabled
  methods and raising descriptors. Typecheck, scoped lint and selected workspace
  build pass. Native __format__ slots, format-mini-language
  parsing, default f-string wiring and the wider interpreter work remain pending.
- Added the public format() builtin adapter with explicit shared formatting
  context registration. Keyword rejection precedes one/two-argument arity checks;
  invalid specs raise the public TypeError, with 50-byte type diagnostics and
  the special None spelling, before entering the internal formatting protocol.
  String-subclass specs and valid method results retain identity.
- Four tests first failed on the absent adapter. A 2,008-program compiled
  CPython audit covers native empty-spec str/int formatting, identity and public
  argument errors. It exposed the None versus NoneType diagnostic mismatch;
  an exact failing regression assertion was added before correcting the adapter.
  All 4,618 tests in 385 files pass. Typecheck, scoped lint and selected workspace build pass. This adapter does not establish
  nonempty native format specifications, the full builtin namespace, default
  f-string formatting or the wider interpreter/SDK/safe-fs work.
- Added inherited object-format behavior for implemented native representation
  families (singletons, bytes, list/tuple/dict, mapping proxies/views and range).
  Empty specs delegate to str through the shared representation context;
  nonempty specs fail before representation traversal. Bound __format__ methods
  validate their own arguments, while a runtime format-context factory exposes
  native inherited slots plus explicit guest formatting hooks. Specialized
  numeric/text formatting remains an explicit implementation gap.
- Four tests first failed on absent native object-format support. All 4,622 tests
  in 386 files pass; typecheck, scoped lint and selected workspace build pass.
  A 2,055-program CPython audit matches builtin formatting, successful native
  method calls and bound-method argument failures over mixed native containers.
- Direct-call diagnostic parity remains incomplete: CPython optimized calls such
  as x.__format__() report object.__format__ for argument failures, while
  m=x.__format__; m() reports the receiver type. The current runtime materializes
  bound methods for both call paths. The initial compiled audit exposed this;
  the passing audit explicitly uses retrieved bound methods for those failures.
  Descriptor/direct-call optimization, remaining native families, format-spec
  parsing, default f-string wiring and the wider interpreter work remain pending.
- Added shared Python 3.14 format-spec parsing for code-point fill/alignment,
  signs, z, alternate form, zero padding, Unicode-decimal width/precision, integer
  and fractional grouping, and presentation type. Numeric accumulation is bounded
  to signed 64-bit platform size. Shared grouping/precision/syntax diagnostics
  retain precedence; type-specific restrictions remain the renderer's job.
- Seven tests first failed on the missing parser. All 4,629 tests in 387 files
  pass. A 12,760-case CPython audit compares exact parser diagnostics on failures
  and formatting equivalence after reconstructing specs from successful parses,
  including every decimal code point in the package's Unicode table. This tests
  syntax normalization, not a native renderer. Source typecheck passes after
  explicitly annotating the bounded bigint accumulator. Scoped lint and selected
  workspace build pass. Text/numeric format
  renderers, their native slots, default f-string wiring and the broader
  interpreter/SDK/safe-fs integration remain unfinished.
- Added native string storage formatting with shared spec parsing, presentation
  and flag diagnostic precedence, Unicode fill/alignment and precision truncation.
  Generalized the existing text field kernel to fuse truncation and custom fill
  into one owned allocation. Format centering puts odd extra padding on the right;
  str.center's separate parity behavior is unchanged. Text percent callers retain
  their existing left/right space padding. Fractional grouping syntax is accepted
  but ignored by string rendering, matching CPython.
- Five tests first failed on the missing renderer and expanded field API. All
  4,634 tests in 388 files pass, including one-allocation centering coverage.
  A 12,060-case CPython comparison matches string output code points and errors;
  a further 5,018-case text-percent audit passes after the shared kernel change.
  Typecheck, scoped lint and selected workspace build pass. This is a storage
  renderer, not native str.__format__ registration or default f-string wiring;
  those and numeric renderers remain pending with the wider interpreter work.
- Connected exact native strings to the runtime format context and exposed their
  bound __format__ method. Unchanged storage preserves guest identity; changed
  output goes through the native string factory. Renamed/generalized the existing
  bound formatter adapter so string and inherited object slots share argument
  validation and dispatch without duplicating the method parser.
- Two regressions first demonstrated unsupported nonempty string formatting and
  the missing str.__format__ attribute. All 4,636 tests in 388 files pass.
  A 159-program compiled CPython audit checks string rendering, unchanged result
  identity and public/bound argument errors; the 2,055-program inherited-object
  audit also passes after shared dispatch changes. Typecheck, scoped lint and
  selected workspace build pass. Guest string subclasses, numeric formatting,
  default f-string wiring and the broader interpreter/SDK/safe-fs work remain
  incomplete; the earlier object direct-call diagnostic gap is unchanged.
- Added the default runtime f-string capability, using a shared format/representation
  context for conversions and field dispatch. Joining validates string payloads,
  preserves singleton result identity and copies multipart code points once,
  retaining independent surrogate points. Explicit formatted-string hooks still
  override the native defaults and can use the same adapter with guest contexts.
- Two tests first reproduced the absent default interpolation capability. All
  4,638 tests in 388 files pass, with a focused rerun also verifying surrogate
  joining. A 1,018-program compiled CPython audit matches native conversions,
  string specs, nested widths, debug fields, result identity and evaluation order
  without custom formatting hooks. Typecheck, scoped lint and selected workspace
  build pass.
  Numeric specialized formatting (including remaining empty-spec numeric slots),
  guest subclasses, template objects, global string canonicalization and the
  broader interpreter/SDK/safe-fs work remain unfinished.
- Added exact native numeric empty-spec formatting and exposed bound numeric
  __format__ slots. Empty specs delegate to existing native str representations,
  preserving bool spelling, float signed zero/nonfinite values and complex
  spelling; nonempty numeric specs remain explicit implementation gaps.
- Two new tests and an expanded default f-string regression first reproduced
  unsupported numeric dispatch and absent attributes. All 4,640 tests in 388
  files pass. A 1,035-program compiled CPython audit covers native numeric empty
  formatting through format(), bound methods, simple/explicit/nested-spec
  f-strings and bound argument diagnostics, including sampled float bit patterns
  and complex values. Typecheck, scoped lint and selected workspace build pass. Numeric
  nonempty renderers, guest subclasses and the wider interpreter/SDK/safe-fs
  integration remain incomplete.
- Added the integer b/o/d/x/X rendering kernel for parsed format specs: signs,
  alternate prefixes, Unicode fill, all four alignments and three/four-digit
  grouping. Sign-aware zero padding participates in grouping and may exceed the
  requested width by a separator; its digit count is calculated without scanning
  the width. Output uses one preflighted owned code-point buffer. Decimal digit
  policy is explicit, and precision errors precede negative-zero flag errors.
- Five tests first failed on the missing kernel. All 4,645 tests in 389 files
  pass. A 20,000-case CPython differential audit matches output and diagnostics
  across bases, signs, prefixes, alignment, grouping, Unicode widths/fill and
  large integers. Typecheck, scoped lint and selected workspace build pass. This kernel is
  not yet connected to native integer dispatch; character/locale/float integer
  presentations, remaining numeric renderers and broader interpreter/SDK/safe-fs
  integration remain unfinished.
- Connected nonempty native int/bool specs to integer presentation dispatch and
  added c formatting with code-point fill/alignment, independent surrogate
  values, flag precedence and signed-C-long versus Unicode range diagnostics.
  Unknown presentation errors precede type-specific flag checks. Radix output
  is adopted as immutable string storage without a second allocation; bool
  retains its existing empty-spec spelling but uses numeric payload otherwise.
- Five tests first reproduced missing dispatch and the absent integer formatter.
  All 4,650 tests in 390 files pass. A 20,000-case CPython audit matches radix,
  character and unknown-presentation output/errors; 180 compiled programs compare
  native int/bool format(), bound methods and f-strings. Typecheck, scoped lint and selected
  workspace build pass. Integer locale/float presentations, nonempty float/complex
  renderers, guest subclass behavior and broader interpreter/SDK/safe-fs work
  remain unfinished.
- Added modern float magnitude formatting for omitted type, e/E/f/F/g/G and %,
  including percent scaling before rounding, alternate shortest output, C-int
  precision bounds and z sign coercion after rounding. The existing decimal
  conversion kernel now also supports omitted-type general notation's earlier
  exponent threshold and retained decimal digit; percent defaults are unchanged.
- Five tests first failed on the missing magnitude stage. All 4,655 tests in
  391 files pass. An 18,000-case CPython audit compares signed magnitudes and
  diagnostics over sampled binary64 values, precision, alternate and z settings;
  the existing 26,160-case percent magnitude audit also passes after kernel reuse.
  Typecheck, scoped lint and selected workspace build pass. Corrected an outdated comment
  after directly checking that modern formatting also zero-pads infinities/NaNs.
  Float width/grouping/layout and native dispatch, locale and complex rendering,
  and broader interpreter/SDK/safe-fs work remain unfinished.
- Added float field layout over the rounded magnitude stage: signs, Unicode
  fill, four alignments, integer and fractional grouping, and suffix preservation.
  Integer grouping counts from the right and fractional grouping from the decimal
  point. Sign-aware zero padding participates only when actual digits exist;
  infinities/NaNs remain ungrouped. Final output uses one preflighted owned buffer.
- Five tests first failed on the missing renderer, including allocation-delta and
  oversized-width checks. All 4,660 tests in 392 files pass. An 18,000-case CPython
  audit matches modern float field output and errors over binary64 samples,
  Unicode padding/widths, integer/fraction grouping, precision, alternate and z
  settings. Typecheck, scoped lint and selected workspace build pass. Native float dispatch,
  integer float-style presentations, locale/complex rendering and broader
  interpreter/SDK/safe-fs integration remain unfinished.
- Connected modern native float presentation dispatch and float-style integer/
  boolean presentations to the shared field renderer. Integer conversion uses
  checked binary64 rounding before precision validation, preserving overflow
  precedence. Unknown float presentations fail before renderer precision checks.
  Immutable float output adopts the final buffer without copying.
- Four tests first reproduced missing native float dispatch and the absent
  formatter. All 4,664 tests in 393 files pass. An 18,000-case CPython audit checks
  float presentation dispatch/output/errors; 468 compiled programs independently
  compare format(), bound methods and f-strings for floats, integers and bools,
  including rounding above 2**53 and large-integer overflow. Typecheck, scoped lint and selected
  workspace build pass. Locale-aware n, nonempty complex formats, guest subclass
  behavior and broader interpreter/SDK/safe-fs integration remain unfinished.
- Added complex field composition for omitted type and e/E/f/F/g/G. Components
  reuse float rounding/grouping with complex omitted-type spelling (no forced
  .0 and ordinary general-notation threshold); the combined number gets padding.
  Positive-zero real omission and parentheses are decided before rounding/z.
  Precision bounds precede forbidden zero-fill and equals-alignment diagnostics.
  Two temporary component buffers feed one preflighted final output buffer.
- Five tests first failed on the missing renderer. All 4,669 tests in 394 files
  pass. An 18,000-case CPython complex audit checks component signs, zero omission,
  grouping, padding and diagnostics across sampled binary64 pairs; the existing
  18,000-case float field audit also passes after sharing the spelling policy.
  Typecheck, scoped lint and selected workspace build pass. Native complex
  dispatch, locale-aware presentation, guest subclasses and broader interpreter/
  SDK/safe-fs integration remain unfinished.
- Connected native complex formatting to presentation dispatch and adopted the
  composed buffer without a second copy. Unsupported presentations, including %,
  fail before renderer precision/layout checks. Consolidated the identical
  unknown-code diagnostic across string, integer, float and complex formatters.
- Three tests first reproduced missing complex dispatch and the absent adapter.
  All 4,672 tests in 395 files pass. An 18,000-case CPython complex dispatch audit
  and 384 compiled format()/bound-method/f-string programs pass. After diagnostic
  consolidation, 12,060 string, 20,000 integer and 18,000 float renderer comparisons
  also pass. Typecheck, scoped lint and selected workspace build pass. Locale-aware
  n, guest subclass behavior, remaining native object families and the broader
  interpreter/SDK/safe-fs integration remain unfinished.
- Added immutable POSIX digit-grouping metadata with prefix boundaries, repeat/
  stop markers and implicit NUL termination. Boundary/count queries use prefix
  sums and a repeating tail; minimum zero-padded digit count uses bounded binary
  search with separator widths measured in code points. Locale acquisition and
  platform CHAR_MAX normalization remain the caller's responsibility.
- Five tests first failed on the missing engine. All 4,677 tests in 396 files
  pass, plus a focused rerun covering zero-length dimensions. A 5,000-case audit
  compares nonempty grouped strings and minimum digit counts with CPython's
  locale grouping, normalizing implicit terminators; the initial empty-string
  oracle attempt hit locale._group's IndexError, so zero length is unit-covered
  rather than counted as a passing differential case. The near-32-bit width
  test finishes within a 500-step budget. Typecheck, scoped lint and selected workspace build
  pass. Locale snapshots, renderer/native n integration and broader interpreter/
  SDK/safe-fs work remain unfinished; no host locale settings were changed.
- Added immutable numeric-locale snapshots and integer n field rendering with
  explicit metadata. Grouping supports repeated/stopped POSIX patterns and
  multi-code-point Unicode separators, including their width during zero padding
  and alignment. Non-n presentations ignore supplied locale data. No locale
  acquisition or host setting changes occur in the interpreter implementation.
- Four tests first failed on the missing snapshot/renderer support. All 4,681
  tests in 397 files pass. A 5,000-case audit compares integer n fields with
  CPython across C, US, Indian, French and German numeric locales, selected only
  inside isolated reference subprocesses. The 20,000-case ordinary radix audit
  also passes. Typecheck, scoped lint and selected workspace build pass. Locale-aware float/
  complex layout, native n dispatch and runtime locale ownership remain pending,
  along with broader interpreter/SDK/safe-fs integration.
- Extended float and complex field rendering to explicit numeric locales. n uses
  general numeric conversion, then substitutes decimal text and groups integer
  digits using the snapshot. Decimal/separator code-point lengths participate in
  padding; complex components localize independently before combined padding.
  Other presentations ignore locale metadata and nonfinite text stays unchanged.
- Four tests first reproduced unsupported n rendering. All 4,685 tests in 398
  files pass. A 10,000-case CPython audit covers float/complex n fields across C,
  US, Indian, French and German locales in isolated reference subprocesses.
  The existing 18,000-case float and 18,000-case complex non-locale audits also
  pass. Typecheck, scoped lint and selected workspace build pass. Native n dispatch, shared
  runtime locale ownership, guest locale APIs and broader interpreter/SDK/safe-fs
  integration remain unfinished.
- Connected explicit numeric-locale snapshots through integer, float and complex
  presentation adapters and immutable output factories. n dispatch now reaches
  the locale-aware kernels when metadata is supplied, while other presentations
  keep their existing semantics. Missing locale ownership remains an explicit gap.
- Added three adapter tests; two initially reproduced unsupported n dispatch.
  All 4,688 tests in 399 files pass. Presentation-level CPython comparisons pass
  for 5,000 integer and 10,000 float/complex cases across five locales. Typecheck,
  scoped lint and selected workspace build pass. Runtime ownership should be carried by the
  shared formatting context, not the value records; propagation through bound
  native methods, expressions and program frames, default C locale selection,
  guest locale APIs and broader interpreter/SDK/safe-fs work remain pending.
- Added lazy, execution-owned numeric locale acquisition to native formatting.
  The shared formatting context defaults to an immutable portable C snapshot;
  trusted owners may supply changing snapshots without reading or mutating host
  locale state. Only n presentations acquire a snapshot, and complex formatting
  resolves it once for both components. Acquisition is followed by a checkpoint.
- Two tests first reproduced missing native locale dispatch. All 4,690 tests in
  400 files pass, together with typecheck, scoped lint and the selected workspace
  build. A 462-case compiled CPython comparison passes for default C formatting
  through format(), bound __format__ and f-strings, including invalid specs.
  Propagating a custom shared context through native attributes, expressions and
  program frames remains pending, as do guest locale APIs and broader work.
- Propagated an optional execution-owned FormatContext through program frames,
  standalone expression assembly, native attribute lookup and bound format
  methods. Default program contexts are created once and reused by nested frames;
  explicit f-string and attribute overrides retain their existing precedence.
  Builtin registration can use the same context, and already-bound native methods
  observe later locale snapshots rather than capturing locale data at lookup.
- Three compiled-program tests cover format(), bound __format__ and f-strings;
  the latter two first failed because supplied locale ownership was lost. All
  4,693 tests in 401 files pass. A 2,310-case compiled comparison against CPython
  passes across five locales, nested frames, snapshot changes and invalid specs.
  Typecheck, scoped lint and selected workspace build pass. Guest locale APIs,
  namespace assembly and broader interpreter/SDK/safe-fs integration remain open.
- Added lazy brace-format scanning as the foundation for str.format/format_map.
  Literal, field-name and spec spans reference immutable source storage, including
  subranges for future nested expansion. Escapes, opaque bracket keys, raw
  conversions, nested brace balance and precise malformed-field errors are
  handled without eagerly parsing subsequent fields or copying their text.
- Five tests first exposed the missing scanner module. All 4,698 tests in 402
  files pass. A 20,159-case comparison with CPython's _string.formatter_parser
  covers emitted partial sequences and errors as well as valid markup, Unicode
  and NUL conversions. Typecheck, scoped lint and selected workspace build pass. Field-name
  binding, numbering state, expansion/evaluation and public format/format_map
  methods remain pending; the scanner alone does not implement these methods.
- Added lazy format-field-name lookup steps for initial arguments, attributes
  and item keys. Steps retain original code-point spans, recognize Unicode
  decimal indices within signed-size bounds, preserve nonnumeric keys and defer
  invalid suffixes until preceding lookup steps have been consumed. Empty first
  names are retained for shared auto-numbering; attribute names stay text.
  Decimal classification now shares one helper with format-spec parsing.
- Five tests first exposed the missing field-name module. All 4,703 tests in
  403 files pass. A 20,062-case CPython field-name comparison covers partial
  sequences, errors, Unicode indices and overflow-before-nondigit behavior.
  The existing 12,760-case format-spec equivalence audit also passes, together
  with typecheck, scoped lint and selected workspace build. Numbering, lookup/evaluation,
  expansion and public str.format/format_map methods remain pending.
- Added a per-invocation format-field resolver with shared auto/manual numbering,
  named argument lookup, attribute/item traversal and format_map positional-field
  rejection. Explicit generic hooks own guest lookup semantics. Each callback is
  followed by a meter checkpoint, and lazy suffix scanning preserves guest-error
  precedence. Nested spec expansion can share the same resolver instance.
- Six tests first exposed the missing resolver. All 4,709 tests in 404 files
  pass. A 6,000-case CPython comparison covers lookup traces, both numbering
  transitions, positional bounds, mapping restrictions and guest/syntax error
  ordering. Typecheck, scoped lint and selected workspace build pass. Nested expansion,
  conversion/rendering assembly and public string methods remain pending.
- Assembled generic brace-format evaluation over explicit field/format hooks.
  Lookup, s/r/a conversion, nested spec expansion and native/guest rendering run
  in Python order. Nested builds share numbering and enforce Python's two-level
  expansion limit; host recursion is therefore bounded. Output uses metered
  immutable code-point pieces and a single final join when required.
- Six tests first exposed the missing evaluator. All 4,715 tests in 405 files
  pass. A 20,584-case CPython comparison covers rendered output and errors,
  including 3,470 successful renderings; focused tests check guest ordering,
  recursion timing and surrogate preservation. Typecheck, scoped lint and selected workspace
  build pass. Native bound str.format/format_map methods, runtime lookup wiring
  and broader interpreter/SDK/safe-fs integration remain pending.
- Exposed native bound str.format and str.format_map through runtime attributes.
  The methods validate map call arguments, defer mapping access until needed,
  preserve missing-key guest arguments and wire native attribute/item lookup to
  the shared evaluator/context. The factory accepts explicit lookup capabilities
  for guest integration. Evaluator results now include sole-field identity
  metadata, preserving exact-str identity for unchanged templates/single fields.
- Six added native/program cases first failed for missing methods (the initial
  dictionary test fixture also required correction). All 4,721 tests in 406 files
  pass. CPython audits pass for 454 compiled method programs, 3,850 compiled
  shared-locale programs across five locales, and 20,584 evaluator cases.
  Typecheck, scoped lint and selected workspace build pass. General guest
  descriptor/mapping wiring, global string identity policies and broader
  interpreter/SDK/safe-fs integration remain unfinished.
- Corrected brace-format output identity after direct CPython evidence: leading
  empty writes do not initialize output, while a later append (even empty)
  ends the nonempty field identity fast path. A sole nonempty str-subclass
  formatter result is retained instead of being coerced to exact str. Empty
  fields still execute lookup/conversion/rendering before output is skipped.
- Two new tests first reproduced the mismatches. All 4,723 tests in 406 files
  pass. CPython comparisons pass for 576 compiled noncached-string identity
  cases, 80 guest subclass identity cases and the existing 20,584 evaluator
  cases. Typecheck, scoped lint and selected workspace build pass. Empty/Latin-1
  single-character canonicalization remains part of unfinished global string
  identity work; these focused audits do not establish all identity policies.
- Added lazy per-runtime small-string caching to ConstantValues. Empty strings
  are canonical; callers explicitly choose canonical Latin-1 single-character
  results or fresh nonempty identity. Metadata strings, parsed literals and
  completed brace-format output request canonical construction. Other nonempty
  stringPoints callers remain fresh, preserving casing/join behavior until their
  operation-specific policies are audited. Cache entries and records are metered;
  mutable input is copied on misses and cache hits do not allocate tagged values.
- Five tests were added; four first reproduced absent canonical identity/cache
  reuse. All 4,728 tests in 407 files pass. A 2,340-case compiled CPython audit
  covers all Latin-1 characters plus empty/non-Latin-1 strings through literal,
  format, casing and join identity. The 20,584 evaluator and 80 subclass identity
  audits also pass. Typecheck, scoped lint and selected workspace build pass.
  Remaining string-operation cache policies, broader interning, guest object
  integration and interpreter/SDK/safe-fs work remain unfinished.
- Connected string indexing and iteration to canonical character construction.
  Contiguous slices request canonical results, while strided slices remain fresh;
  full-slice identity still returns the original source, even when that source
  is a fresh Latin-1 character. Constant and runtime slicing use the same policy.
- Four tests were added; three first reproduced missing cache reuse. All 4,732
  tests in 408 files pass. A 260-program CPython comparison covers all Latin-1
  characters plus non-Latin-1/surrogate/longer strings through indexing,
  iteration, contiguous/strided slices, fresh-source full slices and empty
  results. Typecheck, scoped lint and selected workspace build pass. Other
  string-result identity policies and broader interpreter integration remain open.
- Applied canonical substring construction to strip/lstrip/rstrip, prefix/suffix
  removal, partition/rpartition, split/rsplit and splitlines. Unchanged source
  identity and supplied partition separator identity remain intact. Zero-limit
  whitespace splitting now routes even fresh Latin-1 remainders through canonical
  construction instead of incorrectly returning the fresh source object.
- Four tests first reproduced incorrect substring identity. All 4,736 tests in
  409 files pass. A 4,176-program CPython audit covers empty/all Latin-1,
  non-Latin-1, surrogate and longer strings across the changed methods, including
  fresh source/no-op behavior. Typecheck, scoped lint and selected workspace
  build pass. Other string-result policies and broader interpreter work remain open.
- Added explicitly registered chr with exact native integer/Boolean handling
  and optional guest integer-index capabilities. Public keyword/arity checks
  precede conversion; arbitrary-size indices receive Unicode range errors rather
  than machine-integer overflow. Surrogates remain individual code points and
  Latin-1 characters use canonical construction. Guest slot warnings and errors
  remain owned by the supplied index context, with cancellation checkpoints.
- Five tests first exposed the missing builtin module. All 4,741 tests in 410
  files pass. A 1,274-program CPython comparison covers output, cached/fresh
  identity, surrogates, range limits, huge integers and public argument errors.
  Typecheck, scoped lint and selected workspace build pass. Automatic builtin namespace
  assembly, remaining numeric-format identity policies and broader integration
  remain unfinished.
- Added explicitly registered ord for native str/bytes, with optional pure
  subclass and bytearray storage hooks. It counts code points rather than UTF-16
  units, reads at most one byte and rejects wrong lengths without copying storage.
  No conversion, generic buffer acquisition or guest length method is invoked;
  unsupported type names are bounded and payload callbacks are checkpointed.
- Five tests first exposed the missing builtin module. All 4,746 tests in 411
  files pass. A 1,530-program CPython comparison covers native ord/chr roundtrips,
  all bytes, surrogates, incorrect lengths/types and public argument validation.
  Typecheck, scoped lint and selected workspace build pass. Subclass/bytearray
  behavior currently uses explicit hooks; general guest object construction,
  namespace assembly and broader interpreter/SDK/safe-fs work remain unfinished.
- Applied canonical completed-output construction to native numeric/string
  presentations while preserving unchanged string identity. Auditing exposed an
  integer representation regression from metadata caching: integer str/repr now
  explicitly requests fresh construction. Host-string conversion accepts the
  same explicit identity policy as code-point storage conversion.
- Separated validated format-slot invocation from format()'s exact empty-int
  shortcut. Direct int.__format__('') and brace formatting use the slot/canonical
  output path; format(1, '') and f-strings retain fresh integer conversion.
  Shared slot invocation still validates guest formatter results.
- Four tests first reproduced the missing distinctions. All 4,750 tests in 412
  files pass. CPython audits pass for 890 compiled native-format identity cases,
  454 compiled brace-method programs and 20,584 evaluator cases. Typecheck,
  scoped lint and selected workspace build pass. Remaining output identity and
  broader interpreter/SDK/safe-fs integration work remains unfinished.
- Added explicitly registered bin, oct and hex through one radix builtin factory.
  Fixed presentation metadata is prepared once and the existing metered integer
  renderer owns sign/prefix layout and output allocation. Exact integers/Booleans
  and optional guest index slots are supported; decimal digit limits do not apply
  to these power-of-two radices. Results retain fresh nonempty identity.
- Eight tests first exposed the missing factory. All 4,758 tests in 413 files
  pass. A 1,251-program CPython comparison covers positive/negative arbitrary-size
  integers, values exceeding decimal conversion limits, identity and public
  argument errors. Typecheck, scoped lint and selected workspace build pass. Automatic
  namespace assembly and broader interpreter/SDK/safe-fs integration remain open.
- Began abs coverage by auditing complex magnitude: host Math.hypot differed
  from CPython in 3,189 of 10,000 same-scale finite pairs. Added an exact integer
  floor-square-root kernel as a prerequisite for controlled binary64 magnitude
  rounding and future math.isqrt. Bit-length-seeded integer Newton steps avoid
  float conversion and decimal limits; operand-sized temporaries and conservative
  word-quadratic division work are charged before host arithmetic.
- Four tests first exposed the missing kernel. Initial test budgets were raised
  to accommodate its conservative division charging, not by weakening the meter.
  All 4,762 tests in 414 files pass. A 10,014-case CPython math.isqrt comparison
  covers arbitrary-size squares/neighbors up to 40,001-bit inputs. Typecheck, scoped lint and
  selected workspace build pass. Complex-magnitude rounding, the abs builtin,
  public math.isqrt/module wiring and broader interpreter integration remain open.
- Added a metered complex-magnitude kernel that aligns exact binary64 ratios,
  squares bounded integer operands, takes an at-most-106-bit integer square root
  and compares exact rounding midpoints. Subnormal spacing, positive zero,
  infinity-before-NaN precedence and finite-input overflow are explicit.
- Four tests first exposed the missing kernel. All 4,766 tests in 415 files
  pass; typecheck, scoped lint and selected workspace build pass. A 20,000-case
  audit against 1,600-digit Decimal square roots has no mismatches. The same
  corpus differs from this platform's CPython complex abs in 1,372 cases and
  math.hypot in three subnormal cases; checked differences favor exact rounding.
  CPython complex abs delegates to platform C hypot, so this kernel deliberately
  provides portable correctly rounded results, not platform-libm bit parity.
  The abs builtin and broader interpreter integration remain unfinished.
- Added explicitly registered abs with native integer/Boolean/float/complex
  handling and optional type-level guest __abs__ lookup. Guest results are
  returned without coercion or NotImplemented fallback; lookup/invocation
  checkpoints preserve host cancellation. Negative integer result allocation
  and word-sized work are charged, with existing bit-metric limitations noted.
- Compiled identity auditing exposed missing shared small-integer caching.
  ConstantValues now lazily caches -5 through 256 per execution, charging the
  map/entries once and checking cancellation even on hits. The existing logical
  allocation test was updated to include the newly owned cache metadata.
- Eight new tests cover numeric results, identity, public argument errors,
  arbitrary guest results/failures, cache boundaries and cancellation. All 4,774
  tests in 417 files pass. CPython comparisons pass for 1,024 compiled abs
  programs and 1,614 compiled integer identity programs. Typecheck, scoped lint
  and selected workspace build pass. Complex results retain the previously
  documented exact-rounding/platform-libm distinction. Automatic builtin
  namespace assembly, concrete guest classes and broader SDK/safe-fs work remain
  unfinished.
- Added explicitly registered all/any through one short-circuit reduction
  factory using native/guest iteration and execution-owned optional truth
  dispatch. Explicit cursor pulls avoid implicit iterator closing; exhaustion
  metadata is consumed, whereas truth exceptions propagate unchanged. No
  collection of consumed values or length hint is needed, and each pull/truth
  boundary checks the execution meter.
- Ten tests cover empty results, native truth, early exit without closing or
  over-pulling, argument errors, guest iteration/truth ordering, failures,
  cancellation and bounded infinite input. All 4,784 tests in 418 files pass.
  A 910-program CPython comparison covers native iterable reductions, remaining
  cursor elements after short-circuiting, NotImplemented truth errors and public
  arguments. Typecheck, scoped lint and selected workspace build pass. Automatic
  builtin registration and general guest object/SDK/safe-fs integration remain
  unfinished.
- Added explicitly registered min/max through a shared streaming selector.
  Iterable and multiple-positional forms preserve original member identity,
  first ties and comparison direction. Key callbacks run once per member;
  None disables key dispatch, and empty defaults are returned without key calls.
  Keyword count/name/suggestion checks precede input acquisition, with the
  zero-positional error taking precedence. Guest call/comparison/iteration
  capabilities and checkpoints preserve failures and cancellation without
  implicitly closing input iterators.
- Eight tests cover native selection/ties/NaNs, key order, option errors,
  callback StopIteration, guest sequence fallback, default identity and
  cancellation. All 4,792 tests in 419 files pass; 2,202 compiled min/max
  programs match CPython for selection, keys, identity and diagnostics.
  Typecheck, scoped lint and selected workspace build pass. Automatic builtin
  registration and general guest object/SDK/safe-fs integration remain open.
- Added explicitly registered sorted using existing list storage, extension and
  sort-option kernels. Input is copied/consumed before keyword errors or reverse
  truth conversion; sorting retains member identity and stable reverse ties.
  Optional complete list-extension capabilities preserve guest iteration and
  length-hint ordering; native-only fallback avoids implicit iterator closing.
  Key, rich less-than and truth callbacks remain execution-owned capabilities.
- Seven tests cover copied slots, stable identity, argument/error precedence,
  delayed key callability, source mutation during key calls, failures,
  cancellation and guest hint ordering. All 4,799 tests in 420 files pass;
  1,339 compiled sorted programs match CPython for native ordering, keys,
  reverse, source preservation and diagnostics. Typecheck, scoped lint and
  selected workspace build pass. Exact CPython comparison schedules, hint-driven
  speculative allocations, automatic builtin registration and broader
  object/SDK/safe-fs integration remain unfinished.
- Began sum with a fixed-storage Neumaier compensated binary64 accumulator,
  matching CPython 3.14's float-component kernel. Low-order contributions survive
  cancellation; finalization skips zero/nonfinite compensation to preserve
  signed zero and avoid introducing NaN solely from intermediate overflow.
  Reads are nondestructive and each mutation/read checks the execution meter.
- Five tests first exposed the missing kernel. All 4,804 tests in 421 files
  pass. A 5,036-case bitwise CPython sum comparison (floating start, binary64
  inputs, cancellation patterns and nonfinites) has no mismatches. Typecheck,
  scoped lint and selected workspace build pass. This is not exact math.fsum;
  public sum binding, staged integer/float/complex transitions and guest addition
  remain next work, alongside broader interpreter/SDK/safe-fs integration.
- Added a staged streaming sum kernel and explicitly registered public sum.
  Signed-64-bit integer accumulation advances at most once through compensated
  float and complex stages before ordinary addition. Boolean/large-int starts
  remain generic; overflow or later guest results do not restart earlier phases.
  Complex real-only contributions leave imaginary signed zero unchanged.
  The caller owns full reflected ordinary addition, never in-place addition.
- Public binding supports positional-only input and positional/keyword start,
  validates arity and keyword suggestions, then acquires iteration before
  rejecting string/bytes/bytearray starts. Optional guest start classification
  and iteration remain explicit capabilities. Empty fast numeric results follow
  CPython identity behavior; generic starts preserve identity.
- Ten tests cover phases, cancellation, numeric overflow, start identity, list
  nonmutation, guest errors and public binding. All 4,814 tests in 423 files
  pass. A 2,459-program CPython comparison covers numeric/mixed-complex sums,
  phase transitions, valid concatenation and argument errors. Typecheck, scoped
  lint and selected workspace build pass. The audit exposed missing full-add
  diagnostics for invalid list/tuple concatenation in the supplied native
  addition adapter; those 20 combinations were excluded, not counted as passes.
  Full guest addition/sequence fallback, automatic registration and broader
  object/SDK/safe-fs integration remain unfinished.
- Closed the sum audit's native sequence-addition diagnostic gap with a runtime
  ordinary-addition adapter. Optional prepared numeric dispatch runs before
  native sequence fallback, preserving reflected-method priority. Native list,
  tuple, str and bytes mismatches now report their own bounded diagnostics;
  unsupported numeric pairs use the generic addition TypeError. No in-place
  operation is used. Sum now defaults to this adapter while retaining an
  optional execution-owned full-add override.
- Six new tests cover native results, fallback ordering, successful reflection,
  cancellation, type-name bounds and default sum integration. All 4,820 tests in
  424 files pass. All 2,479 compiled sum cases now match CPython, including the
  20 previously excluded invalid sequence combinations. Typecheck, scoped lint
  and selected workspace build pass. General expression-context wiring, guest
  sequence subclass storage/buffer exporters and broader interpreter/SDK/safe-fs
  integration remain unfinished.
- Wired ordinary + expressions through the addition adapter, replacing host
  implementation-gap failures with native Python addition/concatenation errors.
  Added an optional operand-pair addition capability for guest numeric slots;
  it runs after both operands are evaluated and before native sequence fallback.
  Frame assembly forwards and owner-binds the capability into modules and nested
  functions. Other declined binary operator families remain explicit gaps.
- Three new tests plus an updated unsupported-add expectation first reproduced
  missing diagnostics, dispatch and frame forwarding. All 4,823 tests in 424
  files pass. CPython comparisons pass for 900 compiled addition programs and
  all 2,479 compiled sum cases. Typecheck, scoped lint and selected workspace
  build pass. Concrete guest class/sequence adapters, remaining operators and
  broader interpreter/SDK/safe-fs integration remain unfinished.
- Added an execution-owned truth hook to runtime expression/frame assembly,
  with native truth retained when omitted. Boolean short-circuiting, not and
  statement branch evaluation share the hook; callbacks are owner-bound in
  module/nested-function frames and followed by cancellation checkpoints.
  Existing bool-before-length protocol conversion can now drive these compiled
  paths without inventing truth behavior for guest object records.
- Four new tests first exposed missing expression and frame forwarding, covering
  owner binding, cancellation and guest __bool__/__len__ precedence in branches
  and nested functions. All 4,827 tests in 424 files pass. A 96-program CPython
  comparison matches results and exact truth-call traces for fixed and
  alternating guest truth, nested Boolean expressions and functions. Typecheck,
  scoped lint and selected workspace build pass. Concrete guest type/descriptor
  construction and broader interpreter/SDK/safe-fs integration remain open.
- Added a runtime rich-comparison adapter that preserves arbitrary guest results,
  prioritizes strict-subtype reflection and applies identity equality fallback
  only after both slots decline. Unsupported ordering reports bounded type
  diagnostics. Expression and frame assembly now accept owner-bound prepared
  rich-comparison slots; identity and membership remain separate native paths.
  Chained comparisons use the shared truth hook without coercing final results.
- Six tests first exposed missing adapter/expression/frame behavior. All 4,833
  tests in 425 files pass. CPython comparisons pass for 2,400 native comparison
  programs and 144 guest comparison-chain programs, including exact traces for
  fixed/alternating result truth and nested functions. Typecheck, scoped lint
  and selected workspace build pass. Concrete guest type/descriptor dispatch,
  containment adapters and broader interpreter/SDK/safe-fs work remain open.
- Added a generic metered containment protocol: __contains__ precedes iteration,
  None-disabled slots reject immediately, and arbitrary slot results undergo
  truth conversion without a NotImplemented fallback. Iterator/legacy indexed
  fallback compares member against needle with identity first and stops at the
  first match. No length hints or implicit closing are requested.
- Verified CPython's containment-specific acquisition rule: TypeErrors from
  obtaining the iterator are rewritten to the container/iterable diagnostic;
  next/equality/truth/contains failures propagate unchanged. Seven tests first
  exposed the missing kernel. All 4,840 tests in 426 files pass. A 90-case CPython
  audit matches results, errors and callback traces across slot, iterator,
  indexed and failure paths. Typecheck, scoped lint and selected workspace build
  pass. Runtime expression/frame containment wiring and broader object/SDK/
  safe-fs integration remain unfinished.
- Wired optional guest containment into runtime membership, expression and frame
  assembly. Container-specific capability selection can return undefined to
  retain native dispatch; supplied protocols support contains slots and iterator
  fallback. in/not-in return canonical booleans, with negation applied only
  after the single containment truth conversion. Nested frames owner-bind and
  retain the execution's containment policy.
- Three tests first reproduced missing runtime/frame connections. All 4,843
  tests in 426 files pass. CPython comparisons pass for 374 native membership
  programs and 64 guest contains programs with fixed/alternating truth, Boolean
  combinations and nested functions, including exact callback traces. Typecheck,
  scoped lint and selected workspace build pass. Concrete guest storage/type
  adapters and broader interpreter/SDK/safe-fs integration remain unfinished.
- Forwarded optional guest iteration capabilities through expression/frame
  assembly and starred call collection. Native values retain their exact paths;
  guest sources now support for loops, fixed unpacking, starred tuple/list
  displays and starred arguments in module/nested-function execution. The
  protocol object retains its callback receiver and exhaustion classification.
- Five compiled-consumer tests first exposed missing forwarding. All 4,848
  tests in 426 files pass. A 48-program CPython comparison matches outputs,
  fixed-unpack errors and exact iterator acquisition/pull traces for input sizes
  zero through seven. Typecheck, scoped lint and selected workspace build pass.
- Preserved guest iterator-acquisition exceptions in assignment unpacking and
  starred calls. Consumers now specialize diagnostics only when iteration and
  sequence slots are absent, without catching guest slot failures (including
  nested non-iterability errors). Starred list/tuple displays also use the
  appropriate absent-iteration diagnostic.
- Seven regression cases cover guest TypeErrors and absent iteration in starred
  displays. All 4,855 tests in 426 files pass. CPython comparisons match 30
  acquisition-failure programs, 48 valid guest-iteration programs and 90
  containment-protocol cases, including callback traces. Typecheck, scoped lint
  and selected workspace build pass.
- Connected extended assignment unpacking to guest cursor reacquisition after
  consuming the prefix. The remainder uses iter(cursor), which may return a
  replacement iterator or fail; legacy sequence cursors retain their position.
  Ordinary fixed unpacking and host iterator adaptation do not reacquire.
- Two compiled regressions first failed on replacement/error behavior. Three
  adapter cases additionally cover legacy position, missing cursor iterability
  and invalid replacements. All 4,860 tests in 426 files pass; 40 compiled
  extended-unpack programs match CPython results, arity errors and exact traces
  across prefix/suffix combinations, nested functions and zero-to-seven items.
  Typecheck, scoped lint and selected workspace build pass.
- Added an optional length-hint capability to iteration contexts. Extended
  unpacking reacquires first, then validates the original cursor's hint before
  consuming the remainder. Replacement cursors are not queried in its place.
  Legacy sequence cursors consult only their source's length, subtract the
  consumed index, clamp to zero and avoid callbacks after exhaustion. Guest
  TypeError fallback and invalid length/overflow behavior are retained.
- Two compiled tests first reproduced skipped hint effects/errors; eight adapter
  cases cover legacy absence, remaining counts, exhaustion and invalid lengths.
  All 4,870 tests in 426 files pass. Eighty compiled CPython comparisons match
  values/errors and exact callback traces across guest/legacy cursors, nested
  functions, target shapes and input sizes. Typecheck, scoped lint and selected workspace
  build pass. Advisory sizes are not used for speculative allocations, matching
  existing list-extension policy. Other collecting consumers still need their
  hint integration; concrete objects and broader SDK/safe-fs work remain open.
- Connected source hints to starred list/tuple/subscript expansion and mixed
  positional call collection. Hints run after iterator acquisition, before the
  first pull, against the original source. Lone-star calls retain CPython 3.14's
  tuple-conversion path without hint lookup; loops and fixed unpacking remain
  unaffected. Exact native values retain their existing non-guest paths.
- Four compiled regressions cover failing source hints and lone-star exclusion;
  three failed before implementation. All 4,874 tests in 426 files pass. A
  96-program CPython comparison matches values, errors and exact callback order
  across displays, single/multiple-star calls, nested functions and noncollecting
  consumers with zero-to-eleven items and negative/valid hints. The 80 extended
  unpacking hint comparisons still pass. Typecheck, scoped lint and
  selected workspace build pass. Broader object/builtin/SDK/safe-fs integration
  and complete temporary allocation accounting remain unfinished.
- Metered unpacking's temporary result/array allocations, retained leading and
  starred slots, and copied trailing slots before allocation. Successful next
  callbacks are checked before inspecting exhaustion, retaining values or
  returning; remainder preparation is also checked before allocating its array.
- Six cases cover allocation cutoffs without closing/extra pulls, cancellation
  on exhaustion and exact cumulative temporary charges. Three first failed on
  missing allocation/cancellation enforcement. The 5,000-level traversal fixture
  retains its full depth with a budget accommodating newly counted temporaries.
  All 4,880 tests in 426 files pass, and 120 extended-unpack CPython comparisons
  retain exact output/error/callback behavior. Typecheck, scoped lint and selected workspace
  build pass. Expression buffers and traversal work stacks still need complete
  temporary accounting; broader interpreter and SDK/safe-fs work remain open.
- Assignment traversal now charges its work array and each queued target/value
  record before allocation, both for chained roots and unpacked children. It
  checks cancellation after stores, reference writes, unpacking and starred-list
  creation, including terminal callbacks with no subsequent traversal iteration.
- Five regression cases first demonstrated uncharged root/child records and
  missed terminal cancellation. All 4,885 tests in 426 files pass, including the
  unchanged 5,000-level nonrecursive traversal case. The 120 extended-unpack
  CPython comparisons preserve results, errors and callback order. Typecheck, scoped lint
  and selected workspace build pass. Expression buffers and other work stacks
  remain in the memory-accounting audit; full interpreter integration is open.
- Charged expression collection buffers: tuple/list/subscript arrays and each
  retained value, deferred set entries, and deferred dictionary pairs including
  their pair arrays. Guest-controlled starred collection now reaches the
  allocation limit before retaining a value beyond its budget, without consuming
  another item or publishing the final container.
- Eight regression cases first exposed absent charges for fixed/guest-sized
  buffers. The 5,000-level nested-display test retains its depth with an explicit
  budget for its newly counted arrays/slots. All 4,893 tests in 426 files pass.
  A 136-program CPython rerun preserves starred hint and extended-unpack results,
  errors and callback order. Typecheck, scoped lint and selected workspace build pass.
  Expression continuation records/closures and remaining temporary objects still
  need accounting; full guest-object and SDK/safe-fs integration remain open.
- Closed expression-return cancellation gaps. A final node or continuation can
  invoke guest code without queuing another task; the evaluator now checks the
  meter before publishing its result/reference and after final branch truth
  conversion. Zero-step checks preserve operation-count behavior.
- Five tests first reproduced ignored terminal cancellation in literal, load,
  binary, list-construction and truth callbacks. All 4,898 tests in 426 files
  pass. CPython comparisons still match 96 guest truth programs and 144 guest
  rich-comparison programs, including callback traces. Typecheck, scoped lint and selected
  workspace build pass. Remaining allocation audits and broad interpreter,
  object-model and SDK/safe-fs integration remain unfinished.
- Deletion traversal now charges the root work array/frame and each nested
  frame before allocation, while keeping O(nesting depth) live space and
  left-to-right deletion semantics. Allocation failure does not undo earlier
  deletions. Existing loop checkpoints already cover terminal callbacks.
- Three tests first exposed missing root/nested charges and verify preservation
  of earlier effects. All 4,901 tests in 426 files pass. The 10,000-level traversal
  test retains its depth with an explicit budget covering its frames. Typecheck, scoped lint
  and selected workspace build pass. Remaining continuation/temporary allocation
  accounting and broad guest-object/interpreter/SDK/safe-fs integration are open.
- Charged empty dictionary seed arrays across empty/mapping/incremental-build
  paths and the slice-bound record/field list before creating them. Allocation
  failure therefore precedes dictionary construction or slice-bound callbacks.
- Three tests first exposed missing seed charges and a slice callback running
  before its temporary allocation failure. All 4,904 tests in 426 files pass.
  CPython comparisons retain 260 string-selection identity cases and 4,176
  substring-method identity cases. Typecheck, scoped lint and selected workspace
  build pass. Continuation allocations and broader interpreter/object/SDK/safe-fs
  integration remain unfinished.
- Added an explicitly registered hash builtin over the existing exact-value
  hashing kernel. It shares the execution's identity and payload policies with
  dictionaries/sets, validates keywords before arity and preserves nested
  unhashable errors and policy failures without introducing global hash state.
- Four tests cover primitive/composite policy use, argument validation and error
  propagation. All 4,914 tests in 427 files pass. A 1,014-program CPython audit
  matches numeric/tuple hash representations exactly, plus unhashable/argument
  errors. Typecheck, scoped lint and selected workspace build pass. Guest hash
  slot negotiation and automatic namespace assembly remain required, alongside
  the broader unfinished object/interpreter/SDK/safe-fs integration.
- Added generic guest hash-slot conversion and optional per-value selection in
  the shared runtime hash kernel. Root values and nested immutable members now
  invoke guest __hash__, require integer payloads without index coercion, retain
  signed-64-bit results, numerically hash larger integers and remap -1 to -2.
  Disabled/missing slots and slot failures remain distinct from native fallback.
- Thirteen tests cover conversion boundaries, missing/disabled/invalid slots,
  guest failures and root/nested builtin dispatch. All 4,927 tests in 428 files
  pass; typecheck, scoped lint and selected workspace build pass. All 1,014
  native hash comparisons still match CPython. Of 153 compiled guest hash cases,
  151 match exactly; two dictionary insertion cases (None/float hash results)
  retain the plain hash TypeError instead of CPython's dictionary-key context.
  Their values/callback traces agree. This is a verified outstanding diagnostic
  gap: dictionary/set error adaptation needs guest root type information and
  hash-failure provenance, without rewriting unrelated equality errors. The full
  guest-hash differential is retained with these failures, not counted as passed.
- Resolved the two guest-hash dictionary diagnostics above. Hash-boundary
  provenance carries the root key type and original TypeError; dictionary/set
  consumers add their context without relabeling ordinary equality failures.
  Direct hash() restores the exact original exception, including tuple-member
  failures. Native unhashable diagnostics retain their existing path.
- Two regressions first reproduced invalid-result/raised-TypeError context gaps;
  a third verifies original exception identity for direct/tuple hash calls. All
  4,930 tests in 428 files pass. The formerly failing 153-case guest audit now
  passes, as do 260 expanded guest hash/container cases and 1,014 native hash
  cases. Typecheck, scoped lint and selected workspace build pass. Full guest
  exception-class adaptation and broader object/namespace/SDK/safe-fs work remain
  unfinished.
- Added callable() and shared native/guest call-slot classification with actual
  runtime invocation. Native functions, builtin functions, bound methods and
  types bypass guest inspection. Other values use the execution's slot-presence
  policy without descriptor lookup or speculative calls; a defined but unusable
  __call__ can still classify as callable, matching Python.
- Four tests cover native bypass, guest yes/no inspection, receiver binding,
  default false and argument validation. All 4,934 tests in 429 files pass.
  Twenty-four compiled programs match CPython across absent/disabled/present
  guest call slots, native functions/methods, conditionals, nested functions
  and malformed arguments. Typecheck, scoped lint and selected workspace build
  pass. Automatic namespace assembly, concrete guest types and broader
  interpreter/SDK/safe-fs integration remain unfinished.
- Added explicit getattr/hasattr builtin registration over a full attribute
  access capability. Names stay as their original guest string objects; optional
  classification supports string subclasses without coercion. Lookup runs once,
  and only AttributeError enables a getattr default or false hasattr result.
  Non-default getattr preserves the error directly; fatal execution signals
  cannot be suppressed through guest exception classification.
- Nine tests cover lookup/name identity, fallback identity, non-AttributeError
  propagation, argument validation, guest subclass classification and fatal
  error isolation. All 4,943 tests in 430 files pass. Seventy-six compiled CPython
  comparisons match results/errors and lookup/fallback traces in module and
  nested-function execution. Typecheck, scoped lint and selected workspace build pass.
  Concrete shared attribute adapters, automatic builtin namespace assembly and
  broader interpreter/object/SDK/safe-fs integration remain unfinished.
- Added setattr/delattr builtin adapters and shared attribute-name validation
  with getattr/hasattr. Names and assigned objects retain identity, no preflight
  attribute read occurs, guest mutation errors propagate and successful calls
  return None regardless of the override's return value. Post-mutation metering
  checks cancellation without attempting to roll back completed side effects.
- Six tests cover setter/deleter forwarding, string-subclass names, receiver
  binding, argument validation and descriptor errors. All 4,949 tests in 431
  files pass. Fifty-eight compiled mutation programs and 76 lookup programs
  match CPython results/errors and callback traces, including empty/NUL/Unicode
  names and nested functions. Typecheck, scoped lint and selected workspace build pass.
  Automatic namespace assembly and concrete shared attribute/object adapters,
  plus broader interpreter/SDK/safe-fs integration, remain unfinished.
- Added execution-local weak object identities and an explicitly registered id
  builtin. IDs are opaque, stable, monotonically allocated and do not expose
  host addresses or keep guest objects alive. A derived identity-hash policy is
  available from the same registry. New registry entries and boxed return values
  are metered; repeated lookups retain IDs without allocating another entry.
- Four tests cover identity stability/distinctness, execution isolation,
  allocation limits, non-interned return integers and builtin validation. All
  4,953 tests in 433 files pass; typecheck, scoped lint and selected workspace
  build pass. Of 53 compiled CPython identity comparisons, 51 match. Two expose
  existing compiler pooling differences: repeated (1,) tuple literals and -10
  unary expressions produce distinct objects here. id correctly tracks those
  objects, but CPython pools the constants. The full differential retains these
  mismatches for the compiler audit. Numeric IDs are intentionally opaque rather
  than reproducing process-specific addresses. Automatic identity/builtin policy
  assembly and broader interpreter/object/SDK/safe-fs work remain unfinished.
- Extended per-compilation pooling to immutable tuple displays and unary
  integer/float constants. An iterative postorder walk keys nested tuples by
  typed constant records, preserving bool/int/float distinctions and signed zero
  without guest equality or global interning. Compiled functions retain their
  originating pool; mutable and dynamic displays still execute normally.
- Eight regression cases cover repeated/nested constants, dynamic exclusions,
  typed tuple keys, undefined factory values and boolean inversion's runtime
  warning policy. All 4,961 tests in 433 files pass. All 53 identity comparisons
  now match CPython, resolving the two previously recorded pooling mismatches;
  another 272 compiled constant-pooling comparisons match. Typecheck, scoped lint and selected
  workspace build pass. General constant folding, automatic builtin/object
  assembly and broader interpreter/SDK/safe-fs integration remain unfinished.
- Added an explicitly registered divmod builtin using the existing exact integer
  and float quotient/remainder kernels. Its separate numeric protocol supports
  __divmod__/__rdivmod__ negotiation and subtype priority, returns arbitrary
  guest results unchanged and never substitutes separate // and % calls.
  Argument validation, conversion-before-zero errors and post-hook cancellation
  checks preserve the runtime's protocol and execution-policy boundaries.
- Five tests cover exact real arithmetic, large integers, signed zeros, errors,
  reflected dispatch, guest diagnostics and cancellation. All 4,966 tests in
  434 files pass. All 886 compiled CPython comparisons match, covering module and
  nested-function calls, mixed real pairs, infinities, NaNs, oversized integers
  and invalid arguments. Typecheck, scoped lint and selected workspace build pass.
  Bigint host division remains indivisible; automatic builtin namespace and
  concrete guest slot assembly, plus broader interpreter/SDK/safe-fs integration,
  remain unfinished.
- Added round builtin binding for positional/named number and ndigits, exact
  native integer/float rounding, optional __index__ conversion and type-level
  guest __round__ dispatch. None and omitted ndigits both invoke guest slots
  without an argument; other guest digits and results retain identity without
  conversion. Integer no-op rounding preserves identity, while floats are boxed
  anew. Arithmetic temporaries and callback cancellation are metered.
- Six tests cover ties, signed zeros, argument precedence, guest forwarding,
  index conversion, huge digit counts and cancellation. All 4,972 tests in 435
  files pass. All 717 completed compiled CPython comparisons match results and
  errors across module/nested calls and numeric/keyword edge cases. Fourteen
  extreme negative-ndigits integer reference cases were excluded after the
  initial CPython process remained CPU-bound and was explicitly interrupted;
  they are not counted as passes. Safe-python's bounded zero shortcut remains
  covered by unit tests. Another 16 compiled guest round call/result traces match
  CPython. Typecheck, scoped lint and selected workspace build pass. Automatic
  builtin/object assembly and broader interpreter/SDK/safe-fs work remain pending.
- Auditing pow exposed uncharged bigint arithmetic in modular exponentiation
  and inversion. Added input-width inspection and conservative pre-operation
  charges for reductions, products, exponent shifts, signs and Euclidean
  coefficients; removed temporary destructuring arrays in the inverse loop.
  Modulus-one shortcuts still avoid size-dependent allocation. Host bigint
  operations remain indivisible and size inspection retains the shared metric's
  post-conversion string-accounting limitation.
- Three new tests reproduced zero-allocation execution and now enforce payload
  limits and size scaling. The step-limit test now derives its cutoff from a
  successful execution so it still reaches arithmetic rather than stopping in
  input inspection. All 4,975 tests in 435 files pass; 2,000 metered modular-power
  result/error comparisons match CPython. Typecheck, scoped lint and selected
  workspace build pass. The pow builtin, floating/complex power families and
  full ternary guest dispatch remain unfinished, alongside broader runtime work.
- Added the floating real-pair power kernel and connected it to constant/runtime
  binary dispatch, making mixed float/int/bool ** expressions executable. It
  handles conversion precedence, signed zeros, infinities, NaNs, overflow and
  principal complex results for negative fractional bases. Integer-only powers
  retain their separate exact kernel. Edge-case ordering was checked against
  CPython 3.14 Objects/floatobject.c and local execution.
- Twenty-four new tests cover numeric/error branches, mixed conversion, decline
  boundaries and execution limits; updated old unsupported-float assertions
  while retaining unavailable complex-operand checks. All 4,999 tests in 436
  files pass. Of 510 compiled CPython comparisons, 486 match bit-for-bit and 24
  differ only in finite transcendental results by at most two ULPs. These are
  recorded precision differences, not exact passes; type/sign/nonfinite/error
  comparisons match. Typecheck, scoped lint and selected workspace build pass.
  General complex-operand powers, the pow builtin, guest power dispatch and a
  deterministic transcendental rounding policy remain unfinished, alongside
  broader interpreter/object/SDK/safe-fs work.
- Added complex-operand ** execution, using metered complex multiplication and
  division for integral exponents through magnitude 100, and the principal
  logarithmic branch otherwise. Mixed native numeric operands convert before
  shortcuts; zero-base errors, signed branch direction and overflow diagnostics
  are preserved. The implementation reuses existing complex product/quotient
  kernels and their nonfinite recovery rather than duplicating them.
- Six tests cover small powers/inverses, principal branches, mixed conversions,
  zero/nonfinite/error cases and shared-execution allocation limits. All 5,005
  tests in 437 files pass; typecheck, scoped lint and selected workspace build
  pass. Of 300 compiled CPython comparisons, 290 match bit-for-bit and ten have
  finite component rounding differences of one ULP; types, signs, nonfinite
  values and errors match. General transcendental accuracy remains platform-
  dependent, not an exact CPython compatibility claim. The pow builtin, guest
  binary/ternary power dispatch and broader interpreter/object/SDK/safe-fs
  integration remain unfinished.
- Added pow builtin binding for base/exp/mod and shared exact-native runtime
  power dispatch. Omitted/None mod uses ordinary ** kernels; integer mod uses
  metered modular power. Distinct native ternary slots retain their ordering,
  including float-modulus rejection and complex conversion-before-modulo errors.
  Required arguments are checked before duplicate-keyword diagnostics.
- An explicit execution-owned power capability supports complete guest numeric
  dispatch and unrestricted results; it receives original operands and canonical
  None for an omitted modulus. Automatic guest binary/ternary slot assembly is
  still unfinished rather than hidden behind native fallback or index coercion.
- Five tests cover native families, inverses, keyword/error precedence, guest
  forwarding and cancellation. All 5,010 tests in 438 files pass. All 988 compiled
  CPython comparisons match across module/nested calls and native ternary type
  combinations. Typecheck, scoped lint and selected workspace build pass. Existing
  transcendental rounding differences remain; automatic builtin/object assembly
  and broader interpreter/SDK/safe-fs integration remain unfinished.
- Connected the execution-owned power capability to ** expressions and frame
  hooks, sharing dispatch, cancellation checks and unsupported-operand diagnostics
  with pow. The separately callable native slot kernel remains available for
  object-protocol adapters. Existing PowContext imports remain valid through a
  type alias to the shared RuntimePowerContext.
- Six new compiled-runtime regression cases verify operator/builtin parity in
  module and nested frames, original operand/result identity, hook receiver and
  cancellation after successful or declined guest operations. Native unsupported
  ** operands now raise Python TypeError rather than an implementation-gap error.
  All 5,016 tests in 438 files pass. All 988 native and 32 guest forward/reflected
  CPython comparisons match results, errors and traces. Typecheck, scoped lint
  and selected workspace build pass. Concrete automatic type/slot and builtin
  assembly, existing transcendental precision differences and broader runtime/
  SDK/safe-fs integration remain unfinished.
- Connected statement-frame in-place capabilities to augmented assignment.
  Guest in-place slots run first; absent/declined slots retain native container
  mutation before ordinary expression fallback, including the shared guest power
  policy. Existing target resolution/read/RHS/write ordering is retained, and
  exceptions do not trigger fallback or write-back. No completed mutation is
  rolled back. Ordinary fallback carries augmented diagnostic context so final
  power/addition declines name **=/+= without rewriting inner guest exceptions.
- Six new cases reproduce and cover augmented power negotiation, single indexed
  target evaluation, failure isolation and augmented diagnostics. All 5,022 tests
  in 438 files pass. All 32 compiled CPython augmented-power result/error/trace
  comparisons match across module/nested frames, in-place success/decline/error
  and ordinary/reflected fallback. Typecheck, scoped lint and selected workspace
  build pass. Automatic slot/type assembly, remaining operator families, guest
  container iteration/hints and broader interpreter/SDK/safe-fs work remain open.
- Connected list += to the frame's existing iteration capability with source
  hint evaluation enabled. Exact list/self-extension retains its finite storage
  fast path; other sources acquire an iterator, validate their original source
  length/hint and append incrementally. In-place context now carries iteration
  and ordinary binary capabilities together, removing the fallback-only wrapper.
- Three regression cases cover guest extension, hint failure before mutation and
  partial mutation after next failure, preserving list identity through aliases.
  All 5,025 tests in 438 files pass. All 96 compiled CPython comparisons match
  results/errors/traces for direct/indexed targets, nested frames, self-extension,
  hint errors and iterator failures. Typecheck, scoped lint and selected workspace
  build pass. Advisory hints still do not trigger speculative capacity allocation.
  Guest list.extend method wiring, automatic object/builtin assembly and broader
  interpreter/SDK/safe-fs integration remain unfinished.
- Connected native list.extend attribute lookup and method invocation to the
  execution's iteration capability. Guest source acquisition/hints now match
  list +=; exact lists retain storage-level extension and methods return None.
  Saved bound methods retain the supplied capability without resolving a new
  target, and partial additions survive iterator failure.
- Three additional regression cases share the += success/hint-error/next-error
  checks while verifying method None returns. All 5,028 tests in 438 files pass.
  All 120 compiled CPython method comparisons match results/errors/traces across
  direct/indexed receivers, nested calls, saved bound methods, self-extension and
  failures. Typecheck, scoped lint and selected workspace build pass. Hint-based
  speculative capacity allocation is still omitted; broader native-method guest
  protocols, automatic object/builtin assembly and interpreter/SDK/safe-fs work
  remain unfinished.
- Connected list.count/index/remove to supplied rich comparison and truth
  capabilities through native attribute lookup. Identity shortcuts remain in
  storage; nonidentical elements use guest equality followed by truth conversion.
  Live traversal and numeric-position removal preserve mutations performed by
  guest comparisons. Post-comparison/truth checkpoints enforce cancellation.
- Four regression cases cover each search method and removal after equality
  shifts storage. All 5,032 tests in 438 files pass. All 144 compiled CPython
  comparisons match results/errors/traces for true/false results, identity
  matches, append/pop/clear during equality, and equality/truth failures in module
  and nested calls. Typecheck, scoped lint and selected workspace build pass.
  Guest index conversion, tuple search wiring, automatic object/builtin assembly
  and broader interpreter/SDK/safe-fs work remain unfinished.
- Connected tuple.count/index to guest equality and truth, extracting the shared
  metered search-equality adapter used by list methods. Collections still own
  identity shortcuts and traversal: tuples retain their original immutable slots
  even when comparison callbacks rebind the variable naming the receiver.
- Two additional regression cases verify tuple count/index callback execution.
  All 5,034 tests in 438 files pass. All 64 compiled tuple and 144 list CPython
  comparisons match results/errors/traces, including identity matches, receiver
  rebinding and equality/truth failures. Typecheck, scoped lint and selected
  workspace build pass. Guest search-bound conversion, remaining native-method
  protocols, automatic object/builtin assembly and broader interpreter/SDK/safe-fs
  integration remain unfinished.
- Connected list/tuple index search bounds to the frame's integer-index
  capability. Bounds convert left to right, preserve guest failures and warning
  policy, and saturate oversized results to signed index width. Missing slots
  retain search-specific diagnostics; direct integer subclasses bypass slots.
- Twelve additional regression cases cover compiled list/tuple wiring, clipping,
  missing slots, invalid results, warnings, guest errors and cancellation.
  All 5,046 tests in 439 files pass, as do typecheck, scoped lint and the selected
  workspace build. The existing 144 list and 64 tuple compiled CPython search
  comparisons still pass. Text search and other native-method index consumers,
  automatic object/builtin assembly and broader interpreter/SDK/safe-fs work
  remain unfinished.
- Connected list.insert/pop to the shared guest integer-index protocol, removing
  their duplicated exact-value conversion. Signed-width overflow still raises
  before the operation mutates storage. Index callbacks run before storage
  normalization, so their own list mutations remain visible and are not undone.
- Six regression cases cover compiled execution, conversion-side mutation,
  positive/negative overflow and guest failures. All 5,052 tests in 439 files
  pass; 42 direct native-method comparisons against CPython match for ordinary
  and oversized bounds with unchanged, cleared or shortened receivers.
  Typecheck, scoped lint and selected workspace build pass. Remaining index
  consumers, automatic object/builtin assembly and broader interpreter/SDK/
  safe-fs integration remain unfinished.
- Connected exact list/tuple/string/bytes/range subscription to frame-supplied
  integer-index capabilities. Conversion preserves guest failures and shared
  result validation; storage is accessed only after a cancellation checkpoint.
  Fixed-width sequences report overflow using the original guest type name,
  while range indices retain arbitrary precision. Mapping keys remain untouched.
- Seven regression cases cover compiled wiring, conversion-side mutation,
  cancellation, missing slots, errors and overflow/range differences. All 5,059
  tests in 439 files pass, together with 40 CPython subscription comparisons,
  typecheck, scoped lint and selected workspace build. Guest slice components,
  subscript assignment/deletion, automatic object/builtin assembly and broader
  interpreter/SDK/safe-fs integration remain unfinished.
- Connected slice subscription components to the shared index-result protocol.
  Step converts before start and stop; zero step and guest errors prevent later
  conversion. None remains omitted, and arbitrary-precision components remain
  available to range consumers rather than being narrowed prematurely.
- Eight regression cases verify compiled sequence slicing, conversion order,
  oversized results, failures and cancellation. All 5,067 tests in 440 files
  pass; 625 guest-slice comparisons match CPython across list, tuple, string,
  bytes and range, including huge positive/negative bounds and strides.
  Typecheck, scoped lint and selected workspace build pass. Subscript mutation,
  automatic object/builtin assembly and broader interpreter/SDK/safe-fs
  integration remain unfinished.
- Connected list subscript assignment/deletion, including slices and augmented
  writeback, to the same frame integer-index capability as reads. Extracted
  shared sequence-index conversion so diagnostics and fixed-width policy cannot
  diverge between reads and writes. Mapping keys and immutable-receiver checks
  remain outside index conversion; retained augmented keys convert again on set.
- Five compiled regression cases pass. All 5,072 tests in 440 files pass, along
  with 84 CPython mutation comparisons (oversized/negative indices and callbacks
  clearing or shortening the receiver) and 40 subscription-read comparisons.
  Typecheck, scoped lint and selected workspace build pass. Guest replacement
  iteration for slice assignment, automatic object/builtin assembly and broader
  interpreter/SDK/safe-fs integration remain unfinished.
- Connected guest iterable slice replacements through the expression iteration
  capability. As in CPython's sequence materialization, acquisition is followed
  by iter(cursor), then a length hint on the original cursor, before collecting
  values. Initial iterator TypeErrors retain slice-assignment diagnostics;
  later cursor/hint/next failures propagate. Failed collection does not apply
  partially collected replacements. Bound iteration callbacks are metered.
- Three compiled regression cases cover success, hint failure and next failure.
  All 5,075 tests in 440 files pass, as do 24 CPython replacement comparisons
  across contiguous, extended and reversed slices, typecheck, scoped lint and
  selected workspace build. More callback-mutation audits, automatic object/
  builtin assembly and broader interpreter/SDK/safe-fs integration remain
  unfinished.
- Audited slice-replacement callbacks against CPython: 72 comparisons match
  across clearing/appending/removing destination items, successful collection,
  failures and contiguous/extended/reversed slices. Added six compiled mutation
  regressions confirming successful normalization uses current storage and
  collection failure preserves callback effects without applying partial output.
- Added a seventh compiled regression for cursor redirection: iter(cursor) may
  return another iterator, but the original cursor supplies the length hint.
  The observed trace matches CPython. No runtime fix was justified by these
  audits. All 5,082 tests in 440 files and typecheck pass. This increment changes
  tests only; automatic object/builtin assembly and broader interpreter/SDK/
  safe-fs integration remain unfinished.
- Connected string/bytes find, rfind, index, rindex, count, startswith and
  endswith bounds to the frame's guest integer-index capability. Shared bound
  conversion retains explicit None, signed-width saturation, left-to-right
  conversion and existing per-method needle validation order.
- Seven compiled regression cases exercise both receiver types. All 5,089
  tests in 440 files pass; 350 CPython text-search comparisons match values,
  errors and conversion traces for negative, ordinary and oversized bounds.
  Typecheck, scoped lint and selected workspace build pass. Guest bytes needles,
  remaining native-method protocols, automatic object/builtin assembly and
  broader interpreter/SDK/safe-fs integration remain unfinished.
- Connected bytes find/rfind/index/rindex/count integer needles to guest index
  conversion after both search bounds. Exact bytes retain their storage path;
  integer results must lie in 0..255, including arbitrarily large guest results.
  Missing slots retain bytes-specific diagnostics, while invalid results and
  guest exceptions retain shared protocol behavior.
- Nine compiled regression cases cover ordering, successful searches, negative
  and oversized results, invalid returns and guest TypeErrors. All 5,098 tests
  in 440 files pass; 875 CPython bytes-search comparisons match results/errors
  and traces. Typecheck and selected workspace build pass. Remaining native
  protocols, buffer capabilities, automatic object/builtin assembly and broader
  interpreter/SDK/safe-fs integration remain unfinished.
- Connected str.join/bytes.join to guest iteration, extracting shared sequence
  materializer acquisition with slice assignment. Initial acquisition TypeErrors
  receive consumer diagnostics; cursor reacquisition and original-cursor hints
  remain outside that boundary. Joins still collect before validating members,
  so later iterator errors take precedence over earlier invalid elements.
- Four compiled regressions verify both joins and failure precedence. All 5,102
  tests in 440 files pass; 32 CPython guest-join comparisons and 72 existing
  slice callback-mutation comparisons match values/errors/traces. Typecheck,
  scoped lint and selected workspace build pass. String subclasses, buffers,
  remaining native protocols, automatic object/builtin assembly and broader
  interpreter/SDK/safe-fs integration remain unfinished.
- Connected str.replace/bytes.replace counts to guest integer-index conversion,
  including str's count keyword. Extended the signed-size converter and reused
  it for list.insert/pop, preserving overflow errors instead of saturation.
- Three compiled regressions cover positional and keyword counts. All 5,105
  tests in 440 files pass; 14 CPython replacement-count comparisons and 42 list
  insert/pop comparisons match, including negative and oversized counts.
  Typecheck, scoped lint and selected workspace build pass. Remaining native
  protocols, automatic object/builtin assembly and broader interpreter/SDK/
  safe-fs integration remain unfinished.
- Connected str/bytes split/rsplit limits and center/ljust/rjust/zfill widths to
  guest signed-size conversion through native attribute lookup. Existing argument
  binding, separator/fill validation and storage algorithms remain unchanged.
- Six compiled regression cases exercise both receiver types. All 5,111 tests
  in 440 files pass; 84 CPython comparisons match results/errors and conversion
  traces across negative, zero, positive and oversized sizes. Typecheck and
  selected workspace build pass. Remaining native integer/truth arguments,
  automatic object/builtin assembly and broader interpreter/SDK/safe-fs
  integration remain unfinished.
- Connected str/bytes expandtabs to guest integer-index conversion while
  preserving signed 32-bit overflow checks. The general runtime integer-index
  helper now optionally accepts guest capabilities; signed-size conversion
  reuses it rather than duplicating native-versus-guest dispatch.
- Two compiled regressions cover keyword tab sizes. All 5,113 tests in 440 files
  pass; 18 CPython tabsize comparisons (tabs/newlines, negative values and C-int
  overflow) and 84 split/pad comparisons match. Typecheck and selected workspace
  build pass. Remaining native protocols, automatic object/builtin assembly and
  broader interpreter/SDK/safe-fs integration remain unfinished.
- Connected bytes.hex grouping to guest integer-index conversion, retaining
  signed C-int bounds and conversion before separator length/type/ASCII checks.
- Two compiled regressions verify positive/negative keyword grouping. All 5,115
  tests in 440 files pass; 30 CPython comparisons match output/errors/traces
  across grouping direction, zero, signed-width endpoints/overflow and invalid
  separators. Typecheck, scoped lint and selected workspace build pass.
  Remaining native protocols, automatic object/builtin assembly and broader
  interpreter/SDK/safe-fs integration remain unfinished.
- Connected str/bytes splitlines keepends to the frame truth capability, with
  a post-conversion cancellation checkpoint. This argument follows truth
  semantics rather than integer-index conversion, including empty inputs.
- Four compiled regressions cover guest true/false flags for both receiver
  types. All 5,119 tests in 440 files pass; 32 CPython comparisons match outputs
  and truth traces for empty input, CR/LF/CRLF and text-only line boundaries.
  Typecheck and selected workspace build pass. Remaining native protocols,
  automatic object/builtin assembly and broader interpreter/SDK/safe-fs
  integration remain unfinished.
- Connected int/bool.to_bytes length and signed arguments to guest index and
  truth capabilities. Length conversion precedes byteorder type validation;
  signed conversion precedes byteorder value/negative-length validation. A
  post-truth checkpoint prevents conversion output after cancellation.
- Two compiled regressions verify ordered length/truth callbacks. All 5,121
  tests in 440 files pass; 200 CPython comparisons match bytes/errors/traces
  across signedness, byte order, negative/zero/oversized lengths and integer
  range errors. Typecheck and selected workspace build pass. Remaining native
  protocols, automatic object/builtin assembly and broader interpreter/SDK/
  safe-fs integration remain unfinished.
- Connected from_bytes signed truth, guest input iteration and yielded byte
  index conversion. Byte collection acquires once and hints the original source,
  not its cursor. ProtocolIterator can explicitly select a source for hints.
  Hint validation runs outside the initial iterator-TypeError rewrite boundary;
  a failing regression caught and corrected that boundary during implementation.
- Three compiled regressions verify signedness, source-hint ordering and invalid
  hints. All 5,124 tests in 440 files pass; 48 CPython comparisons match results,
  byte-range errors and traces. Typecheck and selected workspace build pass.
  Guest __bytes__, buffers, automatic object/builtin assembly and broader
  interpreter/SDK/safe-fs integration remain unfinished.
- Connected type-level guest __bytes__ to byte-input conversion through frame
  capabilities. The hook precedes iterable fallback, its result must expose
  bytes storage, and lookup/call/result checkpoints enforce cancellation.
  Existing percent-bytes capability declarations supply the shared slot contract.
- Three compiled regressions cover success, invalid results and hook failures.
  All 5,127 tests in 440 files pass; 24 CPython __bytes__ comparisons and 48
  iterable from_bytes comparisons match values/errors/traces. Typecheck and
  selected workspace build pass. Buffer input, automatic object/builtin assembly
  and broader interpreter/SDK/safe-fs integration remain unfinished.
- Connected the existing buffer-copy capability contract to byte input after
  __bytes__ and before iteration. Acquisition failures propagate; post-copy
  cancellation prevents decoding. The capability owns metered C-order copying
  and release, rather than exposing a live host buffer to the interpreter.
- Four compiled regressions cover buffer success, __bytes__ precedence, failure
  and cancellation. All 5,131 tests in 440 files pass; 24 CPython buffer-provider
  comparisons match results/errors and acquisition/release traces. Typecheck,
  scoped lint and selected workspace build pass. Concrete buffer exporters,
  automatic object/builtin assembly and broader interpreter/SDK/safe-fs
  integration remain unfinished.
- Corrected failed guest byte-input conversion diagnostics to use the supplied
  guest type name rather than internal storage tags, bounded to the shared
  diagnostic limit. Iterator-acquisition error rewriting now checks cancellation
  first. CPython confirms rewriting guest iterator TypeErrors and bounded names.
- Two failing compiled regressions now pass. All 5,133 tests in 440 files pass;
  48 iterable and 24 buffer CPython comparisons remain green. Typecheck and
  selected workspace build pass. Concrete object/buffer models, automatic
  builtin assembly and broader interpreter/SDK/safe-fs integration remain
  unfinished.
- Implemented the metered Unicode translation kernel with ASCII result caching,
  retry when wider/expanding mappings end the fast path, and deletion-run probes
  matching CPython's observable lookup schedule. Output stays in code points;
  cache/output buffers are charged, and callbacks have cancellation checkpoints.
  Reference: CPython v3.14.0 Objects/unicodeobject.c charmap translation routines.
- Twelve regression cases cover mapping schedules, empty input, callback errors
  and cancellation. All 5,145 tests in 441 files pass; 216 CPython comparisons
  match output/errors and lookup traces, including invalid code points.
  Typecheck and selected workspace build pass. Native str.translate binding and
  mapping-result protocols are next; concrete object models, automatic builtin
  assembly and broader interpreter/SDK/safe-fs integration remain unfinished.
- Connected native str.translate to the metered kernel and frame capabilities.
  Native mappings use subscription; guest lookup and pure subclass payload
  inspection are explicit capabilities. LookupError preserves characters, None
  deletes, and integer/string results are validated without coercion hooks.
- Eight compiled regressions cover native mappings, empty input, guest lookup
  schedules and invalid results. All 5,153 tests in 441 files pass; 216 CPython
  comparisons match output/errors and lookup traces. Typecheck, scoped lint and
  selected workspace build pass. str.maketrans, concrete object models, automatic
  builtin assembly and broader interpreter/SDK/safe-fs integration remain
  unfinished.
- Implemented native static str.maketrans for dictionary input and paired Unicode
  strings with optional deletion characters. Code-point keys, duplicate overwrite
  order and deferred value validation match Python; fresh dictionary storage uses
  the current call's hash-policy domain. Input/output iteration is metered.
- Eleven compiled regressions cover translation composition, non-BMP strings,
  validation order, shared values and unrestricted integer keys. All 5,164 tests
  in 441 files pass; 258 CPython comparisons match tables and errors. Typecheck,
  scoped lint and selected workspace build pass. Guest subclass payload handling,
  type-level descriptor installation, automatic builtin assembly and broader
  interpreter/SDK/safe-fs integration remain unfinished.
- Audited native translation callback safety with eight additional compiled
  regressions: cancellation after lookup, exception classification and each
  subclass-payload inspector; integer/string payload results; recognized guest
  lookup errors; and propagation of unrecognized failures. No implementation
  defect was reproduced, so runtime behavior was left unchanged.
- All 5,172 tests in 441 files pass; typecheck and scoped lint pass. This is a
  test-only increment. Concrete guest object assembly and remaining interpreter,
  SDK and safe-fs integration remain unfinished.
- Added an explicit contiguous buffer lease capability and connected it to
  bytes.translate through runtime frames. Table leases remain active while
  deletion buffers are acquired; copies observe intervening mutations. Both
  leases are released in Python order on success, errors and cancellation.
  Providers own contiguity checks, metered copying and non-throwing cleanup;
  the earlier copy-and-release conversion capability cannot express this lifetime.
- Three failing compiled regressions now pass. All 5,175 tests in 441 files pass;
  48 CPython comparisons match output/errors and acquisition/release traces,
  including mutation during the second acquisition and invalid table lengths.
  Typecheck, scoped lint and selected workspace build pass. Concrete buffer
  exporters, automatic object assembly and broader interpreter/SDK/safe-fs
  integration remain unfinished.
- Connected bytes.maketrans to contiguous buffer leases. Both arguments are
  acquired before length comparison and snapshots, preserving mutations during
  the second acquisition. Cleanup releases the first then second lease even on
  acquisition failure, invalid lengths or cancellation.
- Four failing compiled regressions now pass. All 5,179 tests in 441 files pass;
  48 CPython comparisons match tables/errors and acquisition/release traces.
  Typecheck, scoped lint and selected workspace build pass. Remaining native
  buffer consumers, concrete exporters, automatic object assembly and broader
  interpreter/SDK/safe-fs integration remain unfinished.
- Connected bytes.strip/lstrip/rstrip to contiguous buffer leases. Explicit
  character buffers are acquired even for empty or unchanged receivers, copied
  with cancellation checks and released on every exit. Omitted/None arguments
  retain whitespace semantics; unchanged receiver identity is preserved.
- Six failing compiled regressions now pass. All 5,185 tests in 441 files pass;
  120 CPython comparisons match output/errors, identity and lease traces.
  Typecheck, scoped lint and selected workspace build pass. Remaining native
  buffer consumers, concrete exporters, automatic object assembly and broader
  interpreter/SDK/safe-fs integration remain unfinished.
- Connected bytes.removeprefix/removesuffix to contiguous buffer leases with
  post-acquisition/copy cancellation checks and unconditional cleanup. Empty or
  unmatched affixes retain receiver identity. Partition methods share the file
  but remain unchanged: CPython retains bytearray/memoryview separator objects
  and exposes a buffer wrapper for Python-level exporters, needing separate
  retained-object policy rather than substituting a copied bytes value.
- Four failing compiled regressions now pass. All 5,189 tests in 441 files pass;
  80 CPython comparisons match output/errors, identity and lease traces.
  Typecheck, scoped lint and selected workspace build pass. Buffer partitioning,
  remaining native consumers, concrete exporters, automatic object assembly and
  broader interpreter/SDK/safe-fs integration remain unfinished.
- Connected bytes.partition/rpartition to buffer leases. A lease can identify
  its Py_buffer.obj-equivalent guest object; matched results retain that object,
  defaulting to the direct exporter, rather than substituting copied bytes.
  Prefix/suffix removal and partition now share acquisition and cleanup.
- Four failing compiled regressions now pass. All 5,193 tests in 441 files pass;
  80 CPython comparisons match results/errors and lease traces. Typecheck,
  scoped lint and selected workspace build pass. The first full-suite run raced
  dependency emission and saw FsError import failures; a post-build rerun passed
  completely. Run dependency builds before unit checks, not concurrently.
  Concrete export-wrapper objects, remaining buffer consumers, automatic object
  assembly and broader interpreter/SDK/safe-fs integration remain unfinished.
- Connected bytes.replace to contiguous buffer leases. Both buffers remain
  acquired across guest count conversion; snapshots observe mutations performed
  by __index__. Cleanup releases old then replacement on success, acquisition
  failure, count errors and cancellation, without invoking __bytes__ coercion.
- Four failing compiled regressions now pass. All 5,197 tests in 441 files pass;
  36 CPython comparisons match output/errors and acquisition/index/release traces.
  Typecheck, scoped lint and selected workspace build pass. The final unit run
  followed build completion. Remaining native buffer consumers, concrete
  exporters, automatic object assembly and broader interpreter/SDK/safe-fs
  integration remain unfinished.
- Connected bytes.split/rsplit to contiguous separator leases. Guest maxsplit
  conversion precedes acquisition, matching CPython and exposing intervening
  mutations. Leases cover separator copying and result construction and release
  on every exit; the shared str path retains its existing semantics.
- Three failing compiled regressions now pass. All 5,200 tests in 441 files pass;
  320 CPython comparisons match output/errors and lease traces across directions,
  separator contents and split limits. Typecheck, scoped lint and selected
  workspace build pass. Remaining native buffer consumers, concrete exporters,
  automatic object assembly and broader interpreter/SDK/safe-fs integration
  remain unfinished.
- Connected bytes.find/rfind/index/rindex/count to contiguous buffer needles.
  Bounds convert first, then buffer exports take precedence over guest index
  slots; absent exports fall through to the existing integer-needle protocol.
  Leases release on search success and failure, including missing required matches.
- Six failing compiled regressions now pass. All 5,206 tests in 441 files pass;
  800 CPython comparisons match output/errors and lease traces across methods,
  patterns and bounds. Typecheck, scoped lint and selected workspace build pass.
  Remaining native buffer consumers, concrete exporters, automatic object
  assembly and broader interpreter/SDK/safe-fs integration remain unfinished.
- Connected bytes.startswith/endswith to contiguous buffer candidates, including
  lazy tuple alternatives. Each candidate lease releases before the next is
  attempted; successful matches skip later invalid candidates. Acquisition/copy
  cancellation checks and cleanup preserve the existing bound-conversion order.
- Four failing compiled regressions now pass. All 5,210 tests in 441 files pass;
  320 CPython comparisons match output/errors and lease traces across methods,
  patterns and bounds. Typecheck, scoped lint and selected workspace build pass.
  Remaining native buffer consumers, concrete exporters, automatic object
  assembly and broader interpreter/SDK/safe-fs integration remain unfinished.
- Connected bytes.join to contiguous buffer elements. All member validation and
  acquisitions precede copying, so later exports can mutate earlier buffers.
  Leases remain live through output construction and release in input order,
  including on invalid members, acquisition failures and cancellation. Guest
  export failures become position-specific TypeErrors with bounded type names;
  host failures and execution limits are not rewritten.
- Four failing compiled regressions now pass. All 5,214 tests in 441 files pass;
  24 CPython comparisons match output/errors and acquisition/release traces,
  including shared mutable exports. Typecheck, scoped lint and selected workspace
  build pass. Mutable source-list callback audits, remaining buffer consumers,
  concrete exporters, automatic object assembly and broader interpreter/SDK/
  safe-fs integration remain unfinished.
- Corrected bytes.join source-list handling: snapshots hid guest buffer-callback
  mutations. Native lists now use live indexed reads with a captured expected
  length. Same-size replacements affect later members; size changes after a
  successful acquisition raise RuntimeError and release all acquired exports.
  Acquisition failure retains precedence over size-change detection.
- Four failing compiled regressions now pass. All 5,218 tests in 441 files pass;
  60 CPython comparisons match output/errors and lease traces for replacement,
  append, clear and pop callbacks. Typecheck, scoped lint and selected workspace
  build pass. Remaining native buffer consumers, concrete exporters, automatic
  object assembly and broader interpreter/SDK/safe-fs integration remain
  unfinished.
- Connected byte padding fill validation to pure bytes/subclass and bytearray
  payload inspection. Python accepts these one-byte values but rejects general
  buffers; no buffer acquisition or __bytes__ coercion occurs. Length errors
  retain bytes-versus-bytearray wording, including when width needs no padding.
- Four failing compiled regressions now pass. All 5,222 tests in 441 files pass;
  108 CPython comparisons match outputs/errors across methods, lengths, widths
  and bytes/bytearray/general-buffer candidates. Typecheck, scoped lint and
  selected workspace build pass. Concrete bytearray/exporter models, remaining
  native protocols, automatic object assembly and broader interpreter/SDK/safe-fs
  integration remain unfinished.
- Connected byte membership expressions to guest integer-index and contiguous
  buffer capabilities. Unlike byte search methods, membership prefers index
  slots over buffer exports. Integer ranges, buffer errors, negation and cleanup
  retain Python semantics; explicit container containment policies still win.
- Four failing compiled regressions now pass. All 5,226 tests in 441 files pass;
  60 CPython comparisons match results/errors and index/acquisition/release
  traces. Typecheck, scoped lint and selected workspace build pass. Remaining
  native protocols, concrete exporters, automatic object assembly and broader
  interpreter/SDK/safe-fs integration remain unfinished.
- Connected byte concatenation to contiguous buffer operands after numeric/
  reflected negotiation, including augmented assignment's immutable fallback.
  Empty buffers retain the left bytes object. Guest acquisition failures become
  bounded concatenation TypeErrors; host failures and cancellation propagate,
  and acquired leases always release.
- Four failing compiled regressions plus two reflected-dispatch cases pass.
  All 5,232 tests in 441 files pass; 18 CPython comparisons match output/errors,
  identity and lease traces. Typecheck, scoped lint and selected workspace build
  pass. Remaining native protocols, concrete exporters, automatic object assembly
  and broader interpreter/SDK/safe-fs integration remain unfinished.
- Connected bytes.fromhex to contiguous buffer inputs alongside existing exact
  str/bytes paths. Acquisition errors propagate, decoding reuses the metered hex
  kernel, and leases release after success, malformed input or cancellation.
  Unsupported exporters use bounded guest type diagnostics.
- Five failing compiled regressions now pass. All 5,237 tests in 441 files pass;
  18 CPython comparisons match output/errors and lease traces for empty, valid,
  malformed and non-ASCII inputs. Typecheck, scoped lint and selected workspace
  build pass. Concrete exporters, subclass constructors, remaining native
  protocols, automatic object assembly and broader interpreter/SDK/safe-fs
  integration remain unfinished.
- Connected native list/tuple/iterator membership and noninteger range fallback
  to the shared rich-equality/truth adapter already used by list search methods.
  Membership had bypassed guest comparison bindings. Identity shortcuts and
  live list iteration remain, so appended elements can satisfy later membership.
- Three failing compiled regressions now pass. All 5,240 tests in 441 files pass;
  48 CPython comparisons match results/errors and equality/truth traces across
  lists, tuples, iterators, mutations and negation. Typecheck, scoped lint and
  selected workspace build pass. Dictionary-view guest equality, remaining native
  protocols, automatic object assembly and broader interpreter/SDK/safe-fs
  integration remain unfinished.
- Connected dictionary values/items view membership to shared guest equality
  and truth conversion. The view generator retains identity shortcuts, key
  lookup policy and mutation detection; only yielded value comparisons now use
  the execution frame's rich-comparison capabilities.
- Two failing compiled regressions now pass. All 5,242 tests in 441 files pass;
  32 CPython comparisons match results/errors and equality/truth traces across
  both views, mutations and negation. Typecheck, scoped lint and selected
  workspace build pass. Remaining native comparison protocols, automatic object
  assembly and broader interpreter/SDK/safe-fs integration remain unfinished.
- Connected nested native container equality tasks to prepared guest equality
  slots and truth conversion through frame capabilities. Undefined guest work
  falls back to the existing explicit native comparison stack, avoiding host
  recursion for native nesting. Identity shortcuts and comparison-depth limits
  remain enforced; root guest comparison negotiation is unchanged.
- Four failing compiled regressions now pass. All 5,246 tests in 441 files pass;
  32 CPython comparisons match results/errors and traces across list, tuple,
  dictionary and nested-list equality/inequality. Typecheck, scoped lint and
  selected workspace build pass. Uncoerced guest ordering results, remaining
  comparison protocols, automatic object assembly and broader interpreter/SDK/
  safe-fs integration remain unfinished.
- Connected nested lexicographic ordering to prepared guest ordering slots.
  First-unequal-pair ordering decisions return guest objects unchanged through
  native nesting; equality probes still truth-convert. Native comparisons keep
  boolean overloads, while guest-enabled comparisons expose RuntimeValue results.
  Native traversal remains stack-based with depth and callback checkpoints.
- Four failing compiled regressions now pass. All 5,250 tests in 441 files pass;
  48 CPython comparisons match values/result identity, errors and operator traces
  for list, tuple and nested-list ordering. Typecheck, scoped lint and selected
  workspace build pass. Remaining comparison/object protocols, automatic object
  assembly and broader interpreter/SDK/safe-fs integration remain unfinished.
- Fixed list comparison mutation handling after guest equality/truth callbacks:
  recheck current lengths before the unequal-pair decision, and reread current
  elements for ordering. Replacements now affect ordering, and clearing lists
  can resolve equality/ordering by their current sizes, matching CPython.
- Ten failing compiled regressions now pass. All 5,260 tests in 441 files pass;
  336 CPython comparisons match results and callback traces across six operators,
  replacement/clear/append mutations, equality/truth callback phases, and nonzero
  comparison positions. The previous 48 guest ordering comparisons still match.
  Typecheck, scoped lint and selected workspace build pass. Remaining comparison/
  object protocols, automatic object assembly and broader interpreter/SDK/safe-fs
  integration remain unfinished.
- Dictionary equality now scans the existing positional entry storage instead
  of the host insertion-order iterator when dictionary layout is enabled.
  Numeric positions survive callback clear/refill and insertion compaction;
  cached hashes and values captured before lookup remain intact. Storage without
  dictionary layout keeps its existing insertion-order traversal.
- Two failing compiled regressions now pass, with an additional positional
  compaction regression. All 5,263 tests in 441 files pass; 60 CPython cases
  match results and value-comparison traces across dictionary sizes, clear,
  refill, replacement, deletion, compaction and equality outcomes. Selected
  workspace build, typecheck and scoped lint pass. Automatic object assembly,
  remaining native protocols and broader interpreter/SDK/safe-fs integration
  remain unfinished.
- Comparison tasks now distinguish truth-consuming container probes from raw
  delegated results. Cells/proxies retain the caller's mode through native
  delegation; direct cell equality returns guest objects without coercion and
  inequality now dispatches the requested guest operator. A unified optional
  prepared-comparison callback supports all operators; existing specialized
  equality/ordering callbacks remain supported. Traversal stays stack-based.
- Two failing direct-cell regressions now pass, with two nested-cell truth
  conversion guards. All 5,267 tests in 441 files pass. CPython comparisons match
  96 cell cases (six operators, nested cells/lists, truth outcomes and errors),
  80 earlier container cases and 336 list-mutation cases. Selected workspace
  build, typecheck and scoped lint pass. Remaining object protocols, automatic
  object assembly and broader interpreter/SDK/safe-fs integration remain open.
- Audited mapping-proxy delegated guest comparisons against CPython. No runtime
  mismatch was found: delegation retains the other proxy, reflects operators
  when the proxy is on the right, returns direct guest results unchanged, and
  truth-converts nested equality probes. Added eight compiled regression cases
  covering these paths (including all six operators and three operand layouts).
- All 308 compiled-program tests and 72 CPython proxy comparisons pass, together
  with typecheck and scoped lint. This increment changes tests only; it does not
  claim generalized non-dictionary proxy payloads or automatic guest object
  protocol assembly. Those and broader interpreter/SDK/safe-fs integration
  remain unfinished.
- Added the missing internal print builtin with explicit stdout/write/flush
  capabilities and shared representation/truth policies. Keyword-only sep/end/
  file/flush binding preserves None defaults, disabled stdout, incremental
  writes, write lookup before str conversion, subclass separator behavior,
  partial output on errors and flush only after successful writes. No implicit
  host console or filesystem access is introduced; callbacks are checkpointed.
- Added 13 focused tests and a compiled-program registration test. The initial
  missing-module test failed before implementation; CPython validation also
  caught two keyword-diagnostic regressions, reproduced before correction.
  All 5,289 tests in 442 files pass; 216 CPython cases match write traces and
  errors across argument counts, separators, terminators, disabled stdout,
  flush values and write failures. Selected workspace build, typecheck and
  scoped lint pass. Automatic builtin registration, concrete safe-fs streams,
  input, guest object assembly and the complete public interpreter remain open.
- Inspected the safe-fs/print boundary: safe-fs operations are asynchronous while
  current builtin invocation is synchronous. Direct callback wiring would return
  before writes complete. Resumable host effects and concrete guest streams are
  still required; no buffered-output substitute is presented as that integration.
- Added opt-in safe-fs error translation through an explicit guest-platform errno
  policy. Internal Python filesystem faults retain errno, strerror and both
  filenames, select OSError subclasses by portable safe-fs code, and render paths
  with Python repr. Without a policy the existing raw FsError contract remains;
  unrelated host failures retain identity. Cancellation precedes translation.
- Sixteen new tests cover classification, payloads, quoting, cancellation and
  real in-memory safe-fs failures. The missing-module test and a subsequent
  cancellation regression failed before implementation/fix. All 5,305 tests in
  443 files pass; 180 CPython error payload comparisons match. Selected workspace
  build, typecheck and scoped lint pass. Guest exception-object construction,
  platform-policy assembly, resumable filesystem execution and full interpreter
  integration remain unfinished.
- Added a shared builtin namespace assembler for all 35 currently implemented
  global builtin function/constructor capabilities and canonical singleton names.
  Function names come from factory results; context contracts derive from the
  existing factory signatures. Required object/class/I/O policies stay explicit,
  optional guest protocols preserve native fallbacks, and caller extensions can
  supply or override entries without modifying another execution's namespace.
- Five new tests cover registration, namespace isolation/extensions, protocol
  forwarding, cancellation, and compiled module/nested-function execution using
  the shared namespace. The missing-module regression failed before implementation.
  All 5,310 tests in 444 files pass; build, typecheck and scoped lint pass. The
  compiled example's output/result agrees with CPython. Native type objects,
  exception classes, remaining builtins, automatic policy assembly, resumable
  filesystem effects and complete public interpreter integration remain open.
- Hardened namespace extension assembly: checkpoint before unpacking yielded
  entries and in a finally boundary around iterator acquisition/advancement/
  cleanup. Cancellation cannot be replaced by an iterator error or allow entry
  getters to run after an aborted next call; ordinary errors retain identity.
- Two failing regressions now pass, with an additional ordinary-error/cleanup
  guard. All 5,313 tests in 444 files pass; the final focused tests, selected
  build, typecheck and scoped lint pass. Full builtin/object assembly, callback
  invocation integration, resumable filesystem effects and the public interpreter
  remain incomplete.
- Added an optional builtin invocation capability supplied by concrete runtime
  frames. Callback calls reenter normal argument collection, callability checks,
  bound-method handling and compiled-function dispatch, retaining execution call
  limits and lexical namespaces. StopIteration classification excludes fatal
  execution signals and can use the frame's guest iteration policy.
- Map now uses this invocation capability when no explicit callback policy was
  configured; explicit policies retain priority. Lazy iterators preserve the
  capability needed to invoke closures after their creating function returns.
  Map context registration is therefore optional in the shared namespace.
- The compiled closure regression failed before implementation; two additional
  tests protect laziness and explicit overrides. All 5,316 tests in 444 files
  pass; 36 compiled map cases match CPython across functions, lambdas, closures,
  empty sources and non-callable errors. Build, typecheck and scoped lint pass.
  Other callback builtins, native type/exception assembly, resumable filesystem
  effects and the complete public interpreter remain unfinished.
- Filter now uses the runtime invocation capability for predicate calls when
  explicit callbacks are absent. Invocation capabilities also expose the frame's
  truth conversion, so predicate results follow guest truth hooks rather than
  unconditional native truth. Explicit call/truth/exhaustion policies retain
  priority, None/exact-bool predicates retain their fast path, and filtering stays
  lazy. Filter registration no longer requires a separate callback context.
- The compiled closure regression failed before implementation. Three additional
  tests protect lazy invocation, override precedence and frame-owned guest truth.
  All 5,320 tests in 444 files pass; 36 compiled filter cases match CPython across
  functions, lambdas, captured closures, None predicates and empty/nonempty input.
  Build, typecheck and scoped lint pass. Remaining callback builtins, native
  type/exception assembly, resumable filesystem effects and the public interpreter
  remain unfinished.
- Min/max now use runtime invocation capabilities for compiled key functions
  and frame-owned rich comparison/truth when explicit policies are absent.
  Added compareTruth to the invocation contract; explicit key/comparison policies
  retain precedence and native direct-call fallbacks remain. Shared namespace
  registration no longer requires a separate min/max callback context.
- Four failing compiled regressions now pass, plus two explicit-override guards.
  All 5,326 tests in 444 files pass; 96 compiled CPython cases match results,
  errors and key-call traces across both builtins, iterable/positional forms,
  empty inputs, defaults, ties and invalid keys. Build, typecheck and scoped lint
  pass. Other callback/iteration integrations, native type/exception assembly,
  resumable filesystem effects and the complete public interpreter remain open.
- Sorted now uses invocation capabilities for compiled key calls, frame rich
  less-than comparisons and reverse truth conversion when explicit policies are
  absent. Explicit sort policies retain priority; source materialization and
  option-validation order remain unchanged. Sorted context registration is now
  optional in the shared builtin namespace.
- The compiled stable-reverse regression failed before implementation. Two
  additional tests cover invocation callback order and explicit overrides. All
  5,329 tests in 444 files pass; 64 compiled CPython cases match results, errors
  and key-call order across lists/tuples, empty/nonempty inputs, ties, reverse and
  invalid keys. Build, typecheck and scoped lint pass. Exact sort comparison
  scheduling, remaining callback/iteration integrations, native type/exception
  assembly, resumable filesystem effects and the full public interpreter remain
  unfinished.
- Added invocation-owned iteration capability and routed `all`/`any` through
  frame iteration and truth policies when no explicit builtin policy is supplied.
  Both compiled guest-input regressions failed before implementation and now
  verify short-circuit pull/truth order. Additional regressions preserve explicit
  truth overrides and propagate truth-raised StopIteration rather than consuming
  it as iterator exhaustion. All 5,335 tests in 444 files pass; selected workspace
  build, typecheck and scoped lint pass. Remaining builtin input-iteration dispatch (including
  map/filter), guest object assembly and resumable safe-fs effects remain open.
- Routed map/filter input acquisition through invocation iteration when no
  explicit policy exists; map strict truth now likewise uses invocation truth
  and the invocation meter. Three compiled regressions failed first (guest input
  rejection and incorrect strict mismatch), then passed. Four additional tests
  cover explicit iteration/truth priority, receiver preservation, truth failures
  and cancellation before arity validation. Lazy guest input remains usable
  after the creating frame returns. All 5,342 tests in 444 files pass, along with
  selected build, typecheck and scoped lint; rerun differential checks match
  CPython for 36 compiled map and 36 compiled filter cases. Other builtin
  iteration integrations, native type assembly, resumable effects and the full
  public interpreter remain unfinished.
- Routed min/max and sorted guest input iteration through invocation policies
  while preserving explicit min/max iteration and sorted materialization policy
  priority. Three compiled guest-source regressions failed before implementation
  and now pass with compiled key functions, exhaustion and result identity/order.
  Existing tests also exercise override priority including sequence fallback and
  sorted length hints. All 5,345 tests in 444 files pass; selected build, typecheck
  and scoped lint pass. Rerun CPython checks match 96 compiled min/max and 64
  compiled sorted cases. Sorted guest length hints still require its explicit
  materialization policy; automatic hint dispatch, iter/next/enumerate/zip
  invocation integrations, native type assembly and resumable safe-fs effects
  remain unfinished.
- One-argument iter and next now inherit frame-owned iteration when no explicit
  protocol was supplied. Compiled regressions first reproduced guest rejection,
  then verified guest iterator identity, legacy indexed fallback, member identity
  and exhaustion defaults. Additional tests preserve explicit-policy priority,
  original guest exceptions and default-only exhaustion classification. All
  5,349 tests in 444 files pass; selected build, typecheck and scoped lint pass.
  Sentinel iter callback dispatch, enumerate/zip integration, native type and
  exception assembly, resumable safe-fs effects and public execution remain open.
  The existing IterationContext.hints capability can support the pending sorted
  advisory-hint dispatch; it is not yet consumed by sorted's invocation fallback.
- Enumerate and zip now inherit invocation input iteration. Invocation context
  also exposes the frame integer-index policy, used by enumerate start conversion
  through the shared runtimeIntegerIndex helper. Zip strict truth uses invocation
  truth and meter unless explicitly overridden. Two compiled regressions failed
  first, then verified conversion-before-acquisition, tuple results, exhaustion
  defaults and use after the creating function returns. Existing explicit-policy
  tests now check override priority; a new invocation truth cancellation test
  covers empty zip. All 5,352 tests in 444 files pass, plus selected build,
  typecheck and scoped lint. Sentinel iter, sorted advisory hints, sum/reversed
  dispatch, concrete native types, resumable effects and safe-fs execution remain
  unfinished; this is not a full-interpreter completion claim.
- Sorted now requests source length hints through its invocation iterator policy
  using the existing runtimeIterate collector path. The compiled trace regression
  failed first because length/hint calls were absent; it now proves iterator
  acquisition precedes source hints and zero hints do not truncate consumption.
  Min/max still do not request hints. Six additional cases validate negative,
  oversized and noninteger hints, original hint failures, and post-callback
  cancellation before pulls/sorting. All 5,358 tests in 444 files pass; selected
  build, typecheck and scoped lint pass, and 64 compiled sorted differential cases
  still match CPython. Advisory speculative preallocation remains intentionally
  absent, so host preallocation MemoryError behavior is not reproduced. Exact
  sort comparison schedules, remaining builtin integrations, concrete native
  types and resumable safe-fs execution remain unfinished.
- Sum now inherits frame input iteration and ordinary binary-expression dispatch
  for generic additions, retaining staged numeric fast paths and explicit
  addition policy priority. Two compiled regressions failed before the change
  (guest input rejection and missing reflected addition), then passed in nested
  functions. Three additional tests cover explicit receiver/override priority,
  addition-raised StopIteration identity and cancellation before another pull.
  All 5,363 tests in 444 files pass; selected build, typecheck and scoped lint
  pass. Guest string-subclass start classification still requires its explicit
  policy; native type assembly, remaining builtin integrations, suspended effects
  and full safe-fs execution remain unfinished.
- Sentinel iter now inherits frame callability, normal callback invocation,
  sentinel-first rich equality/truth and exhaustion classification when explicit
  callbacks are absent. Iter callback configuration is optional and partial;
  individual supplied policies retain priority and receivers. Two compiled
  regressions failed first and now cover retained closures, permanent exhaustion,
  unconsumed source tail and guest comparison results. Two further tests cover
  eager callability, lazy calls/comparison and explicit overrides. All 5,367 tests
  in 444 files pass; selected build, typecheck and scoped lint pass. Concrete
  native type/exception assembly, remaining builtin frame integration and
  suspended safe-fs execution remain unfinished.
- Callable now inherits invocation callability when no explicit policy is
  configured, with a post-inspection cancellation checkpoint. Compiled eligible
  and ineligible guest regressions failed first, then verified shared frame
  inspection, no speculative calls and native-function bypass. Two additional
  tests cover explicit-policy receiver/priority, argument validation ordering and
  invocation cancellation. All 5,371 tests in 444 files pass; selected build,
  typecheck and scoped lint pass. Reversed still has explicit-only guest policy;
  remaining builtin integrations, concrete guest types, suspended effects and
  full safe-fs execution remain unfinished.
- Chr/bin/oct/hex now inherit invocation integer-index policies unless explicitly
  overridden. Four compiled nested-function regressions failed first and now
  verify guest slot conversion exactly once. Existing chr/radix conversion tests
  run with both inherited and explicit policies, retaining explicit priority,
  strict-subclass warnings, invalid-result errors and original slot failures.
  All 5,377 tests in 444 files pass; selected build, typecheck and scoped lint
  pass. Remaining builtin frame integration, concrete guest type assembly,
  suspended effects and full safe-fs execution remain unfinished.
- Pow now inherits the frame's binary/ternary power policy unless an explicit
  context is supplied; native-number round inherits the frame integer-index
  policy for ndigits. Four compiled regressions failed first and now cover guest
  binary/modular operands and integer/float rounding digits. Two extra power
  tests preserve explicit override/receiver priority, unsupported-type diagnostics
  and post-dispatch cancellation. All 5,383 tests in 444 files pass; selected
  build, typecheck and scoped lint pass. Rerun differential checks match 988
  compiled pow and 717 compiled round cases. Guest __round__ lookup remains
  explicit-only; concrete guest types, remaining builtin integrations and
  suspended safe-fs execution remain unfinished.
- Getattr/hasattr now use frame expression attribute lookup for exact string
  names when no explicit attribute policy is configured. Explicit policies retain
  original name objects, string-subclass classification and guest AttributeError
  subclass recognition. Two compiled regressions failed first and now verify
  native bound-method calls, presence/default handling and NUL/astral/lone-surrogate
  dynamic names. Additional coverage checks explicit priority, inherited lookup
  errors and post-lookup cancellation. All 5,389 tests in 444 files pass; selected
  build, typecheck and scoped lint pass. Unified guest-name/exception identity
  still requires explicit object policies; concrete guest type assembly, remaining
  builtin integrations and suspended safe-fs execution remain unfinished.
- Setattr/delattr now inherit frame statement mutation hooks for exact string
  names when no explicit mutation context is supplied. Explicit contexts retain
  original guest string-subclass names and receivers. Two compiled regressions
  failed first and now verify nested-frame mutation, dynamic Unicode/NUL names,
  assigned-value identity, no preflight reads and None results. Extra coverage
  preserves explicit priority, descriptor failures and completed mutations when
  post-callback cancellation fires. All 5,395 tests in 444 files pass; selected
  build, typecheck and scoped lint pass. Concrete guest object/descriptor wiring,
  remaining builtin integrations and suspended safe-fs execution remain open.
- Added concrete lookupRuntimeSpecialMethod over live runtime type MROs and
  descriptor slots. It binds inherited descriptors using the actual receiver
  type, skips instance dictionaries/ordinary attribute overrides/metaclass lookup,
  distinguishes missing entries from stored None/noncallables and propagates
  binding errors unchanged. The initial test failed on the missing module; seven
  tests now cover live shadow/delete updates, native function binding and compiled
  invocation, descriptor owner/identity, metaclass exclusion, AttributeError and
  cancellation. All 5,402 tests in 445 files pass; selected build, typecheck and
  scoped lint pass. Callers still supply the actual type and descriptor policy;
  automatic object classification and broad builtin/protocol assembly remain
  unfinished, as do suspended safe-fs effects and full public execution.
- Added optional per-frame specialMethods classification/descriptor policy and
  invocation lookupSpecial/typeName capabilities backed by concrete MRO lookup.
  Abs and guest round use these when their explicit lookup hooks are absent,
  invoking bound results through normal compiled-call dispatch. Three compiled
  regressions failed first, then passed with inherited methods and unconverted
  round digits. The type fixture now uses Python string equality rather than
  identity-only namespace keys. Six additional cases distinguish missing slots,
  disabled None slots and unrestricted NotImplemented results. All 5,411 tests
  in 445 files pass; selected build, typecheck and scoped lint pass. Sixteen
  existing compiled guest-round comparisons still match CPython. Actual type
  classification remains explicitly supplied; automatic instance/native type
  assembly, other protocols and suspended safe-fs effects remain unfinished.
- Len now adapts invocation special lookup/calls to the shared length protocol.
  Explicit length/index policies retain priority and receivers; absent index
  policies use MRO __index__ lookup and frame warning dispatch. Three compiled
  length regressions failed first and now cover zero, positive and negative
  results. Five more cases validate length-to-index conversion, bool-result
  warnings, negative lengths, overflow and noninteger results. All 5,419 tests in
  445 files pass; selected build, typecheck and scoped lint pass. Per-call length
  adapter allocation should be reduced without stale frame/policy capture.
  Automatic native/instance type classification, remaining object protocols and
  suspended safe-fs effects remain unfinished.
- Deferred invocation length-adapter creation until runtimeLength selects its
  non-native path. A zero-allocation native-length regression first failed on
  the unnecessary 384-byte adapter reservation and now passes without reading
  guest policy getters. A reentrant guest-call test verifies nested invocations
  and subsequent calls retain their own policies. All 5,421 tests in 445 files
  pass; selected build, typecheck and scoped lint pass. Guest adapters remain
  per invocation; broader performance/accounting audits, automatic type assembly,
  remaining protocols and suspended safe-fs effects remain unfinished.
- Reversed now uses frame-owned MRO __reversed__ dispatch and lazy indexed
  fallback through __len__/__getitem__. A presence-only MRO capability avoids
  binding the item descriptor during eligibility checks. Three compiled
  regressions failed before implementation; eight new cases cover inherited
  methods, disabled None, descriptor timing, escaped-frame iterators, separate
  invocation ownership, explicit override priority and cancellation. CPython
  confirms descriptor timing and disabled reversal behavior. All 5,429 tests
  in 445 files pass; selected build, typecheck and scoped lint pass. Automatic type assembly,
  remaining protocols and suspended safe-fs effects remain unfinished.
- Format now shares the execution formatting context used by f-strings when no
  explicit builtin policy is supplied; standalone calls use existing native
  formatting kernels. Namespace registration no longer requires a duplicate
  format policy. Two compiled regressions failed first; eleven new cases cover
  native/guest f-string parity, namespace defaults, explicit priority, argument
  ordering, subclass storage/results, callback receivers and cancellation.
  A policy-acquisition cancellation regression also failed before its checkpoint
  fix. All 5,440 tests in 445 files pass; selected build, typecheck and scoped
  lint pass.
  Forty-eight compiled format cases match CPython, including errors. Guest
  formatting still requires supplied capabilities: automatic MRO formatting,
  generic object representation and suspended safe-fs effects remain unfinished.
- Added a frame-owned formatting adapter using MRO __format__ lookup and normal
  bound compiled-call dispatch. Both format() and f-strings use it when a
  special-method policy exists and no explicit formatting context overrides it.
  Six compiled regressions failed first; ten new cases cover inherited methods,
  omitted specs, f-strings, missing/disabled slots, invalid results, live slot
  replacement, descriptor errors and cancellation. Existing parity tests now
  also reject accidental MRO lookup when explicit formatting wins. All 5,450
  tests in 446 files pass; selected build, typecheck and scoped lint pass.
  Forty-eight compiled native format comparisons still match CPython. Actual
  type classification remains supplied; automatic representation conversion,
  string-subclass storage, generic object formatting, per-frame allocation
  optimization and suspended safe-fs effects remain unfinished.
- Shared invocation formatting now resolves __str__/__repr__ through live MRO
  binding and compiled calls, including f-string !s/!r/!a conversions and guest
  members in native container representations. Nine compiled regressions failed
  first, covering conversion-before-format ordering, str-to-repr fallback,
  disabled methods and invalid results. Cancellation coverage now includes
  lookup/calls for all representation modes; a default-policy test verifies
  receiver ownership and lookup order. All 5,462 tests in 446 files pass;
  selected build, typecheck and scoped lint pass. Forty-eight compiled guest
  conversion cases match CPython, including Unicode, surrogates, padding and
  nested containers. Standalone representation builtin integration, automatic
  type/storage classification, generic object defaults, per-frame allocation
  optimization and suspended safe-fs effects remain unfinished.
- Repr/ascii now use invocation formatting when no explicit representation
  policy is supplied; standalone calls retain native representation support.
  Namespace registration no longer requires a separate representation context.
  Two compiled MRO regressions failed first; nine added cases cover guest calls,
  standalone defaults, explicit priority, argument order, acquisition cancellation
  and recursive callbacks sharing one invocation context. All 5,471 tests in
  446 files pass; selected build, typecheck and scoped lint pass. Thirty-two
  compiled repr/ascii guest cases match CPython across Unicode and nested lists.
  Cross-frame representation guard sharing still needs an integration audit;
  automatic type/storage classification, generic object defaults, allocation
  optimization and suspended safe-fs effects remain unfinished.
- The cross-frame representation audit reproduced RecursionError in three
  compiled list/guest cycles that CPython renders as [[...]]. Added explicit
  execution-owned RuntimeRepresentationState, shared by default and frame-owned
  formatting contexts while retaining separate method policies. The native
  container stack remains lazy and is not shared across independent executions.
  Three compiled regressions and two state-isolation/exception-cleanup cases
  pass. All 5,476 tests in 446 files pass; selected build, typecheck and scoped
  lint pass.
  CPython confirms all three recursive results, and 32 existing compiled guest
  representation comparisons still match. Explicit external policies own their
  own state; broader native-container recursion audits, automatic type/storage
  classification, allocation optimization and suspended safe-fs effects remain
  unfinished.
- Expanded the compiled representation recursion matrix from three to 39 cases:
  lists, tuples, dictionaries, mapping proxies and all dictionary views through
  repr/ascii/f-strings, plus clearing mutable backing containers during guest
  __repr__. Each case also verifies the subsequent rendering. CPython confirms
  all 39 scenarios. The initial dictionary fixture lacked positional storage;
  it now uses the normal runtime dictionary constructor. No runtime change was
  needed after that correction. All 5,512 tests in 446 files pass; typecheck
  and scoped lint pass. This is a test-only increment. Automatic type/storage classification,
  generic object defaults, allocation optimization and suspended safe-fs effects
  remain unfinished.
- Print now uses invocation formatting and flush truth when its explicit
  representation/truth policies are absent; streams remain mandatory explicit
  capabilities. Two compiled regressions failed first and now exercise inherited
  __str__/__repr__ fallback plus flush conversion ordering. Five additional cases
  cover native defaults, disabled stdout, explicit priority, acquisition
  cancellation and partial writes after conversion failure. All 5,519 tests in
  446 files pass; selected build, typecheck and scoped lint pass. All 216 existing print
  comparisons still match CPython. No implicit host stream or filesystem access
  was added. Automatic type/storage classification, generic object defaults,
  allocation optimization and suspended safe-fs effects remain unfinished.
- Deferred runtime expression/program formatting and f-string contexts until
  first use, caching them thereafter and retaining shared recursion state.
  Two arithmetic-only regressions first failed on eager policy reads; extending
  the program case exposed a second eager f-string-capability read, also fixed.
  Two additional cases cover one-time acquisition, disabling/restoring f-string
  support and deferred-acquisition cancellation. Closure allocations remain
  metered. All 5,523 tests in 446 files pass; selected build, typecheck and scoped
  lint pass.
  All 128 compiled format/representation comparisons still match CPython.
  Native attribute dispatch still requests formatting when resolving native
  members; further allocation optimization, automatic type/storage classification,
  generic object defaults and suspended safe-fs effects remain unfinished.
- Native attribute dispatch now accepts a deferred formatting supplier and
  acquires it only for format/format_map/__format__. Three compiled regressions
  failed first on unnecessary policy reads during list methods, string case
  conversion and numeric attribute access. Six additional cases verify supplier
  acquisition/retention and cancellation for formatting members. Existing direct
  formatting contexts remain supported. All 5,532 tests in 446 files pass;
  selected build, typecheck and scoped lint pass. Forty-eight compiled native __format__
  cases match CPython. Further allocation/performance audits, automatic
  type/storage classification, generic object defaults and suspended safe-fs
  effects remain unfinished.
- Frame truth conversion now adapts MRO __bool__/__len__ and normal compiled
  calls to the existing truth/length validators. Explicit truth policies still
  win; exact native payloads retain allocation-free fast paths. Five compiled
  cases failed before integration. CPython exposed a mistaken expectation for
  __bool__=None; the corrected regression failed before mapping it to the
  protocol's disabled-method state. Twelve added cases cover conditions/not/any,
  bool precedence, slotless objects, invalid/negative results, native allocation,
  guest length __index__ and cancellation. CPython confirms all eight compiled
  truth scenarios. All 5,544 tests in 446 files pass; selected build, typecheck
  and scoped lint pass. Guest truth currently allocates a length adapter even when __bool__ wins;
  allocation optimization, automatic type/storage classification, generic object
  defaults and suspended safe-fs effects remain unfinished.
- Split optional boolean truth validation from length fallback while preserving
  the existing protocolTruth API. Runtime guest truth now acquires length/index
  adapters only after __bool__ is absent. Five regressions failed first: four
  rejected unnecessary index-policy reads for true/false/invalid/disabled bool
  slots, and one exceeded a 400-byte bool-only adapter budget. All now pass,
  alongside existing compiled precedence, index conversion and cancellation
  coverage. All 5,549 tests in 446 files pass; selected build, typecheck and
  scoped lint pass. Further allocation/performance audits, automatic type/storage
  classification, generic object defaults and suspended safe-fs effects remain
  unfinished.
- Added a shared MRO index adapter and lazily cached frame index policy, used
  by expressions, assignment/deletion, native members, builtins and length
  conversion. Existing explicit policies retain priority/receivers; arithmetic
  frames do not acquire unused index capabilities. Five compiled regressions
  failed first, covering indexed reads/writes/deletion/slices, hex/chr, bool
  warnings and missing/disabled/invalid slots. Four more cases cover explicit
  cache ownership and cancellation after lookup, calls and warnings. CPython
  confirms all five scenarios and six bool-result warnings. All 5,558 tests in
  447 files pass; selected build, typecheck and scoped lint pass. Automatic
  type/storage classification, additional protocol assembly, allocation audits,
  generic object defaults and suspended safe-fs effects remain unfinished.
- Audited shared frame index conversion across fourteen compiled native consumers:
  list/tuple/string/bytes/range access, slice assignment/deletion, augmented
  indexed assignment, stepped slices, list pop/insert, string/bytes find and
  integer to_bytes. CPython confirms results and actual __index__ call counts,
  including two conversions for augmented indexed assignment. Regression cases
  also verify MRO lookup counts and inherited compiled method dispatch. No runtime
  change was needed. All 5,572 tests in 448 files pass; typecheck and scoped lint
  pass. Automatic type/storage classification, additional protocol assembly,
  allocation audits and suspended safe-fs effects remain unfinished.
- Binary special-method negotiation now checks cancellation/latched resource
  failure after forward and reflected callbacks, before accepting their results.
  Four cancellation regressions failed first across same-type, ordinary and
  prioritized reflected dispatch. They cover accepted and NotImplemented results;
  another regression verifies that swallowing an allocation-limit exception cannot
  recover execution. Zero-step post-callback checks preserve existing operation
  charges and method ordering. All 5,577 tests in 448 files pass; selected build,
  typecheck and scoped lint pass. Broader numeric/MRO assembly, other dispatch
  boundaries, native classification and suspended safe-fs effects remain unfinished.
- Extended post-callback resource enforcement to in-place and rich-comparison
  dispatch. Eight new regressions failed before the fixes: cancellation after
  in-place/fallback and either comparison method in both subtype orderings, plus
  swallowed allocation failures at both in-place boundaries. Accepted and
  NotImplemented results are checked without undoing prior mutations or changing
  operation charges. All 5,585 tests in 448 files pass; selected build, typecheck
  and scoped lint pass. In-place dispatch remains a reusable kernel rather than complete
  augmented-operation MRO assembly; broader numeric dispatch, native classification
  and suspended safe-fs effects remain unfinished.
- Added multiplication negotiation with exact native sequence fallback and an
  explicit index policy. Four sequence regressions first returned NotImplemented;
  two expression regressions exposed missing dispatch/diagnostics. Sixteen added
  cases cover list/tuple/string/bytes repetition in both operand orders, numeric
  precedence, native fast paths, empty-sequence conversion, invalid/overflow/bool
  results, negative counts and module/nested-frame policy ownership. Index policy
  acquisition is deferred until numeric methods decline and conversion is needed.
  All 96 result/error comparisons match CPython. All 5,601 tests in 449 files pass;
  selected build, typecheck and scoped lint pass. The multiplication hook is wired
  through expressions/program frames; automatic MRO numeric-slot assembly and
  guest in-place repetition remain unfinished, as do native classification and
  suspended safe-fs effects. Numeric/reflected protocol reference:
  https://docs.python.org/3/reference/datamodel.html#emulating-numeric-types
- Frame multiplication now assembles opaque guest __mul__/__rmul__ methods from
  the actual type MRO and calls compiled methods normally, then uses the shared
  frame index policy for sequence fallback. Exact native pairs avoid guest type
  and index acquisition; explicit multiplication hooks retain precedence. Thirteen
  compiled regressions failed first. Twenty-one added cases cover inherited index
  conversion in both operand orders, nested frames, subtype reflected overrides,
  same-type suppression, class descriptor access/comparison, late namespace
  mutation, disabled slots, explicit policies, fast paths and cancellation.
  CPython confirms thirteen core scenarios and both class-descriptor event orders;
  all 96 prior repetition comparisons still match. All 5,622 tests in 450 files
  pass; selected build, typecheck and scoped lint pass. Native-subclass storage adaptation,
  metaclass attribute overrides, guest in-place multiplication, broader numeric
  protocol assembly and suspended safe-fs effects remain unfinished.
- Augmented multiplication's left-list sequence fallback now repeats the original
  slots in place after numeric methods decline. Five compiled regressions first
  replaced the list, breaking aliases/cycles. Eleven new cases cover negative,
  zero, unit and repeated counts, cyclic members, reflected numeric precedence,
  native right-sequence fallback, index-method mutations/errors and failed target
  write-back. CPython confirms all eleven scenarios; the 96 ordinary repetition
  comparisons remain unchanged. Full suite: 5,633 tests in 450 files pass, with
  the final corrected native-right-operand case also checked in the focused suite.
  Build, typecheck and scoped lint pass. A separate CPython difference was identified: heap
  guest types with only __index__ must not fall back to a right-hand sequence
  for *= (unlike ordinary *); current assembly still allows that fallback. This
  sequence-table eligibility gap, guest __imul__, native-subclass adaptation,
  metaclass overrides and suspended safe-fs effects remain unfinished.
- Fixed augmented right-sequence fallback eligibility. Type layouts now expose
  immutable sequence-table presence (heap default true; native registration can
  specify sequenceTable:false), independent of implemented slots or Sequence
  membership. Bootstrap object/type omit the table. Frame multiplication carries
  that metadata; native range/dict/set/view/proxy tables also block right fallback
  when they have no repeat slot. Five regressions failed first. Ten added cases
  cover heap errors, native tables/views, explicit native absence, numeric
  precedence, lazy metadata reads and cancellation. All 76 native augmented and
  five guest scenarios match CPython; 96 ordinary repetition comparisons still
  match. All 5,643 tests in 450 files pass; selected build, typecheck and scoped lint pass.
  Guest __imul__, native-subclass storage adaptation, metaclass overrides, broader
  numeric assembly and suspended safe-fs effects remain unfinished.
- Added frame-owned MRO in-place dispatch for all thirteen augmented operators.
  A shared native/opaque classifier keeps exact native payloads on existing
  kernels; explicit statement hooks retain priority and receiver binding. Guest
  descriptors bind after RHS evaluation, and only NotImplemented permits fresh
  ordinary fallback. Seventeen compiled regressions failed first. Twenty-four
  added cases cover inherited methods in nested frames, arbitrary return values,
  disabled slots, descriptor ordering, type mutation, explicit/native policies,
  cancellation, subtype precedence and failed write-back. CPython confirms
  twenty-one scenarios; 172 prior repetition comparisons still match. All 5,667
  tests in 450 files pass; selected build, typecheck and scoped lint pass. Ordinary numeric
  MRO assembly outside multiplication, native-subclass storage, metaclass overrides
  and suspended safe-fs effects remain unfinished.
- Shared the MRO numeric adapter between addition and multiplication, selecting
  forward/reflected names declaratively and retaining native sequence fallbacks.
  Frame addition now uses inherited compiled __add__/__radd__ by default while
  preserving explicit hooks. Five compiled regressions failed first. Ten added
  cases cover both operand orders, declined __iadd__, subtype/descriptor reflected
  priority, same-type suppression, sum's ordinary addition and explicit policies.
  All nine Python-semantic scenarios match CPython; 172 repetition comparisons
  remain unchanged. All 5,677 tests in 450 files pass; selected build, typecheck
  and scoped lint pass. CPython also confirms reflected addition must precede
  native list += extension; the existing direct extension path still needs that
  integration. Other binary families, native-subclass storage, metaclass overrides
  and suspended safe-fs effects remain unfinished.
- Fixed native list += ordering: ordinary numeric negotiation now precedes
  extension, and only declined numeric methods reach the shared in-place list
  fallback. Five compiled regressions first bypassed __radd__ or reported an
  iteration error instead of the disabled-method call error. Eight added cases
  cover False/None results, missing/declined extension paths, partial next failure,
  disabled methods, deferred iteration acquisition, native self-extension and
  failed target write-back. Existing guest length-hint behavior remains covered.
  All seven new Python-semantic scenarios and sixty native addition comparisons
  match CPython. All 5,685 tests in 450 files pass; selected build, typecheck and
  scoped lint pass. Other binary families, native-subclass storage, metaclass
  overrides, complete automatic iteration assembly and suspended safe-fs effects
  remain unfinished.
- Extended frame-owned numeric MRO dispatch to subtraction, division, floor
  division, modulo, shifts, bitwise operators and matrix multiplication. Ordinary
  and in-place slot names share one declarative table. Native slots retain their
  turn in dispatch; mapping-proxy union delegates through the frame binary policy.
  Fourteen regressions failed first. Twenty-three added tests cover inherited
  forward/reflected calls, subtype ordering, same-type suppression, disabled
  methods, in-place fallback, native percent precedence, proxy delegation,
  explicit hook ownership, cancellation and the native fast path. All thirty-one
  Python-semantic scenarios and 232 native addition/repetition comparisons match
  CPython. All 5,708 tests in 450 files and scoped lint pass. Automatic power MRO,
  native-subclass storage, metaclass overrides, full native formatting/iteration
  policies and suspended safe-fs effects remain unfinished.
- Added frame-owned binary and ternary power MRO dispatch, shared by ** and pow
  while preserving explicit power policies. Real moduli reach guest methods;
  omitted/None moduli retain binary call arity. Individual native power slots
  prevent a later modulus from preempting guest methods, and the modulus object
  never becomes a Python method receiver. Eight regressions failed first. Twenty
  added tests cover nested inherited calls, in-place fallback, subtype ordering,
  same-type suppression, disabled methods, native slot order, policy receivers
  and cancellation. The numeric fixture now executes definitions normally so
  default arguments are captured. All 144 compiled guest power comparisons and
  988 native pow comparisons match CPython; 232 addition/repetition comparisons
  remain unchanged. All 5,728 tests in 450 files pass, as do the selected workspace
  build, typecheck and scoped lint. Unary/divmod frame assembly, native-subclass storage,
  metaclass overrides and suspended safe-fs effects remain unfinished.
- Integrated frame-owned __pos__, __neg__ and __invert__ lookup with the shared
  unary runtime. Exact native values keep scalar kernels and warning policies;
  logical not remains truth-owned. Guest unary methods accept every return value,
  including NotImplemented, and missing methods never trigger index coercion.
  Nine regressions failed first. Seventeen added tests cover nested inheritance,
  disabled/missing methods, descriptor binding after operand evaluation, explicit
  policy receivers, native identity/errors, bounded UTF-8 diagnostics and
  cancellation after lookup/call. All 60 compiled guest and 144 native unary
  comparisons match CPython. All 5,745 tests in 450 files, selected workspace build,
  typecheck and scoped lint pass. Divmod frame assembly, native-subclass storage,
  metaclass overrides and suspended safe-fs effects remain unfinished.
- Integrated divmod with the frame's shared numeric-method preparation policy.
  Its distinct __divmod__/__rdivmod__ registry entry has no fictitious in-place
  method; the native real arithmetic kernel is separately reusable by mixed
  native/guest negotiation. Explicit builtin policies, including an empty policy,
  retain priority over frame defaults. Five regressions failed first. Fifteen
  added tests cover nested inherited methods, disabled/missing methods, subtype
  priority, unrestricted results, same-type suppression, policy receiver binding,
  argument validation before dispatch, native handling and cancellation. All
  80 compiled guest and 288 native divmod comparisons match CPython. All 5,760
  tests in 450 files, selected workspace build, typecheck and scoped lint pass. Automatic rich
  comparison/iteration assembly, native-subclass storage, metaclass overrides and
  suspended safe-fs effects remain unfinished.
- Added an explicit native comparison decline boundary needed by rich MRO
  dispatch. Unsupported root pairs can now return NotImplemented before final
  equality fallback or ordering errors; supported native comparisons and all
  delegated/member comparisons still resolve fully. This is a combined native
  kernel capability, not a claim to expose individual builtin type slots. Seven
  regressions failed first. Fourteen new tests cover all six operators, native
  numeric/identity behavior, nested lists and cells, raw proxy delegation,
  composition with reflected dispatch and cancellation. CPython confirms 22
  scenarios; 504 prior cell/proxy/list-mutation comparisons remain unchanged.
  All 5,774 tests in 451 files, selected build, typecheck and scoped lint pass.
  Automatic frame rich-comparison MRO assembly remains unfinished, including
  default object inequality delegation and actual native/guest type ownership.
- Integrated rich comparisons with frame-owned live MRO lookup. All six methods
  preserve raw results, strict subtypes reflect first even for inherited methods,
  and same-type operands retain both attempts. Missing object inequality delegates
  to equality and truth-inverts only accepted results. Native kernels decline to
  guest reflection while nested container and proxy comparisons reenter the raw
  frame policy selectively, retaining native-stack handling for native members.
  Nine regressions failed first. Twenty-five added tests cover inheritance,
  subtype and same-type ordering, disabled methods, default inequality, arbitrary
  results, native lists/proxies, live type mutation, guest diagnostics and
  cancellation. The fixture now records actual function-type ownership for
  numeric override comparisons. All 560 compiled guest and 2,028 variable-loaded
  native comparisons match CPython. All 5,799 tests in 451 files, selected build,
  typecheck and scoped lint pass. Complete native/guest class construction and
  storage ownership, native-subclass adapters, metaclass overrides, automatic
  iteration assembly and suspended safe-fs effects remain unfinished.
- Added lazily cached frame iteration shared by loops, builtins and argument
  expansion. Inherited __iter__/__next__ methods bind through the normal call
  path; indexed fallback checks sequence-table eligibility. Native cursors keep
  identity, custom next calls do not latch exhaustion, and advisory length/hint
  lookup occurs only when requested. Seven regressions failed before their fixes,
  including native non-index __len__ results and live next-slot removal. Exact
  native non-index values now decline index conversion without guest type lookup;
  this lets length-hint TypeError fallback run normally. Eighteen added tests cover
  identity, disabled slots, indexed fallback, unpacking, hints, early exit,
  exhaustion, native diagnostics, mutation and cancellation. All 120 compiled
  iterator/sequence/consumer/hint cases match CPython; direct CPython probes also
  verify lone-star hint omission and distinct loop/next deletion diagnostics.
  All 5,817 tests in 451 files, selected build, typecheck and scoped lint pass.
  Containment composition, native cursor hint/exhaustion audits, custom guest
  exception-subclass matching, full class/storage ownership and suspended safe-fs
  effects remain unfinished.
- Composed frame containment from shared MRO calls, iteration and raw rich
  comparison. The cached policy preserves explicit iteration receivers and leaves
  native containers/cursors on their kernels. Contains results undergo truth
  conversion, including NotImplemented's Python 3.14 error; only missing methods
  fall back to identity-first, member-first iteration. No hints or implicit close
  are requested. Five regressions failed first. Fifteen added tests cover inherited
  in/not-in, disabled/noncallable methods, custom truth, identity/equality ordering,
  indexed early exit, acquisition-only TypeError rewriting, explicit policies and
  cancellation. All 252 compiled guest and 256 variable-loaded native containment
  comparisons match CPython. All 5,832 tests in 451 files, selected build, typecheck
  and scoped lint pass. Native iterator completion/hint audits, custom guest
  exception-subclass matching, full class/storage ownership and suspended safe-fs
  effects remain unfinished.
- Preserved already-classified native exhaustion when guest __iter__ returns a
  prepared native cursor. Two integration regressions failed first: loops and
  containment converted native completion metadata to a throw, then incorrectly
  classified it again. An optional native-cursor capability now returns completion
  records intact, while explicit next still raises the recorded guest value,
  including undefined. Six adapter tests cover record identity, resumability,
  indexed fallback isolation, cancellation, native failures and reacquisition
  without pulling. All 5,840 tests in 452 files, selected build, typecheck and
  scoped lint pass; 120 guest iteration, 252 guest containment and 256 native
  containment cases still match CPython. Native cursor hints, custom guest
  exception-subclass matching, full class/storage ownership and suspended safe-fs
  effects remain unfinished.
- Exposed prepared cursor __length_hint__ through the native attribute and frame
  special-method path. Six regressions failed first. Optional cursor hints retain
  number/bigint results without premature machine-size conversion; missing hints
  remain absent and unavailable indexed-source lengths return NotImplemented.
  Range adapters preserve their underlying cursor's hint and meter its bound
  callback. Twelve added tests cover immutable/live sequences, mappings/views,
  sets, large ranges, guest indexed cursors, argument validation and cancellation.
  The allocation-boundary test now includes the new callback while still failing
  on the first pull. All 432 native hint observations in 48 traces and the prior
  120 guest iteration cases match CPython. All 5,852 tests in 452 files, selected
  build, typecheck and scoped lint pass. Consumer-side native hint handling and exact iterator
  type-name diagnostics remain unfinished, alongside full class/storage ownership
  and suspended safe-fs effects.
- Connected native cursor hints at consumer boundaries: list-style collection,
  joins/slice materialization, byte conversion and starred-assignment remainder
  preparation. Five compiled regressions failed first. Shared validation retains
  call-time TypeError fallback, propagates lookup/native failures, rejects
  negative/oversized hints and checks cancellation after callbacks without
  reserving memory from hints. Streaming consumers skip hints; starred unpacking
  requests them after its prefix. Twenty-five added tests cover these boundaries
  and standalone bytes/sorted/extend paths. All 240 native consumer cases and
  120 prior guest iteration cases match CPython. All 5,877 tests in 453 files,
  selected build, typecheck and scoped lint pass. Source-length overflow audits,
  exact iterator type-name diagnostics, full class/storage ownership and suspended
  safe-fs effects remain unfinished.
- Checked range source hints for list-style acquisition. Five compiled
  regressions previously consumed oversized ranges until the execution allocation
  limit instead of raising Python's length overflow. Acquisition now validates the
  exact range cursor hint only when the consumer requests it; streaming retains
  lazy access to arbitrarily large progressions. Seven added tests cover extension,
  sorted, starred list/tuple/call collection, signed-machine boundaries and both
  step directions without reserving memory from the hint. All 80 range-consumer
  cases match CPython. All 5,884 tests in 453 files, selected build, typecheck
  and scoped lint pass. Exact iterator type-name diagnostics, full class/storage ownership,
  native-subclass adapters and suspended safe-fs effects remain unfinished.
- Added the default type-instantiation lifecycle as a separate protocol layer.
  The initial test import failed before implementation. The allocator receives
  the requested type and unchanged arguments; unrelated results bypass init,
  while actual subtype results resolve their own live initializer. Non-None init
  results raise using their actual type (including a returned class's metaclass).
  Twenty-three tests cover ordering, mutation, original argument identity, missing
  slots, non-None results, failures and cancellation. All 45 lifecycle comparisons
  match CPython; all 5,907 tests in 454 files, selected build, typecheck and scoped
  lint pass. This layer does not yet supply concrete instance allocation or
  automatic frame call wiring. Metaclass __call__ routing, native layout policies,
  full class/storage ownership and suspended safe-fs effects remain unfinished.
- Wired runtime type calls through metaclass dispatch and the instantiation
  lifecycle when an actual-type policy is available. Three compiled regressions
  failed first. New/init calls reenter the normal function/keyword path; the
  lifecycle now accepts the native keyword container without converting Python
  string keys to host strings. Allocator lookup honors metaclass data descriptors,
  __getattribute__/__getattr__ and explicit attribute policy, while implicit
  __call__ uses metaclass MRO lookup. Related returned objects use their actual
  live initializer; type-call stack entries bound recursive allocator objects.
  Nineteen tests cover keywords, subtype/foreign results, inherited overrides,
  disabled slots, descriptors, mutation, diagnostics, cancellation and recursion.
  All 96 compiled type-call cases match CPython; all 5,926 tests in 454 files,
  selected build, typecheck and scoped lint pass. Concrete instance allocation,
  default object/type bootstrap (including native type.__call__ and type(x)),
  native layout policies, complete class creation and suspended safe-fs effects
  remain unfinished.
- Added concrete instance records carrying an actual type and optional owned
  dictionary. A compiled construction regression failed before the factory
  existed. Shared actual-type resolution now uses intrinsic instance/metaclass
  ownership; external policy remains for opaque/native values. Numeric, power,
  comparison, iteration and frame/type-call adapters use that resolution. Native
  binary fallback, truth and identity-hash paths explicitly handle instances.
  Ten tests cover distinct identity, dictionary-less records, shared members and
  cycles, shadow __class__ isolation, allocation limits, classification cancellation
  and compiled protocols without ownership maps. All 96 type-call and 120 iteration
  cases still match CPython after replacing placeholder cells with owned instances.
  All 5,936 tests in 455 files, selected build, typecheck and scoped lint pass. Instance attribute
  access/mutation, default object allocation, slots/native payload layouts, complete
  class bootstrap and suspended safe-fs effects remain unfinished.
- Connected owned instance attribute reads and mutation to frame expressions,
  assignments and attribute builtins. A compiled initializer failed first on its
  attribute write. Live descriptor precedence now composes with instance storage;
  inherited getattribute/getattr and set/delete overrides use normal calls.
  Mutation performs no pre-read and discards override return values. Default
  object-style entry points bypass overrides for later object builtin wiring.
  Twenty-three tests cover construction/method reads, all eight descriptor slot
  combinations, dictionary-less/read-only diagnostics, class-attribute isolation,
  cancellation, disabled overrides and builtin/syntax parity. All 120 operations
  in 24 descriptor/storage traces match CPython. All 5,959 tests in 456 files,
  selected build, typecheck and scoped lint pass. Default object allocation and metadata
  descriptors, mutable class/dictionary ownership, slots/native payload layouts,
  full class bootstrap and suspended safe-fs effects remain unfinished.
- Installed the canonical registry-owned object allocator. Two compiled tests
  failed first because ordinary classes had no inherited allocator. Heap instances
  now receive fresh dictionaries unless their layout excludes them; inherited
  dictionaries cannot be removed, and native payload incompatibility propagates
  through derived layouts. Allocation validates type ownership and argument rules
  without invoking constructors or initializers. Twelve new tests cover direct and
  compiled calls, inherited init, distinct storage, dictionary-less layouts,
  native safety, foreign registries and cancellation. Updated two older tests to
  account for the now-populated object namespace. All 72 direct allocation cases
  and 96 compiled type-call cases match CPython. All 5,971 tests in 457 files,
  selected build, typecheck and scoped lint pass. Default object initialization and
  metadata descriptors, abstract-class/native-layout validation, complete class
  bootstrap and suspended safe-fs effects remain unfinished.
- Added native method-descriptor values, intrinsic non-data binding, and normal
  frame dispatch for unbound calls. The initial tests failed because no native
  descriptor implementation existed; later tests exposed callable classification,
  Unicode diagnostic limits and qualified call-error names. Receiver validation
  precedes native invocation, class access preserves descriptor identity, bound
  calls retain receiver/keywords/context, and callback cancellation is observed.
  Thirteen tests cover direct and compiled calls, shadowing, implicit arithmetic
  methods, callability, identity hashing, diagnostics and cancellation. All 54
  binding/invocation cases and 96 compiled type-call regressions match CPython.
  All 5,984 tests in 458 files, selected build, typecheck and scoped lint pass.
  Native bound-method equality/hash and
  public metadata, wrapper descriptors, default object initialization and complete
  object/type bootstrap remain unfinished; this increment supplies native method
  binding, not the completed builtin object model.
- Preserved native bound-method implementation and receiver identity. Four
  failing regressions showed unequal repeated lookups, inconsistent hashes and
  duplicate dictionary keys. Bindings now retain immutable metadata and an
  execution-local weak implementation-token cache shared by callback aliases.
  Native equality compares identity without invoking receiver equality; hashing
  combines implementation/receiver identity without hashing unhashable receivers.
  Twelve tests cover aliases, distinct receivers/implementations, ordinary native
  functions, identity versus equality, hash normalization, ordering rejection,
  immutable metadata and compiled dictionary-key behavior. All 1,014 observations
  over 169 method pairs match CPython. All 5,996 tests in 459 files, selected build,
  typecheck and scoped lint pass. Public native metadata, wrapper descriptors, conversion of
  legacy per-attribute native capabilities, complete object/type bootstrap and
  suspended safe-fs effects remain unfinished.
- Exposed native descriptor __name__/__objclass__ and bound native method
  __name__/__self__ through the normal attribute path. Three initial regressions
  failed on missing metadata. Reads retain defining-owner versus actual-receiver
  identity and the accessed alias name without invoking methods/getters or
  exposing host capability fields. Twelve tests cover direct/compiled reads,
  getattr parity, inherited methods, aliases, getsets, missing fields and
  cancellation. All 30 targeted metadata cases match CPython. All 6,008 tests
  in 460 files, selected build, typecheck and scoped lint pass. Qualified names,
  doc/signature/module metadata, native attribute mutation diagnostics, wrapper
  descriptors and complete object/type bootstrap remain unfinished.
- Added distinct wrapper_descriptor and method-wrapper values for native slots.
  Six initial tests failed because slot-wrapper allocation did not exist. Shared
  descriptor binding and call dispatch now preserve wrapper-specific receiver
  diagnostics, immutable binding records, non-data precedence and callback
  cancellation. Equality/hash use descriptor plus receiver identity (unlike
  native method callback aliases). Callable/truth/numeric classification and
  owner/name/self metadata include both wrapper families. Twelve tests cover
  direct and bound calls, metadata, identity, cancellation, compiled constructor
  initialization and arithmetic slot dispatch despite instance shadowing. All 54
  binding cases and 1,014 observations over 169 identity pairs match CPython.
  All 6,020 tests in 461 files, selected build, typecheck and scoped lint pass.
  Default object initialization, slot wrapper argument conventions, qualified
  names/doc metadata, complete object/type bootstrap and suspended safe-fs effects
  remain unfinished.
- Installed canonical object.__init__ as a native slot wrapper. Ten initial
  regressions failed because the initializer was absent. Initialization performs
  no writes; extra-argument acceptance depends on actual __new__/__init__ slot
  identities, with canonical aliases and inheritance preserved. A native-call
  actual-type capability handles opaque/native payloads without reading guest
  __class__; no-argument initialization requires no classification. Sixteen
  tests cover direct/bound/compiled calls, custom allocators, disabled/aliased
  slots, keyword rules, native type policy, shadow attributes and cancellation.
  All 96 initializer, 72 allocation and 96 compiled type-call cases match CPython.
  All 6,036 tests in 462 files, selected build, typecheck and scoped lint pass. Native type
  initialization/allocation, remaining default object methods and metadata,
  complete class bootstrap and suspended safe-fs effects remain unfinished.
- Installed type.__init__ as its own native wrapper rather than inheriting
  object initialization. Thirteen initial tests failed because the slot was
  absent. Applicability follows the actual metaclass MRO; positional arity is
  checked before keyword handling. One-argument initialization rejects keywords,
  while three-argument initialization accepts them without rebuilding or mutating
  the class. Fifteen tests cover positional/keyword matrices, receiver binding,
  non-mutation, cancellation and compiled metaclass allocation/initializer
  overrides. All 140 direct/bound initializer and 96 compiled type-call cases
  match CPython. All 6,051 tests in 463 files, selected build, typecheck and scoped
  lint pass. Native type
  allocation/calling, remaining object methods and metadata, complete class
  bootstrap and suspended safe-fs effects remain unfinished.
- Added the canonical one-argument type inspection path. Eight initial tests
  failed because inspection attempted allocation. The registry's self-metaclass
  root returns intrinsic instance/type ownership or the supplied native/opaque
  actual-type policy, without running new/init or reading guest __class__.
  Inspection rejects keywords and validates canonical arity; ordinary user
  classes (including one named type) and three-argument construction retain
  their allocation path. Twelve tests cover identity, custom metaclasses,
  shadow attributes, diagnostics, cancellation and compiled calls. All 28
  inspection and 96 compiled type-call cases match CPython. All 6,063 tests in
  464 files, selected build, typecheck and scoped lint pass. Native type.__new__/__call__,
  complete three-argument class creation, remaining object methods/metadata and
  suspended safe-fs effects remain unfinished.
- Installed native type.__call__ with a distinct default-call mode. Four initial
  regressions failed because the slot was absent. Normal type calls retain
  metaclass dispatch; explicit type.__call__ bypasses that override while sharing
  allocation, initialization and canonical type inspection. The native invocation
  capability forwards positional/keyword containers and enters a bounded default
  call-stack frame, including for directly recursive wrapper calls. Seven tests
  cover callback contracts, receiver validation, cancellation, explicit/bound
  construction, metaclass bypass, keyword preservation and recursion unwinding.
  Default inspection unit tests now explicitly select the default-call mode.
  All 96 ordinary and 96 explicit compiled type-call cases match CPython.
  All 6,070 tests in 465 files, selected build, typecheck and scoped lint pass. Native
  type.__new__, full class creation, remaining object/type attributes and
  suspended safe-fs effects remain unfinished.
- Connected ordinary TypeValue attribute reads to metaclass/class descriptor
  lookup. Two compiled regressions failed on inherited members and type.__call__.
  Shared class reads now apply metaclass getattribute/getattr, native AttributeError
  fallback and bounded diagnostics; allocator __new__ reads reuse this path instead
  of duplicating it. Omitting invocation exposes default lookup for a future
  explicit type.__getattribute__ adapter. Eleven tests cover inherited members,
  MRO/dictionary metadata, native type slots, function binding, metaclass data
  precedence, disabled overrides, fallback, cancellation and Unicode diagnostics.
  All 160 class-descriptor and 192 compiled type-call cases match CPython. All 6,081 tests in 465 files,
  selected build, typecheck and scoped lint pass. Class mutation wiring, intrinsic
  type names/qualified names, native type.__new__, complete class construction and
  suspended safe-fs effects remain unfinished.
- Connected ordinary class assignment/deletion and setattr/delattr to the shared
  type mutation path. Two compiled regressions first failed on unsupported writes.
  Metaclass overrides run without pre-reading attributes; default mutation keeps
  metaclass data-descriptor precedence, immutable-type restrictions and own-only
  namespace deletion. Override return values are discarded and cancellation is
  checked after callbacks. Fourteen tests cover inherited shadowing, builtin parity,
  descriptor ownership, disabled overrides, read-only metadata and cancellation.
  All 800 operations across 160 descriptor configurations and 96 compiled type-call
  cases match CPython. All 6,095 tests in 465 files, selected build, typecheck and
  scoped lint pass. Intrinsic type names/qualified names, native default
  attribute wrappers, type.__new__, complete class construction and suspended
  safe-fs effects remain unfinished.
- Installed native type.__getattribute__, __setattr__ and __delattr__ wrappers.
  Two compiled regressions first failed because these slots were absent. Explicit
  default execution capabilities bypass metaclass overrides; getattribute excludes
  getattr fallback while ordinary reads retain it. Native wrappers validate the
  receiver, keywords, arity and string name in CPython order, preserve assigned
  identity, return None for mutation and check cancellation after callbacks.
  Eighteen tests cover direct/bound contracts, metaclass delegation, disabled
  overrides, fallback boundaries and cancellation. All 800 descriptor operations,
  144 direct/bound validation cases and 96 compiled constructor cases match CPython.
  All 6,113 tests in 466 files, selected build, typecheck and scoped lint pass.
  Default object attribute slots, intrinsic type names/qualified names, native
  type.__new__, complete class construction and suspended safe-fs effects remain
  unfinished.
- Added intrinsic __name__/__qualname__ getsets and independent mutable name
  storage. Two compiled regressions showed missing qualified names and namespace
  writes leaving diagnostic names unchanged. Layouts now accept a prepared
  qualifiedName; name updates retain assigned string identity without changing
  namespaces or inheritance. Native getsets preserve immutable-type guards even
  when called directly and reject deletion. A further failing Unicode regression
  established UTF-8 surrogate rejection before null validation for __name__;
  qualified names accept both. Thirteen tests cover caching, independent names,
  shadowing, diagnostics, direct descriptor guards and atomic failure. All 264
  mutation operations across 132 CPython cases and 96 compiled constructor cases
  match. All 6,126 tests in 467 files, selected build, typecheck and scoped lint pass.
  Class-construction extraction of qualified names, remaining type metadata,
  default object attribute slots, native type.__new__, complete class construction
  and suspended safe-fs effects remain unfinished.
- Added concrete class allocation with copied namespace storage, selected
  metaclass/owned-base publication, default object bases, intrinsic qualified-name
  extraction, module/doc defaults and class-cell propagation. This is an internal
  allocation stage, not yet the guest type.__new__ lifecycle. CPython probes
  disproved an initial empty-cell-on-MRO-failure assumption: class cells retain a
  partially initialized class. Layouts now expose a frozen pre-MRO allocation
  boundary, with empty internal MRO / guest __mro__ None on failure; registry
  metadata refuses to cache an uninitialized MRO. A failing compiled regression
  also showed object.__new__ could allocate failed classes; that path now rejects
  them. Another regression corrected full-name cannot-create diagnostics.
  Fourteen tests cover ownership, source isolation, metadata order, cell effects,
  cancellation and successful/failed allocated classes in compiled execution.
  All 640 allocation cases and 192 compiled constructor cases match CPython.
  All 6,140 tests in 468 files, selected build, typecheck and scoped lint pass.
  Automatic method wrapping, slot/native layout policy, metaclass new delegation,
  descriptor set-name and subclass hooks must be connected before exposing this
  as native type.__new__. Full class construction and suspended safe-fs effects
  remain unfinished.
- Added post-allocation descriptor/subclass finalization. Own namespace entries
  are snapshotted once, descriptor special methods are resolved live, and inherited
  __init_subclass__ lookup happens after descriptor effects while skipping the new
  class's own hook. Native-to-guest calls now optionally preserve a keyword
  dictionary; a compiled keyword-only callback first failed without this path.
  Set-name call failures retain their exception and append metered contextual
  notes; differential evidence corrected an initial overbroad handler that also
  annotated binding failures. Host termination is not converted to guest errors.
  Sixteen tests cover snapshots, mutation, binding, keyword forwarding, exception
  notes, cancellation and compiled hooks on allocated classes. All 240 finalization
  cases and 192 compiled constructor cases match CPython. All 6,156 tests in 469
  files, selected build, typecheck and scoped lint pass. Native classmethod/staticmethod values,
  automatic method wrapping, native object subclass hooks, full type.__new__
  integration, guest exception-note exposure and suspended safe-fs effects remain
  unfinished.
- Generalized raw bound-method records beyond Python functions, as required by
  classmethod's arbitrary wrapped values. Six initial regressions exposed native/
  type/nested call dispatch and function-identity-only equality/hashing. Calls now
  unwrap receiver chains iteratively and reenter ordinary call dispatch; equality
  truth-converts wrapped-value equality before receiver identity, and hashing uses
  an explicit method continuation to hash the wrapped value before receiver
  identity. Added __func__/__self__ reads and corrected bound native names in
  argument-collection diagnostics. Thirteen tests cover noncallables, native/type
  calls, metadata, guest comparison/hash callbacks, depth limits and 2,000-level
  binding chains. All 576 equality pairs, 24 hash cases, 54 compiled binding cases
  and 96 compiled constructor cases match CPython. All 6,169 tests in 469 files,
  selected build, typecheck and scoped lint pass. Public MethodType validation,
  native classmethod/staticmethod wrappers, automatic class-body wrapping, full
  type.__new__ integration and suspended safe-fs effects remain unfinished.
- Added raw staticmethod/classmethod values with intrinsic non-data descriptor
  binding. Static access returns the payload unchanged; class access binds the
  effective owner without chaining the wrapped descriptor, using actual receiver
  ownership only when the owner is omitted. Static calls share iterative method
  unwrapping; classmethod objects remain noncallable. Added wrapped payload reads,
  native truth/hash/numeric classification and automatic wrapping of exact
  function-valued __new__, __init_subclass__ and __class_getitem__ in copied class
  namespaces. The initial allocation regression showed these remained functions.
  Eighteen tests cover binding markers, intrinsic ownership, explicit owners,
  non-data slots, wrapper preservation and compiled inherited/automatic methods.
  All 160 binding cases, 20 wrapping cases and 96 compiled constructor cases match
  CPython. All 6,187 tests in 470 files, selected build, typecheck and scoped lint
  pass. Public wrapper constructors, metadata copying, mutable attributes and
  reinitialization, native object subclass hooks, full type.__new__ integration
  and suspended safe-fs effects remain unfinished.
- Added mutable internal staticmethod/classmethod storage behind frozen wrapper
  identities. Reinitialization replaces the payload before copying the four
  eager Python 3.14 metadata fields, retains absent fields, preserves partial
  updates on failure, and leaves reentrant payload replacement intact. Previously
  bound methods retain their captured callable. Seven regression tests cover
  both wrapper kinds, metadata failure order, reentrancy, cancellation and host
  error provenance; the initial four tests failed against the frozen payload.
  All 50 metadata failure/missing-field combinations match CPython. All 6,194
  tests in 471 files, selected build, typecheck and scoped lint pass. The 160
  descriptor binding and 96 compiled constructor cases still match CPython.
  Public constructor
  argument validation, automatic metadata initialization, guest dictionary
  exposure and lazy annotation/abstractness protocols remain unfinished.
- Added the shared native method-wrapper initializer policy: keyword rejection
  precedes positional arity checking, both precede payload/metadata mutation,
  and successful initialization returns None. Exact wrapper attribute lookup
  now reads its own metadata after intrinsic __func__/__wrapped__ descriptors.
  CPython probes corrected an initial assumption: automatic type.__new__ wrappers
  deliberately have empty metadata dictionaries, unlike explicit initialization.
  A regression preserves that distinction. Eight tests cover argument precedence,
  copied identity, descriptor precedence, automatic wrapping and compiled reads
  before/after reinitialization. All 48 initializer cases match CPython; all 6,202
  tests in 472 files, selected build, typecheck and scoped lint pass. The 20
  automatic-wrapping and 96 compiled-constructor cases still match CPython.
  Canonical native wrapper
  types, constructor/__init__ descriptor wiring, guest dictionaries and lazy
  annotation/abstractness protocols remain unfinished.
- Added lazy execution-owned canonical staticmethod/classmethod types, native
  __new__ allocators and __init__ wrapper descriptors. Direct allocation validates
  the requested owned subtype, ignores extra arguments and produces a None-backed
  wrapper with empty metadata; ordinary type calls then run initialization with
  the frame's ordinary attribute policy. Allocated wrappers retain actual type
  identity, including heap subclasses, for type calls and classmethod ownership.
  Exact function reads expose the four existing metadata fields for copying.
  Initial compiled-constructor tests failed without native type publication;
  additional failures verified intrinsic ownership and foreign-receiver guards.
  Native decorator syntax accepts unresolved annotations without evaluating them.
  The 96 compiled wrapper-constructor cases, 96 ordinary constructors, 160 binding
  cases and 20 automatic-wrapping cases match CPython. All 6,214 tests in 473 files,
  selected build, typecheck and scoped lint pass. Remaining work includes
  native wrapper __get__/__call__/getset descriptors, guest dictionaries, full
  native metadata, subclass attribute/slot overrides, automatic canonical type
  assignment for raw class-allocation wrappers, and the default builtin catalog.
- Installed native __get__ wrapper descriptors on both method-wrapper types and
  __call__ only on staticmethod. Native get calls validate receiver, keywords,
  arity and None markers in CPython order before using the existing binding
  implementation; static calls forward positional/keyword arguments without an
  added receiver. Shared applicability guards retain execution ownership.
  Automatic class-allocation wrappers now own their canonical native types while
  retaining empty metadata. Six initially failing unit/compiled tests cover the
  native descriptors, and an allocation regression exposed missing ownership.
  All 320 direct/bound binding cases, 96 native validation cases, 20 automatic
  wrapping cases, 96 wrapper constructors and 96 ordinary compiled constructors
  match CPython. All 6,220 tests in 473 files, selected build, typecheck and scoped
  lint pass. Ordinary wrapper-instance attribute dispatch, native getsets, guest
  dictionaries, full native metadata and subclass slot overrides remain pending.
- Added native member_descriptor values and readonly __func__/__wrapped__ members
  on canonical method-wrapper types. Member access shares data-descriptor binding
  and applicability, with member-specific readonly diagnostics, live payload reads,
  native metadata, identity hashing and numeric classification. A failing wrong-
  receiver regression corrected data-descriptor diagnostics to use owned class
  names instead of internal instance storage kinds. Typed method wrappers now use
  the shared instance-attribute protocol for compiled reads/writes/deletes, native
  bound methods, subclass shadowing and attribute overrides/fallbacks. Nine new
  tests first failed without these capabilities. All 144 member operations,
  160 wrapper descriptor-precedence operations, 120 ordinary instance operations,
  96 wrapper constructors and 96 ordinary compiled constructors match CPython.
  All 6,229 tests in 474 files, selected build, typecheck and scoped lint pass. Guest __dict__,
  __class__, lazy annotation/abstractness getsets, full native metadata and
  subclass call/descriptor-slot overrides remain unfinished.
- Added reusable attribute storage that keeps unreflected string attributes
  compact, then promotes them once to a live guest dictionary. Native wrapper
  __dict__ getsets expose identity-preserving reads and replacement, reject
  non-dictionaries and deletion, and preserve detached old dictionaries. Attribute
  and reinitialization writes share the current dictionary, including ordinary
  guest key matching and retained non-string keys. Four compiled regressions first
  failed without __dict__; four storage tests cover promotion order, key matching,
  failure preservation and dictionary replacement during metadata lookup.
  All 20 dictionary mutation/identity traces, 160 wrapper attribute operations
  and 96 compiled wrapper constructors match CPython. All 6,237 tests in 475 files,
  selected build, typecheck and scoped lint pass. The 48 initializer and 96 ordinary
  compiled-constructor cases still match CPython. General instance/function dictionaries,
  __class__, lazy annotation/abstractness protocols, full native metadata and
  subclass call/descriptor-slot overrides remain unfinished.
- Added dynamic readonly method-wrapper __isabstractmethod__ getsets. They read
  the wrapped object's current attribute and apply guest truth, treating only
  missing-attribute lookup errors as false while preserving truth errors and
  host termination. Native data-descriptor callbacks now receive the frame's
  invocation capabilities, separate from ordinary attribute override selection.
  Exact function reads now include their existing custom attribute storage.
  Six compiled regressions failed before implementation; five focused tests
  cover host error provenance, missing flags, None payloads, cancellation and
  requiring a truth policy only after a flag is actually found.
  All 60 compiled abstractness cases, 96 ordinary constructors, 96 wrapper
  constructors and 20 dictionary mutation/identity traces match CPython.
  All 6,248 tests in 476 files, selected build, typecheck and scoped lint pass.
  General instance/function dictionaries, __class__, lazy annotations, full
  native metadata and subclass call/descriptor-slot overrides remain unfinished.
- Added lazy method-wrapper __annotations__/__annotate__ proxy getsets. Reads
  cache wrapped attributes by identity, including None; explicit writes accept
  arbitrary values, and deletion removes only the wrapper cache. Successful
  outer reads overwrite reentrant writes; lookup failures preserve nested effects.
  Per the requested annotation policy, functions expose a lazy empty annotation
  dictionary and None evaluator without evaluating source annotations. Nested
  format fields now retain ordinary attribute dispatch and dictionary-key policy.
  Reproduced missing-annotation diagnostics now use NoneType rather than the
  internal none tag. Seven compiled regressions and five focused cache/cancellation
  tests cover these paths. All 96 proxy cache/error/reentrancy cases, 60 abstractness
  cases, 96 wrapper constructors and 20 dictionary traces match CPython; ignored
  source-annotation semantics are intentionally tested against the user policy.
  All 6,260 tests in 477 files, selected build, typecheck and scoped lint pass.
  General instance/function dictionary mutation, __class__, full native metadata
  and subclass call/descriptor-slot overrides remain unfinished.
- Added ordinary function attribute writes/deletion and native mutation of names,
  qualified names, module/doc metadata and annotation dictionaries. Invalid name
  writes preserve prior values; module/doc deletion resets to None; annotation
  None/deletion resets lazy empty introspection without evaluating source types.
  Unimplemented intrinsic code/default/closure fields retain the extension hook
  boundary instead of being misrepresented as ordinary attributes. Four compiled
  regressions initially failed; four focused tests cover failure preservation,
  arbitrary attribute names, cancellation and extension dispatch. Metadata-writing
  Python decorators now drive native wrapper abstractness. All 224 mutation/read
  operations, 60 abstractness cases, 96 wrapper constructors and 96 ordinary
  constructors match CPython. All 6,268 tests in 478 files, selected build,
  typecheck and scoped lint pass. General instance/function dictionary replacement,
  __class__, remaining function intrinsic fields and subclass call/descriptor-slot
  overrides remain unfinished.
- Added live function __dict__ reflection and identity-preserving replacement.
  Generic function state now accepts a string-name storage interface; reflection
  promotes the existing attributes into shared guest storage, and subsequent
  host/guest writes use that same storage. Native function metadata cannot be
  shadowed by dictionary entries. Non-string keys remain in guest dictionaries;
  the host attribute iterator/size expose only string names. Invalid replacement
  and deletion preserve the live dictionary; replaced dictionaries stay detached.
  The compiled regression initially failed with missing __dict__. Two compiled
  regressions and a storage-view test now pass, along with all 6,271 tests in
  478 files. Ten function dictionary traces, 224 function metadata operations
  and 20 wrapper dictionary traces match CPython. Selected build, typecheck and scoped lint
  pass. General instance dictionaries, __class__, other
  function intrinsic fields and subclass call/descriptor-slot overrides remain
  unfinished.
- Added owned instance dictionary replacement and deletion through a native
  class-installed getset. Deletion publishes independent empty storage instead
  of clearing detached aliases. Class allocation installs the descriptor only
  when a plain-object layout introduces unshadowed dictionary storage; subclasses
  inherit it, dictionary-less layouts omit it, and native metaclass layouts keep
  their existing namespace mapping proxy. Ordinary attribute precedence remains
  in the shared descriptor path. Two initial regressions reproduced missing
  reflection/installation; a subsequent audit reproduced and fixed incorrect
  descriptor installation on metaclasses. Focused tests cover owner validation,
  invalid replacement preservation, repeated deletion and cancellation. Two
  compiled tests cover live aliases and class shadows. All 6,279 tests in 479
  files, selected build and typecheck pass. Twenty dictionary traces, 24 layout
  and shadow cases, 640 class allocations, 240 finalizations and 96 compiled
  constructors match CPython. Scoped lint passes.
  Native payload dictionary introductions, __class__ mutation, remaining function
  fields and the full class-construction pipeline remain unfinished.
- Installed native object __getattribute__/__setattr__/__delattr__ wrappers and
  explicit default execution capabilities. Owned instance overrides can delegate
  without recursively applying themselves or __getattr__. Functions retain
  native metadata and dictionary policies. Explicit object lookup treats classes
  as metaclass instances, reading their own namespace without binding contained
  descriptors or searching base-class namespaces. Type mutation applicability is
  checked after keyword/arity validation but before attribute-name validation,
  matching a reproduced CPython discrepancy. Two initial compiled failures and
  two error-priority failures now pass; four compiled cases and 17 wrapper tests
  cover delegation, fallback suppression, metadata, validation and cancellation.
  All 6,300 tests in 480 files, selected build and typecheck pass. All 288
  instance/type argument-validation cases, 160 class descriptor-precedence cases,
  96 ordinary constructors, 96 wrapper constructors and 60 wrapper abstractness
  cases match CPython. Scoped lint passes. Opaque/native default storage
  still uses the execution extension boundary; a complete native type/member
  catalog, __class__, native payload layouts and full class construction remain
  unfinished.
- Added native classmethod_descriptor values and object.__init_subclass__.
  Binding uses the explicit class owner or the receiver's actual type, never
  instance __class__ shadows. Native bound methods retain implementation/owner
  identity, truth, hash and callable behavior through the existing protocols.
  The finalizer now resolves and calls the root hook normally; its temporary
  keyword-rejection fallback was removed. Unbound class-method receiver checks
  precede keyword-name validation, as demonstrated by a failing compiled case.
  Another compiled regression initially reproduced the missing hook. Six focused
  tests cover owner selection, direct calls, subtype rejection, intrinsic slots,
  native identity/hash and cancellation. All 180 binding/invocation cases, 240
  finalization cases, 96 constructors, 54 existing native method bindings and 54
  slot-wrapper bindings match CPython. All 6,308 tests in 481 files, selected
  build, typecheck and scoped lint pass. The complete
  native descriptor type/member catalog, __class__, native payload layouts and
  full class-construction pipeline remain unfinished.
- Added object.__class__ reflection and validated reassignment for represented
  heap layouts. Instance, wrapper and metaclass identities now live in metered
  mutable storage behind frozen runtime records. Compatible changes preserve
  dictionaries, native payloads and captured bound methods. Validation rejects
  foreign execution types, immutable types, differing dictionary availability
  and incompatible native payload ancestry; extension-owned storage receives an
  explicit validated adoption capability. Three compiled regressions initially
  failed. Five focused tests cover actual-type reflection, dictionary shadows,
  foreign ownership, native layout distinctions, extension adoption and
  cancellation. The old type-inspection fixture now creates its deliberate
  __class__ shadow directly in the dictionary, since Python rejects assigning
  None through the native descriptor. All 238 reassignment cases and both sets
  of 96 ordinary/wrapper constructors match CPython. All 6,316 tests in 482
  files, selected build, typecheck and scoped lint pass. Full slot signatures,
  the ModuleType reassignment exception, canonical native type coverage and the
  complete class-construction pipeline remain unfinished.
- Added native __qualname__ metadata for descriptors, method wrappers and bound
  built-ins. Descriptor names cache their defining owner's ordinary qualified-name
  lookup; bound native methods recompute from the current receiver class. Shared
  descriptor/wrapper caches publish successful outer reads and clear nested
  entries when outer initialization fails, matching a reproduced reentrancy case.
  Joining preserves Python code points, including separate surrogate code points.
  Two compiled regressions and one cache-failure regression initially failed;
  six focused tests cover descriptor families, cache sharing, live type identity,
  code points, reentrancy and cancellation. All 105 metadata reads, 30 existing
  metadata cases and 180 native class-method binding/invocation cases match
  CPython. All 6,324 tests in 483 files, selected build, typecheck and scoped lint
  pass. Complete native member/type publication, slot layouts, ModuleType class
  reassignment and full class construction remain unfinished.
- Added live function __defaults__ and __kwdefaults__ reflection, replacement and
  deletion. Lazy containers preserve captured value identity; subsequent calls
  use the replacement tuple or current keyword dictionary. Positional defaults
  align from the right even for overlong tuples. Keyword defaults are looked up
  only for missing keyword-only arguments, after positional validation, matching
  a CPython probe with observable dictionary-key equality. Two compiled cases
  initially failed; additional coverage checks empty containers, lambda defaults,
  deletion, rejected replacement preservation and lazy binding. All 6,329 tests
  in 483 files, selected workspace build, typecheck and scoped lint pass. Full function
  code/closure metadata, canonical native types and class construction remain
  unfinished.
- Added canonical intrinsic descriptor layouts and explicit protocol methods for
  functions and native method/classmethod/wrapper/getset/member descriptors.
  Public __get__, __set__ and __delete__ are actual bound method-wrapper values,
  preserving defining-owner metadata, receiver guards and Python argument-error
  ordering. Explicit gets reuse intrinsic binding without invoking method bodies;
  getsets retain the execution's callback context. Function dictionary shadows
  precede non-data __get__. Native classification remains an execution capability;
  the registry now supplies canonical descriptor types to that capability.
  A compiled function-binding regression initially failed. Three compiled cases
  plus focused family, arity, mutation, cancellation and publication-failure tests
  pass. All 420 explicit protocol cases, 180 existing class-method cases and 105
  qualified-name reads match CPython. All 6,348 tests in 484 files, selected build
  typecheck and scoped lint pass. Complete native type classification/public SDK wiring,
  descriptor metadata catalogs, native constructors and subclass-layout rules
  remain unfinished.
- Added explicit native base-type eligibility, independent of immutability and
  native payload storage. Canonical functions and the five native descriptor
  families reject subclassing; staticmethod/classmethod remain subclassable.
  Allocation checks eligibility before names, namespace processing and class-cell
  publication. The layout constructor repeats the invariant for internal callers,
  including multiple/duplicate bases and attempted subclassable overrides.
  Six regressions initially failed with the wrong namespace-validation error;
  focused coverage also checks publication isolation and allowed native-derived
  hierarchies. All 192 base-eligibility cases, 640 existing class-allocation cases
  and 420 explicit descriptor cases match CPython. All 6,357 tests in 484 files,
  selected build, typecheck and scoped lint pass. Complete native constructors,
  slots/layout conflict checks, mutable bases and public execution wiring remain
  unfinished.
- Added shared native storage identity and multiple-base layout validation.
  Heap subclasses/diamonds inherit their native storage root; explicitly extended
  native payloads establish a more-specific identity. Base eligibility and storage
  conflicts are checked in source order before namespace validation/publication.
  Incompatible staticmethod/classmethod/type layouts are rejected, while compatible
  native ancestry and plain mixins remain valid. __class__ compatibility uses the
  same identity, fixing reassignment across an additional native payload layer
  (validated with date/datetime subclass behavior). Two regressions initially
  failed; focused cases cover diamonds, native extensions and error precedence.
  All 432 layout-conflict cases, 238 reassignment cases, 640 allocation cases and
  192 base-eligibility cases match CPython. All 6,361 tests in 484 files, selected
  build, typecheck and scoped lint pass. Heap slot signatures, full solid-base
  sizing/alignment, native constructors and mutable-base invalidation remain
  unfinished.
- Added __slots__ declaration processing and owned slot storage. Declarations
  consume native/guest iterables before validation, preserve source containers,
  validate identifiers without NFKC normalization, mangle/sort names by code point,
  retain duplicate positions and enforce namespace/dictionary/weak-reference and
  variable-sized-base restrictions. Allocation installs member descriptors backed
  by lazy positional storage, independent of dictionaries and wrapper metadata.
  Unset/get/delete behavior, inherited redeclarations, explicit dictionaries and
  empty weak-reference fields now execute through normal descriptor dispatch.
  Storage-bearing heap bases participate in conflict selection; __class__ changes
  compare compatible sibling slot additions without conflating unrelated parents.
  Three allocation regressions initially failed, including reserved __module__
  handling and empty-slotted metaclass dictionaries. Two compiled checks and 18
  focused declaration/storage cases pass. All 608 declaration cases, 256 slotted
  reassignment cases, 238 previous reassignment cases and 192 base-eligibility
  cases match CPython; the 640 allocation and 432 native-layout cases also passed
  during integration. All 6,384 tests in 486 files, selected build, typecheck and
  scoped lint pass. Actual weak-reference objects/callbacks, slot documentation
  introspection, complete native sizing/alignment, mutable-base invalidation and
  public class-builder/execution wiring remain unfinished.
- Added native __doc__ reflection for descriptor families, bound native methods,
  method wrappers and builtin capabilities. Protocol-wrapper documentation is
  shared by slot; explicit native text (including empty text) is preserved.
  Object/class storage descriptors, subclass hooks and allocation builtins expose
  their documented text. Slot descriptors correctly return None independently of
  dictionary-form __slots__ documentation, which remains available to a future
  inspect.getdoc implementation. Two metadata regressions initially failed;
  seven added tests cover compiled reads, native bindings, overrides, slot docs
  and cancellation. The full suite caught three budget-sensitive regressions
  from a misplaced metadata checkpoint; restricting charges to applicable native
  values fixed them without increasing test budgets. All 50 native documentation
  reads, 105 qualified-name reads and 96 wrapper constructions match CPython.
  All 6,391 tests in 486 files, selected build, typecheck and scoped lint pass.
  Complete builtin documentation catalogs, inspect integration, weak-reference
  objects and public class-builder/execution wiring remain unfinished.
- Added native type.__new__ allocation and runtime finalization wiring, enabling
  explicit allocation and ordinary three-argument type calls. Receiver/argument
  validation precedes allocation; unresolved MRO entries are rejected without
  invoking their hook. Metaclass winner selection delegates through ordinary
  __new__ lookup only when necessary, preserving unrelated results and leaving
  metaclass initialization to type calls. Live calling-module metadata, slot
  allocation, set-name/subclass hooks, failure notes and class-cell publication
  use the existing shared mechanisms. Initial compiled construction and long-name
  diagnostic regressions failed before implementation; 13 focused tests cover
  delegation, hook order, conflicts, cancellation and host ownership boundaries.
  All 154 allocator validation cases match CPython. All 6,404 tests in 488 files,
  selected build, typecheck and scoped lint pass. Public class-statement builder wiring,
  remaining native constructors, mutable bases and complete execution packaging
  remain unfinished.
- Added native type.__prepare__ as an inherited class-method descriptor. It
  returns independent metered dictionaries without inspecting class arguments or
  mutating keyword inputs. Shared descriptor binding enforces metaclass receivers
  and preserves native metadata. A compiled namespace preparation test initially
  failed with missing __prepare__; four focused tests additionally cover receiver
  precedence, dictionary isolation, binding and cancellation. All 180 binding/call
  cases match CPython. All 6,409 tests in 489 files, selected build, typecheck and
  scoped lint pass. Class-body execution against prepared custom mappings and the concrete
  builtin class-builder adapter remain unfinished.
- Added prepared class-body execution through the invocation context. Compiled
  class suites retain defining globals/builtins/closures while using the supplied
  dictionary or custom mapping for locals. Class cells are returned by identity;
  ordinary optimized functions retain their own activation and argument binding.
  Custom mappings use live type-level item slots, preserve names/value identities,
  convert only KeyError lookup/deletion failures, and leave DELETE_NAME's guest
  failure replacement to the frame. Cancellation and host faults cannot become
  missing names. A compiled closure/isolation regression initially failed because
  the execution capability was absent. Eight added tests cover custom mapping
  order, mutation effects, failure boundaries and optimized function behavior.
  All 72 prepared mapping failure traces match CPython. All 6,417 tests in 490
  files, selected build, typecheck and scoped lint pass. Concrete __build_class__
  assembly, remaining native constructors and public execution packaging remain
  unfinished.
- Connected the concrete __build_class__ builtin to registry/key policies and
  active invocation capabilities while preserving complete custom contexts.
  Ordinary class statements now resolve replacement bases, select/prepare the
  metaclass, execute prepared bodies, store original bases and validate captured
  class cells through the shared lifecycle. Mapping flags are checked without
  invoking instance attribute overrides; original keyword values reach preparation
  and construction. Integration exposed missing __bases__ reads and native type
  representation; both now support normal metadata access and class-cell errors.
  Native representation preserves code points and follows CPython's simple-name
  fallback for builtins/non-string modules, including a differential-discovered
  regression fixed with failing tests. Eleven added tests cover lifecycle order,
  custom metaclasses, slots, decorators, invalid mappings and cell consistency.
  All 72 concrete builder mapping traces and 80 representation cases match
  CPython; the previous 154 allocator validation and 640 allocation cases also
  match. All 6,428 tests in 491 files, selected build, typecheck and scoped lint pass.
  Mutable bases/MRO invalidation, complete native constructors, guest exceptions,
  public execution assembly and packaging remain unfinished.
- Added ordinary guest subscription dispatch for reads, writes, augmented
  assignment and deletion. Live type slots receive original keys and slices;
  class subscriptions prioritize metaclass __getitem__ before ordinary inherited
  __class_getitem__ lookup. Disabled hooks, paired mutation-slot absence and
  unsupported operations retain distinct diagnostics. References resolve receivers
  and keys once but look up slots again at write-back. Prepared custom mappings now
  share the same implementation. Eight added tests cover compiled operations,
  descriptor precedence, key identity, reentrant setter changes and native errors.
  Initial guest assignment and prepared-mapping paired-slot regressions failed.
  Full-suite checks exposed three native tuple write-back regressions, fixed by
  preserving exact-container dispatch without increasing budgets. CPython probes
  also corrected set/view deletion wording and an older view-test expectation.
  All 960 guest subscription cases and 72 concrete builder mapping traces match
  CPython. All 6,436 tests in 491 files, selected build, typecheck and scoped lint pass.
  Native generic aliases, complete constructors, mutable bases/MRO invalidation,
  guest exceptions and public execution assembly remain unfinished.
- Added owned callable-instance dispatch and automatic owned descriptor slots.
  Callability inspects actual-type __call__ presence without binding descriptors;
  invocation ignores instance shadows, binds the live slot and forwards original
  arguments through the shared stack. Instance calls defer keyword-name validation
  until after descriptor binding, preserving disabled-call error precedence.
  Owned __get__/__set__/__delete__ methods now supply ordinary descriptor behavior,
  with paired mutation-slot errors and bounded recursive binding. Explicit
  descriptor extensions retain precedence. Seven added compiled tests cover
  callable/disabled methods, descriptor effects, data precedence and stack recovery.
  Initial instance-call, custom-descriptor and keyword-order regressions failed
  before their respective fixes. All 42 compiled instance-call cases and 512
  descriptor-precedence cases match CPython. All 6,443 tests in 491 files, selected
  build, typecheck and scoped lint pass. Wrapper-subclass call/get overrides,
  complete native constructors, mutable bases and public execution assembly remain
  unfinished.
- Added live call/get/data-descriptor dispatch for staticmethod/classmethod heap
  subclasses. Native payload ownership distinguishes exact wrappers from classes
  with their own slot tables. Exact wrappers retain native paths; subclasses use
  ordinary type-slot lookup, including disabled methods and later class changes.
  Nested staticmethod/bound-method calls stop unwrapping at subclass overrides.
  Classmethod subclasses reflect their own call-slot presence. Explicit native
  __get__ calls still enter the base implementation. A compiled regression first
  failed because callable classmethod subclasses were rejected; four added tests
  cover both wrapper families, inherited behavior, mutation and descriptor data
  precedence. All 972 compiled wrapper-subclass cases, 96 wrapper constructions
  and 42 callable-instance cases match CPython. All 6,447 tests in 491 files,
  selected build, typecheck and scoped lint pass. Complete native
  constructors, generic aliases, mutable bases/MRO invalidation, guest exceptions
  and public execution assembly remain unfinished.
- Added custom call-keyword mapping expansion through ordinary keys lookup and
  live subscription slots. Exact list keys remain live; arbitrary iterables are
  fully consumed, including cursor reacquisition and length-hint effects, before
  value retrieval. Duplicate checks precede subscription, while string-key
  validation remains with the eventual callee. Mapping AttributeError and native
  PythonKeyError failures receive call-specific diagnostics. The initial compiled
  regression failed because owned mappings were rejected. Seven added cases cover
  ordinary expansion, live keys, cursor ordering, duplicates, exception conversion
  and invalid keys results. All 96 compiled mapping cases match CPython. All 6,454
  tests in 491 files, selected build, typecheck and scoped lint pass. Generic dictionary update
  wiring, guest exception objects and public execution assembly remain unfinished.
- Connected dictionary in-place updates and construction kernels to active guest
  mapping and iteration protocols. Mapping detection performs the separate keys
  lookup required by dict.update semantics; the shared merge retains live list
  keys, overwrites repeated keys and preserves earlier writes on failure. Guest
  pair sequences receive cursor preparation and length-hint validation. Compiled
  dict |= Mapping() initially failed as a non-iterable instance. Five added tests
  cover identity, construction keyword overrides, double lookup, repeated keys,
  guest pair sequences and partial failure. All 6,459 tests in 491 files, selected
  build, typecheck and scoped lint pass. Differential checks match 32 mapping cases (including
  KeyError payloads, not unfinished exception rendering), 48 sequence/hint cases
  and all 96 previous call-keyword cases. Native dict constructor/method catalog
  registration, dictionary display unpacking and guest exception rendering remain
  unfinished.
- Connected dictionary display unpacking to shared guest mapping merges through
  an explicit expression mapping capability. Displays perform one keys lookup,
  retain live key lists, accept non-string keys and overwrite repeated entries.
  AttributeError from any merge stage becomes the owned-type mapping diagnostic;
  KeyError and other guest/host failures propagate, without evaluating later
  display entries. The initial compiled regression rejected the mapping instance.
  Six added cases cover overwrite order, live numeric keys, descriptor lookup,
  error stages and rejection of iterable pairs. All 32 mapping and 48 sequence/
  hint differential cases match CPython (KeyError comparison uses payloads rather
  than unfinished exception rendering). All 6,465 tests in 491 files, build and
  typecheck and scoped lint pass. Native dict
  update-method invocation still needs its active capability forwarded; full
  constructor catalog and guest exception rendering remain unfinished.
- Forwarded the active invocation capabilities from native dict.update methods
  to the dictionary kernel. The initial compiled mapping-method call failed as
  a non-iterable instance. Four added tests exercise ordinary/extracted methods,
  guest pair sequences, arity before effects, keyword validation after writes,
  keyword override ordering and preservation of partial writes on failure.
  All 128 mapping-method differential cases match CPython, including final
  dictionary contents and exception payloads, as do 48 sequence/hint cases.
  All 6,469 tests in 491 files, build, typecheck and scoped lint pass. Native constructor catalog and fromkeys
  guest-iteration integration remain unfinished, alongside guest exception
  rendering and public execution assembly.
- Connected fromkeys to active guest iteration and exposed the native capability
  through exact dictionary instance lookup (not mapping proxies). Regressions
  first failed independently for rejected guest sequences and missing fromkeys
  attributes. Four added compiled tests cover shared default identity, extracted
  methods, fresh construction, argument validation, ignored length hints and
  resumable guest cursors after an invalid key, without implicit close. All 120
  compiled fromkeys cases match CPython, including dictionary contents and
  validation order. The integration fixture now uses runtime hashing rather than
  an always-accepting hash stub, so invalid-key checks exercise real semantics.
  All 6,473 tests in 491 files, build, typecheck and scoped lint pass. Native type/classmethod descriptor
  catalog integration, dictionary subclass storage, guest exception rendering
  and public execution assembly remain unfinished.
- Connected set/frozenset algebra and relation methods, plus mutable-set update
  methods, to active guest iteration. Exact set/dict fast paths remain native;
  generic streams keep method-specific short circuiting and failure behavior.
  Eleven initial compiled regressions rejected guest iterable instances. Twenty-
  two added cases cover method results, frozen result kinds and receiver state
  after iteration failures: update/difference_update retain prior mutations,
  whereas intersection_update/symmetric_difference_update publish only completed
  results. All 528 set and 336 frozenset compiled differential cases match
  CPython, including receiver contents, results and iteration effects. All 6,495
  tests in 491 files, build, typecheck and scoped lint pass. Set display/constructor guest-iteration wiring, native type
  catalogs, guest exception rendering and public execution assembly remain open.
- Connected starred set displays and exact set/frozenset construction kernels
  to active guest iteration. Three initial compiled regressions rejected guest
  sequence instances. Six added cases cover deduplication, result kinds, ignored
  length hints, validation before iteration, and failure before later display
  entries or assignment publication. All 216 compiled display/construction
  differential cases match CPython, including disabled __iter__ and invalid
  arguments. All 6,501 tests in 491 files, build, typecheck and scoped lint pass. Canonical native constructor/type catalogs,
  subclass storage, guest exception rendering and public execution assembly
  remain unfinished.
- Connected dictionary keys/items view isdisjoint and set-like binary operations
  to guest iteration, including the native side of reflected numeric dispatch.
  Four initial compiled regressions rejected guest iterable instances. Seven
  added cases cover disjointness short circuiting, all four operators in both
  directions, live backing-dictionary mutation and guest numeric precedence.
  All 864 compiled dictionary-view differential cases match CPython, including
  backing contents, result members and iteration effects. Build, typecheck and
  scoped lint and all 6,508 tests in 491 files pass. Canonical native type catalogs, full guest comparison/hash
  assembly, exception rendering and public execution assembly remain unfinished.
- Connected dictionary-item view disjointness, intersection and item-view xor
  to active rich equality and truth policies. Native numeric fallback now carries
  the comparison policy even when both outer operands are native views. Three
  initial compiled regressions skipped guest __eq__. Seven added cases cover
  non-boolean equality results, identity shortcuts and truth exceptions before
  assignment publication. All 168 guest-value differential cases match CPython,
  including subtype precedence, NotImplemented and iterator effects. Build,
  typecheck, scoped lint and all 6,515 tests in 491 files pass. All 864 previous
  dictionary-view cases still match CPython. Automatic guest hash/key equality assembly and
  remaining native type/public execution catalogs are still unfinished.
- Added automatic __hash__ = None to class namespaces defining __eq__ without
  an own hash entry, after member-slot installation and before descriptor/subclass
  initialization. The initial compiled inherited-hash regression lacked this
  namespace entry. Five added cases cover lifecycle visibility, inheritance,
  explicit hash preservation, equality/hash member slots, late assignments and
  non-mutating source namespace copies. All 160 compiled declaration combinations
  match CPython. Build, typecheck and scoped lint pass. The initial full-suite
  run exhausted temporary storage; its generated cache cleaned itself up, and
  all 6,520 tests in 491 files passed on the complete two-worker rerun without
  repository configuration changes. This establishes class hash metadata;
  automatic runtime guest hash/key-policy dispatch and canonical native object
  hash methods remain unfinished, alongside the broader execution work.
- Added an execution hash-slot adapter and connected hash() to active guest
  methods, including nested immutable members. Explicit extension hash policies
  retain precedence; native identity/payload policies are preserved. Hash lookup
  ignores instance shadows, observes live type changes and disabled descriptor
  results, validates actual integer/bool results, normalizes -1 and oversized
  integers, and preserves guest exceptions. The initial compiled regression
  returned the identity hash instead of calling __hash__. Five added compiled
  cases cover nested hashes, disabled/live slots, descriptors, metaclasses and
  extension precedence. All 240 compiled hash cases match CPython. Build,
  typecheck, scoped lint and all 6,525 tests in 491 files pass (two workers).
  Collection key-policy assembly still needs to
  adopt the same adapter; canonical object.__hash__, native type catalogs and
  public execution assembly remain unfinished.
- Corrected the hash descriptor lookup error boundary: AttributeError raised
  while binding __hash__ means unhashable, but AttributeError from the invoked
  hash body is preserved. Other guest and host binding failures are unchanged.
  The initial regression leaked the binding AttributeError. Four added cases
  cover direct/nested hashes and exception identity. All 48 descriptor/body error
  combinations match CPython, including metaclasses and data descriptors. Build,
  typecheck, scoped lint and all 6,529 tests in 491 files pass with two workers.
  The prior 240 guest-hash differential cases also still match CPython.
  Collection key integration and
  canonical native object hash exposure remain unfinished.
- Added a reusable execution-owned collection key-policy factory composing the
  trusted hash domain, live guest hash slots, rich equality and truth conversion.
  Storage retains identity shortcuts, mutation retries and cached-hash ownership;
  the adapter preserves hash-error provenance for container diagnostics. Initial
  tests failed because the factory was absent. Compiled dictionary/set cases now
  exercise subclass-reflected equality and guest truth with callback traces
  matching CPython. Additional cases cover native fallback, explicit hash
  extensions and comparison/truth exception identity. This is an explicit
  assembly capability, not automatic runtime-program wiring: one shared policy
  and a suitable invocation lifetime still need public execution integration.
  Selected workspace build, typecheck, scoped lint and all 6,534 tests in 492
  files pass (two workers).
- Added call-stack-aware execution key storage and frame binding in concrete
  program assembly. Registry/bootstrap storage and guest collections can now
  share one stable key-policy identity while hashing/equality dispatch uses the
  active frame, not the frame that created a collection. Weak frame bindings
  retain no exited activation by themselves. Native bootstrap keys work without
  a frame; hashing owned guest keys outside an active bound frame fails instead
  of silently using a different identity hash. Existing explicit key policies
  remain supported. Initial compiled dictionary/set regressions kept two equal
  keys; ordinary displays and cross-function cached-hash merges now retain one.
  Four new tests cover these paths, nested frame restoration, exception cleanup,
  and reuse across module executions. All 96 CPython differential cases match
  results and callback order across dict/set, direct/tuple keys, reflected
  equality, truth conversion, merges, membership and removal. Public execution
  configuration, canonical native object hash slots and suspension integration
  remain unfinished. Selected workspace build, typecheck, scoped lint and all
  6,538 tests in 493 files pass with two workers.
- Installed canonical object.__hash__ as a native wrapper descriptor, including
  explicit identity hashing of otherwise unhashable native values. A separate
  trusted identity-hash capability flows from execution keys through builtin
  invocation; it normalizes signed 64-bit hashes and never calls guest __hash__
  recursively. Initial compiled regression failed on the missing object member.
  Ten added tests cover direct/bound/inherited calls, explicit hash restoration
  after equality overrides, instance shadowing, native receivers, argument error
  precedence, normalization and cancellation after trusted callbacks. All 180
  object-hash descriptor differential cases match CPython; the 96 collection-key
  differential cases still pass. Legacy host key policies must supply the
  optional identity capability when invoking this native slot; public execution
  setup and remaining native object/type slots are still unfinished. Selected
  workspace build, typecheck, scoped lint and all 6,548 tests in 493 files pass
  with two workers.
- Installed native object.__ne__ with a receiver-only comparison capability.
  Direct delegation preserves NotImplemented and calls guest truth only for an
  accepted equality result; it does not reflect to a strict subtype or apply the
  final identity fallback. Nested native container members still use full guest
  comparison dispatch. The initial regression failed on the missing native slot.
  Differential checking then exposed numeric widening that belongs to reflected
  comparison: three additional failing regressions now ensure int/bool decline
  float/complex and float declines complex at this single-slot boundary. Seven
  added cases cover delegation, nested comparisons, truth, original errors and
  numeric asymmetry. All 196 new differential cases match CPython. Canonical
  object equality/ordering slots and complete native type catalogs remain pending.
  Earlier comparison/collection differential suites also pass (560 guest, 2,028
  native, 96 key cases). Final selected build, typecheck, scoped lint and all
  6,555 tests in 493 files pass with two workers.
- Installed the four canonical object ordering descriptors (__lt__, __le__,
  __gt__, __ge__). Each declines every pair without delegating to guest overrides
  or native payload ordering; descriptor binding, documentation and argument
  validation use the normal wrapper path. Four initial regressions failed on
  absent slots. Eight added tests cover direct/bound/native calls and argument
  error precedence for every slot. All 432 CPython differential cases match,
  including native/guest receivers, None binding and descriptor documentation.
  Base object equality and complete native type catalogs remain unfinished.
  Earlier 560 guest and 2,028 native comparison cases also still match CPython.
  Selected build, typecheck, scoped lint and all 6,563 tests in 493 files pass
  with two workers.
- Installed canonical object.__eq__ with identity-or-NotImplemented semantics.
  The initial missing-member regressions then exposed why native callable types
  need their own comparison slots: inherited base identity must not replace
  function/receiver or implementation/receiver binding equality. Added canonical
  method, method-wrapper and builtin-function/method types with receiver-validated
  native __eq__/__ne__ descriptors, rather than bypassing the object descriptor.
  Repeated list methods also lacked binding metadata; canonical list descriptors
  now supply stable implementation identities for eleven maintained methods and
  preserve active iteration, equality, truth and index capabilities on invocation.
  Native list lookup binds those descriptors when the actual-type policy supplies
  the canonical type; legacy unconfigured lookup remains available. Updated two
  older integration fixtures to classify native values using the registry instead
  of placeholder types, retaining index/callback count checks. Sixteen new cases
  cover base/direct/native equality, all eleven list binding identities/metadata,
  shared hash keys and live descriptor invocation. All 186 object/callable equality
  and 66 canonical list-method cases match CPython. Native constructor catalogs,
  remaining callable/list members (including explicit native hash slots), list
  sort descriptor binding and public execution setup are still unfinished.
  Earlier 560 guest and 2,028 native comparison cases still pass. Final selected
  build, typecheck, scoped lint and all 6,579 tests in 493 files pass (two workers).
- Installed native __hash__ descriptors for method, method-wrapper and builtin
  function/method types. Initial regressions showed explicit type-slot calls
  returning object identity instead of the native binding hash. A metered native
  root-hash capability now bypasses only the outer guest slot, retaining active
  guest hashing for nested callable members and original exception identity.
  Follow-up regressions exposed missing ordinary callable __hash__/__eq__/__ne__
  attribute access; these now bind the defining native wrapper through the actual
  type MRO. Five added tests cover all three callable kinds, ordinary/direct/bound
  access, nested guest hashing and original nested errors. All 78 callable hash
  and 42 comparison-attribute differential cases match CPython; the previous 186
  object/callable equality cases still pass. Native constructor catalogs, remaining
  list members/slots and complete public execution assembly remain unfinished.
  Final selected build, typecheck, scoped lint and all 6,584 tests in 493 files
  pass with two workers.
- Installed canonical list __eq__/__ne__/ordering wrappers and disabled the
  list hash slot with None. Native comparison publication now shares one module
  with callable comparison slots; ordinary native attribute lookup binds the
  defining wrappers and exposes disabled hashing without invoking it. Six initial
  regressions failed on missing ordinary list comparison attributes. Eleven added
  cases cover direct/ordinary access, unsupported peers, raw guest ordering
  results, member identity shortcuts, live list mutation and original callback
  exceptions. All 756 list-slot differential cases match CPython; the prior 78
  callable-hash and 66 canonical list-method cases still pass. List construction,
  remaining list slots/sort binding and public runtime assembly remain unfinished.
  Selected build, typecheck, scoped lint and all 6,595 tests in 493 files pass
  with two workers.
- Bound list.sort through the canonical list method descriptor, retaining stable
  binding metadata and hash identity. Initial regressions reproduced missing
  type-level sort, missing bound metadata and bypassed guest comparisons. Sort
  now uses active guest call, comparison and truth capabilities, preserving the
  explicit legacy key-call adapter when supplied. Thirteen added tests cover
  direct/bound/extracted invocation, temporary-empty storage, original callback
  errors with restored storage and stack unwinding, metadata, and argument-count
  precedence. CPython differential checks exposed the latter error-message gap;
  the total argument count is now checked before rejecting positional arguments.
  All 104 sort cases and 72 canonical list-method cases match CPython. The stable
  kernel still does not reproduce CPython's exact comparison schedule or partial
  permutation after comparison failure. List construction, remaining native
  slots/catalogs and public runtime assembly remain unfinished.
  Selected build, typecheck, scoped lint and all 6,608 tests in 493 files pass
  with two workers.
- Published canonical list __len__, __iter__ and __contains__ wrapper slots.
  Seven initial regressions reproduced absent type-level/ordinary slots and
  noncanonical iteration binding metadata. The new sequence-slot module uses
  live owned storage and active guest equality/truth, preserving identity
  shortcuts, membership mutation behavior and metering. Ten added cases cover
  direct/bound calls, live growth, permanent iterator exhaustion, wrapper
  metadata/argument errors and original guest exceptions with stack unwinding.
  All 96 sequence-slot differential cases match CPython; the existing 252 guest
  containment, 560 guest comparison and 2,028 native comparison cases still pass.
  List construction, subscription/mutation/arithmetic slots, remaining native
  catalogs and public runtime assembly remain unfinished.
  Selected build, typecheck, scoped lint and all 6,618 tests in 493 files pass
  with two workers.
- Published canonical list subscription descriptors: __getitem__ is a method
  descriptor, while __setitem__/__delitem__ are wrapper descriptors with their
  distinct CPython argument validation. Seven initial regressions reproduced
  absent ordinary/type-level methods. The subscription-slot module shares the
  native index and mutation kernels, forwarding active guest index and iteration
  capabilities rather than reimplementing slice behavior. Twelve added tests
  cover direct/bound reads and mutations, index-driven storage changes, binding
  metadata, independent slice results, iterable-driven mutation before slice
  normalization, None mutation results and original errors with stack unwinding.
  All 108 native subscription differential cases match CPython. List construction,
  arithmetic slots, remaining native catalogs and public runtime assembly remain
  unfinished.
  Previous 960 guest-subscription, 96 sequence-slot and 72 list-method cases
  still pass. Selected build, typecheck, scoped lint and all 6,630 tests in 493
  files pass with two workers; the same full-suite process completed despite
  host scheduling delays (7.37 seconds of test execution).
- Published canonical list __add__, __iadd__, __mul__, __rmul__ and __imul__
  wrappers. Ten initial regressions reproduced missing arithmetic attributes.
  Addition shares native concatenation/extension kernels without reflected
  numeric negotiation; repetition performs guest integer conversion before
  touching storage and retains descriptor-specific overflow/type diagnostics.
  Eighteen added tests cover both call forms, binding/argument metadata, result
  identity, guest iteration/index conversion, original callback exceptions,
  overflow operand names, partial extension and native diagnostics without an
  invocation type policy. The latter had a reproduced NoneType naming regression
  that now retains the existing native diagnostic fallback. All 195 arithmetic
  differential cases match CPython, including ordinary and augmented expressions.
  List construction, remaining native catalogs, subclass storage, complete
  public execution setup and other interpreter scope remain unfinished.
  Prior 108 subscription and 96 sequence-slot differential cases still pass.
  Final selected build, typecheck, scoped lint and all 6,648 tests in 493 files
  pass with two workers.
- Installed a canonical list __init__ wrapper. Seven initial regressions showed
  missing ordinary initialization and inherited object initialization at the
  type level. Argument validation precedes clearing; source acquisition and
  length hints observe cleared storage, self-initialization empties the list,
  and iterator failures retain partial progress without replacing guest errors.
  Eleven added tests cover direct/bound initialization, self-source behavior,
  metadata, invalid arguments, noniterables and all three callback failure phases.
  All 58 initialization differential cases match CPython, including source
  mutation and invalid hints. The prior 195 arithmetic, 108 subscription and 72
  canonical list-method cases still pass. Native list allocation/construction,
  subclass storage, remaining catalogs and full public execution remain open.
  Selected build, typecheck, scoped lint and all 6,659 tests in 493 files pass
  with two workers.
- Added exact-list native allocation through list.__new__, enabling the existing
  normal type-call lifecycle to initialize empty, native and guest iterable
  sources. Seven initial regressions reproduced unsafe inherited object
  allocation and incorrect receiver validation. New allocates fresh empty
  storage without consuming additional init arguments; the normal type call
  subsequently validates and consumes them. Nine added cases include allocation
  identity, receiver errors, foreign-registry rejection and original initializer
  failure propagation. All 42 allocation/type-call differential cases match
  CPython; prior 58 initialization, 195 arithmetic and 186 object/callable equality
  cases still pass. This is exact-list support, not complete native subclass
  construction: list subclasses explicitly report an unimplemented host storage
  boundary rather than silently returning an exact list. Native subclass payload,
  state and overridden-slot integration remain required, along with remaining
  catalogs and public execution setup.
  Selected build, typecheck, scoped lint and all 6,668 tests in 493 files pass
  with two workers.
- Replaced the list-subclass allocation boundary with owned native payloads on
  ordinary instances. Subclasses retain actual type, dictionaries and declared
  slots; native descriptors unwrap storage while bound metadata and in-place
  results retain the guest receiver. List methods, initialization, subscription,
  sequence operations and comparisons share existing storage kernels. Initial
  regressions reproduced the allocation failure; follow-up regressions exposed
  mixed concatenation and sequence-versus-numeric dispatch differences. Native
  arithmetic descriptors now identify their sequence fallback operator. Live
  dispatch tracks overridden fallback eligibility and paired forward/reflected
  numeric activation; declined custom in-place methods use ordinary operations,
  preserving fresh result identity instead of silently mutating the old list.
  Twenty-one added tests cover allocation, overrides, dictionaries/slots, hidden
  payload boundaries, binding identity, mixed operands, native errors, declined
  overrides and paired-slot activation. All 114 subclass-slot/override, 195
  subclass-arithmetic and 72 subclass-method differential cases match CPython.
  This removes the explicit allocation blocker, but does not complete native
  subclass conformance: representation, remaining native members and lifecycle
  edge cases still need audits, as do other native catalogs and public execution.
  Prior 195 exact-list arithmetic, 560 guest comparison and 2,028 native
  comparison cases still pass. Final selected build, typecheck, scoped lint and
  all 6,689 tests in 493 files pass with two workers.
- Published canonical list __repr__ with active guest element representation and
  execution-owned recursion guards keyed by the guest receiver, not its hidden
  native payload. Initial regressions reproduced missing subclass representation,
  incorrect type-level lookup and bypassed guest elements. Explicit base calls
  bypass only the outer override; nested overrides, live mutation, recursive
  reentry and original exceptions share the existing list representation kernel.
  Ordinary formatting differentials then exposed missing object.__format__;
  installed its canonical method descriptor with native argument validation,
  empty-spec str delegation, result identity and nonempty-spec errors. Fifteen
  added tests cover these paths, including guard restoration within one execution.
  All 80 list representation/formatting and 56 base-format descriptor cases match
  CPython. Object str/repr publication, remaining native members, lifecycle and
  other subclass audits, full catalogs and public execution remain unfinished.
  Updated one older MRO-format assertion from absent-slot behavior to the
  inherited object-format error, verified directly against CPython. Earlier 48
  guest representation, 32 repr/ascii builtin, 96 format invocation/native-method
  and 114 subclass slot differential cases still pass.
  Verification: workspace build, typecheck and focused lint pass; all 6,704 unit
  tests in 493 files pass with two workers. All 426 differential cases above pass.
- Published canonical object.__str__ and bound exact-list attribute reads to the
  inherited wrapper. Four RED regressions demonstrated missing subclass/base
  lookup and native-list bypass of guest element repr. The implementation uses
  the active representation context, preserving overrides, recursion guards and
  raw repr-result identity; explicit base str deliberately does not validate the
  repr return value, matching direct CPython evidence. Five added tests cover
  exact/subclass elements, wrapper ownership, overrides, non-string returns,
  recursive storage and argument validation. All 27 object-str, 80 list
  representation and 56 base-format differential cases match CPython.
  Workspace build, typecheck and focused lint pass; all 6,709 unit tests across
  493 files pass with two workers.
  Default object repr/identity presentation, remaining native members and public
  execution integration remain unfinished.
- Published canonical object.__repr__ using owned type metadata and opaque,
  execution-local IDs. Eight initial RED cases reproduced missing instance repr
  and erroneous fallback to a bound metaclass repr on explicit object access.
  RuntimeValues now lazily owns a shared identity registry; id registration and
  frame invocation use it by default, with an explicit execution identity policy
  supported. A ninth RED case exposed mismatched override policies between id
  and repr; default id now follows the active invocation policy. Added coverage
  verifies stable/distinct IDs, persistence across programs sharing values,
  module/qualified-name selection, bypassed repr overrides and wrapper argument
  validation. All 81 base-object repr, 27 object str, 80 list representation and
  56 object format differential cases match CPython, including native receivers,
  Unicode/embedded-null names and errors. Direct CPython probes additionally
  confirm that base repr bypasses metaclass attribute hooks and module descriptors.
  Workspace build, typecheck and focused lint pass; all 6,718 unit tests in 493
  files pass with two workers. All 244 differential cases above pass.
  Remaining specialized native representations, full catalogs, lifecycle audits,
  public execution assembly and safe-fs integration are still unfinished.
- Published specialized function and native descriptor repr slots for all six
  canonical descriptor families. Eight RED regressions reproduced generic
  function text and missing explicit repr/str/format attributes. The wrappers
  read live intrinsic function qualified names or defining-type short names;
  function addresses share execution-local id policy. Explicit function
  dictionary shadows remain separate from implicit type-slot dispatch. Descriptor
  attribute binding now includes inherited object str/format without bypassing
  canonical ownership or receiver validation. Added eight integration tests;
  all 78 descriptor representation differential cases match CPython, including
  qualified-name mutation, Unicode/embedded-null input and wrong receivers.
  Earlier 81 object repr, 27 object str, 80 list representation and 56 object
  format differential cases remain green. Bound-callable representations,
  remaining native catalogs and full public interpreter assembly remain open.
  Workspace build, typecheck and focused lint pass; all 6,726 unit tests in 493
  files pass with two workers. All 322 differential cases above pass.
- Published specialized repr wrappers for bound guest methods, built-in
  functions/methods and method wrappers. Nine RED cases reproduced generic text
  and missing explicit attributes. Guest methods resolve function names before
  invoking active receiver repr; general callable name lookup falls back from
  absent qualname to name, preserves non-AttributeError exceptions and displays
  '?' for non-string metadata. Native callable text uses actual receiver types
  and shared opaque IDs without invoking receiver repr. Twelve added tests cover
  ordinary/explicit/format paths, metadata ownership, original lookup errors,
  invalid repr results and name mutation order. All 105 callable-repr differential
  cases match CPython, and 78 descriptor, 81 object and 80 list representation
  cases remain green. Constructor binding metadata, remaining specialized native
  objects, full catalogs and public interpreter/safe-fs assembly remain open.
  Workspace build, typecheck and focused lint pass; all 6,738 unit tests across
  493 files pass with two workers. All 344 differential cases above pass.
- Published native staticmethod/classmethod repr using active payload repr and
  fixed native labels even for subclasses. Ten initial RED cases reproduced
  generic object text, missing payload callbacks and absent recursive behavior.
  Reinitialization during repr retains the original payload result, while later
  operations see the new value. Two additional RED tests exposed host stack
  overflow for direct self-wrapping decorators. Native recursive operations now
  have an invocation capability to enter the configured execution call limit;
  decorator repr uses it with unmetered finally restoration. Twelve added tests
  cover exact/subclass/explicit base behavior, uninitialized wrappers, invalid
  results, mutation and direct/guest cycles with recovery. All 106 decorator,
  105 bound-callable, 78 descriptor, 81 object and 80 list representation
  differential cases match CPython. This does not complete native recursion
  auditing, the stack-independent execution trampoline, full catalogs or public
  interpreter/safe-fs integration.
  Workspace build, typecheck and focused lint pass; all 6,750 unit tests in 493
  files pass with two workers. All 450 differential cases above pass.
- Implemented exact set/frozenset representation with metered key snapshots,
  type-specific empty/recursive text and shared active-path guards. Seven RED
  cases exposed missing set repr plus tuple/dict explicit calls bypassing active
  guest callbacks. Native container repr adapters now acquire the caller's
  representation context only for containers; scalar fast paths remain lazy.
  Nine added tests cover guest elements, native formatting, snapshot mutation,
  recursion, original exceptions and guard recovery within one execution.
  All 90 set/container differential cases match CPython; comparisons avoid
  depending on set iteration order, which is not a Python ordering guarantee.
  Canonical set type slots/subclass storage, remaining native catalogs and full
  public execution/safe-fs assembly are not completed by this increment.
  Final workspace build, typecheck and focused lint pass; all 6,759 unit tests
  in 493 files pass with two workers. The 90 new differential cases and earlier
  106 decorator, 105 bound-callable, 78 descriptor, 81 object and 80 list cases
  all pass (540 total).
- Published canonical set/frozenset types with native repr, len, iter,
  membership, rich comparison and hash declarations. Four initial RED cases
  reproduced absent type-level sequence methods and generic-object comparison
  results. Mutable sets declare hash=None; frozen hashes use their stored key
  hashes. Membership is a method descriptor, while repr/len/iter/comparison/hash
  use native wrappers. Both ordinary and type-level binding use the canonical
  defining type. Nine added tests cover mixed-family comparisons, mutable-set
  probes, ownership, argument validation and iterator mutation. All 388 canonical
  slot and 90 canonical representation differential cases match CPython; earlier
  560 guest and 2,028 native comparison cases remain green. Constructor and
  mutation-method publication, set-subclass storage, remaining catalogs and full
  public interpreter/safe-fs assembly remain unfinished.
  Workspace build, typecheck and focused lint pass; all 6,768 unit tests in 493
  files pass with two workers. All 3,066 differential cases above pass.
- Published canonical mutable set initialization. Five RED cases reproduced
  inherited object-init behavior and missing ordinary __init__ access. Argument
  errors precede clearing; source acquisition and streaming happen after clearing,
  with original exceptions and partial progress preserved. Existing set update
  storage paths retain cached hashes and native source handling. Five added tests
  cover replacement, self-initialization, zero arguments, invalid arguments,
  noniterables and failing guest iterators. All 52 initialization differential
  cases match CPython, including final contents after errors and ignored length
  hints; 388 canonical slot and 90 representation cases remain green. Native
  allocation, subclass storage and the remaining full-interpreter scope stay open.
  Workspace build, typecheck and focused lint pass; all 6,773 unit tests in 493
  files pass with two workers. All 530 differential cases above pass.
- Published exact set/frozenset allocation through normal native type calls.
  Six RED cases reproduced unsafe object-allocation fallback and incorrect new
  validation. Set new creates independent empty storage without touching init
  arguments; frozen new consumes through the existing frozen construction kernel
  and preserves exact frozen source identity. Ownership/subtype checks precede
  storage construction. Native set-subclass storage is explicitly still absent,
  rather than allocating incorrect generic instances. Six added tests cover
  ordinary/direct construction, identity, guest iteration and type errors.
  All 60 allocation, 52 initialization, 388 canonical slot and 90 representation
  differential cases match CPython. Subclass allocation, mutation-method
  publication, full catalogs and public interpreter/safe-fs integration remain
  unfinished.
  Workspace build, typecheck and focused lint pass; all 6,779 unit tests in 493
  files pass with two workers. All 590 differential cases above pass.
- Added owned set/frozenset subclass storage alongside list payloads, preserving
  ordinary guest dictionaries, slots and dispatch. Seven initial RED regressions
  reproduced blocked subclass allocation. Native storage adapters now support
  subclass initialization, sequence slots, comparisons, hashing and representation
  without exposing payload fields. Exact-source copying bypasses overridden
  iteration. Custom frozen initializers receive keywords while default ones retain
  native validation. Repr guards use original receiver identity and reread the
  subclass name after guest callbacks. Additional RED checks corrected mutable
  subclass probe fallback after hash/comparison TypeError and subclass constructor
  arity diagnostics (including the native 200-byte type-name limit).
  Sixteen added tests cover ownership, dictionary/slot storage, overrides,
  mutation, recursion, keyword handling and probe behavior. All 167 subclass,
  60 allocation, 52 initialization, 388 native-slot and 90 representation cases
  match CPython, as do 114 list-subclass, 560 guest-comparison and 2,028 native
  comparison cases. Remaining set mutation/algebra method publication, full
  lifecycle auditing, other native subclasses and public interpreter/safe-fs
  integration remain unfinished.
  Final workspace build, typecheck and focused lint pass; all 6,795 unit tests
  in 493 files pass with two workers. All 3,459 differential cases above pass.
- Published canonical set/frozenset read/algebra methods and mutable set methods.
  Descriptors retain original receiver identity, inherited method binding and
  ordinary overrides while operating on owned native storage. Initial RED tests
  reproduced missing subclass methods and incorrect native-source iteration.
  Native algebra and subset/superset methods now consume subclass storage;
  isdisjoint deliberately honors subclass iteration except for its self-identity
  shortcut, covered by two additional RED regressions. Frozen subclass copies
  are fresh exact frozensets even when allocation shared an immutable payload.
  Ten added tests cover method catalogs, ownership, binding, validation, source
  overrides, self-identity and copying. All 400 compiled CPython differential
  cases match results, mutation state, iteration events and errors (KeyError
  compares guest argument payloads; guest exception rendering remains unfinished).
  Workspace build, typecheck and focused lint pass; all 6,805 unit tests in 493
  files pass with two workers. Set operator-slot publication, remaining native
  catalogs and lifecycle auditing, and public interpreter/safe-fs integration
  remain unfinished. No push or release was requested.
- Published canonical set/frozenset forward and reflected numeric wrappers and
  mutable-set in-place wrappers for union, intersection, difference and xor.
  Eight initial RED cases reproduced missing descriptors, failed mixed-subclass
  augmented operations and lost native fallback after declining reflected
  overrides. Mixed native/guest set pairs now participate in actual subtype
  dispatch, while exact pairs retain native kernels. Wrappers reject non-set
  operands with NotImplemented, preserve reflected operand order/result type,
  and retain original subclass identity for in-place mutation. Exact set
  in-place kernels consume subclass storage without invoking iteration hooks.
  Ten added tests cover binding, validation, reflection priority, mutable
  identity and non-mutating fallback after declined guest in-place overrides.
  All 896 operator, 336 non-set/view/guest negotiation and 400 previous set-method
  differential cases match CPython, including mutation state and callback events.
  Workspace build, typecheck and focused lint pass; all 6,815 unit tests in 493
  files pass with two workers. No push or release was requested.
  Remaining native catalogs, lifecycle details, public interpreter integration,
  guest exceptions and suspended safe-fs execution remain unfinished.
- Published a canonical tuple type with length, iteration, containment,
  subscription, repr, hash, count/index and six comparison descriptors. Six
  initial RED regressions reproduced missing native descriptors, inherited
  object comparisons/hashing and missing bound receiver metadata. Explicit
  tuple operations now use the current execution's equality, ordering, truth,
  integer-index, representation and hash policies. Hash failures retain their
  original guest exception; full slices retain exact tuple identity and repr
  shares container recursion guards. Tuple subscription is a wrapper descriptor
  (unlike list subscription), with native receiver/argument validation.
  Eight added tests cover these protocols, metadata, callback results, errors,
  slicing and recursion. All 496 native tuple descriptor and 85 guest callback
  cases match CPython; the 400 set-method, 896 set-operator and 336 set/view/guest
  negotiation regression cases also pass. Tuple allocation, subclass storage,
  arithmetic wrappers and remaining native catalogs remain unfinished, as do
  public interpreter integration and suspended safe-fs execution.
  Workspace build, typecheck and focused lint pass; all 6,823 unit tests in 493
  files pass with two workers. All 2,213 differential cases above pass. No push
  or release was requested.
- Published canonical tuple concatenation and forward/reflected repetition
  wrappers. Seven initial RED tests reproduced missing arithmetic descriptors.
  Explicit calls reuse the immutable sequence kernels without numeric reflection;
  guest index conversion and signed-size validation run before empty/one-copy
  identity shortcuts. Bound receiver metadata, native argument validation and
  operand type names are retained. Ordinary expression reflection remains
  separate and is checked alongside explicit calls. All 267 compiled arithmetic
  cases match CPython, including result identity and guest index events.
  Tuple allocation and subclass payloads remain unfinished; the broader native
  catalogs, public interpreter API and suspended safe-fs execution are still
  required for the full goal.
  Workspace build, typecheck and focused lint pass; all 6,830 unit tests in 493
  files pass with two workers. The 496 tuple descriptor and 85 guest callback
  regressions also pass, for 848 CPython comparisons in this increment. No push
  or release was requested.
- Added native exact tuple allocation through ordinary type calls and explicit
  tuple.__new__. Six initial RED regressions reproduced blocked construction and
  fresh empty-tuple identities. Exact tuple inputs retain identity, exact list
  slots copy directly into immutable storage, and generic iterables are consumed
  without hints or closing, matching CPython 3.14. Validation precedes iteration;
  failures retain the original guest exception and never publish partial tuples.
  Empty tuples are now lazily cached per value factory, including slices,
  repetition and independent executions sharing the runtime. The cache preserves
  reader validation and charges allocation once; independent runtimes do not
  share the singleton. All 162 construction, 267 arithmetic, 496 descriptor and
  85 guest callback comparisons match CPython. Owned tuple subclass allocation
  remains an explicit implementation gap, not a fabricated ordinary instance.
  The broader native catalogs, public interpreter API and suspended safe-fs
  execution remain unfinished.
  Workspace build, typecheck and focused lint pass; all 6,836 unit tests in 493
  files pass with two workers. All 1,010 differential cases above pass. No push
  or release was requested.
- Added owned tuple subclass storage with ordinary dictionaries, inherited
  sequence/search/comparison/hash/representation protocols and native arithmetic.
  Seven initial RED tests reproduced blocked subclass allocation. Native storage
  adapters preserve guest overrides and keep backing tuples private; slicing,
  one-copy repetition and empty concatenation produce fresh exact nonempty tuples
  rather than publishing backing identities. Constructors honor overridden source
  iteration and allow keywords for custom initialization. Tuple layouts now use
  existing variable-size slot restrictions; an additional RED test corrected
  default weak-reference storage for variable-size classes. A constructor audit
  corrected subclass arity diagnostics to retain the native "tuple" name.
  Broad arithmetic checks found and reproduced a related list fallback defect:
  declining ordinary __mul__ must not disable inherited native in-place repetition.
  That path now retains identity and native count validation, while declined guest
  __imul__ still takes ordinary fallback. Nine added tests cover these behaviors.
  All 768 tuple arithmetic, 768 list arithmetic, 140 tuple subclass construction,
  496 subclass descriptor, 162 exact construction and 267 exact arithmetic cases
  match CPython. Remaining native catalogs and lifecycle details, guest exception
  integration, public interpreter APIs and suspended safe-fs execution remain
  unfinished.
  Workspace build, typecheck and focused lint pass; all 6,845 unit tests in 493
  files pass with two workers. All 2,601 differential cases above pass. No push
  or release was requested.
- Dictionary read-method canonicalization (2026-09-10): reproduced missing
  type-level dict.get and missing bound-method __self__ with failing integration
  tests. Added a canonical dictionary registry identity and six native read
  descriptors: get, copy, keys, values, items and __reversed__. Instance binding
  retains the original dictionary, descriptor ownership and native documentation;
  calls reuse existing storage operations and active guest key policies. Six
  added tests cover metadata, argument validation, guest hash/equality and live
  views. All 330 explicit/bound method and invalid-receiver cases match CPython.
  Workspace build, typecheck, focused lint and all 6,851 unit tests in 493 files
  pass with two workers. Dictionary protocol slots, construction, mutation-method
  descriptors and owned subclass storage remain unfinished. Comprehensions are
  also still unsupported; these read-method checks use the native list constructor
  to inspect views and iterators. No push or release was requested.
- Dictionary mutation-method canonicalization (2026-09-10): failing integration
  tests reproduced missing type-level mutation methods and missing bound receiver
  metadata. Added clear, pop, popitem, setdefault and update descriptors, reusing
  native dictionary mutation kernels and active invocation policies. CPython
  evidence distinguishes keyword timing: bound update applies positional writes
  before rejecting non-string keyword names, but unbound dict.update rejects
  them before mutation. A declarative boundKeywordValidation descriptor capability
  preserves that distinction without changing unbound call dispatch. Four new
  tests cover metadata, mutation results, keyword timing and partial pair updates;
  existing guest mapping callback tests also pass. All 515 mutation cases compare
  results, errors (KeyError args) and post-call storage with CPython; all match,
  as do the 330 read-method regression cases. Workspace build, typecheck, focused
  lint and all 6,855 unit tests in 493 files pass with two workers. Dictionary
  protocol slots, construction, fromkeys and owned subclass storage remain open.
  No push or release was requested.
- Canonical dictionary protocols (2026-09-10): failing integration tests
  reproduced absent item slots, inherited object repr and inherited object
  equality on explicit dict type calls. Added len, iteration, representation,
  item mutation and equality wrappers; contains/getitem retain their distinct
  method-descriptor identities and argument diagnostics. Dictionary __hash__ is
  explicitly None. Instance binding now consults the canonical dictionary type
  before native representation fallbacks. Existing storage operations retain
  active guest key/equality/representation policies and recursive repr guards.
  Differential checks exposed premature keyword-name validation for native
  wrappers: wrapper descriptors and bound method-wrappers now perform their own
  validation, matching CPython, without changing method-descriptor call rules.
  Five added tests cover protocols, live guest repr, equality/hash metadata and
  bound/unbound wrapper keyword rejection. All 927 dictionary protocol cases,
  2,655 list/tuple/set protocol regression cases (including invalid dictionary
  receivers), 515 mutation-method and 330 read-method cases match CPython.
  Workspace build, typecheck, focused lint and all 6,860 unit tests in 493 files
  pass with two workers. Dictionary construction, fromkeys, union operators and
  owned subclass storage remain unfinished, as does the broader interpreter goal.
  No push or release was requested.
- Canonical dictionary union operators (2026-09-10): three failing integration
  tests reproduced missing __or__, __ror__ and __ior__ descriptors. Installed
  native wrappers with the correct operand orientation and receiver metadata.
  Ordinary union declines non-dictionary operands without attempting mapping or
  iterable conversion; in-place union accepts native update sources, retains
  receiver identity and preserves partial writes on later pair-conversion errors.
  Active invocation policies reach guest mapping and iterable callbacks. All
  309 descriptor/argument cases and 126 guest-source/operator cases match CPython,
  including callback order and storage after success or failure. Workspace build,
  typecheck, focused lint and all 6,863 unit tests in 493 files pass with two
  workers. Dictionary construction, fromkeys and owned subclass lifecycle remain
  unfinished; the full interpreter objective remains active. No push or release
  was requested.
- Exact dictionary construction (2026-09-10): four failing integration tests
  reproduced unsafe object allocator fallback, missing native initialization
  and premature keyword validation on explicit dict.__new__. Added a registry-
  owned allocator that returns fresh empty dictionary storage and ignores init
  arguments, including non-string keyword names on explicit allocator calls.
  Native __init__ merges rather than clears, preserving positional writes before
  invalid keyword rejection and applying valid keyword overrides afterward.
  Normal constructor calls still reject invalid keyword names before source
  effects. Existing mutation kernels supply active guest mapping/pair protocols.
  All 130 allocation/construction and 103 initialization cases match CPython,
  including callback order, arity, wrong types and partial mutation. Workspace
  build, typecheck, focused lint, 445 integration tests and all 6,867 package unit
  tests in 493 files pass with two workers. Owned subclass allocation remains an
  explicit implementation gap, not a claimed Python exception; fromkeys and the
  broader interpreter lifecycle remain unfinished. No push or release requested.
- Canonical dictionary fromkeys (2026-09-10): three failing integration tests
  reproduced missing type-level class-method binding. Connected the existing
  fromkeys kernel to a canonical classmethod_descriptor with proper owner,
  bound-class metadata and native documentation. Exact dict keeps its direct
  storage path; subclass-bound calls use ordinary no-argument construction and
  active item-assignment dispatch for arbitrary returned objects. Construction
  precedes iteration; duplicate keys still reach guest setters, and one default
  value is shared. CPython comparison identified and corrected keyword diagnostics
  to name the actual bound subclass. All 137 bound/raw descriptor, custom result,
  invalid argument and callback-order cases match CPython. Workspace build,
  typecheck, focused lint, 448 integration tests and all 6,870 package unit tests
  in 493 files pass with two workers. Owned dictionary subclass storage remains
  unfinished, along with the broader interpreter requirements. No push or release
  was requested.
- Owned dictionary subclasses (2026-09-10): failing integration tests
  reproduced the allocation guard, missing native storage dispatch and incorrect
  copying of overridden dictionary sources. Added trusted dictionary payloads to
  owned instances and connected initialization, read/mutation methods, equality,
  iteration, representation and union wrappers. Item lookup consults __missing__
  only after a native miss; get/contains/mutation do not. Fromkeys invokes owned
  subclass setters, including duplicate keys, and respects empty slots. Native
  copy/update/union bypass mapping overrides only while the canonical __iter__
  slot is inherited; raw-slot inspection avoids binding guest descriptors during
  that decision. Exact dictionaries participate in subtype reflection priority.
  CPython diagnostics distinguish immediate native method calls from retained
  bound methods. Added optional direct-method call preparation that excludes
  unpacked calls, custom attribute lookup and instance shadows; native descriptor
  invocation records bound calling convention for receiver-specific diagnostics.
  A further failing test established that heap dictionary constructors consume
  positional sources before rejecting invalid keyword names, unlike exact dict;
  heap class calls now delegate that validation to allocation/initialization.
  Twelve added tests cover these boundaries. All 1,772 direct and 1,772 retained
  subclass descriptor cases, 2,655 native protocol regressions, 70 copy-override
  cases, 126 missing-hook cases, 130 subclass and 130 exact constructor cases and
  137 owned fromkeys cases match CPython (6,792 total). Workspace build, typecheck,
  focused lint and all 6,882 unit tests in 493 files pass with two workers.
  Further subclass view/proxy ownership, recursive comparison and native lifecycle
  audits remain, alongside public APIs, exception objects, suspension and safe-fs
  execution. This is not completion of the full interpreter objective. No push
  or release was requested.
- Dictionary view/proxy ownership (2026-09-10): failing integration tests
  reproduced lost subclass ownership behind native dictionary views. Views keep
  native-entry iteration while their mapping proxies retain the owning instance
  and delegate indexing, methods, iteration, membership, length, hashing,
  representation, comparison and union. Proxy truth uses owner length rather
  than owner __bool__; length hints do not inherit owner __length_hint__.
  Reversal uses ordinary owner attribute lookup. Mapping expansion retains live
  keys/item callbacks and partial-effect behavior. A differential comparison
  exposed declined subclass equality missing the exact dictionary fallback;
  four failing regressions established the correction through direct instances
  and each view kind. Exact dictionary comparison now participates in canonical
  slot dispatch when a guest operand is present. Ten added tests pass, along
  with all 6,892 package tests in 493 files, workspace build, typecheck and focused
  lint. All 90 owner-delegation cases, 258 edge cases and 927 subclass protocol
  regressions match CPython. The edge harness uses matching callable-name policy
  and materializes iterator results on both interpreters. Canonical proxy
  construction, arbitrary mapping owners, recursive lifecycle audits and the
  broader full-interpreter requirements remain unfinished. No push or release
  was requested.
- Native container comparison fallback (2026-09-10): four failing integration
  cases reproduced valid list, tuple, set and frozenset subclass comparisons
  raising TypeError when guest ordering slots returned NotImplemented. Mixed
  native/guest comparisons now resolve canonical container slots, preserving
  strict-subtype reflection priority and native payload fallback. Exact/native
  pairs retain their kernel fast path. Regression tests cover all six operators
  in both orientations and assert callback order. All 3,024 CPython differential
  cases match across four container families, individual versus complete slot
  overrides, three return policies and three storage relationships. Workspace
  build, typecheck, focused lint and all 6,896 package tests in 493 files pass.
  Broader native lifecycle, interpreter execution and safe-fs integration work
  remains; this increment does not establish full Python support. No push or
  release was requested.
- Native allocator keyword ownership (2026-09-10): seven failing integration
  cases reproduced premature caller-side rejection of non-string keywords in
  list, set, tuple, frozenset and object __new__, plus lost tuple/frozenset input
  effects before guest initializer errors. Native allocators now use the
  existing callee-owned keyword validation capability. An 800-case CPython
  matrix exposed two additional mismatches, reproduced with failing tests:
  exact object construction owns its argument diagnostics, and list subclasses
  with custom allocators allow initialization keywords. Added optional native
  type keyword-validation policy and opted object into it. List initialization
  checks the live raw allocator identity; aliasing list.__new__ retains native
  keyword rejection. All 800 cases match across exact types, plain subclasses,
  custom new/init combinations, explicit allocation and ordinary construction,
  argument errors and source side effects. Workspace build, typecheck, focused
  lint and all 6,905 package tests in 493 files pass. Nine tests were added.
  Further native lifecycle and full interpreter/safe-fs work remain unfinished.
  No push or release was requested.
- Native allocator binding metadata (2026-09-10): seven failing integration
  tests reproduced missing __self__ on the canonical object, type, list, tuple,
  dict, set and frozenset allocation functions. Native capabilities can now
  retain a fixed type owner independently of descriptor argument binding.
  Allocators expose __name__, __qualname__, __self__ and None __module__, and
  render as built-in methods using the defining type's execution-owned identity.
  Subclasses inherit the same callable without rebinding; explicit allocation
  still receives the requested class as an argument. Duplicate-key diagnostics
  retain the defining owner's qualified prefix. CPython confirmed metadata and
  duplicate-key behavior for all seven types; all 800 constructor regression
  cases still match. Workspace build, typecheck, focused lint, 490 integration
  tests and all 6,912 package tests in 493 files pass. Broader native type/catalog,
  full interpreter and safe-fs execution requirements remain unfinished.
  No push or release was requested.
- Canonical dictionary view types (2026-09-10): five failing integration tests
  established missing native view types and descriptor catalogs. Added lazy
  canonical dict_keys, dict_values and dict_items layouts with native iteration,
  length, representation, reversal and read-only mapping descriptors. Key/item
  views also publish comparison, containment, disjointness and forward/reflected
  set-algebra slots; values views retain object identity comparison and hashing.
  Native layout metadata now records direct allocation prohibition; views reject
  allocation, subclassing and type mutation while inheriting object.__new__.
  Exact view attribute lookup binds canonical descriptors before legacy kernel
  fallbacks. Shared method operations avoid creating temporary bound callables
  during descriptor invocation. All 880 bound/unbound slot cases, 81 lifecycle
  and metadata cases and 90 proxy-owner regressions match CPython (1,051 total).
  Workspace build, typecheck, focused lint and all 6,917 package tests in 493
  files pass. Mapping-proxy construction/catalog and arbitrary mapping owners
  remain unfinished, alongside full interpreter and safe-fs execution work.
  No push or release was requested.
- General mapping-proxy construction (2026-09-10): failing integration tests
  established missing construction and arbitrary mapping retention. Added a
  canonical immutable, non-subclassable mappingproxy type with native allocation
  and keyword argument handling. Proxies now retain their original RuntimeValue
  directly rather than a dictionary payload plus optional owner. Construction
  accepts native mapping-protocol values and guest item-slot presence without
  invoking descriptors; list/tuple subclasses remain excluded. Existing read,
  iteration, membership, length, truth, hash, representation, comparison, union
  and expansion paths forward to the retained mapping. Nested item/length/
  iteration/containment and representation forwarding is iterative: a failing
  5,000-proxy test reproduced host stack exhaustion, and CPython confirmed that
  both str and repr must succeed. Framing is built in one metered operation.
  Four added tests pass. All 98 constructor cases, 144 general-mapping operation
  cases, 90 owner cases and 258 proxy edge cases match CPython (590 total).
  The constructor audit needed a larger fixture budget: collision-heavy setup
  plus lazy set registration completed at 102,149 steps; production limits were
  unchanged. Hash comparisons use underlying-value equivalence, and slice-key
  errors are compared structurally. Native slice repr remains an independently
  confirmed missing feature, not a passing rendering claim. Workspace build,
  typecheck, focused lint and all 6,921 package tests in 493 files pass. Canonical
  proxy descriptor publication, slice representation/catalog, remaining native
  lifecycle audits and full interpreter/safe-fs execution remain unfinished.
  No push or release was requested.
- Native slice representation (2026-09-10): three failing integration tests
  reproduced generic object text, missing explicit repr and incorrect recursive
  container rendering. Added a metered slice renderer that expands nested exact
  slices iteratively, invokes component repr in order without coercion, and
  leaves mutable-container cycle markers to their shared guards. Native repr,
  str, ascii and default formatting now use this operation. A 1,000-level nested
  slice renders without host recursion; CPython with a sufficient configured
  recursion limit confirms the same output length. All 3,072 component/format
  combinations match CPython, including invalid guest repr results and Unicode.
  The 144-case general-proxy audit now also matches rendered slice-key errors,
  removing its earlier structural-only exception for this missing feature.
  Workspace build, typecheck, focused lint and all 6,924 package tests in 493
  files pass. Canonical slice allocation, descriptors and the broader interpreter,
  native catalog and safe-fs execution work remain unfinished. No push or release
  was requested.
- Canonical slice allocation and members (2026-09-10): two integration tests
  reproduced the missing type and host-fallback mutation of immutable components.
  Added a lazy immutable, non-subclassable slice type, its fixed-owner allocator,
  native repr wrapper, and start/stop/step member descriptors. Allocation retains
  arbitrary components and zero steps without index coercion. Native default
  mutation now checks intrinsic data descriptors before host hooks, including
  explicit object setattr/delattr calls. All 192 constructor/member cases and
  3,072 representation cases match CPython. Workspace build, typecheck, focused
  lint and all 6,926 package tests in 493 files pass. Slice indices, comparison,
  hash and reduce descriptors, the remaining native catalog, full interpreter
  execution and safe-fs integration remain unfinished. No push or release was
  requested.
- Slice protocol descriptors (2026-09-10): two failing integration tests
  reproduced missing indices and reduction methods. Published all six comparison
  wrappers through the shared receiver-only dispatcher, a native hash wrapper,
  indices and reduce methods. Indices retains arbitrary precision and checks
  length before converting step/start/stop, reusing metered index conversion and
  bounds normalization. Reduction retains original component identities and the
  canonical slice constructor. All 3,692 index/descriptor cases and 882 slice
  comparison cases match CPython, including guest effects, invalid index results,
  non-boolean ordering results and argument diagnostics. Workspace build,
  typecheck, focused lint and all 6,928 package tests in 493 files pass. The
  broader native catalog, full interpreter and safe-fs execution remain
  unfinished. No push or release was requested.
- Mapping proxy protocol and read descriptors (2026-09-10): three failing
  integration tests reproduced missing bound-method ownership and absent native
  protocol descriptors. Published length, iteration, item access, containment,
  repr/str, hash, comparison and union wrappers plus six read-method descriptors.
  Wrappers delegate complete operations to the retained mapping; in-place union
  remains forbidden. Shared dictionary reads now serve both native capabilities
  and descriptors without allocating a temporary callable on descriptor calls.
  All 1,232 descriptor cases, 144 general-mapping cases, 90 owner cases, 258 proxy
  edge cases and 330 dictionary-subclass read cases match CPython (2,054 total).
  Hash checks compare against the underlying mapping, not another process's
  randomized string hash. Workspace build, typecheck, focused lint and all 6,931
  package tests in 493 files pass. Generic aliases/class subscription, remaining
  native types, full interpreter and safe-fs execution remain unfinished. No push
  or release was requested.
- Canonical range allocation and descriptors (2026-09-10): three failing
  integration tests reproduced the missing canonical type and range count/index
  bypassing guest equality. Added immutable non-subclassable range allocation,
  read-only members, protocol wrappers, search/reverse/reduction descriptors.
  Construction uses ordered index conversion and lazy arbitrary-precision
  progressions. Range search now shares the existing search kernel with active
  rich equality and truth conversion instead of duplicating a payload-only loop.
  A CPython audit exposed and a failing assertion reproduced the distinction
  between ordinary range non-string keyword validation and raw allocator keyword
  rejection; the canonical type now preserves that distinction. All 1,152
  constructor/descriptor and 840 slicing cases match CPython, including large
  bounds and guest coercion failures. Workspace build, typecheck, focused lint
  and all 6,934 package tests in 493 files pass. Native object identity/lifecycle
  audits, remaining scalar types, full interpreter and safe-fs execution remain
  unfinished. No push or release was requested.
- Range component identity (2026-09-10): two failing integration tests and
  CPython probes showed that component reads and reduction must retain exact
  integer identities, including integers returned by guest index conversion.
  Range values now own metered component references alongside their arithmetic
  progression. Construction captures validated index objects before extracting
  bigint payloads; booleans and non-exact integers normalize to exact integers.
  Component access and reduction reuse retained objects; sliced ranges also
  retain stable component objects. All 270 identity cases, 1,152 range protocol
  cases and 840 slicing cases match CPython (2,262 total). Workspace build,
  typecheck, focused lint and all 6,936 package tests in 493 files pass. Remaining
  native lifecycle/scalar audits, full interpreter and safe-fs execution remain
  unfinished. No push or release was requested.
- Integer text conversion kernel (2026-09-10): added 16 tests before the missing
  implementation. The metered parser supports bases 0 and 2–36, signs, Python
  int whitespace rules, Unicode decimal digits for text only, prefix/underscore
  rules, base-zero leading-zero rejection and non-power-of-two digit limits.
  Syntax validation precedes balanced chunk conversion, avoiding repeated
  single-digit multiplication of an ever-growing integer. Invalid-input errors
  use original text/bytes repr and Python's diagnostic truncation. All 6,409
  syntax/bytes/limit cases, 3,800 pinned Unicode decimal cases and 140 long-input
  cases match CPython (10,349 total). The oracle separates parsing from decimal
  output conversion so its own output limit does not invalidate successful
  power-of-two-base parsing. Workspace build, typecheck, focused lint and all
  6,952 package tests in 494 files pass. Runtime integer-constructor integration,
  canonical scalar types, full interpreter and safe-fs execution remain
  unfinished. No push or release was requested.
- Runtime integer conversion (2026-09-10): added runtime argument binding and
  conversion behind the integer text kernel. Two integration tests preceded the
  implementation; five buffer tests cover success, parse failure, cancellation,
  acquisition-error rewriting and explicit-base restrictions. Conversion retains
  exact integer identities, normalizes bool, truncates finite floats, prefers
  guest int over index, validates conversion results and warnings, and omits the
  removed trunc fallback. Explicit bases use index conversion before source
  validation. Optional bytearray and buffer capabilities preserve their distinct
  acceptance rules; acquired leases release even when parsing/copying fails.
  All 420 CPython argument/protocol/warning cases match. Workspace build,
  typecheck, focused lint and all 6,959 package tests in 495 files pass. This is
  the shared conversion operation, not completed canonical int/subclass
  allocation; scalar type integration, full interpreter and safe-fs execution
  remain unfinished. No push or release was requested.
- Canonical integer allocation and core slots (2026-09-10): four new failing
  integration tests drove exact/subclass allocation, inherited arithmetic,
  payload-first index consumption and integer-valued explicit bitwise methods
  on bool receivers. Added owned integer payloads, a registry allocator and core
  unary/binary/comparison/hash/representation/conversion wrappers. Native numeric
  dispatch now recognizes integer subtype priority and adapts owned integers for
  mixed float/complex/bool fallback without invoking index overrides. Two older
  integration classifiers now register canonical integers. A recursion-only
  fixture needed a larger step budget after canonical registration; production
  limits are unchanged. All 1,320 core descriptor cases and 420 canonical
  conversion cases match CPython; 864 owned-operator cases pass with 1e-14 scaled
  tolerance for complex components (one complex-power result differed in its
  last few floating bits), with exact callback/error comparisons. Workspace
  build, typecheck, focused lint and all 6,963 package tests in 495 files pass.
  Remaining integer methods/data descriptors, bool hierarchy, owned-integer
  protocol-consumer audits, full interpreter and safe-fs execution remain
  unfinished. No push or release was requested.
- Owned integer protocol results (2026-09-10): two failing integration tests
  reproduced rejection of valid integer subclasses returned by hash and length
  hint methods. Both adapters now inspect native integer payloads directly,
  preserving the prohibition on invoking result conversion overrides. All 96
  CPython protocol cases match, including negative/overflowing length values,
  arbitrary-precision hashes, bool results and index-only objects that remain
  invalid hint/hash results. Workspace build, typecheck, focused lint and all
  6,965 package tests in 495 files pass. Integer method/data descriptors, bool
  hierarchy, remaining scalar consumers, full interpreter and safe-fs execution
  remain unfinished. No push or release was requested.
- Canonical booleans and selected type bases (2026-09-10): failing integration
  tests drove singleton bool allocation, the immutable/non-subclassable int
  hierarchy, boolean-specific bitwise/repr/invert descriptors, and inherited
  integer conversion descriptors. Inversion uses the existing warning policy.
  Native bool attribute lookup preserves inherited descriptor owners. The
  hierarchy test exposed missing type.__base__; a read-only member descriptor
  now resolves the selected layout base, including multiple inheritance where
  it differs from the first declared base and None for object. A test assumption
  also exposed unimplemented type.__instancecheck__; direct MRO assertions cover
  this increment, and instance/subclass checking remains pending. All 903
  CPython constructor and bound/unbound descriptor cases match, including guest
  truth callbacks and warnings. Workspace build, typecheck, focused lint and all
  6,968 package tests in 495 files pass. Remaining integer methods/data members,
  other canonical scalar types, full interpreter and safe-fs execution remain
  unfinished. No push or release was requested.
- Integer numeric members (2026-09-10): two failing integration tests reproduced
  missing canonical data and method descriptors. Added real/imag/numerator/
  denominator getsets and nine no-argument methods: bit_length, bit_count,
  as_integer_ratio, conjugate, __trunc__, __floor__, __ceil__, __getnewargs__ and
  is_integer. Owned subclasses are normalized to plain integers without guest
  conversions; exact integers retain identity where CPython does. Native
  attribute lookup now binds getsets as well as members. All 771 integer member
  CPython comparisons match. An initial broader 816-case audit also exposed 20
  failures in existing float __trunc__/__floor__/__ceil__/__getnewargs__ access;
  these remain pending with canonical float work (bound float operations were
  excluded from the integer-only audit, not counted as passes). Expanded catalogs
  exceeded four integration tests' deliberately all-colliding hash fixture step
  budget; raised its default to one million, leaving production limits unchanged.
  Workspace build, typecheck, focused lint and all 6,970 tests in 495 files pass.
  Integer rounding, format and byte-conversion descriptors, other scalar types,
  full interpreter and safe-fs execution remain unfinished. No push or release
  was requested.
- Integer rounding and formatting (2026-09-10): failing integration tests
  reproduced missing __round__ and inappropriate inherited object formatting
  for integer subclasses. Added the integer rounding descriptor with index
  conversion and shared metered ties-to-even arithmetic with round(). Explicit
  int.__format__ bypasses format overrides, honors original-object str for empty
  specs, and otherwise formats native payloads with accurate subtype diagnostics.
  Formatting contexts now expose their execution-owned numeric locale to native
  descriptors; a regression checks lazy locale acquisition and grouped output.
  All 504 integer-only CPython comparisons match. The initial reference run was
  interrupted after sustained CPU consumption; a one-second diagnostic probe
  confirmed CPython stalls on int.__round__(25,-10**30). The matrix uses -1000
  instead; the extreme runtime regression retains the existing size-based zero
  shortcut and is not claimed as a completed CPython comparison. A broader
  bounded matrix exposed three existing None.__format__ argument diagnostics
  naming NoneType rather than object; these remain pending outside the integer
  audit. Workspace build, typecheck, focused lint and all 6,973 package tests in
  495 files pass. Integer byte-conversion descriptors, remaining scalar types,
  full interpreter and safe-fs execution remain unfinished. No push or release
  was requested.
- Integer byte-conversion descriptors (2026-09-10): failing integration tests
  reproduced absent class-bound from_bytes and owned-integer conversion methods.
  Published to_bytes and from_bytes with native method/classmethod descriptors,
  sharing argument parsing, conversion ordering and metering with the legacy
  methods. from_bytes converts first, then invokes the bound subclass normally,
  preserving custom constructor return values and bool singleton construction.
  Builtin invocations now carry the execution owner's byte/buffer protocol; a
  failing host-storage regression ensured descriptor adapters retain that policy
  rather than overriding its byte recognition. Native instance attribute lookup
  binds classmethod descriptors to the actual type. The 1,131-case CPython audit
  initially exposed 45 guest byteorder type-name mismatches; a failing regression
  drove correct diagnostic names without coercion, and all comparisons now pass.
  Workspace build, typecheck, focused lint and all 6,977 tests in 495 files pass.
  Remaining scalar types, general type checks, full interpreter and safe-fs
  execution remain unfinished. No push or release was requested.
- Inherited native formatting (2026-09-10): seven failing parameterized cases
  reproduced argument diagnostics naming the receiver rather than the defining
  object/int formatter. Native fallback validation now uses the defining family,
  without changing receiver-specific invalid-spec diagnostics. The 136-case
  CPython audit then exposed eight slice failures: slices lacked inherited
  formatting entirely. A failing integration test drove slice object formatting,
  preserving guest component repr calls for empty specs and f-strings. Corrected
  two older tests that expected the disproven receiver-based argument names.
  All 136 comparisons now match. Workspace build, typecheck, focused lint and
  all 6,989 package tests in 496 files pass. Remaining scalar types, general type
  checks, full interpreter and safe-fs execution remain unfinished. No push or
  release was requested.
- Float text parsing (2026-09-10): added a metered float constructor grammar
  after failing tests established the missing parser. Decimal syntax, exponent
  signs, underscores, infinities and NaNs are validated before host binary64
  conversion; Unicode decimal digits/whitespace normalize only for strings,
  not bytes. Signed zero, overflow/underflow and arbitrarily long decimal text
  are supported without integer-string limits. Exact-bit comparisons exposed
  the transpiler folding literal -NaN into positive NaN; a failing sign-bit
  regression drove explicit binary64 NaN construction. All 5,616 syntax/decimal/
  byte cases and 3,945 Unicode cases match CPython, including exact result bits
  and error diagnostics. Workspace build, typecheck, focused lint and all 7,014
  package tests in 497 files pass. Float protocol construction and canonical
  float type integration remain next; full interpreter and safe-fs execution
  remain unfinished. No push or release was requested.
- Float protocol construction (2026-09-10): failing integration tests drove
  native argument binding and conversion through __float__, then __index__,
  then text/bytearray/buffer parsing. Exact float identities are retained;
  __int__ and __bytes__ are not fallback conversions. Added owned float payload
  inspection/storage for strict-subclass result normalization and warnings.
  Buffer leases release after success, syntax failure and cancellation; guest
  acquisition errors are rewritten while host faults propagate. A failing
  regression ensured execution-limit errors cannot be swallowed even by an
  overbroad guest-exception predicate. All 104 CPython construction comparisons
  match. Workspace build, typecheck, focused lint and all 7,021 package tests in
  498 files pass. Canonical float type allocation and method catalog remain
  next; full interpreter and safe-fs execution remain unfinished. No push or
  release was requested.
- Canonical float allocation and numeric slots (2026-09-10): failing integration
  tests drove immutable float type publication, owned subclass allocation, and
  unary/arithmetic/comparison/hash descriptors. Custom initializers consume
  subclass keywords while plain float rejects them. Further failing regressions
  fixed reflected NotImplemented fallback, mixed boolean reflection/comparison,
  and NaN subclass hashing by instance identity rather than backing storage.
  Updated one strict numeric integration classifier to register canonical floats.
  The 3,372-case descriptor audit has 3,364 exact matches and eight fractional
  power results differing by one ULP between host math implementations; the
  latter are explicitly bounded comparisons, not exact matches. All 624 mixed
  operator/override cases and 104 canonical constructor cases match exactly.
  Workspace build, typecheck and focused lint pass. The original final unit run
  terminated with six worker-start failures during a host slowdown, so it was
  not counted as a pass. After that terminal result, an uncached one-worker
  package run passed all 7,026 tests in 498 files with no worker errors and no
  timeout or assertion changes. Float data/method descriptors, formatting,
  rounding and remaining scalar consumers still need work; full interpreter
  and safe-fs execution remain unfinished. No push or release was requested.
- Float data and numeric method descriptors (2026-09-10): two failing
  integration tests drove real/imag getsets and eight native numeric methods,
  including ratio, hexadecimal representation, integral conversions and pickle
  arguments. Owned subclasses expose plain float results without invoking
  __float__ overrides. Exact conjugate/real preserve identity; __getnewargs__
  intentionally creates a fresh float, matching CPython. All 1,084 CPython
  property/method comparisons match, including special values, descriptor
  receiver validation and argument diagnostics. Workspace build, typecheck,
  focused lint and all 7,028 tests in 498 files pass in the uncached one-worker
  package run. Float rounding, formatting and subclass-aware fromhex remain
  next; full interpreter and safe-fs execution remain unfinished. No push or
  release was requested.
- Canonical float rounding (2026-09-10): a failing integration test confirmed
  owned floats lacked __round__. Published the method descriptor with native
  payload access, optional None handling, guest __index__ conversion and exact
  argument diagnostics, reusing the metered exact-ratio rounding kernel.
  Built-in round now reaches inherited float rounding for owned subclasses;
  __float__ overrides remain untouched. All 522 descriptor/protocol cases and
  2,000 seeded binary64 rounding comparisons match CPython exactly. Workspace
  build, typecheck, focused lint and all 7,029 tests in 498 files pass in the
  uncached one-worker package run. Float formatting and subclass-aware fromhex
  remain next; full interpreter and safe-fs execution remain unfinished.
  No push or release was requested.
- Canonical float formatting (2026-09-10): two failing integration tests drove
  float.__format__ publication, owned subclass numeric formatting, empty-spec
  __str__ dispatch and lazy execution-locale sharing. Nonempty specifications
  inspect native storage without invoking __float__; diagnostics preserve the
  actual subclass name. All 414 descriptor/argument comparisons and 2,000 seeded
  native/subclass fixed, scientific, general and percentage formatting cases
  match CPython exactly. Workspace build, typecheck, focused lint and all 7,031
  tests in 498 files pass in the uncached one-worker package run. Subclass-aware
  float.fromhex remains next; full interpreter and safe-fs execution remain
  unfinished. No push or release was requested.
- Canonical float hexadecimal construction (2026-09-10): a failing integration
  test drove fromhex class-method descriptor publication and bound subclass
  allocation after parsing. Custom __new__/__init__ callbacks and unrelated
  allocation results are preserved; invalid text never reaches construction.
  The differential audit exposed subclass-named argument errors, reproduced by
  a failing regression before correction. Shared argument parsing serves both
  the legacy native entry point and canonical descriptor. All 111 CPython
  binding/construction/error cases match; a separate bit-level check confirms
  signed NaN parsing. Workspace build, typecheck, focused lint and all 7,032
  tests in 498 files pass in the uncached one-worker package run. Namespace
  comparison identifies __getformat__ and from_number as still missing float
  class methods. Remaining scalar consumers, full interpreter and safe-fs
  execution are unfinished. No push or release was requested.
- Float numeric-only construction (2026-09-10): a failing integration test
  drove from_number class-method publication. Extracted shared numeric
  conversion from float construction without text/buffer fallback. Unlike
  float(), from_number reads float-subclass storage without invoking __float__;
  other numeric objects retain __float__/__index__ dispatch. Exact float identity
  and bound subclass construction are preserved. A further failing regression
  corrected rejected argument type names to CPython's 50-byte diagnostic limit.
  All 143 CPython comparisons match, including long ASCII/Unicode names. The
  first full run retained the pre-correction diagnostic failure and was not
  counted as a pass; a fresh final-code run passes all 7,034 tests in 498 files.
  Final workspace build, typecheck and focused lint pass. Float __getformat__,
  remaining scalar consumers, full interpreter and safe-fs execution remain
  unfinished. No push or release was requested.
- Float storage-format introspection (2026-09-10): a failing integration test
  drove __getformat__ class-method publication. The virtual platform reports
  deterministic IEEE little-endian formats, consistent with its existing fixed
  native-storage model. Strict UTF-8 validation precedes embedded-null rejection;
  subclass binding and argument diagnostics match CPython. All 82 differential
  cases pass. A namespace audit finds all 47 CPython float names with matching
  descriptor kinds and no extras; this does not establish complete float
  behavior or integration. Workspace build, typecheck, focused lint and all
  7,035 tests in 498 files pass in the uncached one-worker package run. Remaining
  scalar consumers (including owned float percent conversion), full interpreter
  and safe-fs execution remain unfinished. No push or release was requested.
- Percent numeric/representation integration (2026-09-10): two failing
  integration tests exposed missing owned-number payload inspection and absent
  execution callbacks in percent formatting. Native percent conversion now
  recognizes owned integer/float storage; floating formats bypass float-subclass
  __float__ while decimal integer formats retain their __int__ dispatch.
  Percent expressions receive active numeric-conversion, warning and shared
  representation policies, including positional tuples containing guest values.
  Integer subclasses also work as dynamic field widths without conversion.
  All 324 CPython text/bytes numeric and representation comparisons match.
  Workspace build, typecheck, focused lint and all 7,037 tests in 498 files pass
  in the uncached one-worker package run. Guest mapping and tuple-subclass
  percent binding remain to be integrated, as do remaining scalar consumers,
  full interpreter and safe-fs execution. No push or release was requested.
- Percent argument binding integration (2026-09-10): failing integration tests
  drove pure tuple-subclass argument storage and guest mapping subscriptions.
  Tuple __iter__/__len__/__getitem__ overrides are bypassed and tuple subclasses
  remain excluded from mapping formats. Guest mappings receive text/bytes keys
  through normal subscription. An expanded audit reproduced a further failure
  through mapping proxies; a third regression drove metered proxy unwrapping
  before wrapped guest subscription. All 432 CPython binding comparisons match,
  comparing retained KeyError arguments rather than internal host diagnostics.
  Workspace build, typecheck, focused lint and all 7,040 tests in 498 files pass
  in the uncached one-worker package run. Remaining scalar consumers, complete
  guest exception rendering, full interpreter and safe-fs execution remain
  unfinished. No push or release was requested.
- Percent bytes capability integration (2026-09-10): three failing tests drove
  guest __bytes__ dispatch and execution-owned bytes/bytearray/buffer capability
  wiring. Native payloads bypass conversion; __bytes__ precedes buffer copying,
  and callback ownership is preserved. Character fields accept single-byte
  native payloads but never request arbitrary buffers. Added fault-identity
  checks for host errors and execution-limit errors from buffer providers.
  All 192 CPython bytes-format comparisons match. Workspace build, typecheck,
  focused lint and all 7,044 tests in 499 files pass in the uncached one-worker
  package run. General bytearray/bytes canonical types, remaining scalar
  consumers, full guest exceptions, interpreter assembly and safe-fs execution
  remain unfinished. No push or release was requested.
- Canonical numeric buffer construction (2026-09-10): failing integration
  tests drove execution buffer leases and bytearray payload capabilities into
  float/int allocators, including subclass allocation. Explicit integer bases
  accept bytearray storage but never acquire arbitrary buffers. A failing host
  fault regression narrowed integer acquisition-error rewriting to guest errors.
  CPython probing exposed invalid float buffer diagnostics: a further failing
  test drove lazy original-object repr before release, including cleanup when
  repr itself fails. Native string/bytes parsing retains its existing fast path.
  All 168 CPython buffer/bytearray constructor comparisons match, including
  error text and acquire/repr/release ordering. Workspace build, typecheck,
  focused lint and all 7,048 tests in 499 files pass in the uncached one-worker
  package run. Full interpreter assembly, guest exception rendering, remaining
  scalar types and safe-fs file execution remain unfinished. No push or release
  was requested.
- Complex constructor text grammar (2026-09-10): failing tests drove a
  standalone metered parser for real/imaginary components, optional parentheses,
  Unicode decimal digits, strict whitespace and underscore handling, signed
  zeros and non-finite values. Differential failures drove CPython's distinct
  invalid-underscore diagnostic and its null-terminated validation prepass.
  All 7,276 CPython syntax/randomized/Unicode comparisons match, including exact
  component binary64 bits and error messages. Added 37 regression cases covering
  valid and invalid grammar and execution/allocation limits. Workspace build,
  typecheck, focused lint and all 7,085 tests in 500 files pass in the uncached
  one-worker package run. Canonical complex
  allocation and conversion protocols, full interpreter assembly, guest
  exceptions and safe-fs execution remain unfinished. No push or release was
  requested.
- Complex constructor conversion (2026-09-10): failing tests drove positional
  versus real/imag keyword binding, numeric protocol dispatch, native and owned
  complex payload conversion, strict-subclass result warnings, and exact-input
  identity. CPython comparisons exposed different float-subclass behavior for
  single versus two-field calls, warning ordering, signed-zero preservation and
  diagnostic-name limits. Added 14 regression cases, including fatal/host error
  preservation and warning callbacks that remove numeric slots. Reused full
  float conversion for those mutation cases, including buffer fallback and
  lease release. All 4,206 CPython protocol/binding and binary64 comparisons
  match; an execution-fixture probe also verified guest __complex__, __float__,
  __index__ and float-subclass dispatch. Workspace build, typecheck, focused
  lint and all 7,099 tests in 501 files pass in the uncached one-worker package
  run. Constructor reference:
  https://raw.githubusercontent.com/python/cpython/v3.14.0/Objects/complexobject.c.
  Canonical complex type publication, allocation and numeric/member descriptors,
  complete interpreter assembly, guest exceptions and safe-fs execution remain
  unfinished. No push or release was requested.
- Canonical complex allocation and numeric slots (2026-09-10): failing guest
  integration tests drove execution-owned complex type publication, safe native
  allocation and subclass storage, unary/binary/comparison slots and reflected
  subtype priority. Complex subclasses retain strict constructor keyword
  validation even with custom initializers. Published read-only real/imag member
  descriptors, conjugate, __complex__ and __getnewargs__; owned NaN hashing uses
  the instance identity. Five integration tests cover allocation, identity,
  reflection, descriptors and NaN hashes. All 1,058 focused mixed-numeric/member
  comparisons and 430 descriptor/allocator comparisons match CPython. Workspace
  build, typecheck, focused lint and all 7,104 tests in 501 files pass in the
  uncached one-worker package run. An earlier
  1,078-case exploratory run exposed three non-complex gaps: native None/str
  hash descriptors and str.__getnewargs__; these remain unfinished alongside
  canonical complex formatting/from_number, full interpreter assembly, guest
  exceptions and safe-fs execution. Existing complex magnitude rounding and
  transcendental power kernels retain their documented platform-ULP differences.
  No push or release was requested.
- Canonical complex formatting (2026-09-10): two failing integration tests drove
  the native __format__ descriptor and execution-owned locale wiring. Empty
  specifications preserve subclass __str__; nonempty specifications inspect
  complex storage without invoking conversion overrides. Locale is resolved
  only for n formatting. All 414 descriptor/error comparisons and 2,000 seeded
  native/subclass binary64 formatting comparisons match CPython exactly.
  Workspace build, typecheck, focused lint and all 7,106 tests in 501 files pass
  in the uncached one-worker package run. Namespace auditing finds 30 of 31
  CPython complex members with matching descriptor kinds and no extras; only
  from_number is missing. This does not establish complete type behavior.
  Complex from_number, remaining scalar type catalogs, full guest exceptions,
  interpreter assembly and safe-fs execution remain unfinished. No push or
  release was requested.
- Complex numeric-only construction (2026-09-10): failing integration tests drove
  the from_number classmethod, native complex/float subclass override bypasses,
  numeric-only protocol conversion and bound-subclass construction. Extracted
  shared __complex__ result validation for constructor and from_number paths.
  Three integration tests cover conversion, identity, subclass initializers and
  unrelated __new__ results, warning-filter failures, and exclusion of buffers.
  All 90 focused CPython comparisons match, and all 1,806 constructor comparisons
  still match after sharing validation. Workspace build, typecheck, focused lint
  and all 7,109 tests in 501 files pass in the uncached one-worker package run.
  The 31 complex namespace members now
  match CPython's names and descriptor kinds with no extras; this is not proof
  of complete numeric behavior. Three exploratory cases using guest raise hit
  the known unimplemented statement-extension hook; arithmetic-generated
  conversion failures were separately verified and propagate correctly.
  Native exception types, guest raise/try wiring, remaining scalar catalogs,
  public interpreter assembly and safe-fs execution remain unfinished. No push
  or release was requested.
- BaseException object foundation (2026-09-10): failing integration tests
  drove canonical BaseException publication, private native argument storage,
  allocation/initialization separation, str/repr wrappers and a writable args
  descriptor. Allocation captures positional arguments while custom initializers
  may accept keywords; default initialization rejects them before mutation.
  Iterable args conversion preserves exact tuples and only replaces storage
  after successful collection. A fourth regression drove UTF-8-aware 200-byte
  initializer error names, including multibyte boundaries, after a CPython probe
  exposed untruncated diagnostics. All 158 constructor/representation/descriptor
  comparisons and 12 argument-conversion comparisons match CPython, including
  ignored length hooks during args conversion. Workspace build, typecheck,
  focused lint and all 7,113 tests in 501 files pass in the final uncached
  one-worker package run. This is not yet a complete guest
  exception: cause/context/traceback/notes, dictionary and serialization
  descriptors, the builtin exception hierarchy, host-fault translation and
  raise/try execution wiring remain unfinished, as do public interpreter and
  safe-fs assembly. No push or release was requested.
- Exception chaining metadata (2026-09-10): two failing integration tests drove
  native cause/context links and context-suppression storage, with canonical
  getset/member descriptors. Explicit cause assignment, including None, enables
  suppression; context assignment leaves it unchanged. Only exception payloads
  or None are accepted for links, only bool for suppression, and all deletion
  attempts are rejected. Explicit self-links/cycles are preserved. Two native
  state tests connect the existing handled-exception cycle-removal helper to
  actual exception storage and verify rejected metered writes do not partially
  change cause/suppression. All 249 CPython comparisons match, including direct
  descriptor access and invalid input types; integration tests also verify
  subclass shadowing does not replace internal storage. Workspace build,
  typecheck, focused lint and all 7,117 tests in 502 files pass in the uncached
  one-worker package run.
  Tracebacks/notes, dictionary/serialization descriptors, builtin exception
  hierarchy, fault translation, raise/try wiring and full interpreter/safe-fs
  assembly remain unfinished. No push or release was requested.
- Exception notes (2026-09-10): two failing integration tests drove
  BaseException.add_note, preserving native list identity, validating strings
  before virtual attribute lookup, and publishing an empty list through the
  setter before native append. List-subclass append overrides are bypassed.
  Two additional tests cover setters that discard the list and guest/host/fatal
  hook failures without premature append. All 252 argument/storage/binding
  comparisons and 48 attribute-hook comparisons match CPython. Focused tests,
  typecheck, lint, the selected workspace build and all 7,121 tests in 502 files
  pass in the uncached one-worker package run. Dictionary/serialization and traceback descriptors, exception
  hierarchy, fault translation, raise/try wiring and full interpreter/safe-fs
  assembly remain unfinished. No push or release was requested.
- Exception dictionaries (2026-09-10): two failing integration tests drove the
  BaseException dictionary descriptor and dictionary-subclass assignment for
  ordinary instances as well as exceptions. Instance state retains the guest
  dictionary object separately from its exposed native payload; attribute reads,
  writes and deletions bypass mapping overrides while descriptor reads preserve
  identity. Exception dictionary deletion is rejected; ordinary instance deletion
  still detaches aliases. A third failing regression drove complete-character
  UTF-8 truncation of invalid replacement type names. All 82 focused CPython
  comparisons match, covering direct descriptors, inherited storage, ownership,
  invalid values, replacement aliases and exception notes. Focused tests,
  typecheck, lint, the selected workspace build and all 7,124 tests in 502 files
  pass in the uncached one-worker package run.
  Serialization must distinguish unmaterialized from exposed empty dictionaries;
  this is confirmed by CPython probes and remains pending alongside tracebacks,
  the exception hierarchy, raise/try wiring and interpreter/safe-fs assembly.
  No push or release was requested.
- Exception reduction (2026-09-10): failing integration tests drove native
  BaseException.__reduce__ and genuinely lazy dictionary allocation. Reduction
  retains the actual type, argument tuple and existing dictionary object without
  attribute hooks. Untouched dictionaries are omitted; explicit dictionary reads
  and attribute mutations materialize them. Failed reads stay lazy, whereas
  failed deletions materialize empty storage, matching CPython. Two native tests
  verify one-time allocation, allocation-free replacement and cancellation before
  publishing storage. All 66 reduction comparisons, the prior 82 dictionary
  comparisons and 252 note comparisons match CPython. Focused tests, typecheck,
  lint, the selected workspace build and all 7,129 tests in 502 files pass in
  the uncached one-worker package run. State restoration, traceback support,
  the exception hierarchy, raise/try wiring and interpreter/safe-fs assembly
  remain unfinished. No push or release was requested.
- Exception state restoration (2026-09-10): two failing integration tests drove
  BaseException.__setstate__. None and empty dictionaries leave lazy storage
  untouched. Nonempty state is scanned through native dictionary positions,
  bypassing mapping overrides while invoking the current attribute setter for
  each original key/value pair. Setter-driven additions, deletions, clearing,
  updates and setter replacement affect subsequent processing. Invalid keys or
  setter failures retain earlier changes. A direct capability test verifies key
  identity and unchanged host/guest/fatal failure propagation without processing
  later entries. All 84 argument/state comparisons and 21 live-mutation
  comparisons match CPython. Focused tests, typecheck, lint, the selected
  workspace build and all 7,132 tests in 502 files pass in the uncached
  one-worker package run. Traceback objects, exception
  hierarchy, raise/try wiring and interpreter/safe-fs assembly remain unfinished.
  No push or release was requested.
- Standard exception hierarchy (2026-09-10): failing integration tests drove
  canonical lazy registration of 34 CPython builtin exceptions sharing the
  BaseException allocation/state protocol. A declarative catalog defines their
  bases and docstrings; registry construction supplies immutable types and owned
  allocators with inherited native storage. Allocation errors identify the
  defining type and enforce its subtype boundary. An independent CPython
  inventory exposed StopAsyncIteration, SystemError and PythonFinalizationError;
  a third failing regression drove their inclusion. All 1,394 metadata,
  construction and cross-type allocator comparisons match CPython. Focused tests,
  typecheck, lint, the selected workspace build and all 7,135 tests in 502 files
  pass in the uncached one-worker package run.
  Specialized exceptions (including MemoryError's distinct allocator), traceback
  objects, fault translation, raise/try wiring and interpreter/safe-fs assembly
  remain unfinished. No push or release was requested.
- KeyError representation (2026-09-10): failing integration tests drove the
  KeyError type, its inherited LookupError allocator, and repr-based formatting
  for one argument. Shared exception formatting was extracted with a declarative
  single-argument policy; zero/multiple args and reduction retain their normal
  behavior. Native args are captured before repr callbacks mutate them, and
  guest attribute shadows do not replace storage. A third failing regression
  tightened descriptor receiver validation to the defining type's MRO. All 49
  KeyError comparisons and the prior 1,394 standard hierarchy comparisons match
  CPython. Focused tests, typecheck, lint, the selected workspace build and all
  7,138 tests in 502 files pass in the uncached one-worker package run.
  Specialized member-bearing exceptions require separate native
  layout and allocator-family handling: CPython permits BaseException.__new__
  for NameError/AttributeError/ImportError/StopIteration/SystemExit, but not
  MemoryError. These types, tracebacks, fault translation, raise/try wiring and
  interpreter/safe-fs assembly remain unfinished. No push or release requested.
- Argument-bearing exceptions (2026-09-10): three failing integration tests drove
  StopIteration.value, SystemExit.code and distinct native layouts that retain
  BaseException allocator compatibility. Type layouts now track allocation family
  separately from storage identity. Declarative argument-member policies initialize
  first/all arguments; StopIteration clears its value on empty initialization,
  whereas SystemExit retains its prior code. Multiple SystemExit arguments share
  the args tuple, direct field writes remain independent, and deletion resets to
  None. Raw base allocation leaves fields unset; incompatible native layouts still
  reject multiple inheritance. A native state test verifies metered field writes
  preserve prior values on failure. All 98 focused CPython comparisons and 1,394
  hierarchy regression comparisons match. Focused tests, typecheck, lint, the
  selected workspace build and all 7,142 tests in 502 files pass in the uncached
  one-worker package run. Remaining specialized exceptions,
  tracebacks, fault translation, raise/try wiring and interpreter/safe-fs assembly
  are unfinished. No push or release was requested.
- Name-resolution exception types (2026-09-10): two failing integration tests
  drove NameError, UnboundLocalError and the native name member. Keyword-derived
  member initialization replaces args before validation, preserves the previous
  name on invalid keywords and clears it when a successful call omits name.
  Errors retain the defining initializer's name and include CPython spelling
  suggestions. Native name storage is excluded from reduction and ordinary
  dictionary state. An additional regression verifies subtype attribute shadows
  and setters do not intercept initialization. All 109 focused CPython comparisons
  match, as do 98 existing argument-member regression comparisons. Focused tests,
  typecheck, lint, the selected workspace build and all 7,145 tests in 502 files
  pass in the uncached one-worker package run. Attribute,
  import, OS, Unicode and other specialized exceptions, traceback objects, fault
  translation, raise/try wiring and interpreter/safe-fs assembly remain unfinished.
  No push or release was requested.
- AttributeError state (2026-09-10): failing integration tests drove coordinated
  native name/obj keyword initialization and AttributeError-specific serialization.
  The shared member initializer now validates all keywords before replacing any
  field, while preserving the established args-before-validation ordering.
  Serialization copies ordinary dictionary state without exposing lazy storage,
  overlays native name when set (including explicit None), always includes args,
  and omits the native object reference. Native reduction bypasses subclass
  __getstate__ hooks and observes args mutations from key-equality callbacks in
  CPython order. All 116 focused comparisons match after aligning fixture module
  names; prior 109 NameError and 98 argument-member comparisons also match.
  Focused tests, typecheck, lint, the selected workspace build and all 7,148 tests
  in 502 files pass in the uncached one-worker package run.
  Import, OS, Unicode and other specialized exceptions, tracebacks,
  fault translation, raise/try wiring and interpreter/safe-fs assembly remain
  unfinished. No push or release was requested.
- Import exception state (2026-09-10): failing integration tests drove ImportError
  and ModuleNotFoundError with msg/name/path/name_from native fields. A message
  field derives from exactly one positional argument only after keyword validation;
  invalid keywords replace args but retain prior native fields. String messages
  override args-based display, nonstrings fall back, and subclass attribute shadows
  do not replace native storage. Reduction preserves an existing dictionary alias
  when metadata is absent and copies only when overlaying native import metadata.
  Native msg is omitted. A callback-order regression verifies later metadata/args
  mutations remain observable during reduction. All 100 focused CPython comparisons
  match, along with 323 prior member-type comparisons. Focused tests, typecheck,
  lint, the selected workspace build and all 7,151 tests in 502 files pass in the
  uncached one-worker package run. OS, Unicode and other
  specialized exceptions, tracebacks, fault translation, raise/try wiring and
  interpreter/safe-fs assembly remain unfinished. No push or release requested.
- Synchronous exception execution (2026-09-10): failing integration tests drove
  an explicit execution-owned adapter shared across module, class and function
  frames. Raise construction, virtual normalization, explicit causes, implicit
  context, bare reraises, complete handler validation and alias cleanup now use
  native exception instances. Assertions use the canonical builtin even when
  names are shadowed. Recognized internal faults become guest instances without
  rendering their arguments; KeyError retains its original key and normalization
  notes survive translation. Guest StopIteration subclasses terminate native
  iteration. Host failures, spoofed error names, unsupported native families and
  execution-limit failures remain uncatchable; active state restores even after
  actual step/allocation exhaustion. A generic preparation-hook regression also
  preserves deliberately null guest payloads. All 78 focused CPython comparisons
  match. The selected workspace build, typecheck, focused lint and all 7,162
  tests in 502 files pass in the uncached one-worker package run.
  Native protocol catch sites still need guest-aware classification beyond
  StopIteration (including attribute fallback and sequence IndexError), and
  unsupported native families still need translation. Tracebacks, exception
  groups, suspension and public interpreter/safe-fs assembly remain unfinished.
  No push or release requested.
- Native protocol exception matching (2026-09-10): five failing reproductions
  drove shared matching for native faults and guest exception subclasses through
  an explicit invocation capability. Instance/metaclass attribute fallback,
  getattr defaults, hasattr, exception-note initialization, sequence termination
  and advisory length hints now recognize the appropriate guest subclasses.
  Classification uses actual inheritance and canonical builtin classes, never
  virtual subclass checks or guest rendering. Unknown names and spoofed host
  errors remain false, and execution limits never reach extension classifiers.
  The policy also recognizes canonical parent classes of supported native faults.
  All 84 focused CPython comparisons and 627 focused tests pass. The selected
  workspace build, typecheck, focused lint and all 7,172 tests in 503 files pass
  in the uncached one-worker package run. Remaining native catch sites (class preparation,
  mappings, decorators, conversions and related protocols) still need individual
  reproduction and guest-aware integration. A separate 24-case read-only audit
  confirms eight remaining mismatches: dict's iterable fallback, dictionary
  unpacking, keyword unpacking and class subscription each fail to recognize
  explicitly raised AttributeError and its subclasses. These are next work,
  not counted as passing comparisons. Broader interpreter, tracebacks,
  exception groups, suspension and safe-fs work remain unfinished.
  No push or release requested.
- Mapping and subscription exception integration (2026-09-10): failing tests
  reproduced and fixed the prior eight mismatches. Mapping detection now treats
  guest AttributeError as absent keys and falls back to iterable pairs; dictionary
  and keyword unpacking instead produce their proper TypeError diagnostics.
  Missing class-subscription hooks use the canonical unsubscriptable diagnostic.
  Further failing tests drove TypeError normalization during key/pair iterator
  acquisition, preserving prior dictionary writes and later iteration failures.
  A CPython-backed descriptor regression treats AttributeError while binding
  __iter__ as an absent hook, allowing legacy sequence fallback without masking
  exceptions raised by the iterator body. All 60 expanded comparisons match
  after aligning the audit fixture's deliberate call-name policy; the prior
  84 protocol comparisons and all 630 integration tests also pass. The selected
  workspace build, typecheck, focused lint and all 7,178 tests in 503 files pass
  in the uncached one-worker package run. Other native catch sites, exception metadata,
  tracebacks, exception groups, suspension and interpreter/safe-fs integration
  remain unfinished. A separate 20-case read-only audit confirms 12 remaining
  keyword-expansion mismatches: one-argument guest KeyError (including subclasses)
  from keys/getitem must become the duplicate-keyword TypeError, while zero- and
  multi-argument cases retain the original exception. This requires native
  exception-argument access and diagnostic formatting, not only classification;
  these cases are next work and are not counted as passing comparisons.
  No push or release requested.
- Keyword exception arguments and diagnostics (2026-09-10): failing regressions
  drove read-only native exception-argument access through the invocation policy.
  One-argument guest KeyError becomes the duplicate-keyword TypeError; zero- and
  multi-argument instances retain identity, including mixed KeyError/AttributeError
  subclasses. Native args bypass overridable attributes and are read after frame
  cleanup. Diagnostic keys use the shared str protocol, preserving guest failures
  and avoiding repr when str exists. A further failing test exposed formatting
  inside the mapping catch boundary; duplicate detection now transports its raw
  key out of that boundary before formatting, so KeyError/AttributeError raised
  by str cannot be reclassified as another mapping failure. Host failures and
  execution limits remain uncatchable. All 65 focused CPython comparisons match,
  including bare reraises during diagnostic formatting with and without an active
  outer handler. The prior 144 protocol comparisons also match. The selected
  workspace build, typecheck, focused lint and all 7,184 tests in 503 files pass
  in the uncached one-worker package run.
  Other native protocol catch sites, metadata, tracebacks, exception groups,
  suspension and interpreter/safe-fs integration remain unfinished.
  No push or release requested.
- Class namespace exception integration (2026-09-10): failing regressions drove
  guest-aware KeyError misses in prepared mappings, deletion-error replacement
  with NameError, and AttributeError fallback during optional __prepare__ lookup.
  A further regression covers guest equality failures during deletion from exact
  prepared dictionaries. Their exception policy now follows every class-body
  entry path, including direct builder/class helpers, with the additional policy
  storage charged to the execution meter. Lookup and storage still propagate
  nonmatching exceptions; deletion recognizes BaseException subclasses while
  preserving fatal host/limit failures. Exact-dictionary lookup still propagates
  comparison KeyError rather than treating it like a custom-mapping miss.
  All 98 CPython comparisons and 669 focused tests pass. The selected workspace
  build, typecheck, focused lint and all 7,189 tests in 503 files pass in the
  uncached one-worker package run. Remaining native protocol
  catch sites, exception metadata/tracebacks/groups, suspension, and public
  interpreter/safe-fs assembly remain unfinished. No push or release requested.
- Method-wrapper exception integration (2026-09-10): failing regressions drove
  guest-aware missing metadata during staticmethod/classmethod initialization,
  missing abstractness detection, and bound-method repr name fallback. Native
  wrapper initialization now carries the explicit exception policy through its
  validation/state layers. Partial metadata writes and the new wrapped object
  survive nonmatching initialization errors; AttributeError from abstractness
  truth conversion still propagates. Host failures, spoofed error names and
  execution limits remain uncatchable. All 112 CPython comparisons and 646 focused
  integration tests pass, along with the prior 98 class-namespace comparisons.
  The selected workspace build, typecheck, focused lint and all 7,195 tests in
  503 files pass in the uncached one-worker package run. Remaining
  native catch sites, exception metadata/tracebacks/groups, suspension and public
  interpreter/safe-fs assembly remain unfinished. A separate two-case read-only
  audit confirms that explicit guest exceptions and translated arithmetic faults
  escaping __set_name__ currently lack CPython's contextual diagnostic note.
  That note integration is next work, not a passing comparison.
  No push or release requested.
- Set-name exception diagnostics (2026-09-10): failing regressions drove native
  diagnostic notes on explicit guest exceptions and translated native faults
  escaping descriptor __set_name__. Native note addition bypasses overridden
  add_note methods, preserves existing notes and exception identity, and exposes
  the outer handled exception during note lookup, mutation and key repr. Failures
  in those callbacks replace the original error and receive its context directly,
  including CPython's self/cyclic links. Host failures, spoofed names and execution
  limits remain fatal. All 48 targeted CPython comparisons, the prior 210
  method-wrapper/class-namespace comparisons and 669 focused tests pass. The
  selected workspace build, typecheck, focused lint and all 7,203 tests in 503
  files pass in the uncached one-worker package run (295.43s; test bodies 14.70s).
  A separate two-case audit confirms one remaining mismatch: guest AttributeError
  from a nonclass base's __mro_entries__ lookup must count as a missing attribute
  during direct type allocation. This is next work, not a passing comparison.
  Exception metadata/tracebacks/groups, suspension, remaining native protocols,
  public interpreter assembly and safe-fs integration remain unfinished.
  No push or release requested.
- Direct type allocation exception lookup (2026-09-10): a failing integration
  regression reproduced propagation of guest AttributeError subclasses from
  nonclass bases' __mro_entries__ lookup. The allocator now uses the shared
  guest-aware matcher, permitting normal metaclass validation to continue.
  Nonmatching guest errors retain identity; host errors, spoofed AttributeError
  names and execution limits remain fatal. All 30 CPython comparisons spanning
  descriptor, __getattribute__ and __getattr__ lookup through type/type.__new__,
  plus all 663 focused allocator/integration tests, pass. The selected workspace
  build, typecheck and focused lint pass.
  A separate 24-case read-only audit confirms four next mismatches: missing guest
  hash descriptors must produce unhashable TypeError, missing __contains__
  descriptors must fall back to iteration, and guest TypeError during containment
  iterator binding/calling must receive the native non-iterable diagnostic. Those
  four cases are not passing comparisons. Broader runtime assembly, safe-fs,
  suspension and remaining exception families/metadata remain unfinished.
  No push or release requested.
- Hash/containment exception integration (2026-09-10): failing regressions drove
  guest-aware missing hash descriptors, missing containment descriptor fallback
  and TypeError normalization during containment iterator acquisition. Optional
  descriptor lookup is distinct from method invocation: hash/contains method
  errors and later next/index/equality/truth failures still propagate unchanged.
  Host exceptions, spoofed names and execution limits remain fatal. All 48
  targeted CPython comparisons and 98 prior class-namespace comparisons pass.
  The selected workspace build, typecheck, focused lint and all 7,211 tests in
  503 files pass in the uncached one-worker package run (160.87s; bodies 10.70s).
  A separate 24-case read-only sequence-consumer audit confirms eight remaining
  TypeError diagnostic mismatches during iterator binding/calling for string and
  bytes join and ordinary/extended list slice assignment; later iteration errors
  match. Those eight cases are next work, not passing comparisons. The broader
  unfinished runtime/standard-library/safe-fs assembly remains under audit.
  No push or release requested.
- Sequence consumer exception integration (2026-09-10): a failing regression
  drove guest TypeError normalization during initial iterator acquisition for
  string/bytes join and list slice assignment. The shared iterator helper now
  receives the explicit invocation exception policy, including expression
  mutation and explicit/inherited list subscription slots. Reacquisition,
  advisory hints and element iteration remain outside diagnostic replacement.
  Callback effects survive later failures; host errors, spoofed names and
  execution limits remain fatal. All 54 targeted CPython comparisons, 48 prior
  hash/containment comparisons and four focused integration regressions pass.
  The selected workspace build, typecheck, focused lint and all 7,215 tests in
  503 files pass in the uncached one-worker run (241.72s; test bodies 11.81s).
  A separate eight-case read-only audit confirms three next mismatches: set
  subclass probes whose hash raises guest TypeError must use equivalent frozen
  contents for membership/discard/remove. Insertion and non-TypeError failures
  already match. Those three cases are next work, not passing comparisons.
  Remaining native exception boundaries, specialized exception families,
  suspension and public interpreter/standard-library/safe-fs assembly remain
  unfinished. No push or release requested.
- Set subclass probe exception integration (2026-09-10): failing regressions
  drove guest TypeError fallback to equivalent frozen contents during set
  membership/discard/remove, explicit/inherited slots and dictionary key-view
  comparisons. Expression membership and native comparison contexts now carry
  the exception matcher; added bound policies are charged to the allocation
  meter. Insertion and non-TypeError failures preserve guest identity, while
  host errors, spoofed names and execution limits remain fatal. All 84 CPython
  comparisons and five focused regressions pass. The selected workspace build,
  typecheck, focused lint and all 7,220 tests in 503 files pass in the uncached
  one-worker run (184.27s; bodies 10.14s). The previous 54 sequence-consumer comparisons and an
  additional 18-case numeric descriptor exception audit pass. A separate two-case
  probe confirms str.translate does not yet dispatch guest mapping __getitem__,
  including its LookupError identity fallback. Those cases are next work, not
  passing comparisons. The full public interpreter, standard library,
  specialized exceptions, suspension and safe-fs assembly remain unfinished.
  No push or release requested.
- Guest string translation (2026-09-10): failing regressions drove default
  runtime subscription dispatch for str.translate tables, guest LookupError
  identity fallback and native integer-subclass result inspection without
  coercion. Explicit lookup/payload policies retain their priority. A separate
  failing safety regression prevents an explicit translation exception policy
  from swallowing execution limits; nonmatching guest and host failures still
  propagate. All 690 focused translation/integration tests, 100 CPython
  comparisons, selected workspace build, typecheck and focused lint pass.
  Comparisons cover observable lookup caching/retries, Unicode, deletion,
  expansion, missing/overridden dictionary lookup, descriptors and class tables.
  Full string subclass storage, broader public runtime/standard-library/safe-fs
  assembly, suspension and specialized exception families remain unfinished.
  No push or release requested.
- Native syntax exception family (2026-09-10): failing regressions drove
  SyntaxError, IndentationError and TabError catalog/layout integration, native
  message/location/private-metadata fields, detail initialization and specialized
  string formatting. Arguments remain separate from mutable native fields and
  the guest dictionary. Failed detail collection retains callback effects;
  cardinality failures preserve prior fields, while a five-item sequence writes
  fields before its missing-end-offset error. Valid details clear omitted end
  positions/metadata. No iterator hints or reacquisition occur. Formatting uses
  basename/exact-integer line snapshots before guest message conversion and
  bypasses attribute overrides. Host failures and execution limits stay fatal.
  All 167 CPython comparisons and five focused regressions pass. The selected
  workspace build, typecheck, focused lint and all 7,231 tests in 503 files pass
  in the uncached one-worker run (159.86s; bodies 10.38s). Parser error conversion,
  traceback display, other specialized exceptions, suspension and public
  interpreter/standard-library/safe-fs assembly remain unfinished.
  No push or release requested.
- Parser diagnostic conversion (2026-09-10): failing regressions drove native
  conversion of PythonSyntaxError/PythonIndentationError/PythonTabError during
  runtime operations. Constructor identity, not mutable error names, determines
  the native family. Filename, message, line and zero-based code-point column
  become native fields and one-based offsets, and active exception chaining is
  preserved. Ordinary host SyntaxError objects, spoofed structures and execution
  limits remain fatal. Five focused regressions, 18 limited CPython position
  comparisons and 167 prior syntax-exception comparisons pass. The selected
  workspace build, typecheck, focused lint and all 7,236 tests in 503 files pass
  in the uncached one-worker run (177.36s; bodies 9.74s). Parser
  diagnostics currently lack source text/end spans, which remain None instead
  of being invented. Full source-span enrichment, parser diagnostic parity,
  public compile/exec assembly and traceback rendering remain unfinished, as do
  the broader standard library, safe-fs and suspension work.
  No push or release requested.
- Parser source-line/span enrichment (2026-09-10): failing regressions drove
  diagnostic-line capture at lexer, parser and analysis boundaries, copied
  optional token end positions, and native guest text/end-location fields.
  Only the attributed physical line is retained; repeated boundaries preserve
  it, Unicode columns remain code-point based, and physical newlines normalize
  to LF. An 18-case CPython span comparison exposed the token-parser implicit
  EOF newline distinction; two additional regressions drove its correction
  without changing lexer EOF text. All 203 CPython comparisons pass (18 spans,
  18 prior positions and 167 native syntax-exception cases), as do nine source
  boundary probes. The initial full one-worker suite passed 7,244 tests in 503
  files (164.08s; bodies 10.71s); after the EOF correction all 717 focused tests,
  selected workspace rebuild, typecheck and focused lint pass. Missing end
  spans remain unset. Exact parser/analysis diagnostic parity, parser resource
  controls, public compile/exec and traceback rendering remain unfinished,
  alongside specialized exception families, suspension, standard-library and
  safe-fs assembly. No push or release requested.
- Native Unicode exception family (2026-09-10): failing regressions drove shared
  UnicodeEncodeError/UnicodeDecodeError/UnicodeTranslateError native layouts,
  initialization, mutable object fields, signed-size numeric members and native
  formatting. Initialization uses index slots; member writes require integer
  payloads without conversion. Failed initialization replaces args but preserves
  native fields and callback effects. Formatting converts reason/encoding before
  rereading mutable object/position fields. Decode buffers are copied after
  argument validation and released even on fatal copy failures. Structured
  internal encode/decode faults now retain native arguments and all five fields
  when converted into guest exceptions. Seven focused regressions and all 696
  integration tests pass, as do 201 Unicode and 167 prior syntax-exception
  CPython comparisons, selected workspace build, typecheck and focused lint.
  All 7,253 tests in 503 files pass in the full uncached one-worker run
  (161.95s; bodies 8.88s). The comparison audit also
  reconfirmed missing comprehension execution (UnsupportedExpressionError);
  exception MRO comparisons use ordinary loops and do not count comprehensions
  as supported. Full string/bytes subclass storage, OS exceptions, traceback,
  suspension, public interpreter/stdlib and safe-fs assembly remain unfinished.
  No push or release requested.
- Eager comprehension execution (2026-09-10): failing regressions drove compiled
  comprehension-scope registries that travel with function/class code, a metered
  iterative clause walker, and runtime list/set/dict construction. Outer iterable
  acquisition uses the enclosing scope; targets, filters, later iterables and
  bodies use isolated lexical storage with captured cells. Nested closures and
  walrus writes retain their analyzed ownership across separate compiled
  programs. Dictionary keys precede values and hashing. Clause iterators are
  neither length-hinted nor closed on abrupt completion; target unpacking keeps
  normal assignment protocols. Comprehension frames are active
  for key operations and restore without metered cleanup; a failing fatal-error
  regression verified the latter. A differential mismatch also drove exact
  list/tuple excess-unpack cardinality diagnostics in the shared assignment
  adapter, leaving subclasses on their generic iterator path. All 1,057 focused
  tests and 98 CPython comparisons pass, including 5,000 nested clauses, infinite
  iteration limits and cross-program scope ownership. Selected workspace build,
  typecheck and focused lint pass. Final uncached one-worker verification passes
  all 7,263 tests in 504 files (143.24s; bodies 9.39s).
  Generator expressions, asynchronous comprehensions, suspension, inlined-frame
  locals/introspection and complete frame allocation accounting remain pending,
  alongside public interpreter/stdlib/safe-fs and other outstanding runtime work.
  No push or release requested.
- Generator resumption lifecycle foundation (2026-09-10): 22 new tests drove a
  metered created/running/suspended/closed state machine for trusted resumable
  Python-body drivers. It rejects initial non-None sends and reentrancy, injects
  normalized throws, skips unstarted bodies for throw/close, preserves close
  return values, and leaves ignored-GeneratorExit yields suspended. Escaping
  StopIteration uses an explicit native wrapping policy rather than normal
  completion. Fatal limits bypass exception classification; activation restores
  without metered cleanup. A failing cancellation-at-entry regression prevents
  body execution after cancellation. Closing drops driver and activation-context
  references. All 47 selected lifecycle/frame/exception/completion tests and 648
  paired trusted-body lifecycle comparisons with CPython pass. The comparisons
  cover send/throw/close sequences and phases, not execution of Python ASTs by
  the new module. Selected workspace build, typecheck and focused lint pass.
  Guest generator types/descriptors, resumable expression/statement drivers,
  generator-expression integration, exception-state switching, yield delegation,
  async suspension and finalization remain unfinished. This is not yet guest
  generator support or a complete interpreter. No push or release requested.
- Suspended handled-exception frames (2026-09-10): eight failing regressions
  drove execution-owned opaque frame slots, activation/deactivation and dynamic
  caller fallback. Only a frame's own handler persists across suspension;
  restoring it reveals the new caller's exception rather than an old captured
  caller. Active lookup stays constant-time. Handler cleanup is bound to its
  originating slot; foreign frames, active-frame reentry and invalid activation
  cleanup order are rejected without changing state. Deactivation is unmetered
  and idempotent. One integrated lifecycle regression covers saved handlers and
  changing callers through GeneratorExecution. Root native exception storage is
  now allocated after charging its expanded frame bookkeeping. Initial focused
  verification passed 742 tests, and 243 paired trusted-body CPython traces pass;
  selected workspace build, typecheck and focused lint pass. All 7,294 tests in
  505 files pass in the uncached one-worker run (157.25s; bodies 9.39s), along
  with 648 prior lifecycle and 167 native syntax-exception CPython comparisons.
  Native generator descriptors and resumable AST
  drivers still need to consume these pieces; full generator/async/traceback
  support, public interpreter/stdlib/safe-fs and other runtime work remain
  unfinished. No push or release requested.
- Resumable comprehension traversal (2026-09-10): three failing cursor
  regressions drove pull-based traversal with no element prefetch, retained
  nested iterator positions and state release on exhaustion or failure. Eager
  comprehensions now consume that same cursor, preserving the nonrecursive
  clause stack and not closing ordinary iterators. Additional checks cover
  errors at every callback boundary, cancellation, reentry and upfront clause
  validation/allocation. Two failing cancellation regressions exposed element
  evaluation after assignment/filter cancellation; a checkpoint now prevents
  those effects. Fourteen new tests cover this slice. The 98 existing native
  comprehension/unpacking CPython comparisons pass, as do 125 paired cursor
  pull traces with rebinding, live inner-list mutation and changed filters and
  element variables. Those cursor traces use trusted callback evaluation, not
  native guest generator execution. Selected workspace build, typecheck and
  focused lint pass. All 7,308 tests in 505 files pass in the final uncached
  one-worker run (177.57s; bodies 9.72s). Native
  generator descriptors, resumable Python bodies and generator-expression
  integration remain unfinished. No push or release requested.
- Native generator objects and generator expressions (2026-09-10): four
  failing native-object regressions drove canonical nonconstructible,
  nonsubclassable generator types and ordinary descriptors for iteration,
  next/send/close and read-only running/suspended flags. Native storage shares
  the existing lifecycle and drops body/frame references on termination.
  Three failing AST regressions drove generator-expression integration with
  eager outer-iterator acquisition, lazy element/filter/inner-iterator work,
  lexical cells and walrus ownership. Ordinary iterators are not closed when
  the generator closes. Native exception activation follows each resumption;
  completion preserves StopIteration.value without attaching caller context.
  Escaping StopIteration becomes RuntimeError with the original cause/context.
  A failing saved-handler regression drove native fault preparation before
  frame deactivation. Additional checks cover current-caller exception
  inheritance, builtin iter/next, reentry, completion chaining and unmetered
  cleanup after fatal errors. Twelve new tests cover this slice; 734 focused
  tests and 160 native generator-expression CPython comparisons pass, plus 98
  prior comprehension/unpacking comparisons. The 125 mutation traces among
  those 160 comparisons now execute Python ASTs, not trusted cursor callbacks.
  All 7,319 tests in 505 files pass in the uncached one-worker run (236.27s;
  bodies 14.53s). The final 734-test focused run also covers the subsequently
  added builtin iter/next regression and allocation-check ordering refinement.
  Selected workspace build, typecheck and focused lint pass. Generator throw normalization,
  name/repr/frame/code metadata, finalization, general resumable function bodies,
  yield delegation and async generators remain unfinished. The public runtime,
  stdlib and safe-fs assembly remain separate unfinished work. No push or
  release requested.
- Native generator throw (2026-09-10): four failing native regressions drove
  throw descriptors, pre-resumption validation, normalization and injection.
  Arity/keyword/traceback validation and warning failures leave the body alone;
  the deprecated multi-argument form warns before traceback/type validation.
  Exception instances retain identity; None and tuple constructor arguments use
  native semantics without tuple iteration hooks. Constructor and subclass-query
  failures become injected exceptions, while host/limit failures remain fatal.
  A mismatched constructor result receives final restore construction; repeated
  normalization failures are bounded. Ordinary raise and throw share native
  type, subclass-query and representation policies without sharing their distinct
  normalization semantics. Injected exceptions, including internal GeneratorExit,
  chain only to a generator's own saved handler, not its inherited caller.
  Twenty new tests cover this slice. All 765 focused tests, 195 throw CPython
  comparisons and 258 prior native generator/comprehension comparisons pass.
  Selected workspace build, typecheck and focused lint pass. All 7,340 tests
  in 506 files pass in the uncached one-worker run (150.16s; bodies 9.63s).
  Semantics were checked against local CPython
  and the reference generator/error normalization implementations. Real traceback
  objects and attachment, generator name/repr/frame/code metadata, general
  resumable function bodies, yield delegation, async execution and finalization
  remain unfinished. No push or release requested.
- Resumable expression continuations (2026-09-10): four failing regressions
  drove an unstarted yield/send/throw continuation sharing the existing explicit
  expression task stack with synchronous evaluation. It retains earlier operands,
  call collectors, dictionary keys, f-string conversion state, subscript references
  and branch-mode truth decisions across suspension without replaying effects.
  Bare yield uses the supplied guest None value; injected exceptions propagate at
  the paused expression. Synchronous evaluation still rejects yield before its
  operand executes. Continuation frames are charged before creation; collection
  budget regressions now reserve that frame cost before testing their own buffers.
  Cancellation is checked before publication and resumed callbacks. A separate
  reproduced validator stack overflow on 5,000-operator flat source drove iterative
  validation/binding collection while retaining left-to-right scope checks.
  Twelve expression regressions and one parser regression cover this slice.
  All 756 paired expression send traces and 355 prior native generator/throw
  CPython comparisons pass. Expression traces use parsed Python ASTs and a
  primitive protocol fixture, not complete native generator-function execution.
  Selected workspace build, typecheck and focused lint pass. The full run exposed
  one more exact-budget fixture: the 5,000-level display test also needed its
  expression frame reserved in addition to the existing per-display buffers.
  After reproducing and correcting that fixture, all 7,353 tests in 506 files
  pass in the uncached one-worker run (219.45s; bodies 15.30s).
  The enclosing statement/leaf-operation suspension
  backend, native generator-function integration, yield delegation, async execution
  and complete continuation heap accounting remain unfinished. No push or release
  requested.
- Resumable statement frame machine (2026-09-10): four failing tests drove a
  suite continuation sharing the synchronous executor's explicit frames. Typed
  resumable callbacks preserve pending return/break/continue transfers, loop
  iterators, selected branches, manager exits, exception searches and handler
  cleanup across yields. Exceptions injected at a suspended expression/target/
  leaf operation enter the existing guest-unwind path. Fatal errors and cancellation
  restore bookkeeping without executing guest cleanup. The entry allocation is
  reserved before creation; moving the existing entry step there retains the
  synchronous step-budget contract. Native adapters must activate the saved
  exception frame at each resume and inject GeneratorExit for Python close;
  host generator return is not Python finalization.
  Sixteen new regressions include suspended for/with targets, exception-type
  evaluation, assertions, return replacement, alias cleanup and 5,000 nested
  yielding finalizers. All 76 focused statement/finally/with/assert tests pass.
  All 2,000 parsed-suite send/throw traces match CPython; these use primitive
  protocol/leaf fixtures, not complete native generator-function assembly.
  The 355 existing native generator-expression and throw comparisons also pass.
  Reference semantics: https://docs.python.org/3/reference/expressions.html#yield-expressions
  Selected workspace build, typecheck and focused lint pass. All 7,369 tests in
  507 files pass in the uncached one-worker run (275.11s; bodies 15.51s).
  Native resumable references, assignment/deletion/
  definition/raise operations and default generator-function wiring remain next,
  alongside yield delegation, async execution and complete frame accounting.
  No push or release requested.
- Native suspended mutation operations (2026-09-10): four failing native-value
  regressions drove lazy resumable statement-context binding and shared reference,
  ordinary/annotated assignment, unpacking, augmented-assignment and deletion
  continuations. Suspended target evaluation retains receiver/key identities;
  queued unpacked values, earlier stores/deletes and pre-RHS augmented values are
  not replayed or rolled back. Actual get/set/delete dispatch still uses current
  bound protocols. Annotation expressions remain ignored, while executable target
  expressions may yield without reading the annotated target. For/with assignment
  adapters use the same target engine. Definition/import/raise continuation hooks
  are explicit capabilities; missing hooks fail without synchronous fallback.
  Entry frames are charged before construction while preserving existing step
  counts. Exact target/deletion-budget fixtures now reserve continuation storage
  before checking queued records and nested frames. Nineteen new regressions cover
  native mutations, slice references, failure/limit boundaries, lazy reference
  access, invalid write-back after in-place mutation and absent leaf capabilities.
  All 104 focused tests pass. All 2,000 parsed-suite native mutation comparisons
  match CPython, including yielded values, errors and final bindings. These bind
  native values to a controlled frame; full compiled generator-function assembly
  is still pending. The 453 existing native generator/throw/comprehension
  comparisons also pass, as do eight direct host-capability send/throw checks.
  Selected workspace build, typecheck and focused lint pass. All 7,388 tests in
  507 files pass in the uncached one-worker run (179.62s; bodies 11.11s).
  Resumable definitions/raise and default
  native generator-function wiring are next, with yield delegation, async execution
  and complete continuation accounting still unfinished. No push or release
  requested.
- Native compiled generator functions (2026-09-10): default runtime wiring now
  creates lazy generator bodies using the shared expression, statement and native
  mutation continuations. Argument binding remains call-time; body preparation is
  first-resume work. Originating code tables, globals and closure cells survive
  later module compilations. Explicit suspended hooks retain precedence.
  Shared function/class-definition and raise kernels retain decorator/default,
  header and exception/cause operands without replay across yields. Native
  lifecycle integration preserves saved handlers, pending returns/finalizers,
  send/throw/close behavior and escaping StopIteration conversion. Six initial
  definition/raise failures and five unsupported-generator failures drove the
  implementation; native regressions cover generator lambdas, nested definitions,
  call-time validation, created close, finally returns and illicit cleanup yields.
  All 641 compiled-generator CPython comparisons pass. They exposed missing
  canonical NoneType allocation, followed by an intrinsic descriptor bug that
  confused actual None with an absent receiver. Native binding now uses host null
  for absence and explicit __get__ converts its guest None sentinel at the boundary.
  NoneType allocation and inherited method access have regression coverage; ten
  additional None/descriptor CPython comparisons pass. Full NoneType slot/catalog
  fidelity, yield delegation, async execution, generator metadata/finalization and
  complete continuation allocation accounting remain unfinished. All 7,413 tests
  in 507 files pass in the uncached one-worker run (228.55s; bodies 12.18s).
  The 453 prior generator/throw/comprehension CPython comparisons also pass;
  combined with the new comparisons, 1,104 cases match. Selected workspace build,
  typecheck and focused lint pass. Full-suite failures exposed old internal
  sentinel assumptions and an incomplete fixture type resolver; both fixtures now
  exercise the canonical None/absent distinction. No push or release requested.
- Yield-delegation protocol (2026-09-10): added explicit iterator delegation
  state with separate yielded, returned, body-raised and caller-rejected results.
  Acquisition happens lazily and exactly once; sends resolve current ordinary
  methods, and throw forwarding preserves the original argument array. Missing
  throw or successful close defers normalization until injection is necessary.
  Invalid normalization and failing throw-attribute lookup preserve suspension.
  Source: CPython 3.14 Objects/genobject.c, especially gen_close_iter, gen_close,
  _gen_throw and _PyGen_FetchStopIterationValue, alongside PEP 380. Differential
  checks exposed behavior beyond the PEP's illustrative expansion: close-method
  StopIteration completes yield-from, close-lookup failures are unraisable, and
  throw-lookup failures belong to the caller rather than the Python body. A host
  generator implementation could not preserve that last distinction and was
  replaced by the explicit result/state protocol. Completion releases source,
  iterator and context references; fatal execution limits bypass guest handling.
  The expression continuation can evaluate a yielding delegation source and
  retain pending operands through a trusted delegation capability; absent or
  synchronous capabilities fail before source side effects. Twenty-five protocol
  tests and two expression regressions pass. All 6,912 controlled-protocol
  comparisons match CPython, including operation traces, optional/missing/failing
  methods, completion and later resumes after rejection. This oracle uses a
  controlled lifecycle adapter, not compiled native generator functions.
  Native integration must intercept delegated requests before entering the outer
  body, preserve raw throw argument lists before normalization, and route reject
  results back to callers without closing that body. A CPython probe confirms
  gi_running is false during throw-attribute lookup but true during the forwarded
  call, send lookup/call and close lookup/call; preflight cannot simply run wholly
  inside the ordinary running-body entry. The default native runtime
  still does not execute yield-from; this is the next implementation step, not a
  completed delegation claim. Selected workspace build, typecheck and focused lint
  pass. All 7,440 tests in 508 files pass in the uncached one-worker run (156.17s;
  bodies 9.92s). No push or release requested.
- Native yield-from integration (2026-09-10): default compiled generator bodies
  now use the delegation protocol directly. Caller-side throw lookup/validation
  rejection leaves the body suspended; selective frame activation preserves
  gi_running and the distinct caller-versus-generator handled-exception contexts.
  Raw throw arguments reach custom delegates unchanged, and native subgenerator
  forwarding emits legacy-call warnings only once. Shared iterator acquisition
  preserves iterator identity and common native container cursor diagnostics.
  The runtime accepts a host unraisable diagnostic sink for close-lookup errors;
  public sys.unraisablehook/stderr assembly remains pending.
  Native failing tests drove lifecycle interception, exception-context fixes,
  iterator diagnostics, warning forwarding and reentrant lookup handling. A
  reentrant lookup can finish the old delegation and start another before its
  captured throw method returns: initial iteration must use the already-active
  body, and completion must resume the current instruction rather than revive
  the old delegate. Both new-delegation regressions passed after failing first.
  Focused verification passes 830 tests in five files. CPython comparisons pass
  512 operation sequences, 560 optional/failing-method cases, eight reentrant
  cases and eight further reentrant cases that cross into a new delegation.
  Six additional exception-context comparisons pass: 1,094 native delegation
  cases in total. Selected workspace build, typecheck and focused lint pass.
  All 7,462 tests in 508 files pass in the uncached one-worker package run
  (166.61s; test bodies 10.43s).
  Canonical iterator type publication, range cursor diagnostics, generator
  metadata/finalization, async execution, deep-delegation efficiency and the
  complete resource audit remain unfinished. No push or release requested.
- Generator delegation introspection (2026-09-10): added read-only gi_yieldfrom
  with the actual acquired iterator identity. Visibility is gated by suspended
  lifecycle state, not merely the presence of a retained cursor: it is None
  during creation, ordinary yields, running operations and after completion.
  Delegated throw lookup sees the iterator; the invoked method does not. Local
  CPython probes and Objects/genobject.c establish that distinction. Three native
  regressions failed before implementation; all pass now, including read-only
  assignment/deletion without advancing the iterator. Focused verification passes
  813 tests, and all 512 operation-sequence comparisons match CPython with
  gi_yieldfrom visibility recorded after every operation. Eight reentrant
  new-delegation comparisons also pass. Selected workspace build, typecheck and
  focused lint pass; all 7,465 tests in 508 files pass in the uncached one-worker
  package run (141.67s; bodies 10.02s).
  This does not complete generator names, frame/code metadata,
  finalization, async support, public runtime assembly or safe-fs integration.
- Await acquisition and expression continuations (2026-09-10): added a metered
  protocol boundary that distinguishes native coroutine/code flags from special
  __await__ lookup. It validates the returned next slot without calling __iter__,
  preserves source/iterator identity and protocol failures, rejects ordinary
  iterators lacking await support and rejects native/generator-based coroutines
  returned by __await__. CPython probes confirm these rules and the distinct
  invalid-result diagnostics. Expression continuations now accept an explicit
  await capability, preserving operands through nested awaits and injected errors;
  absent or synchronous capabilities fail before source side effects. Thirteen
  acquisition tests and three expression regressions pass after the missing
  implementation and two unsupported-expression failures were demonstrated.
  This is a required protocol/expression stage, not native coroutine execution.
  The native coroutine object, await wrapper, reuse rules, prepared-iterator
  delegation admission and default runtime wiring remain next. All 324 controlled
  await-expression comparisons match CPython (not native coroutine integration).
  Selected workspace build, typecheck and focused lint pass. All 7,481 tests in
  509 files pass in the uncached one-worker package run (204.07s; bodies 14.97s).
  Typechecking caught the now-exhaustive expression switch's obsolete fallback;
  it now has a compile-time never guard. The final 77 focused tests also pass
  after that guard and a fixture-only lint correction. Full async and safe-fs
  execution remain open. No push or release requested.
- Native coroutines and await wrappers (2026-09-10): default compiled async
  functions now create lazy native coroutine objects. They share the metered
  suspension engine with generators while retaining distinct initial-send,
  reentrancy, ignored-close and exhausted-reuse diagnostics. Coroutine await
  wrappers are separate self-iterating objects retaining the same coroutine;
  coroutine objects themselves are not ordinary iterators. Native await uses
  prepared-iterator acquisition, skips a returned iterator's __iter__, preserves
  cr_await identity and rejects a coroutine already suspended in another await.
  Send/throw/close forwarding and saved exception contexts use the existing
  delegation machinery; close preserves a body/finalizer return value.
  Five native unsupported-coroutine failures drove default integration. Further
  failing regressions corrected current non-awaitable diagnostics and two close
  return paths. CPython confirms the extra legacy warning at an await-wrapper
  boundary, unlike direct native coroutine/generator forwarding. All 768 native
  operation-sequence comparisons match CPython; 90 coroutine/wrapper argument
  comparisons and 512 prior native generator comparisons also pass (1,370 total).
  Selected workspace build, typecheck and focused lint pass. All 7,490 tests in
  509 files pass in the uncached one-worker run (170.00s; bodies 10.99s).
  Coroutine names/frame/code
  metadata, finalization warnings/origin tracking, generator-based coroutine flags,
  async generators, async-for/with, and event-loop/public runtime/safe-fs assembly
  remain unfinished. This does not establish complete async support.
- Native async-for (2026-09-10): added resumable async-iteration frames using
  native __aiter__/__anext__ special lookup and coroutine await continuations.
  Acquisition happens once; next awaits retain instruction state. Break,
  continue and loop-else reuse the statement transfer engine. Only exceptions
  from next-call/await handling can signal exhaustion; target/body failures are
  not swallowed, and loop exit does not implicitly call aclose. Invalid awaitable
  acquisition from __anext__ gets its contextual TypeError with original cause;
  normal awaited-body failures remain unchanged. Four native unsupported-loop
  failures drove implementation. A separate failing fatal-path regression caught
  type-name inspection after an execution limit; that path now escapes before
  diagnostic work. All 512 initial native async-for CPython sequences match.
  A further failing regression captures a CPython distinction from ordinary
  await: async-next can consume an already-started native coroutine. Only ordinary
  await acquisition applies the already-awaited check.
  Final focused verification passes 835 tests in four files. The 768 prior native
  coroutine comparisons also pass (1,280 comparisons total). Selected workspace
  build, typecheck and focused lint pass. All 7,496 tests in 509 files pass in the
  final uncached one-worker run (208.09s; bodies 12.31s).
  Async comprehensions, aiter/anext builtins,
  async generators, context-manager integration and the broader public runtime,
  traceback and safe-fs work remain unfinished.
- Materialized async comprehensions (2026-09-10): native suspended functions can
  now build list/set/dictionary comprehensions with async clauses and awaits in
  source expressions, filters and elements. The outer iterator is acquired in the
  enclosing scope; target locals are isolated while awaits retain the enclosing
  coroutine's frame and handled-exception state. Synchronous pull cursors and
  suspended materialization share one iterative clause traversal, without
  recursive clause nesting. Four native failures drove list/set/dict and filter/
  element support. The existing 5,000-clause allocation test exposed redundant
  iterator wrappers; traversal now uses clause flags and pre-reserved raw iterator
  slots instead of allocating a wrapper per nesting level. All 512 initial native
  mixed/nested comprehension comparisons match CPython. The 98 synchronous
  comprehension and 512 native delegation comparisons also pass (1,122 total).
  Final focused verification passes 798 tests in two files; selected workspace
  build, typecheck and focused lint pass. The final uncached one-worker package
  run passes all 7,500 tests in 509 files (380.25s; test bodies 24.37s).
  Async generator expressions and generator expressions whose outer source awaits
  remain separate unfinished work, alongside async generators, context managers,
  traceback/public runtime assembly and safe-fs integration.
- Generator-expression outer awaits (2026-09-10): a failing native regression
  confirmed that a synchronous generator expression rejected await in its outer
  source. The suspended expression path now evaluates that source in the enclosing
  frame, acquires its iterator immediately, and shares normal lazy generator
  construction with the synchronous path. The generator body does not retain the
  enclosing coroutine's await controller. CPython confirms that an await confined
  to the outer source still produces a normal generator, consistent with the
  [expression reference](https://docs.python.org/3/reference/expressions.html#generator-expressions).
  All 512 new suspension,
  injected-error, close, source-error and lazy-consumption comparisons match;
  98 synchronous and 512 async materialization comparisons also pass. The same
  outer-source path also passes 256 CPython yield/yield-from comparisons (1,378
  comparisons total). Build, typecheck, focused lint and all 782 native integration
  tests pass. The uncached one-worker package run passes all 7,501 tests in
  509 files (268.02s; test bodies 17.37s).
  Async generator bodies/expressions remain unfinished. Their operation wrappers
  must distinguish an awaited suspension from an emitted async-generator item,
  retain running-across-await ownership, and implement separate send/throw/close
  completion and reuse semantics; a coroutine alias would not provide that.
- Async-generator send operation layer (2026-09-10): added a metered, reusable
  asend/anext lifecycle around trusted body continuations. Await suspensions retain
  shared operation ownership; emitted items complete only their operation, while
  exhaustion signals StopAsyncIteration. Initial argument selection, competing
  operations, throw injection, reuse rejection and synchronous wrapper close are
  distinct from body execution. Fatal failures release operation ownership without
  guest exception classification. A failing regression also drove async-generator
  StopAsyncIteration conversion in the shared body engine; ordinary generators and
  coroutines do not acquire that conversion.
  All 44 focused tests pass, including 19 new cases. Build and typecheck pass.
  A controlled-body comparison matches CPython on 10,368 four-operation sequences;
  this does not establish native async-generator integration. The oracle snapshots
  results before later CPython finalization can mutate recorded event arrays.
  All 768 native coroutine regression comparisons also pass (11,136 comparisons
  total). Focused lint passes. The uncached one-worker package run passes all 7,520 tests
  in 510 files (205.28s; test bodies 12.90s). Native async-generator
  objects, asynchronous athrow/aclose operations, async generator expressions,
  hooks/finalization and the wider runtime/safe-fs work remain unfinished.
- Native async-generator sends (2026-09-10): connected classified async-generator
  functions to lazy native objects, canonical non-instantiable types, __aiter__,
  __anext__, asend and their await/iteration/send/throw/close wrapper descriptors.
  Native ag_running and ag_await distinguish operation ownership from body-frame
  activation. Raw throw arguments are validated after reuse/ownership checks and
  remain deferred through active await delegation. Internal GeneratorExit and
  StopAsyncIteration signals bypass guest constructors and implicit caller chains;
  escaping body termination exceptions receive native RuntimeError cause/context.
  Four unsupported-function failures drove integration. Two further regressions
  cover native async-for consumption and closed-send validation ordering.
  All 832 focused tests pass. Native CPython comparisons match 10,368 operation
  sequences and 81 argument cases; 768 existing coroutine comparisons also pass
  (11,217 total). Build, typecheck and focused lint pass. The final uncached
  one-worker package run passes all 7,526 tests in 510 files (163.83s; test bodies
  12.35s).
  Async athrow/aclose, async generator expressions, metadata/hooks/finalization,
  context managers, public runtime, library/import and safe-fs integration remain
  unfinished. Synchronous wrapper close is not asynchronous generator aclose.
- Async GeneratorExit delegation policy (2026-09-10): three failing protocol/
  native-continuation regressions exposed synchronous delegate.close handling
  where asynchronous termination needs delegate.throw. Added an explicit internal
  throw-request policy, propagated through native coroutine/generator delegation
  and preserved through normalization. Per-resume policy is restored after
  reentry; ordinary close/throw behavior keeps its existing default. Cleanup can
  now suspend through an awaited throw method, including through nested native
  coroutines. Missing throw methods inject the original exception; lookup failures
  remain caller-side rather than becoming unraisable close diagnostics.
  CPython confirms direct and nested asynchronous close both call throw and yield
  its result in these cases. Five new tests cover the policy and default restoration.
  All 844 focused tests, build, typecheck and focused lint pass. Regression
  comparisons match CPython for 10,368 native async-generator sequences, 768
  coroutines and 512 generator-delegation sequences (11,648 total). The full
  uncached one-worker package run passes all 7,531 tests in 510 files (171.79s;
  test bodies 16.24s). This is the delegation prerequisite for asynchronous
  athrow/aclose, not their public operation-wrapper implementation.
- Native asynchronous generator termination (2026-09-10): added native athrow
  and aclose awaitables with separate lifecycle handling from asend. Cleanup can
  await; competing operations retain their owner; stored throw arguments are
  validated at first send, while legacy-signature warnings occur at creation.
  Post-await athrow reuse follows CPython's distinct send-completion behavior.
  Native wrappers share exception normalization and delegation policy without
  duplicating the body engine. Failing tests drove native integration, exact
  warning text, fatal preparation cleanup and termination-signal construction
  failures. Failed signal construction closes only the affected operation and
  does not release a competing owner.
  All 827 focused tests pass. CPython comparisons match 6,912 mixed termination
  sequences, 156 argument cases and 768 coroutine regressions (7,836 total).
  Selected workspace build, typecheck and focused lint pass. The full uncached
  one-worker package run passes all 7,549 tests in 511 files (153.04s; test bodies
  11.16s).
  Async generator expressions, metadata/hooks/finalization, context managers,
  public runtime, library/import and safe-fs integration remain unfinished.
- Native async generator expressions (2026-09-10): three failing native tests
  exposed rejected async clauses, synchronous objects for awaited elements, and
  incorrect nested-generator classification. Added a metered iterative classifier
  that excludes the outer source and nested lazy bodies while including executed
  defaults and materialized comprehensions. Async generator expressions acquire
  the outer iterator immediately, then lazily execute the existing resumable
  clause traversal in their own frame and delegation controller. They work in
  synchronous code and coroutine bodies, including mixed clauses, awaited filters,
  nested comprehensions, and independent outer-source/element awaits.
  The classification follows the
  [expression reference](https://docs.python.org/3/reference/expressions.html#generator-expressions).
  All 1,728 mixed send/throw/close comparisons match CPython, as do 52 nested-scope
  classification checks, 98 synchronous comprehension regressions, 512 outer-await
  regressions, 512 materialized async comprehension regressions and eight complete
  consumption cases (2,910 total).
  Build, typecheck and focused lint pass. The final uncached one-worker package
  run passes all 7,567 tests in 512 files (134.55s; test bodies 9.99s).
  Metadata/hooks/finalization, context managers, public
  runtime, library/import and safe-fs integration remain unfinished.
- Async context-manager statement lifecycle (2026-09-10): five failing cases
  drove awaited entry/exit, reverse-order cleanup, retained prepared exits,
  target-failure suppression and fatal/host-return bookkeeping restoration.
  A further native coroutine regression drove explicit async-manager hooks through
  runtime statement bindings. Exits run only after successful entry; pending
  returns and loop transfers survive awaited cleanup, and truth conversion occurs
  only for exception suppression. The initial implementation allocated an extra
  continuation for every synchronous exit and failed the existing 5,000-manager
  budget test. Exit handling now lives directly in the iterative frame loop;
  the test passes without increasing its allocation budget.
  All 4,096 controlled-protocol CPython comparisons pass across mixed sync/async
  managers, entry/exit suspension, suppression, return/loop control, injected
  exceptions and close. The comparison harness was corrected to return the sent
  value from its awaiter, distinguish GeneratorExit from ValueError and retain
  coroutine references until snapshots were captured. All 768 native coroutine
  regressions also pass (4,864 comparisons total). Build, typecheck and focused
  lint pass. The final uncached one-worker package run passes all 7,574 tests
  in 512 files (132.39s; test bodies 9.84s).
  This is the statement lifecycle and explicit extension-hook path, not native
  context-manager lookup/awaitable acquisition or traceback integration. Those
  remain required, along with the public runtime, libraries/import and safe-fs.
- Internal traceback links (2026-09-10): inspection confirmed that native
  exceptions have no traceback storage or guest frame representation yet.
  Added an interpreter-owned traceback chain with immutable frame/location
  identity and independently writable next links. Link assignment validates the
  entire candidate chain before mutation, rejects direct/indirect cycles, permits
  shared tails and traverses iteratively without auxiliary allocations. The -1
  line sentinel resolves through an explicit frame/instruction policy; other
  supplied line numbers remain unchanged. No host JavaScript stack is captured.
  Eleven focused tests pass, including a 5,000-link chain, budget-failure atomicity
  and cancellation before line resolution. All 1,728 three-node mutation-sequence
  comparisons match CPython. Selected workspace build, typecheck and scoped lint
  pass. This isolated new storage module has no runtime consumers yet; the full
  package suite was not rerun for this slice. Native frame/code objects,
  exception attachment, traceback descriptors/constructor and context-manager
  exception arguments remain required integration work, not completed support.
- Native aiter builtin (2026-09-10): added direct asynchronous iterator
  acquisition to builtin assembly, with an optional explicit protocol policy.
  Native invocation inherits the execution's type-level lookup/call capabilities.
  aiter and async-for acquisition share one adapter: it preserves iterator
  identity, bypasses instance attribute lookup, checks the anext slot without
  binding it, and never advances, awaits or falls back to synchronous iteration.
  Failing tests drove builtin registration, cancellation that could be masked by
  callback failure, and CPython's distinct 200/100-byte type-name diagnostics.
  Scoped verification passes 871 tests. Build, typecheck and focused lint pass.
  Final comparisons pass 260 aiter protocol/argument cases, 12 long-name cases
  (including multibyte names), 512 async-for regressions and 1,728 async generator
  expression sequences (2,512 total). The final uncached one-worker package suite
  passes all 7,607 tests in 514 files (156.29s; test bodies 13.51s).
  anext, native context-manager protocols,
  traceback/frame integration, public runtime, library/import and safe-fs work
  remain unfinished.
- Native anext builtin/default awaitable (2026-09-10): immediate actual-type
  anext lookup/call, unvalidated no-default result, and lazy default wrapper
  acquisition are implemented with explicit extension capabilities. Native
  coroutine and async-generator awaitables are supported. Each next/send/throw/
  close operation reacquires the await iterator; only operation failures matching
  StopAsyncIteration receive the default, never acquisition failures. Proxy
  methods use ordinary attribute lookup and retain CPython tuple expansion for
  send. Native wrapper identity, arity and non-instantiable type integration are
  included. Failing tests established missing registration/type integration and
  a CPython differential exposed the distinction between explicit None async
  items/defaults and empty ordinary coroutine/close completion arguments; the
  completion adapter now preserves that distinction. Eighteen builtin tests
  cover protocol errors, arity and cancellation after successful/failing external
  callbacks. Focused verification passes 880 tests; 784 custom-awaitable, 864
  native coroutine/generator and 96 argument comparisons match CPython. Another
  6,912 async termination regression sequences pass (8,656 comparisons total).
  Selected workspace build, typecheck and scoped lint pass. The final uncached
  one-worker package suite passes 7,635 tests in 515 files (183.15s; test bodies
  9.72s).
  Generator-based coroutine flags, native context managers, traceback/frame
  integration, public runtime/import/library and safe-fs work remain required.
- Await acquisition boundary audit (2026-09-10): ten failing tests exposed
  cancellation masked by failing callbacks at seven acquisition boundaries and
  unbounded type-name diagnostics. All native-kind, special lookup, await call,
  iterator validation and type-name callback exits now checkpoint in finally,
  retaining ordinary failures unless execution has been cancelled/exhausted.
  Missing-await and invalid-result diagnostics use the shared metered UTF-8
  truncation helper with CPython's 100-byte precision. Sixteen new tests cover
  failing/successful cancellation boundaries and ASCII/multibyte diagnostics.
  Focused verification passes 840 tests. All 48 native long-name cases, 784 anext
  sequences and 768 coroutine sequences match CPython (1,600 comparisons).
  Selected workspace build, typecheck and scoped lint pass. The final uncached
  one-worker suite passes 7,651 tests in 515 files (286.12s; test bodies 17.58s).
  This hardens shared acquisition used by await, async iteration
  and anext; it does not complete native frame/code or generator-coroutine flags.
- Function local-layout metadata (2026-09-10): function/lambda compilation now
  retains immutable ordered variable, cell and free-name arrays plus positional,
  positional-only, keyword-only and variadic argument metadata. Captured
  parameters keep their parameter slots and precede sorted nonparameter cells;
  keyword-only slots precede variadic slots. Annotation-only declarations do not
  allocate fast-local slots, and executable name occurrences retain order even
  in unreachable code. Private-name mangling and metered Unicode code-point
  sorting apply; nested functions retain independently sorted forwarded closures.
  Three failing compilation tests drove integration; five storage/layout tests
  cover immutability, scope validation, Unicode, cancellation and the existing
  interpreter-owned separate comprehension activation boundary. All 1,280
  ordinary-function/closure and 640 parameter-capture comparisons match CPython
  (1,920 total). CPython's inlined
  comprehension optimization is not this interpreter's current activation model;
  this metadata describes actual local storage, not CPython bytecode layouts.
  Native frame/code objects, locals reflection and traceback integration remain
  unfinished. Selected build, typecheck and scoped lint pass. Focused compiler
  checks pass 28 tests; the earlier native integration route passed 834 tests.
  The final uncached one-worker package suite passes 7,659 tests in 516 files
  (144.02s; test bodies 9.60s).
- Reflective optimized-local storage (2026-09-10): lexical function/lambda
  activations now lazily expose an execution-owned FrameLocals slot view.
  Invocation passes the existing compiled layout through argument binding, so
  reflection need not reconstruct metadata for normally compiled functions.
  Literal name lookup/write-through reaches fast locals and shared closure cells,
  including forwarded cells and bound None/undefined host values. Independent
  ordered snapshots omit unbound slots and never write changes back. Deleting a
  known slot rejects with CPython's ValueError even when unbound; unknown names
  fall through for the future native adapter's arbitrary-key extra dictionary.
  Global names, unmangled spellings and annotation-only non-slots never redirect
  reflective writes into globals or unrelated lexical bindings. Allocation and
  cancellation rejection precede publication/mutation. Eight storage tests and a
  native call/generator/retained-closure test cover these boundaries; the focused
  five-file route passes 876 tests. All 512 CPython get/set/delete/snapshot and
  729 nonlocal/unbound-slot sequences match (1,241 comparisons total). Selected
  build, typecheck and scoped lint pass. The final uncached one-worker suite
  passes 7,668 tests in 517 files (138.08s; test bodies 9.53s).
  Guest FrameLocalsProxy methods/extra-key storage,
  locals/globals builtins, comprehension reflection, frame/code objects and
  traceback/native context-manager integration remain unfinished.
- Frame-locals mapping storage (2026-09-10): added a generic execution-owned
  mapping over optimized slots plus a lazily allocated ordered extra dictionary.
  Slot-name arrays are immutable. Lookup hashes incoming keys before identity
  matching, then compares equal-hash names in compiler order; arbitrary hashable
  alias objects can match slot names. Reads skip unbound equal names, whereas
  writes/deletes recognize them. Equality callbacks may mutate a slot before its
  value is read. Extra keys retain original identity and insertion order on
  overwrite; entry snapshots and size include bound slots followed by extras.
  Key callback failures preserve state, and post-callback checkpoints prevent
  failures from masking cancellation. Twelve focused mapping tests plus eight
  slot-storage tests pass. All 1,000 CPython mapping sequences match. Selected
  build, typecheck and scoped lint pass. The final uncached one-worker suite
  passes 7,680 tests in 518 files (122.80s; test bodies 8.91s).
  Native frame/proxy factories must share one mapping state per frame and still
  need descriptors, bulk methods, missing-key diagnostics and guest exposure;
  this generic mapping kernel alone is not a completed FrameLocalsProxy API.
- Native frame-locals proxy core (2026-09-10): registry factories now return
  fresh native proxies while sharing one execution-owned mapping per lexical
  frame. Descriptors implement item lookup/write/delete, membership, length,
  snapshot iteration, keys/values/items, reverse keys, copy, get and equality.
  Same-frame proxies compare equal by frame identity; distinct frames do not,
  even with equal contents. Dictionary/subclass comparisons use independent
  copies with live lookups after the key snapshot. Missing item diagnostics
  retain CPython's formatted local-name KeyError, while missing deletion keeps
  the original key. Initial hash failures do not acquire dictionary-key context;
  get catches KeyError from hashing/representation callbacks as CPython does.
  Native integration tests cover write-through function slots, shared extras,
  independent copies, unbound deletion, snapshots, arity and callback errors.
  The focused three-file route passes 836 tests. All 110 operation/argument and
  1,000 mutation-sequence comparisons match CPython (1,110 total). The oracle
  checks iterator contents and NotImplemented values directly because the
  integration fixture's fallback type lookup does not publish those native
  type names. Selected workspace build, typecheck and scoped lint pass.
  The final uncached one-worker suite passes 7,684 tests in 518 files (144.79s;
  test bodies 11.46s). Bulk methods/operators, repr recursion,
  native frame construction/public exposure and callback-boundary hardening
  remain required; this core is not the complete FrameLocalsProxy API.
- Native frame-locals callback audit (2026-09-10): ten failing direct-descriptor
  tests reproduced cancellation hidden by failed representation callbacks,
  successful/failed comparison and exception-classification callbacks, and
  extension classification swallowing host execution limits. Every descriptor
  exit now checkpoints in finally; get uses the shared fatal-safe exception
  matcher, which never offers host termination to extension classifiers.
  Ordinary failures and raw rich-comparison results preserve their identities.
  Eleven new boundary tests pass; the focused proxy/native-integration/mapping
  route passes 839 tests. All 110 native operation/argument and 1,000 mutation
  sequence comparisons still match CPython. Selected workspace build and
  typecheck and scoped lint pass. This isolated descriptor change does
  not alter compiler/program assembly; the previous full-package baseline is
  7,684 passing tests. Remaining proxy methods and native frame exposure are
  still required.
- Native frame-locals defaults/removal (2026-09-10): implemented setdefault
  and pop after two failing storage/native integration tests established the
  missing operations. Setdefault uses live item lookup, catches KeyError from
  lookup/representation as CPython does, then writes the default through the
  normal slot/extra-key path. It can initialize an unbound local. Pop performs
  one slot-resolution pass followed by the extra dictionary's single removal;
  it always rejects known bound/unbound slots, even with a supplied default.
  Missing pop errors retain the original key, stored None remains distinct from
  absence, and empty extra dictionaries skip the second hash. Cancellation
  after exception classification is checked before attempting a default write.
  Three new tests cover native behavior, hash counts, aliases, unbound slots and
  the no-write cancellation boundary. The focused proxy/mapping/native route
  passes 842 tests. All 120 operation/argument, 1,000 default/removal sequences
  and 36 callback-error cases match CPython (1,156 total). Selected workspace
  build, typecheck and scoped lint pass. This isolated mapping/
  descriptor change uses focused verification, not a new full-package run.
  Update/union methods, repr and native frame construction/exposure remain.
- Native frame-locals bulk operations (2026-09-10): added update and forward,
  reflected and in-place union descriptors after two failing integration tests.
  Updates accept dictionaries/subclasses or other frame proxies, call subclass
  keys/items, retain live exact-list key iteration, and materialize other key
  iterables before writing. Earlier writes survive later failures. Ordinary
  unions make independent dictionaries and use native dictionary-copy behavior
  when iteration is inherited. Reflected union accepts general mappings, unlike
  the forward operand restriction. Update replaces guest source failures with
  its prescribed TypeError. Direct __ior__ failure preserves the original
  exception as the cause/context of SystemError through an explicit execution
  capability; host termination bypasses replacement. Four cancellation tests
  cover fatal classification and successful/failing exception wrapping.
  Three native integration tests cover unions, partial writes, general reflected
  mappings and mutable key lists. Focused verification passes 836 tests. All 140
  argument/operation and 80 direct bulk comparisons match CPython. A separate
  20-case augmented-assignment comparison has 14 known mismatches: CPython leaves
  a C-level exception pending after failed in-place union, then detects it at
  a later fallback keys call; this runtime currently reports the direct wrapper
  SystemError immediately. These are unresolved compatibility cases, not passes.
  Selected workspace build, typecheck and scoped lint pass. The final uncached
  one-worker package suite passes 7,705 tests in 519 files (332.75s; test bodies
  17.56s). Repr, native frame construction/exposure and the pending
  augmented-failure distinction remain required.
- Native frame-locals representation (2026-09-10): two failing native tests
  established missing dictionary-style repr and callback execution. The proxy
  now copies its current mapping before formatting and owns a per-proxy recursion
  guard, so self-references render as {...} while two proxies sharing one frame
  remain independently guarded. Guard cleanup runs on ordinary errors and host
  termination; the descriptor's exit checkpoint observes cancellation after
  successful or failing formatting callbacks. Four direct boundary tests cover
  cleanup/retry and cancellation; two native tests cover shared-frame cycles,
  repr failures and mutation of a not-yet-rendered value after the copy.
  All 343 nested-reference cases and 145 operation/argument checks match CPython
  (488 total). Selected workspace build, typecheck and scoped lint pass. The
  final two-file focused route passes 842 tests; this isolated descriptor change
  uses focused verification rather than a new full-package run and does not
  modify compiler/program assembly. Native frame exposure/construction and the
  previously documented augmented-failure distinction remain required.
- Native lexical-frame identity and locals bridge (2026-09-10): registry-owned
  weak caches now publish one native frame object per lexical activation, with
  a non-instantiable/non-subclassable immutable frame type and a read-only
  f_locals descriptor returning a fresh write-through proxy. FrameLocalsProxy
  construction now accepts native frame objects and retains shared mapping
  storage without caching proxy identities. Two failing integration tests drove
  the bridge; additional tests cover retained generator frames after close,
  qualified diagnostics and constructor callback cancellation. Native %T-style
  diagnostics use intrinsic module/qualname metadata, including empty modules,
  and omit __main__/builtins prefixes. Long-name comparisons exposed eighteen
  initial qualification/truncation mismatches, now corrected; two failing
  adapter-free tests also corrected primitive fallback names. All 32 constructor/
  attribute and 24 long Unicode-name comparisons match CPython (56 total).
  The focused native/proxy/registry route passes 863 tests. Selected workspace
  build, typecheck and scoped lint pass. The final uncached one-worker package
  suite passes 7,721 tests in 519 files (185.24s; test bodies 10.57s).
  This is the native identity/f_locals bridge for optimized lexical frames, not
  a complete frame API: globals/builtins require live dictionary adapters;
  module/class/comprehension reflection, f_back/code/location/lifecycle metadata,
  traceback attachment and public sys._getframe registration remain required.
  Existing RuntimeDictionaryNamespace/RuntimeMappingNamespace adapters should
  be extended for shared namespace identity rather than introducing copied
  reflection dictionaries.
- Dictionary-backed global execution (2026-09-10): a failing native test showed
  module stores required JavaScript Map.set even when supplied the existing
  exact-dictionary namespace adapter. Added a trusted mutable-name storage
  contract alongside Map compatibility and routed module, lexical and class
  global reads/writes through namespace lookup/store. Function creation now
  selects __builtins__ and captures __name__ through the same live storage;
  explicit present undefined metadata remains distinct from absence. Function
  class-body execution and module-name lookup also support adapters. No Python
  dictionaries are copied and arbitrary non-string dictionary keys remain
  untouched by source-name access. Public exec argument validation must still
  require actual Python dictionaries, not arbitrary guest mappings.
  Five new tests cover native cross-scope mutations, storage identity, literal
  names, undefined values, builtin selection and adapter failures. The focused
  seven-file route passes 889 tests. All 1,000 mixed module/function/class/direct
  dictionary mutation sequences match CPython. Selected build, typecheck and
  scoped lint pass. The final uncached one-worker package suite passes 7,726
  tests in 520 files (148.83s; test bodies 9.75s). Frame namespace
  descriptors/identity publication remain separate work, using this shared
  storage contract rather than snapshot dictionaries.
- Frame namespace identity (2026-09-10): native frames now expose read-only
  f_globals and f_builtins descriptors backed by the original guest objects in
  the existing dictionary/mapping namespace adapters. Reflection neither copies
  dictionaries nor invokes guest item protocols. Functions retain their selected
  builtins after globals['__builtins__'] changes; new functions select the new
  object. Nonmapping selected builtins, including None, retain their identity.
  Trusted low-level Map namespaces without an original guest identity report a
  missing reflection capability rather than fabricating a dictionary. Public
  runtime assembly must supply dictionary-backed globals and original builtins.
  The original missing-descriptor failure is covered by a native integration
  regression; five boundary tests cover absent identity, None, and cancellation
  after successful/failing identity callbacks. Focused checks pass 870 tests;
  all 256 native builtin-selection cases match CPython. A separate CPython
  reference check confirms None identity. Selected build, typecheck, scoped
  lint and diff whitespace checks pass. The final uncached one-worker package
  suite passes 7,732 tests in 520 files (131.62s; test bodies 8.84s).
- Traceback resolver termination boundary (2026-09-10): a new failing test
  reproduced an ordinary resolver error masking cancellation when a lazy line
  callback both aborted execution and threw. Resolution now checks the execution
  meter in finally, preserving cancellation on both success and failure. Ordinary
  resolver failures still propagate unchanged and are not cached. All 14 focused
  traceback tests pass; selected build, typecheck and scoped lint pass. This
  isolated kernel currently has no production consumers, so the focused route
  covers the changed behavior; the last full-package baseline remains 7,732
  tests. Native traceback objects and exception attachment remain unfinished.
- Native traceback identity and attributes (2026-09-10): a failing native
  regression demonstrated the missing registry traceback factory. Added native
  traceback storage and canonical per-link wrappers, exposing tb_frame/tb_lasti
  as read-only member descriptors, tb_lineno as a read-only getset descriptor,
  and mutable tb_next with nondeletable, type-checked, atomically acyclic links.
  Saved line lookup uses an explicit interpreter-owned resolver fixed at first
  publication, not the host stack or the frame's current line. An unmapped saved
  instruction returns None. Factory callbacks and invalid-target diagnostics
  preserve host cancellation; cycle traversal preserves old links on exhaustion.
  Semantics were checked against the Python 3.14 data model
  (https://docs.python.org/3.14/reference/datamodel.html#traceback-objects) and
  local CPython 3.14.7. All 512 mixed native link/attribute sequences match
  CPython. A further 24 long Unicode name comparisons exposed incorrect
  diagnostic truncation; three failing regressions now verify full names with
  allocation charging before message construction, and all 24 comparisons pass.
  The focused three-file suite passes 856 tests. Guest construction is
  deliberately not yet exposed: the next implementation must supply constructor
  argument binding/index conversion and frame code-location metadata.
  CPython constructor probes show frame validation precedes integer conversions,
  while both integer conversions precede tb_next validation; preserve observable
  callback order rather than validating every type up front.
  Exception traceback attachment, with_traceback and types module publication
  remain required; this native layer is not complete traceback support.
  Selected build, typecheck, scoped lint and whitespace checks pass. The final
  uncached one-worker package suite passes 7,749 tests in 521 files (154.52s;
  test bodies 9.21s).
- Native traceback construction (2026-09-10): a failing compiled-program test
  reproduced the previously non-instantiable traceback type. Added its native
  __new__ with positional/keyword binding, required-field and total-count
  diagnostics, exact native frame validation, signed C-int index conversion,
  and next-link validation after both conversions. The canonical traceback type
  is now directly publishable through tracebackType(), independently of an
  existing traceback. Constructor callbacks retain frame/link identity and all
  failure paths preserve cancellation. Frame diagnostics use CPython's 50-byte
  type-name limit; next-link and __new__ receiver diagnostics retain full names.
  Registry construction accepts an optional interpreter line resolver for
  guest-created tracebacks. Explicit lines need no resolver; lazy -1 lines
  require the capability and report missing code metadata rather than inventing
  a result. This does not implement compiler instruction maps or automatic
  exception attachment. Eleven new tests cover native construction/order,
  missing metadata, cancellation during callbacks/diagnostics, and explicit
  constructor receivers. All 909 argument/conversion cases and 96 long-name
  cases match CPython; the focused two-file suite passes 853 tests.
  Selected build, typecheck, scoped lint and whitespace checks pass. The final
  uncached one-worker package suite passes 7,760 tests in 521 files (148.86s;
  test bodies 9.63s).
- Explicit exception traceback attachment (2026-09-10): a failing native test
  demonstrated missing __traceback__ storage and with_traceback. Exception state
  now retains an independently metered traceback reference. A getset descriptor
  accepts native traceback objects or None, rejects deletion and invalid writes
  without losing the old value, and takes precedence over instance dictionary
  entries. with_traceback shares validation, mutates native storage without guest
  __setattr__ hooks, and returns the original exception. Reinitialization leaves
  traceback storage intact, and attachment does not change args, cause, context
  or suppression. Bound/unbound argument diagnostics preserve the correct type
  names, including long Unicode names. Nine new tests cover native behavior,
  descriptor ownership, invalid writes and exhausted-budget atomicity. All
  1,000 mixed mutation sequences and 120 method argument/name cases match
  CPython. The focused three-file suite passes 842 tests. Automatic traceback
  construction during raising/unwinding, code-location metadata, sys/traceback
  modules and traceback-aware context-manager arguments remain unfinished.
  Selected build, typecheck, scoped lint and whitespace checks pass. The final
  uncached one-worker package suite passes 7,769 tests in 522 files (210.34s;
  test bodies 21.36s).
- Supplied tracebacks in suspension throws (2026-09-10): four failing native
  regressions reproduced obsolete rejection of every non-None third argument
  in generator/coroutine/async-generator throw paths. Shared exception throw
  normalization now validates native traceback identity, attaches an explicitly
  supplied traceback after successful normalization, preserves existing storage
  for omitted/None arguments, and retains a normalization failure's own traceback.
  Delegated custom throw methods still receive raw arguments and traceback
  identity before validation; native delegation and async operations use the
  shared selection policy. Nine native tests cover the four suspension paths,
  existing/supplied/failure selection, and raw custom delegation. The focused
  two-file suite passes 850 tests. All 320 CPython comparisons match for supplied
  traceback marker retention, exception values, constructor events and validation
  errors across the four paths. These comparisons deliberately do not claim
  automatic frame insertion parity, which still requires code/location metadata.
  Selected build, typecheck, scoped lint and whitespace checks pass. The final
  uncached one-worker package suite passes 7,778 tests in 522 files (150.82s;
  test bodies 9.68s).
- Native compiler code identity/header (2026-09-10): a failing native regression
  demonstrated that frames discarded compiled function identity and no canonical
  guest code publisher existed. Function activation now retains its originating
  compiled function; registry code objects are weakly cached by that identity.
  Frame f_code and function __code__ share publication through an explicit runtime
  hook. Function attribute shadows and later function renaming cannot replace
  code metadata. Ten read-only descriptors expose co_name, co_qualname,
  co_firstlineno, argument counts, co_nlocals and local/cell/free-name tuples;
  tuple identities and immutable metadata are shared across reads and closures.
  Low-level uncompiled frames or absent function publication policies report
  missing capabilities rather than inventing code. Fifteen new tests cover
  native frame/function identity, descriptor categories/ownership/immutability,
  missing capabilities and cancellation after successful/failing publication.
  The focused four-file suite passes 898 tests; all 384 header/layout comparisons
  match CPython across signatures, nested functions, methods/private names,
  decorators, generators and async functions. This is not a complete code type:
  filename, flags, constants/names, instruction/line/position maps, structural
  equality/hash, constructor/replace and function code replacement remain needed.
  Synthetic module/class/comprehension code reflection and automatic traceback
  frame insertion also remain required; existing comprehension layout differences
  are not erased or claimed compatible by these tests.
  Selected build, typecheck, scoped lint and whitespace checks pass. The final
  uncached one-worker package suite passes 7,793 tests in 523 files (121.98s;
  test bodies 9.28s).
- Compiler source identity and co_filename (2026-09-10): two failing regressions
  demonstrated absent shared source metadata and lost defining filenames across
  program invocations. Added literal filename compilation options, defaulting to
  <string>, and one frozen source record shared by module, function, lambda,
  class and synthetic class-function code. Standalone function/class compilation
  also retains source identity. Whole-program compilation allocates the filename
  constant only once; empty, relative, Unicode and newline-containing names are
  retained without path normalization, resolution or filesystem access. Generic
  undefined filename constants remain distinct from absent metadata. Native code
  publishes read-only co_filename; manually assembled code lacking source
  metadata reports the missing capability rather than inventing a filename.
  Fifteen new tests cover provenance, sharing, default/literal filenames,
  descriptor immutability, generic undefined and callback cancellation/failure.
  The focused six-file route passes 903 tests. All 256 cross-program filename
  comparisons match CPython, including nested lambdas/functions/generators and
  class methods created after another program starts executing. Source contents,
  instruction/line maps, public compile filename argument validation and automatic
  traceback locations remain separate unfinished work.
  Selected build, typecheck, scoped lint and whitespace checks pass. The final
  uncached one-worker package suite passes 7,808 tests in 524 files (157.73s;
  test bodies 11.78s).
- Compiler execution flags (2026-09-10): failing scope/native regressions
  demonstrated absent co_flags metadata. One metered iterative scope traversal
  now derives lexical nesting, direct class method and active future-feature
  flags for the entire program. Function compilation adds argument, execution
  kind and retained-docstring flags; standalone compilation derives the same
  ancestry from complete analysis, while legacy partial metadata stays absent
  rather than inventing flags. Module/class code retains future flags without
  acquiring function/docstring flags. Native code exposes immutable co_flags.
  Sixteen new tests cover lexical versus qualified-name ancestry, lambdas inside
  class comprehensions, future propagation, standalone compilation, generic
  undefined docstrings, stripping, cancellation and descriptor ownership.
  All 1,536 compiler comparisons match CPython across signatures, ordinary/async
  functions, generators, module/class/nested/global scopes, future features and
  docstring stripping; another 144 lambda/generator-lambda comparisons match
  across lexical and comprehension nesting. Selected build, typecheck, scoped
  lint and whitespace checks pass. The final uncached one-worker package suite
  passes 7,824 tests in 525 files (179.65s; test bodies 10.68s).
  This does not implement code replacement, dynamically
  marked iterable coroutines, instruction/location tables, native comprehension
  code objects or automatic traceback capture.
- Native synchronous context managers (2026-09-10): a native regression
  reproduced unconditional rejection of with statements. The runtime now
  supplies a modular default adapter when type-level protocol capabilities are
  available, preserving explicit host manager overrides. It binds __exit__ before
  __enter__, caches both before entry, ignores instance shadows, passes native
  exception type/value/stored-traceback identities and uses the existing metered
  statement unwinder for reverse cleanup, suppression and active exception state.
  Missing-method diagnostics use qualified type names and inspect asynchronous
  descriptor availability without binding those descriptors. Thirteen new tests
  cover normal exits, return, descriptor ordering, assignment/exit failures,
  generator suspension/close, stored tracebacks, active bare raise and cancellation.
  An additional failing cancellation regression caught entry callbacks executing
  after abort; entry now checks before invoking guest code. The focused three-file
  suite passes 871 tests. All 144 cleanup/control-flow and 192 diagnostic/descriptor
  comparisons match CPython. This does not claim automatic traceback frame
  insertion or native async-with adapters; both remain required. Selected build,
  typecheck, scoped lint and whitespace checks pass. The final uncached one-worker
  package suite passes 7,837 tests in 526 files (459.34s; test bodies 39.52s).
- Native asynchronous context managers (2026-09-10): three failing native
  regressions reproduced the missing async-with adapter and absent contextual
  await diagnostics. Shared acquisition now selects synchronous/asynchronous
  special methods and opposite-protocol hints without binding hint descriptors.
  A separate resumable adapter delays calls until entry/exit cursors advance and
  delegates awaitables through the owning coroutine, with cancellation checks
  around calls and resumed completion/failure. Native async-with retains cached
  methods, stored traceback identities and host overrides. Missing __await__ gets
  the method-specific diagnostic; existing descriptor/call/iterator failures
  propagate without an artificial cause. Fifteen new tests cover suspended
  entry/cleanup, argument identity, async-generator close, active bare raise,
  await acquisition errors, lazy calls and cancellation. CPython comparisons
  exposed ten lost-context cases during native exit protocol validation. Native
  and generic regressions confirmed that the shared unwinder restored handled
  state before converting native faults; it now prepares failures before restoring
  state, preserving the body exception for both synchronous and async exits.
  The focused five-file suite passes 915 tests. All 64 malformed-awaitable cases
  and 192 async protocol/descriptor diagnostics match CPython. Rechecks after the
  unwinder correction also pass all 288 async cleanup/control-flow and 144
  synchronous cleanup/control-flow comparisons. Automatic traceback
  frame insertion and complete code/frame location metadata remain unfinished.
  Selected build, typecheck, scoped lint and whitespace checks pass. The final
  uncached one-worker package suite passes 7,852 tests in 527 files (179.96s;
  test bodies 10.98s).
- Expression execution locations (2026-09-10): failing regressions demonstrated
  missing source ownership for deferred operators and suspended yield sites.
  Expression contexts now accept trusted per-frame position bookkeeping, also
  available through native runtime expression hooks. Observed continuation tasks
  retain the AST expression that scheduled them and restore that owner before
  argument collection, calls, operators and other deferred work. Operand errors
  retain operand locations, skipped branches produce no location visits, and
  yield/await/delegation retain their owning expression while suspended. Ordinary
  unobserved continuations do not allocate location records. Added metering for
  observed task records and cancellation checks around position callbacks.
  Seventeen tests cover ownership, call/operand failures, logical skipping,
  suspension/injected errors, callback failures/cancellation, allocation limits,
  independent native frames and 20,000-deep observed trees without recursion.
  The focused three-file suite passes 959 tests. All 192 native call-site line
  comparisons match CPython across multiline calls/arguments, operations,
  displays, formatted strings, lambdas and comprehensions in module/function
  scopes. This is AST execution metadata, not a guest tracing API or bytecode
  location table: statement/control-flow locations, native f_lineno/f_lasti,
  complete code position tables and automatic traceback capture remain required.
  Selected build, typecheck, scoped lint and whitespace checks pass. The final
  uncached one-worker package suite passes 7,869 tests in 527 files (182.24s;
  test bodies 13.29s).
- Statement/control-flow locations (2026-09-10): failing generic and native
  regressions demonstrated absent implicit-protocol locations and cleanup that
  retained the last body expression's line. Added trusted source-span callbacks
  to synchronous/resumable statement contexts and native per-frame hooks.
  Statement entry, condition tests, iterator acquisition/advance, target binding,
  handler selection/binding and assertion failure publish their operation sites.
  Prepared manager exits retain each manager expression's site across nested
  bodies, return/error unwinding and async suspension. Cancellation during cleanup
  location bookkeeping restores handled exception state without running guest exit.
  A failing grouped-iterable regression exposed parser span widening: parenthesized
  expressions now retain optional contentSpan metadata independently of their
  full syntax span, preserving delimiter-sensitive grammar checks. Nested grouping
  retains the innermost content span; real tuple/display delimiters stay semantic.
  Thirteen new tests cover generic/native loops and managers, grouped spans,
  bare return/skipped suites, suspended cleanup and callback cancellation/failure.
  The focused six-file suite passes 981 tests. All 96 manager-location comparisons
  match CPython across sync/async entry/exit, multiline/grouped managers and normal,
  return and error exits. All 128 loop-location comparisons now match across
  sync/async loops, grouped iterables, repeated advances, break/continue and body
  errors. These comparisons exposed 48 async-advance location mismatches: async
  advances belong to the loop header, unlike synchronous iterable-site advances.
  A corrected native regression failed before that distinction was implemented.
  The initial full-suite run was deliberately stopped after this discovery; its
  partial result is not counted as verification of the corrected code.
  This is not complete frame tracing or instruction
  metadata: deferred leaf-operation sites, native frame location storage and
  f_lineno/f_lasti, code position tables and automatic tracebacks remain required.
  A read-only follow-up check also reproduced grouped-lambda firstLine metadata
  using the opening parenthesis (line 1) instead of the lambda (CPython line 2);
  compilation must consume contentSpan for that case in the next compiler pass.
  Selected build, typecheck, scoped lint and whitespace checks pass. The final
  uncached one-worker package suite passes 7,882 tests in 527 files (208.05s;
  test bodies 11.05s).
- Grouped code first-line metadata (2026-09-10): seven failing regressions
  confirmed that grouped lambdas and first decorators on functions, asynchronous
  functions and classes used the opening parenthesis line rather than the
  executable expression content. Function/class compilation now consumes retained
  contentSpan metadata without changing full syntax spans. All 400 comparisons
  against CPython 3.14.7 match across source padding, nested grouping, lambda
  expressions, decorator names/calls/subscripts and multiple decorators. The
  focused three-file suite passes 41 tests. Selected workspace build, typecheck,
  scoped lint and whitespace checks pass. The final uncached one-worker package
  suite passes 7,889 tests in 527 files (164.30s; test bodies 12.50s).
  Native frame location storage and automatic traceback capture remain required.
- Frame-owned execution positions (2026-09-10): four failing native regressions
  confirmed that source locations were absent without host observer bookkeeping.
  Module, lexical and class frames now retain their last entered SourceSpan;
  native expression/statement contexts update it before optional host observers.
  Expression storage uses executable contentSpan while callbacks retain their
  original AST contract. Suspended/completed/failed frames retain their own site
  independently of later activations and separately compiled callers. No host
  stack or instruction offset is fabricated. Four tests cover frame isolation,
  generator/coroutine suspension and observer failure ordering. The focused
  four-file suite passes 909 tests. With observer hooks removed, all 416 CPython
  comparisons pass (192 expression, 128 loop and 96 manager locations).
  A separate read-only multiline subscription-assignment probe also matches.
  Selected workspace build, typecheck, scoped lint and whitespace checks pass.
  The final uncached one-worker package suite passes 7,893 tests in 527 files
  (129.92s; test bodies 9.55s). This is host-only current AST metadata, not native
  f_lineno/f_lasti, complete instruction/leaf-operation locations, tracing or
  automatic traceback capture; those still require implementation and auditing.
- Native frame line reflection (2026-09-10): five failing integration cases
  confirmed the missing f_lineno descriptor. Native lexical frames now expose
  their current stored execution line, or compiled firstLine before execution;
  legacy frames without either capability fail explicitly rather than inventing
  a line. Reads retain suspension/completion state. Ordinary writes reject exact
  integers outside tracing, reject all other values (including bool/int subclasses)
  without conversion hooks and reject deletion with CPython diagnostics. Guest
  tracing/jump support is still absent and is not simulated by assigning metadata.
  Tests cover active/returned functions, suspended/completed generators, grouped
  initial lambda/decorator lines and mutation validation. All 872 integration
  tests pass. All 96 getter and 144 mutation/diagnostic comparisons match CPython
  3.14.7 across padding, grouping and function/generator/coroutine states.
  Selected workspace build, typecheck, scoped lint and whitespace checks pass.
  The final uncached one-worker package suite passes 7,898 tests in 527 files
  (172.32s; test bodies 10.59s). Full instruction/leaf-operation location coverage,
  native module/class frame publication, f_lasti, tracing and automatic traceback
  capture remain unfinished.
- Deferred native reference locations (2026-09-10): a twelve-case CPython audit
  exposed six mismatches in multiline attribute access and augmented write-back.
  Five failing parser/native regressions reproduced missing attribute token spans
  and stale RHS/receiver locations. Attribute AST nodes now retain optional
  nameSpan metadata from primary and pattern parsing; runtime attribute execution
  uses that token site while preserving original expression observer arguments.
  Retained name/attribute/subscript references restore their access site before
  get/set/delete, including resumable references after RHS evaluation. Three
  further tests cover cancellation, observer failure and their priority before
  all reference operations. The focused four-file suite passed 943 tests before
  these final three safety cases; the final reference file passes all 13 tests.
  All 160 expanded CPython comparisons match across read/set/delete/augmented
  write-back, grouping, Unicode names, source padding and resumable execution.
  Selected build, typecheck, scoped lint and whitespace checks pass. The final
  uncached one-worker package suite passes 7,906 tests in 527 files (144.81s;
  test bodies 9.75s). A separate read-only probe verifies the next remaining gap:
  native __iadd__ itself reports RHS line 5 instead of statement line 4 for
  `a += (\n 2\n)`; correcting reference write-back does not fix that operator
  callback site. Augmented operators, unpacking and other leaf-operation sites
  still require their own audits, alongside instruction maps and tracebacks.
- Augmented operator locations (2026-09-10): five failing regressions confirmed
  stale RHS locations for native in-place calls, including a grouped target and
  a yielding RHS. The shared synchronous/resumable augmented-assignment kernel
  now restores the whole statement span before in-place/binary negotiation;
  reference write-back continues to restore its distinct target access site.
  Optional position callbacks are forwarded by native statement contexts, and
  cancellation after callbacks takes priority before operator mutation.
  The focused three-file suite passes 932 tests. All 832 CPython comparisons
  match across thirteen operators, in-place/binary fallback, four target forms,
  source padding and suspended RHS evaluation. Selected build, typecheck, scoped
  lint and whitespace checks pass. The final uncached one-worker package suite
  passes 7,911 tests in 527 files (133.80s; test bodies 10.37s).
  A read-only follow-up probe confirms an unpacking location gap: iterator
  acquisition for a multiline `a,b=(\n i\n)` reports RHS line 8 rather than
  target line 7. That target traversal, other remaining leaf operations,
  instruction maps, tracing and automatic traceback capture remain required.
- Unpacking/target traversal locations (2026-09-10): five failing regressions
  confirmed missing per-target sites, stale RHS locations during native unpacking
  and absent cancellation boundaries before iterator acquisition. Shared
  synchronous/resumable target traversal now publishes each target's content span
  before unpacking or storing, preserving separate nested sites and forwarding
  the native position capability. Position callback cancellation takes priority
  before unpacking/stores. The focused four-file suite passes 941 tests. After
  correcting the differential harness's native-builtin receiver binding assumption,
  all 192 CPython comparisons match across tuple/list/nested/starred targets,
  source padding, RHS grouping and suspension, including iterator acquisition,
  advancement, starred reacquisition and length hints. Selected build, typecheck,
  scoped lint and whitespace checks pass. The final uncached one-worker package
  suite passes 7,916 tests in 527 files (150.82s; test bodies 10.09s).
  Remaining leaf-operation and instruction metadata audits, tracing and automatic
  traceback capture are still required; these location fixes do not establish
  complete frame or traceback behavior.
- Name deletion locations (2026-09-10): five failing generic/native regressions
  confirmed missing individual name sites and stale del-statement lines retained
  in failed native frames. Shared synchronous/resumable deletion traversal now
  publishes each name's content span before removal; structural tuple/list nodes
  do not create execution sites, and retained references still own attribute and
  subscription removal sites. Cancellation during later position bookkeeping
  preserves earlier deletions and prevents the remaining operations, including
  when the callback also throws. The focused three-file suite passes 920 tests.
  All 96 CPython comparisons match for retained failure lines and surviving locals
  across grouped/nested targets, source padding and suspended generators.
  Selected build, typecheck, scoped lint and whitespace checks pass. The final
  uncached one-worker package suite passes 7,921 tests in 527 files (190.13s;
  test bodies 10.80s). Complete instruction metadata, module/class native frames,
  tracing and automatic traceback capture remain unfinished.
- Native module/class code metadata (2026-09-10): two failing publication
  regressions confirmed that native code objects incorrectly required a function
  layout for module/class code. Renamed the shared compiler to code-local-layout
  and generalized it to preserve closure names without assigning fast locals or
  arguments to module/class scopes. Function/lexical-frame consumers use the same
  compiler; comprehension activations still do not pretend to own native code.
  Native code publication now accepts compiled modules and class suites, supplies
  module headers and class names/closure metadata, and canonicalizes class-body
  function wrappers to their underlying suite identity regardless of publication
  order. Three new publication cases and the adjusted layout boundary test pass;
  the focused five-file suite passes 72 tests. A 256-program CPython comparison
  covers module/function/class headers, filenames, flags, Unicode closure ordering
  and nested scopes: 128 cases match exactly, and 128 differ only by CPython's
  annotation-related __classdict__ cell, intentionally absent under type erasure.
  Those differences are recorded separately, not counted as exact matches.
  CPython disassembly and compiler/symbol-table sources confirm the implicit cell;
  no other metadata differences remain in this corpus. Selected workspace build,
  typecheck, scoped lint and whitespace checks pass. The final uncached one-worker
  package suite passes 7,924 tests in 527 files (129.74s; test bodies 9.23s).
  This prepares code publication; native module/class frame objects, complete
  instruction metadata, tracing and automatic traceback capture remain required.
- Native module/class frames (2026-09-10): failing native publication cases
  confirmed that frame reflection assumed optimized lexical storage. Module and
  class activations now retain their compiled code and original namespace
  capabilities; f_locals returns the actual unoptimized mapping (including custom
  class namespaces), while f_globals/f_builtins/f_code retain canonical identities.
  Frame, traceback and explicit FrameLocalsProxy publication accept all runtime
  frame kinds. Explicit proxies on module/class frames expose only code/closure
  slots plus shared proxy extras, not a copied namespace; class proxy writes share
  original closure cells, including the completed __class__ cell. Reflection
  remains lazy and metered, and legacy missing guest mapping identities fail
  explicitly. Three integration cases cover live mappings, namespace/code identity,
  explicit proxy isolation, closure writes and heterogeneous traceback chains.
  The focused four-file suite passes 937 tests. All 64 frame-only CPython
  comparisons match across ordinary/custom class mappings, outer closures,
  source padding, proxy extras and traceback identity. An initial corpus's future
  imports hit the deliberately absent fixture import adapter; those cases are not
  counted as frame verification. Selected build, typecheck, scoped lint and
  whitespace checks pass. The final uncached one-worker package suite passes
  7,927 tests in 527 files (125.60s; test bodies 9.41s). This completes native
  publication for the three frame kinds, not automatic traceback capture, f_back,
  full instruction metadata, tracing, imports or the overall interpreter goal.
- Native caller-frame lifecycle (2026-09-10): failing stack and native reflection
  cases confirmed absent f_back links. Shared ExecutionFrame metadata now holds
  caller identity and retained source position for module, class and lexical
  activations. CallStack preserves ordinary returned callers, avoids cycles from
  repeated/native reentry, and detaches suspended bodies on every exit, including
  fatal cancellation. Native f_back is read-only and publishes canonical frame
  identities. Generator, coroutine and async-generator resumes acquire their
  current caller rather than retaining a previous resumer. A CPython differential
  caught distinct delegated close/throw behavior: close skips the suspended
  delegating activation, while throw retains it. Delegation now carries that
  distinction separately from handled-exception state; invisible cleanup entries
  still enforce recursion depth and restore in LIFO order. Six stack and fourteen
  native regressions cover lifecycle, module/class/function identity, mutation
  rejection, completion, throw, close and delegated cleanup. The focused three-file
  suite passes 940 tests. All 128 CPython comparisons match across direct/delegated
  suspension, the three suspended body kinds, completion/throw/close, ValueError
  and GeneratorExit, and source padding. Selected workspace build, typecheck,
  scoped lint and whitespace checks pass. The final uncached one-worker package
  suite passes 7,947 tests in 527 files (220.36s; test bodies 12.52s).
  Automatic tracebacks, instruction metadata, tracing and overall interpreter
  completion remain separate unfinished requirements. No push was requested.
- Suspended-object frame/code ownership (2026-09-10): seventeen failing generic
  and native regressions confirmed missing activation retention and reflection.
  GeneratorExecution now exposes optional host activation metadata only while its
  body context is live; existing terminal cleanup releases it without new guest
  callbacks or checkpoints. Function-created generators, coroutines and async
  generators retain their compiled code separately and lazily publish gi_frame /
  cr_frame / ag_frame and gi_code / cr_code / ag_code. Native f_generator uses a
  registry-local weak owner link and verifies live execution ownership, so a
  retained frame does not itself keep a generator alive or report a completed
  owner. No host garbage-collection finalization equivalence is claimed.
  Five generic and eighteen native cases cover first activation, rejected sends,
  suspension, return, throw, unstarted close/throw, fatal cleanup, write-through
  locals, canonical code/frame identity, readonly attributes and ignored close.
  The focused two-file suite passes 947 tests. All 72 CPython comparisons match
  across the three body kinds, six termination paths and source padding, including
  retained code after frame release and exact mutation diagnostics. Workspace
  build, typecheck, scoped lint and whitespace checks pass. The uncached one-worker
  full package suite passes 7,970 tests in 527 files (126.32s; test bodies 10.22s).
  After replacing a lint-flagged empty catch with explicit exception assertions,
  the two-file suite again passes all 947 tests; production source is unchanged.
  A read-only generator-expression probe confirms gi_code still fails explicitly
  with missing compiled metadata rather than fabricating a code object.
  Generator-expression compiled code metadata, automatic finalization,
  traceback capture, imports, library coverage and safe-fs integration remain
  unfinished; this change does not establish complete generator introspection.
- Generator-expression compiled code (2026-09-10): failing layout, whole-program
  compilation and native publication tests confirmed that generator expressions
  lacked their own code records. A dedicated compiler now retains analyzed scope,
  qualified name, source identity, first line, synchronous/asynchronous kind and
  code-local layout with the implicit .0 argument. Whole-program compilation
  shares a generator-expression catalog through function/class code and nested
  runtime bodies, preserving the originating compilation across later calls.
  Native lexical frames and suspended code publication accept these code records;
  generator expressions share canonical code identity, expose closure slots and
  retain code after frame release. The compiler does not create native code for
  materialized comprehensions. A CPython differential exposed the missing
  class-scope CO_METHOD flag; a failing regression preceded the fix. Three more
  failing tests established cancellation boundaries after constant callbacks.
  All 256 compiler comparisons now match across eight expression forms, four
  nesting contexts, source padding and future annotations. The focused six-file
  suite passes 1,271 tests; workspace build, typecheck, scoped lint and whitespace
  checks pass. The final uncached one-worker full package suite passes 7,981 tests
  in 528 files (129.60s; test bodies 9.00s).
  Separate read-only probes retain two explicit failures, not counted as passes:
  the native .0 iterator slot is absent, and a generator expression containing an
  inlined list comprehension reports (.0,x) instead of CPython's (.0,x,y).
  Binding/honoring the live iterator slot and shared inlined-comprehension
  activation/layout semantics remain required, alongside full instruction
  metadata, automatic tracebacks, imports, library coverage and safe-fs integration.
- Generator-expression iterator binding (2026-09-10): failing symbol and native
  tests confirmed that .0 was absent and could not select the initial iterator.
  Generator-expression analysis now records its implicit local parameter. Native
  creation acquires the real synchronous/asynchronous guest iterator exactly
  once in the enclosing frame and stores it in .0. First execution captures the
  current slot; later writes do not replace the active loop iterator. Prepared
  synchronous advancement is shared with ProtocolIterator, and prepared async
  advancement is shared with async-for without another acquisition. Frame-bound
  invocation capabilities preserve generator-expression callers during descriptor
  lookup and next callbacks. Compiler-owned execution kind avoids rescanning
  generator bodies at creation, and synchronous body assembly is deferred until
  first resume. Tests cover implicit binding, native completion preservation,
  non-latched guest exhaustion, cancellation priority, sync/async replacement
  timing and safe TypeError handling for invalid pre-start slot writes; invalid
  later writes do not disrupt an already-active iterator. The focused eight-file
  suite passes 1,318 tests. All 160 CPython comparisons match: 96 custom-iterator
  cases cover ordinary/generator/coroutine creators, acquisition/caller identity,
  replacement timing and padding; 64 cover list/tuple/string/bytes iterator
  replacements. Workspace build, typecheck, scoped lint and whitespace checks
  pass. The final uncached one-worker full suite passes 7,991 tests in 529 files
  (127.11s; test bodies 9.04s). Inlined-comprehension activation and
  layout remain a verified gap, along with instruction metadata, automatic
  tracebacks, imports, library coverage and safe-fs integration.
- Inlined-comprehension code layout (2026-09-10): failing regressions confirmed
  missing fast-local slots in enclosing function, generator-expression, module
  and class code, plus synthetic closure cells caused solely by inline reads.
  Symbol scopes now retain their parent event position after outer-input
  evaluation, so code layout interleaves inline slot reservations with ordinary
  local operations without sorting source offsets. Nested inline scopes reserve
  isolated locals, while actual nested code objects determine closure storage.
  Shared fast-local/cell slots precede sorted cell-only storage. Differential
  checks exposed additional global assignment-expression slots and cell ordering;
  failing regressions preceded both fixes. New compiler collections and traversal
  are metered, with an explicit large-inline-layout resource-limit test.
  All 2,274 CPython comparisons match: 310 inline layout cases, 218 declaration and
  shadowing cases, 210 async variants and the existing 256 generator-expression
  metadata comparisons, plus 1,280 ordinary-function layout regressions.
  Invalid CPython sources are excluded, not counted as
  passes. Workspace build, typecheck, scoped lint and whitespace checks pass.
  The final uncached one-worker full package suite passes 8,009 tests in 529
  files (78.01s; test bodies 6.26s), including allocation-accounting changes.
  This establishes compiler slot metadata, not complete runtime inlining:
  materialized comprehensions still need shared enclosing activation, temporary
  storage/cell isolation, live locals reflection and restoration on every exit.
- Inlined-comprehension runtime frames (2026-09-10): failing native tests
  established that materialized comprehensions published separate activations
  and did not expose the enclosing frame's live locals. Runtime body assembly
  now separates binding environments from the visible frame. List/set/dict
  comprehensions share their enclosing module/class/function/coroutine frame;
  generator expressions retain their own activations. Cached temporary layouts
  cover nested shadow slots without clearing directly referenced outer names.
  Frame-local overlays preserve outer storage and captured cell identities,
  remain live during suspension, and restore in reverse order without metering.
  Differential checks exposed hidden module/class slots: writes/deletions route
  to extra mapping storage or existing closure cells, while reads prefer bound
  inline values and fall through unbound hidden slots to enclosing cells.
  Failing tests preceded those fixes and promoted-cell isolation. Further failing
  tests found abandoned overlays when delegated throw lookup fails fatally;
  generator termination now has a trusted unmetered cleanup hook and discards
  temporary views without resuming guest continuations. Ordinary completion,
  close, throw and fatal body evaluation also restore locals.
  All 353 CPython comparisons match: 96 synchronous frame/locals cases across
  module/class/function/nested contexts, 96 async suspension/termination cases,
  the earlier 160 generator-iterator regressions, and an additional unbound
  nonlocal fallback probe. That probe reproduced another missing read fallback;
  a failing regression preceded the fix. The focused four-file suite
  passed 970 tests before the two additional fatal-delegation regressions; those
  two also pass. Workspace build, typecheck, scoped lint and whitespace checks
  pass. The final uncached one-worker full suite passes 8,035 tests in 530 files
  (94.46s; test bodies 7.40s), including the nonlocal fallback change.
  One separate read-only probe remains a verified failure, not a pass: in
  outer(x), an f containing keep=lambda:x followed by [x for x in [1]] retains
  the enclosing x here, while CPython promotes an unbound local cell in f.
  Static ownership promotion for such nested-only references remains required.
  No zero-allocation/performance equivalence is claimed: internal binding views
  remain allocated, and physical slot optimization still needs measurement.
- Inline closure-owner promotion (2026-09-10): failing symbol and native tests
  reproduced the previously recorded nested-only reference gap. Resolution now
  validates original lexical bindings first, then merges inline symbols in
  child order and reassigns already-free references to promoted owners. Initially
  global references remain global; existing direct references/declarations and
  earlier inline symbols prevent inappropriate promotion. Nonlocal validation
  still requires an original enclosing binding. Pass-through free names enter
  effective symbol tables only after child inlining.
  A 310-case layout comparison exposed retained outer cell requirements when
  promotion copies an already-captured inline cell. A failing regression preceded
  separate compiler closure-requirement metadata, preserving those requirements
  without inventing executable free-variable slots. Expanded runtime comparisons
  exposed unbound reads incorrectly diagnosed as free-variable errors. Static
  code ownership on lexical cells now distinguishes same-code inline reads from
  actual nested closures, without retaining execution frames in cells.
  The original ownership probe and all 396 expanded runtime cases now match
  CPython, as do the 310 new layout cases and earlier 310 layout, 218 declaration,
  210 async layout, 1,280 ordinary-function, 192 native inline-frame and 256
  generator-expression metadata checks: 3,173 matching comparisons in total.
  The focused four-file suite passes 998 tests. Workspace build, typecheck,
  scoped lint and whitespace checks pass. The final uncached one-worker full
  suite passes 8,045 tests in 530 files (126.46s; test bodies 10.20s).
  The original static-owner failure recorded above is resolved.
  A separate three-case class-cell probe finds two still-failing direct reads:
  a comprehension in a class body must read global __class__, while lambdas and
  methods retain the class construction cell. Direct reads currently capture the
  unbound class cell. These failures are not counted as passes and are the next
  scope-resolution audit target. Performance, instruction metadata, automatic
  tracebacks, imports/stdlib, public interpreter and safe-fs integration remain
  unfinished; this does not establish full Python compatibility.
- Class-body inline class-cell resolution (2026-09-11): failing symbol and
  native regressions established that direct materialized-comprehension reads
  of __class__ must use globals unless the class suite already has an enclosing
  free binding. Actual nested lambdas, methods and generator expressions retain
  the construction cell; comprehension loop targets remain lexical. Resolution
  now distinguishes those reads before inline symbol promotion. Broader CPython
  comparisons exposed simultaneous suite-free and construction cells with the
  same name. Inline binding environments retain enclosing captures separately
  and select cells by exact static owner, without changing real generator
  expression capture boundaries. Failing regressions preceded both fixes.
  All 480 CPython comparisons match: 288 lookup variants and 192 mixed capture
  variants, covering nested comprehensions, outer inputs, declarations, suite
  reads, lambda defaults and generator-expression captures.
  Workspace build, typecheck, scoped lint and whitespace checks pass. The final
  uncached one-worker full package suite passes 8,055 tests in 530 files
  (83.95s; test bodies 7.62s).
  A separate reflective-locals probe remains a verified failure: an explicit
  proxy for a retained class frame exposes the enclosing __class__ value instead
  of the constructed class and collapses duplicate physical names. CPython also
  exposes a __classdict__ slot absent here. This probe is not counted as a pass;
  physical slot reflection and class-dictionary capture require a separate audit.
- Physical frame-local slot identity (2026-09-11): a failing class-frame test
  reproduced proxy writes mutating the enclosing free cell rather than the
  owned construction cell. Reflective storage now retains physical slot order:
  shared fast/cell parameters remain one slot, while free cells are separate
  even when names coincide. Class frames retain their owned/free maps instead
  of merging them. Mapping operations carry physical indices, skip unbound
  duplicates on reads and target the first eligible slot on writes. Iteration
  and length expose all bound physical slots; snapshots keep first-bound lookup
  semantics. Native comparisons exposed a second issue: duplicate compiler names
  need shared key identity for live copy lookups. Failing native coverage preceded
  reusing keys per name during proxy-map construction.
  A further failing native regression distinguished temporary inline fast slots
  from same-named free cells. Reflection now preserves their separate storage,
  including unbound fast slots before/after comprehension execution and proxy
  writes that must not mutate the enclosing free cell. Compiler cell membership
  distinguishes true shared fast/cell slots from this case. New name/index/key
  metadata remains metered. The focused four-file suite passes 987 tests.
  All 2,651 scoped CPython comparisons match: 72 duplicate class-cell operation
  cases, 144 duplicate inline/free-slot cases, 192 inline-frame regressions,
  2,241 ordinary frame-local/closure/mapping regressions and two individual
  inline free-cell probes. Duplicate-class operation comparisons deliberately
  inspect __class__ entries; they do not establish missing classdict coverage.
  Workspace build, typecheck, scoped lint and whitespace checks pass. The final
  uncached one-worker full suite passes 8,058 tests in 530 files
  (94.56s; test bodies 7.88s).
  The original retained-class probe now selects the construction cell and exposes
  both __class__ slots correctly, but still fails full comparison because the
  __classdict__ slot remains absent. Its absence is not counted as a pass; class
  dictionary capture and Python 3.14 annotation-scope interactions need review
  against the requested ignored-type behavior.
- Annotation-cell audit (2026-09-11): revisited the retained-class probe against
  the existing type-erasure requirement and the earlier module/class metadata
  audit. CPython 3.14 symtable_visit_annotations introduces an AnnotationBlock
  and __classdict__ reference even for unannotated methods in class scope;
  type-parameter and lazy class-annotation scopes also request this capture.
  This is the intentional annotation-related metadata difference already recorded
  above, not a reason to reintroduce erased annotation scopes. The original raw
  probe remains a non-exact CPython comparison, but its runtime cell-identity
  failures are resolved. The recent notes calling classdict absence unfinished
  are superseded by this audit. Source:
  https://raw.githubusercontent.com/python/cpython/v3.14.0/Python/symtable.c
- Core match execution (2026-09-11): three failing native statement tests
  reproduced the unconditional UnsupportedStatementError for match. The shared
  synchronous/resumable statement machine now evaluates the subject once, tries
  ordered cases, publishes successful captures before guards, preserves captures
  after false guards and executes only the selected suite. Subjects and captures
  survive guard suspension; injected exceptions use existing handler/finally
  machinery. A separate value-agnostic pattern engine handles captures, wildcards,
  literal/value/singleton patterns, OR and AS patterns. Explicit work/choice stacks
  avoid recursive host calls; failed alternatives discard pending captures and
  guest comparison failures propagate. Runtime adapters use existing equality,
  identity, truth, expression and scope-storage protocols. No filesystem or host
  execution capability is introduced. New work, captures and adapters are metered;
  tests cover cancellation overriding callback faults and depth/allocation limits.
  The focused four-file suite passes 1,013 tests. All 384 scoped CPython
  comparisons match: 336 subject/pattern/guard cases and 48 suspended-guard cases
  with send/throw and finally cleanup. Native tests also cover dotted-value
  lookup, custom equality/truth methods and nonlocal/private captures.
  Workspace build, typecheck, scoped lint and whitespace checks pass. The final
  uncached one-worker full suite passes 8,072 tests in 531 files
  (131.33s; test bodies 9.91s).
  This is the first match-runtime stage, not complete structural matching:
  sequence, mapping and class patterns still fail explicitly and are next.
  Pattern semantics reference: https://peps.python.org/pep-0634/
- Sequence match execution (2026-09-11): six failing native statement tests
  reproduced missing sequence support for nested/starred patterns, wrong lengths
  and ineligible subjects. The pattern work machine now consumes ordered
  subpattern extractions without recursive calls and restores pending captures
  when a sequence alternative fails. A separate runtime sequence adapter uses
  exact list/tuple/range eligibility and trusted MRO pattern-kind metadata for
  subclasses or explicitly provided host types. Sequence protocol table presence,
  textual names and duck typing do not grant eligibility. ABC registration and
  additional standard-library sequence types remain part of the module work.
  Length checks precede extraction; fixed wildcard-only patterns avoid iteration,
  and a star-only wildcard skips sizing entirely. Ignored-star patterns use
  indexed prefix/suffix access and skip wildcard reads, while capture-star and
  ordinary patterns reuse metered assignment unpacking. Star captures receive
  fresh guest lists. Protocol failures propagate, including inconsistent lengths,
  and failed pattern extraction does not close guest iterators. New metadata,
  iterator work and binding adapters are accounted to the execution meter.
  The focused four-file suite passes 1,011 tests, including subclass protocol
  order, fake sequence rejection, enormous range wildcard handling, alternative
  capture rollback and cancellation during extraction. Mapping/class patterns
  still fail explicitly and remain next; this is not complete match coverage.
  All 852 scoped CPython comparisons match: 324 sequence subject/pattern cases,
  144 subclass protocol cases and the earlier 384 core/suspended-guard cases.
  Workspace build, typecheck, scoped lint and whitespace checks pass. The final
  uncached one-worker full suite passes 8,083 tests in 531 files
  (132.80s; test bodies 10.10s).
- Mapping match execution (2026-09-11): four failing native statement tests
  reproduced missing keyed/rest mapping patterns. A shared actual-type/MRO
  classifier now serves sequence and mapping adapters; exact dictionaries and
  mapping proxies qualify, while native dictionary metadata propagates through
  subclass MROs. Slot duck typing and guest __class__ shadows do not grant flags.
  The mapping adapter checks cardinality before evaluating keys, binds get once,
  checks dynamic duplicates with strict set membership and acquires all keyed
  values before matching their subpatterns. Missing keys fail without invoking
  __missing__; stored None remains a value. Custom get methods receive one fresh
  plain-object sentinel per keyed attempt. RuntimeExecutionContext.objectType is
  explicit canonical-registry metadata for this native allocation, forwarded to
  invocation contexts without reading shadowable guest builtins.
  Rest dictionary copying waits until keyed subpatterns succeed, reuses the
  existing mapping-copy protocols and removes matched keys through normal dict
  deletion. Extracted subpatterns use the shared iterative work machine. Native
  strict set membership is distinct from guest mutable-set probe coercion; both
  policies have regression coverage. Sentinel/key/extraction bookkeeping remains
  metered and introduces no filesystem/host-discovery capability.
  The focused four-file suite passes 1,019 tests. Native coverage includes
  sentinel identity and shadowed object, missing-versus-None, dynamic duplicate
  diagnostics, unhashable set keys, eager get ordering, delayed rest copies and
  mapping-proxy independence. Class patterns remain explicitly unsupported;
  ABC registrations and additional library mapping types remain module work.
  All 1,212 scoped CPython comparisons match: 192 mapping subject/pattern cases,
  96 custom protocol/copy cases, 72 dynamic-key/error cases and the earlier
  852 core, sequence and suspended-guard comparisons.
  Workspace build, typecheck, scoped lint and whitespace checks pass. The final
  uncached one-worker full suite passes 8,093 tests in 531 files
  (134.68s; test bodies 11.19s).
  Protocol references: https://peps.python.org/pep-0634/ and
  https://raw.githubusercontent.com/python/cpython/v3.14.0/Python/ceval.c
- Class match execution (2026-09-11): three failing integration tests reproduced
  the remaining UnsupportedPatternError for class patterns. A separate class
  adapter now evaluates the class expression once, rejects nonclasses, performs
  class-only instance checks and eagerly extracts positional/keyword attributes
  before matching children through the existing iterative pattern machine.
  Exact actual-type identity precedes virtual metaclass __instancecheck__;
  ordinary __class__ inheritance is considered only after actual inheritance
  fails. Missing attributes suppress only AttributeError, while guest errors
  propagate without publishing pending captures. __match_args__ must be an exact
  tuple; only consumed names are validated, cardinality precedes element checks,
  and duplicate attributes retain ordered access and repr-based diagnostics.
  Keyword attribute names remain literal, including private-looking names.
  Trusted matchSelf layout metadata inherits through the selected layout base;
  explicit __match_args__ disables native self matching. Canonical bool/int,
  float, list, tuple, dictionary and set/frozenset layouts now supply this policy.
  String/bytes/bytearray catalog assembly remains external to the native registry;
  the integration host supplies matching metadata, not name-based runtime rules.
  Nine additional red native __class__ tests exposed missing ordinary reflection;
  exact-value attribute lookup now uses the actual-type policy for __class__,
  while guest instance overrides remain in the object attribute dispatcher.
  New metadata, attribute names, child storage and adapters are metered; class
  extraction cancellation tests verify termination before captures publish.
  The focused four-file suite passes 1,048 tests. All 1,670 scoped CPython
  comparisons match: 192 class argument/attribute cases, 120 virtual-check cases,
  104 native-type cases, 42 metadata/Unicode diagnostic cases and the earlier
  1,212 core, sequence, mapping and suspended-guard comparisons.
  Workspace build, typecheck, scoped lint and whitespace checks pass. The final
  uncached one-worker full suite passes 8,121 tests in 531 files
  (133.42s; test bodies 10.64s). This completes extraction for all parsed pattern forms,
  not full Python: ABC registration, builtin isinstance/issubclass argument
  policies, default type instance/subclass-check descriptors, native catalog
  assembly, modules and the other runtime/integration work remain unfinished.
  Protocol references: https://peps.python.org/pep-0634/ and
  https://raw.githubusercontent.com/python/cpython/v3.14.0/Objects/abstract.c
- Default type checks (2026-09-11): two failing integration tests reproduced
  missing type.__instancecheck__ and type.__subclasscheck__ descriptors. A shared
  default-check module now supplies real MRO/apparent-class instance checks and
  real-MRO/abstract-__bases__ subclass checks without reentering virtual metaclass
  overrides. Class-pattern virtual dispatch reuses the default instance policy;
  custom metaclasses can delegate explicitly to the installed type descriptors.
  Abstract bases accept tuple-subclass storage, validate the derived class before
  the target, reread the root during traversal and preserve left-to-right branch
  lookup/error order. Explicit heap work avoids host recursion; a 10,000-node
  chain succeeds and cyclic graphs terminate under the execution meter.
  Callback cancellation tests caught and fixed an actual-type fault masking
  termination; apparent-class and abstract-base callback faults are covered too.
  A further failing diagnostic test and CPython comparison exposed immediate
  native method calls on classes being optimized as generic instance calls.
  Class receivers now retain bound native methods, preserving class-qualified
  diagnostics while explicit type descriptor calls remain unbound.
  The focused three-file suite passes 1,007 tests. All 210 new scoped CPython
  comparisons match: 128 default instance/subclass cases, 42 descriptor argument
  cases and 40 abstract-base lookup/error-order cases. The earlier 1,670 matching
  comparisons also pass, for 1,880 scoped CPython comparisons in total. Workspace
  build, typecheck, scoped lint and whitespace checks pass. The final uncached
  one-worker suite passes 8,130 tests in 532 files (144.25s; test bodies 11.66s).
  General isinstance/issubclass builtins, including tuple/union class arguments,
  remain separate work; this milestone implements their default type protocols,
  not their public argument-dispatch surface or ABC registration.
  References: https://raw.githubusercontent.com/python/cpython/v3.14.0/Objects/abstract.c
  and https://raw.githubusercontent.com/python/cpython/v3.14.0/Objects/object.c
- Public type predicates (2026-09-11): a failing builtin-assembly test reproduced
  the absence of isinstance and issubclass. Both functions are now registered,
  validate positional arity/keyword rejection before dispatch and accept an
  explicit typeChecks context or the execution invocation policy. Runtime
  predicate dispatch supports actual types, nested tuples (including tuple
  subclass storage), metaclass and arbitrary predicate-object special methods,
  apparent classes and class-like __bases__ targets. Exact instance identity
  bypasses virtual instance checks; custom subclass checks do not receive that
  shortcut. Guest truth and descriptor failures preserve normal ordering.
  Shared abstract-base helpers now serve generalized default instance/subclass
  checks without guest iteration. No new host discovery or filesystem capability
  is introduced. Two failing resource tests exposed eager queuing of unused tuple
  alternatives and abstract-base siblings; both traversals now retain lazy
  indexed frames and stop before inspecting later alternatives after success.
  Tests cover 10,000 nested tuples, an equally deep base chain, bounded cyclic
  graphs, early success within a small budget and cancellation over lookup,
  call, truth and actual-type callback faults. Tuple-subclass sequence and
  predicate overrides do not replace owned tuple storage.
  The focused five-file suite passes 1,062 tests. All 332 new scoped CPython
  comparisons match: 192 type/tuple/class-like cases, 80 virtual-check cases and
  60 descriptor/error/argument cases. The earlier 1,880 type-check and matching
  comparisons also pass, for 2,212 scoped CPython comparisons in total. Workspace
  build, typecheck, scoped lint and whitespace checks pass. The final uncached
  one-worker full suite passes 8,146 tests in 534 files
  (138.17s; test bodies 10.95s).
  Runtime union and parameterized-generic objects are not implemented yet, so
  their construction and class-information paths remain required work. This
  milestone does not claim complete public predicate compatibility or full Python.
  Reference: https://raw.githubusercontent.com/python/cpython/v3.14.0/Objects/abstract.c
- Runtime union core (2026-09-11): two failing integration tests reproduced
  missing type union construction and union class information. Native type and
  Union numeric descriptors now route through the existing reflected/metaclass
  binary dispatcher. A separate union builder flattens native union arguments,
  normalizes None to canonical NoneType, preserves first-occurrence argument
  order and collapses a singleton result to its member. Owned immutable union
  state separates ordered args, a frozen hashable set and unhashable arguments.
  Initial guest hash failures classify unhashable members; later set-probe,
  equality and host failures propagate. Cancellation always remains fatal.
  Union equality ignores order while preserving separate hashable/unhashable
  membership rules. Hashing uses cached member hashes, or retries originally
  unhashable members and keeps the union unhashable even if those classes change.
  Public type predicates consume the union's native args through lazy tuple
  traversal. Ordinary guest __args__ attributes cannot grant union eligibility.
  Additional red tests drove repr/hash/equality support, module-before-qualified
  string conversion and strict descriptor receiver families. Runtime typing repr
  follows ordinary metadata lookup and str/repr callbacks rather than the native
  type repr shortcut. New names, union state, key storage, callbacks and output
  joins are metered; direct tests cover hash-probe boundaries, host failures,
  duplicate collapse and cancellation during hash/equality/None/publication.
  The focused three-file suite passes 1,016 tests. New CPython comparisons cover
  72 construction/flattening/predicate cases, 32 hash/deduplication cases and
  12 hash/equality mutation cases. Observable hash tests use explicit matching
  hash domains; the integration host's deliberate constant identity hashes are
  not interchangeable with CPython identity hashes. All 36 reflected/metaclass
  operator cases also match, as do the earlier 2,212 type-check and matching
  cases: 2,364 scoped CPython comparisons in total. Workspace build, typecheck,
  scoped lint and whitespace checks pass. The final uncached one-worker suite
  passes 8,162 tests in 535 files (104.37s; test bodies 7.95s).
  This is union runtime core, not the entire typing surface: remaining work
  includes union metadata/subscription/mro-entry methods, checked typing.Union
  construction, generic aliases and their union/predicate integration, typing
  module publication and complete native-qualified diagnostics.
  References: https://raw.githubusercontent.com/python/cpython/v3.14.0/Objects/unionobject.c
  and https://raw.githubusercontent.com/python/cpython/v3.14.0/Objects/typevarobject.c
- Union metadata and native type modules (2026-09-11): failing integration tests
  reproduced missing readonly metadata, nongeneric subscription/base diagnostics,
  native qualified operator errors and native type module lookup. Unions now
  expose name, qualified name, origin and empty parameters for their current
  real-type-only argument domain, without inspecting class parameter shadows.
  Subscription and mro-entry descriptors preserve argument validation and repr
  error ordering. Native type layouts carry an optional trusted diagnostic name
  independently of public short names; numeric, allocation, attribute and
  descriptor diagnostics use it. Heap names remain live and inherited layouts
  do not inherit native diagnostic names. Native type modules derive from native
  names through a type descriptor; heap modules remain arbitrary own-namespace
  values and cannot be deleted. Union module reads forward to the owner without
  creating a class namespace entry or making instance module writes legal.
  Native type repr and descriptor repr retain module-qualified names, while
  method qualified names and unbound method diagnostics retain short names.
  The focused integration suite passes 1,013 tests; all 60 new metadata CPython
  comparisons and the earlier 2,364 union, predicate and matching comparisons
  pass, for 2,424 scoped comparisons total. Build, typecheck, scoped lint and
  whitespace checks pass. The final uncached one-worker full suite passes
  8,174 tests in 535 files (135.81s; test bodies 10.18s).
  A direct Python 3.14.7 audit confirms a further required gap: union-object OR
  accepts checked arbitrary arguments (including conversion of strings to
  ForwardRef), whereas type-object OR remains restricted. The current builder
  still implements only the restricted path. Checked construction, non-type
  parameter collection/substitution, generic aliases and typing publication
  remain unfinished; empty parameters are not a general typing implementation.
  References: https://raw.githubusercontent.com/python/cpython/v3.14.7/Objects/typeobject.c
  and https://raw.githubusercontent.com/python/cpython/v3.14.7/Objects/unionobject.c
- Runtime parameter discovery (2026-09-11): seven failing kernel tests drove a
  reusable, iterative parameter collector as a prerequisite for checked unions
  and generic aliases. Bare type objects are skipped before ordinary lookup.
  Presence of __typing_subst__ identifies a parameter even when its value is
  None or false. Otherwise tuple-valued __parameters__ entries are merged by
  identity; absent metadata recursively traverses lists/tuples, while explicit
  non-tuple metadata suppresses recursion. Lists are materialized before child
  metadata reads, using subclass iteration hooks; tuple subclass storage is
  borrowed without guest iteration. Encounter order is preserved and guest
  equality/hashing never participates in parameter deduplication. An explicit
  frame stack and metered identity set bound deep/cyclic structures without
  consuming the host stack. AttributeError alone permits fallback; cancellation
  survives failing attribute callbacks. Union metadata now caches only successful
  discovery and subscription initializes the same cache before diagnostics.
  Tests cover a 10,000-level container, cycles, list mutation during lookup,
  strict bare-class bypass, subclass protocols, lookup failures and cache retry
  after failure/cancellation. The focused three-file suite passes 1,025 tests.
  All 132 new scoped CPython comparisons pass (96 parameter/lookup combinations
  and 36 sequence-subclass combinations), as do the 212 earlier union cases.
  Build, typecheck, scoped lint and whitespace checks pass. The final uncached
  one-worker full suite passes 8,186 tests in 537 files
  (122.45s; test bodies 10.62s). Checked operand construction,
  ForwardRef conversion, actual parameter substitution, generic aliases and
  typing publication remain required work; this milestone does not expose a
  complete generic subscription path or enable arbitrary union operands yet.
  Reference: https://raw.githubusercontent.com/python/cpython/v3.14.7/Objects/genericaliasobject.c
- Runtime parameter substitution kernel (2026-09-11): eight failing kernel tests
  drove the shared substitution engine required by generic aliases and checked
  union subscriptions. It expands finite __typing_unpacked_tuple_args__ tuples,
  retains ellipsis-ended/unrecognized inputs, invokes every parameter's optional
  preparation hook in order and validates the resulting arity before replacing
  arguments. Preparation may return a non-tuple; subsequent hooks receive it
  wrapped as one argument. Nested list/tuple arguments repeat input preparation,
  snapshot lists through normal iteration and preserve list/tuple result shape.
  Bare type objects bypass metadata; other arguments use unpacked-parameter
  truth, ordinary substitution hooks or nested alias parameter metadata and
  normal subscription. Parameter matching is identity-based. Variadic alias
  expansion checks native __iter__ slot presence without calling the iterator.
  An explicit frame stack handles 10,000 nested containers without host stack
  use, with quotas bounding cycles; callback failures preserve cancellation.
  Nongeneric, arity and non-tuple variadic-result diagnostics retain repr/callback
  ordering. Integration checks exercise ordinary guest descriptors and calls.
  The focused two-file suite passes 1,028 tests. All 168 scoped CPython
  comparisons pass: 90 nested/preparation combinations, 36 variadic alias cases,
  18 input/subclass cases and 24 lookup/call failure cases. Six root-list harness
  cases were excluded from the comparison because GenericAlias's public
  constructor wraps a list argument, unlike the internal substitution kernel's
  list-root contract; nested-list comparisons and direct list-root unit tests
  cover those separate contracts without claiming they are identical.
  Build, typecheck, scoped lint and whitespace checks pass. The final uncached
  one-worker full suite passes 8,199 tests in 538 files
  (139.04s; test bodies 10.79s).
  This kernel is not yet wired to complete public generic subscriptions:
  checked union construction, ForwardRef conversion/validation, native generic
  alias construction and fast paths, and typing publication remain required.
  Reference: https://raw.githubusercontent.com/python/cpython/v3.14.7/Objects/genericaliasobject.c
- Cooperative source and parser-cursor accounting (2026-09-11): ForwardRef
  conversion requires eager expression compilation, but inspection found that
  public parser entry points had no execution-budget input. Ten failing tests
  reproduced ignored limits/cancellation during lexing, buffered-token lookups,
  cursor allocation and speculative syntax recovery. LexerOptions now accepts
  an optional structurally typed SourceMeter, compatible with ExecutionBudget
  without importing the runtime into the parser. Source scanning, lookahead,
  positions, diagnostic-line extraction, cursor buffering, comment retention,
  source-text extraction and speculative cursor work are charged. Source text
  is charged before the native NUL scan and extracted ranges before copying.
  Parser/lexer final checkpoints preserve cancellation over callback faults and
  syntax recovery. Ordinary callers remain source-compatible without a meter;
  SourceMeter is exported through the package API. The focused five-file suite
  passes 128 tests, including 20 metered/unmetered AST or syntax-error comparisons,
  cancelled expression/module/analysis entry and failing comment callbacks.
  Build, typecheck, scoped lint and whitespace checks pass. The final uncached
  one-worker full suite passes 8,233 tests in 539 files
  (126.19s; test bodies 10.55s).
  This is source/cursor accounting, not a complete parser sandbox: AST creation,
  validation/analysis passes, normalization and recursion-depth controls still
  require audit/instrumentation before guest-driven eager compilation is enabled.
  Checked unions and ForwardRef conversion remain unfinished; no unchecked
  parser call was added to guest execution to bypass this safety prerequisite.
- Lexical depth limits and expression recursion policy (2026-09-11): ten failing
  tests reproduced acceptance of excessive delimiter/indentation/interpolation
  nesting, including a host RangeError on 10,000 parentheses. The lexer now
  enforces CPython's 200 delimiter levels, 100 indentation-stack entries
  (including the base level) and 150 interpolation-mode entries (including
  ordinary mode). Replacement-field braces participate in total delimiter depth;
  literal and field counters are restored as modes close. Excess indentation
  does not grow state and is attributed to the physical line start. Excess
  f/t-string nesting is attributed to the final opening quote, including triple
  quotes. An older test accepting 300 nested f-strings contradicted both CPython
  compile and tokenize; it now covers the valid 149-level boundary and rejection
  of the next level. Five additional failing tests reproduced host-stack errors
  from recursive unary, power and lambda grammar and absent recursion ownership.
  LexerOptions/TokenCursor now carry an optional host-owned enterRecursiveCall
  policy; expression parsing restores each successful entry in a finally block.
  Tests stop 10,000-level inputs at a configured depth and verify restoration
  after success and syntax/resource errors. This does not impose a new arbitrary
  recursion limit on existing host parser callers; guest compilation must supply
  its execution-owned guard. All 102 CPython comparisons pass: 70 ordinary/raw
  delimiter/indentation/interpolation boundaries and 32 triple-quote boundaries.
  Another 30 combined delimiter/interpolation cases match the CPython tokenizer.
  These are lexical comparisons only: compiling some near-limit combinations
  hits CPython's separate parser-stack MemoryError, whose default compatibility
  remains to be audited rather than counted as a parsing match.
  The focused five-file suite passes 153 tests. Build, typecheck, scoped lint
  and whitespace checks pass. The final uncached one-worker full suite passes
  8,252 tests in 540 files (125.94s; test bodies 10.66s).
  AST creation and validation/
  analysis accounting remain required before enabling guest eager compilation.
  References: https://raw.githubusercontent.com/python/cpython/v3.14.7/Parser/lexer/lexer.c
  and https://raw.githubusercontent.com/python/cpython/v3.14.7/Parser/lexer/state.h
- Metered expression validation (2026-09-11): seven failing tests reproduced
  ignored validation budgets/cancellation and uncharged child enumeration,
  lambda parameter scanning and comprehension scope work. Expression and module
  parsing now pass the existing SourceMeter into expression validation. Pending
  frames, temporary child arrays, comprehension context/set copies, collected
  binding names and diagnostic allocations are charged before allocation.
  Additional red tests exposed empty slice entries that yield no children and
  syntax-error allocation after an exhausted budget; both paths are charged.
  Formatted-string child enumeration now uses an explicit frame stack instead of
  recursively delegating nested format generators. It charges literal-only
  parts and bounds cyclic externally supplied format trees with the same meter.
  Tests cover 10,000-wide child/default/slice inputs, a 10,000-level format tree,
  cycles, entry cancellation and allocation/step limits. The focused three-file
  suite passes 87 tests. All 34 maintained comprehension examples agree with
  CPython on acceptance/rejection with metering enabled; these are outcome
  comparisons, not claims of identical ASTs or all diagnostic text.
  Build, typecheck, scoped lint and whitespace checks pass. The final uncached
  one-worker full suite passes 8,264 tests in 541 files
  (139.47s; test bodies 13.62s).
  AST construction, normalization and remaining module analysis passes still
  require accounting before guest eager compilation/ForwardRef conversion is
  enabled. This milestone does not claim a complete parser sandbox.
- Metered Unicode identifier normalization (2026-09-11): thirteen failing
  tests reproduced ignored entry limits/cancellation and unbounded compatibility
  expansion, combining-class sorting and output construction. normalizeNfkc now
  accepts the parser's structural SourceMeter and charges decomposition visits,
  intermediate storage, combining-run copies and sort comparisons, composition,
  code-point string construction and the final join. A final checkpoint preserves
  cancellation. All eleven grammar normalization sites forward the cursor meter;
  twelve integration cases verify forwarding through names, attributes,
  declarations, imports, patterns, exception bindings and type parameters.
  The focused three-file suite passes 81 tests. Metered normalization matches
  Python's Unicode 16.0.0 NFKC output for all 1,114,112 individual code points,
  including surrogates, using 272 block digests, and all 4,096 three-element
  combinations of representative starters, combining marks, Hangul components,
  compatibility expansions, Unicode 16 additions and surrogates. The trusted
  decomposition graph is acyclic with maximum depth four. These comparisons do
  not establish exhaustive multi-character normalization coverage. Build,
  typecheck, scoped lint and whitespace checks pass. The final uncached
  one-worker full suite passes 8,289 tests in 542 files
  (134.76s; test bodies 12.61s).
  AST construction and remaining module analysis still require accounting before
  guest eager compilation/ForwardRef conversion is enabled.
- Metered future-directive validation (2026-09-11): nine failing tests reproduced
  ignored budgets/cancellation, a host stack overflow on a 10,000-level external
  syntax tree, uncharged repeated feature names and diagnostics, and missing
  analysis-meter forwarding. Future validation now uses a metered depth-first
  iterator stack that retains only the active path. Frame/set allocations,
  feature-name lookup work, diagnostics and every traversal step are charged.
  statementChildren accepts the structural meter for otherwise invisible empty
  branch, handler and match-case scans; the consuming validator charges each
  yielded child. Tests also cover cyclic trees, empty handler/case collections,
  and depth-first diagnostic order. analyzeModule forwards its meter.
  CPython comparisons exposed local wildcard future imports reporting directive
  placement instead of the local wildcard restriction. Three additional failing
  tests verified this discrepancy; traversal frames now retain local scope state
  and prioritize the wildcard restriction for that directive. All 97 comparisons
  agree with CPython on acceptance, error message and line, including competing
  error precedence. The focused three-file suite passes 76 tests. Build,
  typecheck, scoped lint and whitespace checks pass. The final uncached
  one-worker full suite passes 8,305 tests in 543 files
  (106.59s; test bodies 10.54s).
  This does not complete module analysis accounting: control-flow/expression
  context, symbol analysis, derived metadata and AST construction remain.
- Metered statement and pattern expression traversal (2026-09-11): thirteen
  failing tests reproduced ignored entry limits, host recursion failures on
  10,000-level trees, unbounded expressionless bodies/capture patterns/defaultless
  parameters, cyclic external patterns and missing parser-meter forwarding.
  Pattern traversal now uses indexed frames; statement traversal uses suspended
  direct-part generators and indexed borrowed-body frames. Both retain only the
  active path instead of eagerly copying siblings, charge frames and traversal
  work, and check the meter when traversal finishes or closes. Pattern traversal
  is forwarded the same meter; capture-only patterns and defaultless parameter
  scans cannot hide unbounded work between yielded expressions. Module parsing
  forwards its meter into statement enumeration. Seventeen further tests cover
  source-order enumeration across fourteen statement/pattern combinations,
  disabled body descent, cancellation on consumer close and cyclic statements.
  The focused four-file suite passes 101 tests. All 28 comparisons against the
  previous traversal preserve expression identity/order across fourteen fixtures
  with descent enabled and disabled. These are regression comparisons, not a
  CPython execution comparison. Build, typecheck, scoped lint and whitespace
  checks pass. The final uncached one-worker full suite passes 8,335 tests in
  545 files (125.64s; test bodies 9.77s). Control-flow/expression-context analysis,
  symbols, derived metadata and AST construction remain separate unfinished
  accounting work; these traversals do not establish a complete parser sandbox.
- Metered expression-context and control-flow validation (2026-09-11): thirteen
  failing tests reproduced ignored entry budgets/cancellation, host recursion
  failures on 10,000-level expression/statement trees, uncharged defaultless
  parameter and expressionless-body scans, diagnostic allocation and missing
  analysis-meter forwarding. Both passes now drive suspended direct-child
  generators with explicit active-path stacks. Resuming a parent after its child
  completes preserves default-expression ownership, nested lambda/function
  generator classification, async-generator return checks and diagnostic order.
  Frames, traversal results, contexts, function-kind entries and diagnostics are
  charged; statement/expression/annotation-target enumeration receives the meter.
  Four additional tests verify postorder kind recording, scope isolation and
  cyclic external graphs. The focused six-file suite passes 135 tests.
  All 58 maintained valid/invalid language cases agree with CPython on acceptance
  and, when valid, named function/lambda name, line and execution kind derived
  from code flags. The comparison excludes class-body and implicit-comprehension
  code objects because they are not entries in functionKinds; an initial harness
  incorrectly counted class bodies as functions and was corrected without a
  production change. Build, typecheck, scoped lint and whitespace checks pass.
  The final uncached one-worker full suite passes 8,352 tests in 547 files
  (155.80s; test bodies 12.46s).
  Symbol analysis, derived metadata, annotation-target allocation and AST
  construction remain unfinished accounting work before guest compilation.
- Annotation-target allocation and close accounting (2026-09-11): five failing
  tests reproduced uncharged iterator/frame/diagnostic allocation and lost
  cancellation when consumers return or throw into a suspended traversal. The
  shared analysis/runtime walker now uses structural SourceMeter, charges entry,
  tuple frames and starred-target diagnostics before allocation, and checkpoints
  in finally. Slice bounds are selected by index without a temporary array.
  Existing deep-key and evaluation-order behavior remains covered, including a
  10,000-level tuple traversal. One older runtime test had competing step and
  allocation limits; the new accounting correctly exhausted allocation first.
  It now independently verifies both limits and unchanged receiver-evaluation
  effects. The initial full run was interrupted after that focused failure;
  final verification uses a new uncached run after the test correction.
  The focused three-file suite passes 36 tests. All eight CPython side-effect
  comparisons agree on attribute receivers, flattened tuple keys and slice-bound
  evaluation order with annotation expressions left unevaluated. Build and
  typecheck, scoped lint and whitespace checks pass. The final uncached
  one-worker full suite passes 8,360 tests in 548 files
  (226.00s; test bodies 15.80s). Symbol analysis,
  derived metadata and AST construction remain unfinished accounting work.
- Metered qualified-name generation (2026-09-11): eight failing tests reproduced
  ignored entry budgets/cancellation, unbounded path-string growth and duplicate
  global-event scans, missing analysis forwarding, and unmetered private-name
  underscore scanning/string construction. Qualified-name collection now uses
  indexed active-path frames, retaining sibling order without copying all pending
  siblings. String construction, frames, sets/maps, parent contexts and event
  lookups are charged. Private-name mangling accepts the structural SourceMeter,
  charges scans and output before allocation, and checks cancellation on all
  exits; other consumers remain source-compatible without a meter. analyzeModule
  forwards its meter. Three additional tests cover lazy sibling access, cyclic
  external scope trees and private-name fast-path cancellation. The focused
  five-file suite passes 94 tests. All 28 CPython code-object comparisons match
  the generated qualified-name multiset across nested functions/classes, private
  names, explicit globals, lambdas and inlined/generator comprehensions. Build
  and typecheck, scoped lint and whitespace checks pass. The final uncached
  one-worker full suite passes 8,371 tests in 549 files
  (183.22s; test bodies 13.78s). Symbol collection/resolution, static-attribute
  metadata and AST construction still require accounting before guest compilation.
- Metered static-attribute collection (2026-09-11): six failing tests reproduced
  ignored entry budgets/cancellation, host argument-stack overflow from spreading
  a 200,000-statement body, uninterruptible attribute-name sorting and missing
  analysis-meter forwarding. The collector now charges scope/statement/target
  worklists, set/map entries, source-name lookup, result copies and sort workspace.
  Statement and target lists are appended individually, never spread into an
  unbounded host call. Sort comparisons checkpoint at entry and during Unicode
  code-point comparisons; statement-child enumeration receives the same meter.
  A final checkpoint preserves cancellation. Three additional tests cover a
  successful 200,000-statement traversal within sufficient budgets, cyclic
  external scope trees and allocation-limited pending statements. The focused
  four-file suite passes 81 tests. All thirteen comparisons match CPython's
  compiled __static_attributes__ tuples by class qualified name, covering nested
  classes, private/Unicode names, excluded stores and comprehension ownership.
  Build, typecheck, scoped lint and whitespace checks pass. The final uncached
  one-worker full suite passes 8,380 tests in 550 files
  (205.89s; test bodies 13.34s). Unlike qualified-name traversal, these worklists still
  retain pending siblings/targets, with their storage charged before appending;
  this milestone does not claim active-path-only memory for static attributes.
  Symbol collection/resolution and AST construction remain unfinished accounting
  work before guest compilation.
- Metered declaration-history validation (2026-09-11): seven failing tests
  reproduced ignored entry budgets/cancellation, host recursion failure on
  10,000 nested scopes, unmetered duplicate-event scans/history/diagnostics and
  missing analysis/resolver forwarding. Validation now uses explicit active-path
  frames with metered per-scope name/kind histories. Name scans and diagnostic
  strings are charged before construction, and a final checkpoint preserves
  cancellation. Two further tests cover cyclic external scopes and allocation-
  limited distinct histories. A CPython probe exposed parent-first validation
  masking an earlier nested-scope error with a later parent declaration error;
  an additional failing regression reproduced it. The walker now interleaves
  children at their recorded parentEventIndex, preserving collected event order;
  external scopes without that optional metadata retain the prior children-last
  fallback. Further probes found annotation diagnostics must identify global
  versus nonlocal specifically, and conflicting global/nonlocal flags are checked
  after immediate ordering/annotation errors, at the first directive's location.
  Six additional failing tests cover these semantics. Histories are retained in
  scope preorder for the deferred conflict pass, with their storage and traversal
  charged; traversal frames alone are active-path-only, not all validation memory.
  The focused five-file suite passes 123 tests. The initial full run was stopped
  before these additional fixes; final verification uses a fresh uncached run.
  All 39 comparisons match CPython acceptance, diagnostic message and line,
  including repeated/conflicting directives and competing nested/parent errors.
  Build, typecheck, scoped lint and whitespace checks pass. The final uncached
  one-worker full suite passes 8,396 tests in 551 files
  (178.24s; test bodies 13.59s). resolveSymbols accepts and
  forwards the meter only for declaration validation in this milestone; its own
  binding resolution/closure propagation and symbol collection/AST construction
  remain unfinished accounting work before guest compilation.
- Metered iterative symbol collection (2026-09-11): ten failing tests reproduced
  ignored entry budgets/cancellation, host stack overflow in all four recursive
  walkers on 10,000-level statement/expression/target/pattern trees, unmetered
  defaultless parameter scans and event allocation, and absent analysis forwarding.
  The walkers now yield child generators to an explicit active-path driver rather
  than recursively invoking or delegating them. Resumption preserves mutations
  after children, including walrus write-outer events, pattern bindings and scope
  creation after defaults/outer iterables. The driver reserves iterator-result
  and child-generator allocation before advancing; records/scopes, synthetic
  names, expression/statement helper iterators and private-name work are charged.
  Expressionless statements and defaultless parameters have explicit checkpoints.
  analyzeModule forwards its meter; final checkpoints preserve cancellation.
  Two additional tests bound cyclic statement/expression graphs. The focused
  six-file suite passes 125 tests. All 22 comparisons against the previous
  collector preserve complete scope trees, event order and child-entry indices;
  these are regression comparisons, not a new claim of exhaustive compatibility.
  All 80 downstream CPython comparisons still pass: 28 qualified-name cases,
  13 static-attribute cases and 39 declaration diagnostics. Build and typecheck
  pass, as do scoped lint and whitespace checks. The final uncached one-worker
  full suite passes 8,408 tests in 552 files (142.03s; test bodies 13.10s).
  Binding resolution/closure
  propagation and AST construction remain unfinished accounting work before
  guest compilation.
- Metered iterative binding resolution (2026-09-11): four failing tests reproduced
  host recursion on 10,000 nested scopes, ignored cancellation/steps after the
  declaration pass and uncharged missing-nonlocal diagnostics. Frame construction
  now uses an indexed active-path stack; outward/walrus owner resolution is a
  loop. Comprehension metadata is computed in reverse frame-build order, consuming
  child results in original sibling order and discarding them after merge. This
  eliminates recursive closure-propagation calls without changing binding owners.
  Frame/collection/result allocation, name lookup, ancestry scans, all map/set
  mutations, inline copies, promotions and diagnostics are charged; final
  checkpoints preserve termination. Two further tests verify frame-allocation
  limits and free-variable propagation through 500 enclosing scopes. The focused
  four-file suite passes 86 tests. All 68 comparisons with the previous resolver
  preserve resolved trees/bindings/cells/free/closure requirements or diagnostics
  (two diagnostic cases). All 52 CPython comparisons match compiled cell/free
  layouts across inline promotion, globals/nonlocals and class captures. An
  initial harness compared lexical cells directly with code cells; those differ
  by design because compileCodeLocalLayout merges inline storage. The corrected
  harness uses that production layout and excludes the deliberately omitted
  annotation-only __classdict__ cell under the ignored-types policy; no production
  behavior was changed to match the incorrect harness. Build and typecheck pass;
  scoped lint and whitespace checks pass. The final uncached one-worker full
  suite passes 8,414 tests in 553 files (129.79s; test bodies 10.25s).
  AST allocation and downstream
  compiler traversal audits remain required before guest eager compilation.
- Stack-safe compiler local layout (2026-09-11): three failing tests reproduced
  host recursion on 10,000 nested inline scopes, unmetered private-parameter
  mangling and lost cancellation immediately before publishing a frozen layout.
  Inline slot reservation now uses indexed active-path frames while retaining
  parent-before-child and sibling order. Private-name mangling receives the
  compiler meter, capture/event/binding/name lookups charge string length, and
  capture-child iteration checks even empty metadata collections. Final
  checkpoints preserve cancellation through layout publication. A separate
  baseline probe processed a 10,000-character local name for only five steps;
  a fourth regression now verifies that lookup is budgeted. The focused three-
  file suite passes 51 tests. All 52 CPython comparisons match ordered variable,
  cell and free names, argument counts and variadic flags through the production
  layout API; the deliberately omitted annotation-only __classdict__ cell is
  excluded consistently with the ignored-types policy. Build and typecheck pass;
  scoped lint and whitespace checks pass. The final uncached one-worker full
  suite passes 8,418 tests in 554 files (217.30s; test bodies 21.51s).
  AST construction and remaining
  downstream compilation still require safety accounting/audit before guest
  eager compilation is enabled.
- Literal-pool traversal/callback safety (2026-09-11): three failing tests
  reproduced cancellation hidden by throwing literal/tuple factories and
  unmetered scans of 10,000 defaultless parameters. Compilation now forwards
  its meter into statement-expression, expression-child and statement-child
  traversal, reserves helper iterator storage, and checks termination in a
  finally block. Two additional regressions retain ordinary factory errors
  when cancellation is absent. The original focused two-file run passes
  14 tests; build, typecheck and scoped lint pass. All 19 in-memory comparisons
  against cfac316ac preserve literal/folded maps and values, including nested
  tuples, signed zero, Unicode, docstring stripping, patterns and comprehensions.
  These are baseline regressions, not additional CPython compatibility evidence.
  The final uncached one-worker full suite passes 8,423 tests in 555 files
  (254.51s; test bodies 13.82s). This fixes these demonstrated boundaries, not
  all remaining AST/compiler allocation accounting. Suite compilation still
  needs statement-copy allocation and docstring callback termination auditing.
- Suite/docstring compilation resource accounting (2026-09-11): seven failing
  tests reproduced ignored empty-suite and statement-copy allocation, uncharged
  docstring expansion/temporary storage, and cancelled docstring factories
  returning successfully or masking termination with another exception. Suite
  compilation now charges result/list storage, per-statement slots and the
  docstring wrapper before allocation, and checks termination in finally.
  Docstring cleanup charges expansion fragments, joined/split UTF-16 storage,
  line/indent arrays, sliced lines, final output and encoding-error construction;
  code-point error positions remain separate from UTF-16 storage accounting.
  Final checkpoints preserve cancellation. Two positive tests preserve stripped
  docstring omission and ordinary factory errors. The initial focused five-file
  suite passes 60 tests. All 144 CPython comparisons match cleaned function
  docstrings across tabs, indentation, astral text, CR, LF, VT, FF, NBSP and NUL.
  A further 24 CPython comparisons match encoding, expanded code-point input,
  start/end and reason for surrogate encoding errors, including separate high/low
  surrogates after astral text, tabs and line breaks. Build, typecheck, scoped
  lint and whitespace checks pass. The final uncached one-worker full suite
  passes 8,432 tests in 556 files (155.39s; test bodies 13.36s). Remaining
  compiler metadata construction and AST allocation audits are still required.
- Function/class metadata resource boundaries (2026-09-11): ten failing tests
  reproduced cancellation masked by throwing name, qualified-name, first-line,
  static-attribute and tuple factories; metadata callbacks occurring before
  result storage was reserved; and uncharged static-attribute array slots.
  Function/lambda compilation reserves its result/body storage at entry, class
  compilation reserves result/array storage and charges each attribute slot,
  and both paths preserve cancellation with final checkpoints. Constant value
  allocation remains adapter-metered. Two further tests cover cancelled lambda
  factories and legitimate undefined lambda constants. The initial focused
  four-file suite passes 52 tests. All 48 comparisons against 547cfb212 preserve
  full compiled metadata and factory-call order across functions, lambdas,
  classes, nesting, decorators, suspension kinds and both docstring policies;
  these are baseline regressions, not new CPython compatibility claims. Build
  and typecheck pass, as do scoped lint and whitespace checks. The final uncached
  one-worker full suite passes 8,444 tests in 557 files (147.76s; test bodies
  11.68s). Whole-program registries/traversal, class-wrapper constants and
  remaining AST/compiler allocation accounting still require auditing.
- Whole-program compilation resource boundaries (2026-09-11): four failing
  regressions reproduced cancellation lost at the final class-wrapper name
  factory, including throwing factories, and missing program/registry storage
  reservation. Three more reproduced scope-flag cancellation hidden by throwing
  feature lookup or final map publication, and feature/traversal storage not
  reserved before lookup. Program compilation now reserves module/result/maps
  and the initial worklist, charges bound factories, registry entries/wrappers
  and pending child slots, and checks termination in finally. Scope flags reserve
  feature/traversal storage, charge map entries and preserve final cancellation.
  The initial focused four-file suite passes 20 tests. All 92 comparisons against
  17e065299 preserve full program metadata, cyclic registry relationships and
  factory-call order across 23 sources with both literal-pool and docstring
  policies; all 23 scope-flag comparisons also match. These are prior-version
  regressions, not new CPython coverage. Build, typecheck, scoped lint and
  whitespace checks pass. The final uncached one-worker full suite passes 8,451
  tests in 559 files (134.96s; test bodies 11.65s). AST construction and remaining compiler helper audits
  still precede enabling guest eager compilation.
- Comprehension compiler resource boundaries (2026-09-11): four failing tests
  reproduced unmetered scans of 10,000 defaultless lambda parameters and literal
  interpolation parts, cancellation lost on an early async-clause result, and
  cancellation lost while freezing generator metadata. Async classification now
  reserves its worklist/enqueue helper, meters parameter scans, forwards the
  meter into expression-child traversal and checks termination in finally.
  Generator compilation also checks termination after final result publication.
  The focused four-file suite passes 30 tests. All 48 CPython comparisons match
  generator async flags across outer/inner awaits, async clauses, materialized
  comprehensions, lazy nested generators, lambda defaults/bodies and formatted
  fields. Build, typecheck, scoped lint and whitespace checks pass. The final
  uncached one-worker full suite passes 8,455 tests in 560 files (138.95s; test
  bodies 12.12s). Remaining
  AST allocation accounting is still required before guest eager compilation.
- Pratt expression AST allocation (2026-09-11): twenty failing tests isolated
  pretokenized expression reads from lexer/cursor construction, reproducing
  uncharged literal, unary, await, binary/boolean, conditional and comparison
  AST storage, plus cancellation hidden by returning/throwing recursion-exit
  callbacks. The reader now charges its own AST nodes, comparison operand/operator
  arrays and entries, standalone tuple storage and name nodes before allocation.
  Two per-call lookup arrays were replaced with direct comparisons. Recursion
  entry and cleanup live inside final cancellation checks, including throwing
  entry/exit callbacks. Six additional tests isolate composite storage from its
  already charged literal operands; two preserve entry cancellation and ordinary
  exit errors. The focused two-file suite passes 56 tests. All 218 complete AST
  comparisons against ecf12de3d preserve nodes, spans, precedence and normalized
  names across operator combinations, tuples and representative delegated forms.
  These are baseline regressions, not independent CPython compatibility evidence.
  Build, typecheck, scoped lint and whitespace checks pass. The final uncached
  one-worker full suite passes 8,483 tests in 561 files (143.33s; test bodies
  11.61s). Delegated primary/display/string/lambda and statement grammar
  allocation still needs accounting; guest eager compilation remains gated.
- Primary/named-expression AST allocation (2026-09-11): sixteen failing tests
  isolated child-reader and normalization costs, reproducing uncharged attribute,
  call, argument, subscript, slice/unpack and assignment-expression storage and
  cancellation hidden by throwing child readers. Primary parsing now charges
  attribute/name-span objects, call/subscript nodes and arrays, argument records,
  keyword sets/entries and name scans, duplicate-name diagnostic text, bare
  generator wrappers and slice/unpack objects before allocation. Two temporary
  slice-delimiter arrays became direct comparisons. Exported trailer/argument
  and named-expression readers preserve cancellation in finally; named-expression
  nodes receive their own charge. The focused two-file suite passes 44 tests.
  All 68 AST/diagnostic comparisons against b362dd7fc preserve existing behavior;
  the same 68 cases match CPython compile acceptance across chained trailers,
  Unicode names, keyword/unpack ordering, generator arguments, slices and walrus
  restrictions. Build, typecheck, scoped lint and whitespace checks pass. The
  final uncached one-worker full suite passes 8,499 tests in 562 files (185.20s;
  test bodies 12.08s). Display/comprehension/string/lambda and statement
  grammar allocation still needs accounting before guest eager compilation.
- Display/yield/comprehension-clause allocation (2026-09-11): twenty-nine failing
  tests isolated child-reader costs, reproducing uncharged empty/nonempty
  collection storage, parenthesized copies, unpack/mapping/entry objects,
  comprehension wrappers/clauses/filters and yield/tuple nodes, plus cancellation
  hidden by throwing child readers. These readers now reserve their own nodes,
  arrays and entries before construction, with final cancellation checkpoints.
  Parenthesized copies reserve both copied expression and content-span storage;
  shared child expressions remain borrowed. Yield delimiter lookup no longer
  constructs a temporary array. The focused two-file suite passes 57 tests.
  All 65 AST/diagnostic comparisons against 5d7b20667 preserve existing behavior;
  58 complete function compilation cases match CPython acceptance, including
  async/nested comprehensions, unpacking, dictionary keys and yield forms. Build
  and typecheck pass, as do scoped lint and whitespace checks. The final uncached
  one-worker full suite passes 8,528 tests in 563 files (137.03s; test bodies
  11.66s). Loop-target allocation
  and validation, string/lambda and statement grammar still require auditing
  before guest eager compilation is enabled.
- Metered iterative target validation (2026-09-11): seven failing tests reproduced
  ignored validator entry limits/cancellation, uncharged loop-target storage and
  cancellation hidden by a throwing child reader. The initial 10,000-level
  nesting test passed on this host; a separate a1d59dd01 baseline probe at 50,000
  levels reproduced host stack overflow, and the regression now uses that depth.
  Validation uses metered active-path frames with borrowed item arrays and an
  independent starred flag per collection, retaining depth-first diagnostic order.
  Loop-target parsing charges temporary arrays, entries, unpack nodes and tuple
  wrappers; both exported readers preserve cancellation in finally. Two additional
  tests bound cyclic external graphs and nested frame allocation. The focused
  two-file suite passes 38 tests. All 56 previous-validator diagnostic comparisons
  and 84 CPython assignment/deletion/for-target acceptance comparisons pass.
  The initial full run was stopped after typecheck caught an invalid Extract over
  the grouped tuple/list/set AST union; frames now borrow item arrays directly.
  Final build, typecheck, scoped lint and whitespace checks pass. The fresh
  uncached one-worker full suite passes 8,538 tests in 564 files (182.22s; test
  bodies 12.49s). String,
  lambda and statement grammar allocation still require auditing before guest
  eager compilation.
- Parameter/lambda AST allocation (2026-09-11): fifteen failing tests isolated
  normalization and child-reader costs, reproducing uncharged parameter arrays,
  records, name-set storage and lambda nodes plus cancellation hidden by throwing
  body/default/annotation readers. Parameter parsing now charges arrays/sets,
  name lookup and insertion, records/slots and each positional-only replacement
  before allocation; lambda parsing charges its result node. Both readers
  preserve termination in finally. An additional test activates allocation
  checking after consuming the slash to isolate replacement-copy storage. The
  initial focused two-file suite passes 43 tests. All 86 AST/diagnostic comparisons
  against 6ffc9f9c8 preserve results, spans and ignored annotation behavior; the
  same 86 function/lambda forms match CPython compile acceptance across separators,
  defaults, variadics, annotations, Unicode normalization and invalid ordering.
  Build, typecheck, scoped lint and whitespace checks pass. The final uncached
  one-worker full suite passes 8,554 tests in 565 files (134.23s; test bodies
  11.78s). String and
  statement grammar allocation still require auditing before guest eager
  compilation.
- String-expression allocation and copying (2026-09-11): eleven failing tests
  isolated lexing, reproducing uncharged string/bytes/formatted/template AST
  storage, adjacent-buffer allocation/copy work and cancellation hidden by a
  throwing interpolation reader. Assembly now charges temporary part/buffer
  arrays, entries, text records, merged groups and the final node. Buffer joining
  charges each input byte length before allocating the output and each copy's
  element count before copying, without aggregating allocation into a potentially
  unsafe integer multiplication. A single input buffer remains borrowed, covered
  by a positive identity regression. Final checkpoints preserve cancellation.
  The focused two-file suite passes 40 tests. All 85 AST/diagnostic comparisons
  against ba5c47ea0 preserve existing assembly; 74 CPython literal-value cases
  match prefix combinations, empty segments, raw strings, bytes, templates,
  supplementary characters and separate surrogate code points. Build, typecheck,
  scoped lint and whitespace checks pass. The final uncached one-worker full
  suite passes 8,566 tests in 566 files (147.88s; test bodies 12.09s).
  Interpolation-field and statement grammar allocation still require auditing
  before guest eager compilation.
- Interpolation-field AST allocation (2026-09-11): twelve failing tests isolated
  lexing/source extraction, reproducing uncharged interpolation result/part/field
  records, field tuple/unpack storage, unmetered expression-text trimming and
  cancellation hidden by a throwing field reader. Parsing now charges these
  nodes, arrays and entries before construction and charges trim work/output
  before trimEnd. Final checkpoints preserve cancellation. The field-expression
  delimiter test no longer creates a temporary array. The focused two-file suite
  passes 40 tests. All 64 AST/diagnostic comparisons against b8225fa38 preserve
  field text, debug/conversion/format metadata and spans; the same 64 cases match
  CPython compile acceptance across f/t strings, nested format fields, yield,
  tuple/unpack expressions and malformed conversions. The initial full run was
  stopped before replacing a lint-rejected constant do/while condition with an
  explicit delimiter condition. Build, typecheck, scoped lint and whitespace
  checks pass. The fresh uncached one-worker full suite passes 8,578 tests in
  567 files (172.24s; test bodies 12.70s). Statement grammar and remaining ingress
  safety audits still precede guest eager compilation.
- Module/block and compound AST allocation (2026-09-11): eleven failing tests
  isolated expression readers and cursor/block construction, reproducing
  uncharged module nodes, empty/nonempty blocks, simple-line copies, conditionals
  and loops, plus cancellation hidden by a throwing compound child reader.
  Block parsing now reserves body slots before dispatch and remaining simple-line
  copy slots before copying; simple-line and decorator arrays receive their own
  charges. Conditional branch arrays/records, else arrays, span/result objects
  and for-loop results are reserved before construction. The module node and
  expression-validation iterator allocation are charged; readStatements preserves
  cancellation in finally. The focused file passes 11 tests. All 50 complete
  block AST/diagnostic comparisons against 05a8ba9a6 preserve behavior, and the
  same 50 cases match CPython compilation acceptance across nested blocks,
  semicolons, decorators, branches, loops and representative delegated statements.
  Build, typecheck, scoped lint and whitespace checks pass. The final uncached
  one-worker full suite passes 8,589 tests in 568 files (171.01s; test bodies
  13.56s). Delegated simple,
  assignment, definition, import, try/with/match and type-statement allocation
  remains to be audited before guest eager compilation.
- Simple/assignment statement allocation (2026-09-11): twenty-seven failing tests
  isolated expression, normalization and target-validation costs, reproducing
  uncharged declaration/delete/control statement records, assignment results,
  target/value arrays and tuple/unpack nodes, plus cancellation hidden through
  each exported reader. These paths now charge their own records, arrays and
  entries before allocation and preserve termination in finally. Augmented
  operator slicing charges text work/storage; statement-value delimiter checks
  no longer construct a temporary array. The focused file passes 27 tests.
  All 54 AST/diagnostic comparisons against d5f6800e4 preserve behavior; 108
  complete module/nested-function cases match CPython compile acceptance across
  declarations, control statements, chained/annotated/augmented assignments,
  tuple/unpack targets, yield values and invalid forms. Build, typecheck, scoped
  lint and whitespace checks pass. The final uncached one-worker full suite passes
  8,616 tests in 569 files (198.13s; test bodies 13.65s). Delegated definition/import/try/with/match
  and type-statement allocation still require auditing before guest compilation.
- Function/class definition AST allocation (2026-09-11): seven failing tests
  isolated delegated metadata readers, reproducing uncharged definition/name
  storage and cancellation lost when suite readers returned or threw. Function
  and class readers now reserve their own records, with class empty-argument
  storage included, and preserve cancellation in finally. Default decorator
  arrays are created only after their allocation checkpoint, using an undefined
  default to preserve host reader arities. Two positive tests retain supplied
  decorator/suite identities. The focused file passes nine tests. All 45
  AST/diagnostic comparisons against 49def9497 preserve definition metadata and
  reader arities; 30 decorated/undecorated cases match CPython compile acceptance,
  including type parameters, annotations, normalized names and invalid headers.
  Build, typecheck, scoped lint and whitespace checks pass. The uncached full
  suite passes 8,625 tests in 570 files (249.15s; test bodies 15.26s). Ignored
  type syntax, imports and try/with/match grammar allocation still require auditing
  before guest eager compilation.
- Ignored type grammar resource accounting (2026-09-11): seven failing tests
  reproduced uncharged parameter-set/alias storage and cancellation masked by
  delegated type-expression readers. Type parameter parsing now reserves its
  name set and entries, charges name hashing and dynamic diagnostic strings,
  and checks cancellation in finally. Alias parsing reserves its speculative
  reader closure and successful AST/name records and also checks cancellation
  in finally. The ordinary soft-keyword fallback remains intact. All eight
  focused tests pass. All 28 AST/diagnostic comparisons against 97b79ec32 and
  28 CPython compile-acceptance comparisons pass. Build, typecheck and scoped
  lint and whitespace checks pass. The uncached full suite passes 8,633 tests
  in 571 files (170.69s; test bodies 13.14s). This does not enable execution
  of annotations or type aliases. Import/try/with/match allocation remains next.
- Import grammar resource accounting (2026-09-11): nine failing tests reproduced
  uncharged import metadata and cancellation lost through normalization or final
  future-feature publication. The reader now reserves statement/module storage,
  import arrays/items, path arrays/slots and declared-name records. Future-feature
  insertion charges name hashing and new set entries, preserving duplicate and
  alias behavior. A final checkpoint preserves cancellation on success/error.
  All ten focused tests pass. All 32 AST/diagnostic/future-feature comparisons
  against 24bcac0e9 preserve behavior; 32 CPython compile-acceptance comparisons
  pass when the separate future-import validator is included (the initial
  parser-only comparison omitted that required stage). Build, typecheck, scoped
  lint and whitespace checks pass. The uncached full suite passes 8,643 tests
  in 572 files (159.96s; test bodies 12.66s). Module
  loading is not introduced by this parser change. Try/with/match remain next.
- Try/with grammar resource accounting (2026-09-11): thirteen failing tests
  isolated child readers and reproduced uncharged statement/handler/context
  storage plus cancellation lost when suites returned or threw. The parenthesized
  fixture explicitly allows existing speculative token-buffer copies. Try parsing
  now charges its statement and three arrays, exception tuples/slots, aliases and
  handler records. With parsing charges its statement/speculative closure, item
  arrays and context records. Both readers preserve cancellation in finally.
  All thirteen focused tests pass. Forty AST/diagnostic comparisons against
  a90111b95 preserve behavior, and forty CPython compile-acceptance cases pass,
  covering exception groups, unparenthesized exception tuples, aliases, finalizers,
  manager-list backtracking and invalid targets. Build, typecheck, scoped lint
  and whitespace checks pass. The uncached full suite passes 8,656 tests in 573
  files (189.55s; test bodies 13.25s). Match/pattern
  grammar allocation remains before enabling checked guest compilation.
- Match statement resource accounting (2026-09-11): eight failing tests
  reproduced uncharged subject/case storage and cancellation masked by throwing
  pattern, validation or suite readers. Match parsing now reserves its speculative
  header closure, successful statement/case array and individual case records,
  plus subject arrays/slots, starred records and tuple nodes. Its final checkpoint
  preserves cancellation while retaining the soft-keyword alternative. Nine
  focused tests pass. All 42 AST/diagnostic comparisons against 5af8cc49b and
  42 CPython compile-acceptance cases pass, including tuple/starred/named subjects,
  guarded and unreachable cases, representative pattern forms and malformed
  headers. Build, typecheck, scoped lint and whitespace checks pass. The uncached
  full suite passes 8,665 tests in 574 files (157.87s; test bodies 12.28s).
  Pattern parsing/validation itself still needs
  allocation and recursive-entry auditing before checked guest compilation.
- Nested pattern parser resource accounting (2026-09-11): twenty-four failing
  tests reproduced uncharged pattern storage and missing recursive-entry hooks.
  Pattern parsing now charges item/result records, sequence/or/as/star nodes,
  name/attribute paths, mapping/class arrays and entries, keyword sets/hashing,
  and speculative reader closures. Temporary delimiter/singleton arrays were
  replaced with direct comparisons. Recursive pattern entry uses the caller's
  guard, restoring it on success or failure with final cancellation checks;
  standalone and shared entry points preserve cancellation too. All 27 focused
  tests pass, including three 100-level successful nested forms and bounded
  sequence/mapping/class recursion. All 120 AST/diagnostic comparisons against
  3b8851193 and 120 CPython compile-acceptance cases pass. Build, typecheck,
  scoped lint and whitespace checks pass. The uncached full suite passes 8,692
  tests in 575 files (186.17s; test bodies 13.17s). Pattern literal
  readers and cross-pattern validation still need auditing before checked guest
  compilation; this does not make external-AST validation stack safe yet.
- Pattern literal resource accounting (2026-09-11): thirteen failing tests
  reproduced uncharged literal/unary/binary nodes, unreserved integer conversion
  work and lost cancellation through delegated string readers. Literal parsing
  now reserves those nodes and conservatively charges integer source width before
  conversion to a complex real component; its final checkpoint preserves aborts.
  The singleton check no longer creates a temporary array. All thirteen focused
  tests and 34 AST/diagnostic plus CPython compile-acceptance cases pass. The AST
  harness now explicitly encodes bigints: the previous 120-pattern comparison
  had caught JSON serialization failures as diagnostics for numeric ASTs. All
  120 cases and the prior 42 match-statement cases were rerun with bigint-safe
  serialization and pass. Build, typecheck,
  scoped lint and whitespace checks pass. The uncached full suite passes 8,705
  tests in 576 files (136.84s; test bodies 11.72s).
  Literal equality-key generation and stack-safe pattern validation remain next.
- Literal pattern equality-key safety (2026-09-11): twelve failing tests
  reproduced uncharged string/numeric keys, absent typed-buffer work checks,
  host stack overflow on 50,000 nested numeric nodes, cyclic traversal overflow
  and cancellation lost through AST accessors. Key generation accepts the source
  meter, reserves typed-buffer joining and key output, and uses an iterative
  numeric traversal with charged frames/results. Metered integer formatting uses
  the maintained integer helpers with no new decimal-digit policy; their existing
  temporary-hex size-inspection limitation is explicitly retained, not claimed
  fixed. Mapping-pattern validation forwards its meter to key generation.
  All twelve focused tests pass. All 154 metered/unmetered key comparisons against
  c67ee0744 and 484 CPython duplicate-key compile-acceptance cases pass, including
  bool/int/float/complex equality, large exact integers, strings and bytes.
  A separate 50,000-level binary AST check also passes. Build, typecheck, scoped
  lint and whitespace checks pass. The uncached full suite passes 8,717 tests
  in 577 files (193.22s; test bodies 13.68s). Cross-pattern capture validation remains recursive and
  requires a separate stack-safe resource audit before checked guest compilation.
- Stack-safe pattern capture validation (2026-09-11): thirteen failing tests
  reproduced uncharged validation storage, unbounded wide/cyclic traversal,
  stack overflow on 50,000 nested sequences and lost cancellation from AST
  accessors. Validation now uses depth-first continuation frames, charging
  capture/key sets, name hashing, OR-alternative comparison and error strings.
  OR alternatives retain independent captures and original diagnostic priority;
  sequence stars, mapping rests and class positional/keyword ordering are preserved.
  The final checkpoint preserves cancellation. All thirteen focused tests pass,
  as do separate 50,000-level OR/mapping/class/as trees. All 820 result/diagnostic
  comparisons against 0a46b5e77 and 820 CPython compile-acceptance cases pass.
  Build, typecheck, scoped lint and whitespace checks pass. The uncached full
  suite passes 8,730 tests in 578 files (149.57s; test bodies 11.95s).
  This closes the identified recursive pattern-validation gap, not the complete
  interpreter safety audit. BigInt representation accounting, guest compilation
  ingress, runtime integration, modules and safe-fs delivery remain unfinished.
- Numeric/identifier lexical resource accounting (2026-09-11): the compilation
  ingress audit found that source cursor work was charged but lexical token
  storage and conversion buffers were not. Fourteen failing tests reproduced
  missing identifier/numeric allocation charges and cancellation masked by a
  throwing numeric warning callback. PythonSource exposes its existing meter
  read-only so delegated token readers share it. Readers reserve token records,
  spelling/normalization strings and numeric payload/conversion work; final
  checkpoints preserve cancellation. Underscore normalization uses replaceAll
  instead of split/join, and keyword-boundary scanning no longer allocates a
  callback. All fourteen focused tests pass. All 157 token/warning/diagnostic
  comparisons against dc139b401 and 144 CPython numeric compile-acceptance cases
  pass. Build, typecheck, scoped lint and whitespace checks pass. The uncached
  full suite passes 8,744 tests in 579 files (182.24s; test bodies 12.50s).
  Structural lexer, indentation and string/interpolation
  storage still require auditing; host numeric conversion remains indivisible.
- Indentation resource accounting (2026-09-11): ten failing tests reproduced
  uncharged initial/level/output storage, unbounded standalone whitespace scans
  and cancellation lost during diagnostic construction. Indentation creation and
  finalization accept optional source-compatible meters without changing host
  arities; the lexer forwards its meter. Accept charges scanning, level search,
  new records, dedent slots and diagnostic storage, with final cancellation checks.
  Dedent arrays use fill instead of allocating Array.from callbacks and length
  objects. All ten focused tests pass. All 729 state/output/diagnostic sequences
  against 34658ec0d preserve behavior, including post-error state and repeated
  finalization; 729 CPython compile-acceptance cases covering spaces/tabs/form feeds
  also pass. Build, typecheck, scoped lint and whitespace checks pass. The first
  full-suite run ended with 69 ENOSPC import failures (8,291 tests passed) because
  the host data volume was full. Its temporary directory was already removed;
  no unrelated files were deleted. The same uncached full suite passes with the
  supported thread pool, which avoids fork-worker temporary module copies:
  8,754 tests in 580 files (77.60s; test bodies 9.07s).
  Structural lexer and string/interpolation storage remain
  before checked guest compilation ingress.
- Structural lexer resource accounting (2026-09-11): nine failing tests
  reproduced uncharged structural tokens and indentation-prefix copies while
  isolating source positions and indentation output. The lexer now reserves
  its delimiter array, pending indentation records/spelling, comment spans,
  newline/indent/dedent/operator/end records, delimiter entries and bounded
  prefix/operator/diagnostic strings. Prefix positions are read once instead of
  allocating a discarded duplicate. Its initial checkpoint is inside the final
  cancellation boundary. The recursion-option comment now includes patterns.
  All nine focused tests pass. Seventy-five token/comment/warning/diagnostic
  comparisons against 2ef945965 preserve behavior, and 75 CPython syntax cases
  pass across LF/CRLF/CR, delimiters, prefixes and invalid input. Build, typecheck,
  scoped lint and whitespace checks pass. The uncached full thread-pool suite
  passes 8,763 tests in 581 files (109.74s; test bodies 12.72s).
  String and interpolation storage remain to audit before guest compilation.
- String token resource accounting (2026-09-11): fourteen failing tests
  reproduced uncharged string records/point arrays, final decoded buffers after
  warning callbacks, dynamic warning text and cancellation masked by a throwing
  warning callback. Ordinary/raw text and byte readers now reserve token/span
  records, point slots, prefix/spelling strings and final typed buffers. Escape
  results are copied by an indexed loop rather than argument spreading. Warning
  construction accepts an optional source meter, preserving the existing message
  and first-warning behavior. Final checks preserve cancellation; the prefix
  validity test no longer allocates an array. All fourteen focused tests pass.
  All 104 token/warning/diagnostic comparisons against 65ad167c4 and 104 CPython
  decoded-value/error cases pass across raw/byte prefixes, Unicode, escapes and
  malformed strings. Build, typecheck, scoped lint and whitespace checks pass.
  The uncached full thread-pool suite passes 8,777 tests in 582 files (105.75s;
  test bodies 11.66s). Escape decoding and interpolation storage remain
  before checked guest compilation ingress.
- Escape decoding and Unicode-name resource accounting (2026-09-11): seventeen
  failing tests reproduced uncharged escape arrays/name strings, absent Unicode
  lookup work/storage checks and warning cancellation lost on return or throw.
  Escape decoding now reserves output/intermediate storage and forwards the
  meter into named-character lookup; both preserve cancellation in finally.
  Name lookup charges ASCII scanning, case folding, range parsing and static
  table-search strings without building a name map. All seventeen focused tests
  pass. Sixty escape-result/warning/diagnostic comparisons against 2dc5dae04 and
  60 CPython decoded-value/error cases pass. All 45,842 Unicode-name cases match
  CPython, including the complete stored name/alias table, algorithmic range
  samples and invalid names. All 91,572 metered upper/lowercase table lookups also
  pass. Build, typecheck, scoped lint and whitespace checks pass. The uncached
  full thread-pool suite passes 8,794 tests in 583 files (103.93s; test bodies
  11.31s). Interpolation storage remains before
  checked guest compilation ingress.
- Interpolation token resource accounting (2026-09-11): sixteen failing tests
  reproduced uncharged mode/token/text storage, final buffers after warning
  callbacks and cancellation masked by throwing warnings. Interpolation now
  reserves mode records, token records, text/escape buffers, point slots and
  final typed buffers, with final cancellation checkpoints. The lexer forwards
  its meter to initial mode storage. Escape points use an indexed copy instead
  of argument spreading. All sixteen regressions pass. All 176 full token,
  warning and diagnostic baselines against 332798e87 and 176 CPython syntax
  acceptance comparisons pass. Sixty-eight decoded text cases match CPython;
  four raw named-escape cases were excluded from the value-only harness because
  their braces are expression syntax, and remain covered by syntax comparisons.
  Build, typecheck, scoped lint and whitespace checks pass. The uncached full
  thread-pool suite passes 8,810 tests in 584 files (95.30s; bodies 11.44s).
  Remaining analysis/compilation ingress accounting and end-to-end interpreter
  integration are not established by these lexical checks.
- Analysis result resource accounting (2026-09-11): three failing tests isolated
  the completed analysis record after static-attribute collection. Analysis now
  reserves that record before returning it. All 23 focused analysis tests pass,
  preserving source diagnostics, scope identities, discarded types and callbacks.
  Build, typecheck, scoped lint and whitespace checks pass. The uncached full
  thread-pool suite passes 8,813 tests in 585 files (65.01s; bodies 8.93s).
  Integration inspection confirms that executeRuntimeProgram takes compiled
  metadata and the native integration fixture separately calls unmetered analysis.
  Next integration work is a source compilation entry sharing the execution meter
  and recursion guard across analysis and code preparation; this is not yet wired.
- Shared source-program compiler (2026-09-11): ten failing public-entry tests
  established source compilation requirements, then compileSourceProgram was
  added with explicit constants/options and a required host recursion guard.
  It snapshots diagnostic/compiler settings, reserves the settings record and
  shares one cumulative meter through analysis and code preparation, preserving
  cancellation in finally. The public index exposes compiler contracts without
  adding filesystem or execution side effects. A separate failing native-runtime
  regression proved comment scanning previously bypassed the execution budget;
  the runtime integration fixture now uses this compiler and its call-depth
  policy. All 1,031 focused compiler/runtime tests pass. Fifty deep compiled
  metadata comparisons with the prior analyze-then-compile route pass across
  nested scopes, generators, comprehensions, types and docstring stripping.
  Build, typecheck, scoped lint and whitespace checks pass. The uncached full
  thread-pool suite passes 8,824 tests in 586 files (69.33s; bodies 7.83s).
  This exposes source compilation, not a complete interpreter API or guest
  compile/eval/exec builtins. Constant adapters remain responsible for their own
  guest allocations, and indivisible host operations remain cooperative limits.
- Standalone expression analysis (2026-09-11): twelve failing public-entry tests
  established eval-context and scope requirements. analyzeExpression now parses
  expression grammar, creates a metered synthetic module scope, and shares the
  existing future/context/symbol/qualified-name/static-attribute analysis pipeline.
  The original expression identity is retained alongside its analysis; the
  synthetic module is explicitly not a docstring/execution suite. Top-level
  yield/await and invalid comprehension assignments are rejected, while lambda
  generators, async generator expressions and comprehension outer assignments
  retain their scopes. All 35 focused analysis tests pass. Sixty-six acceptance
  comparisons match CPython eval compilation, and 36 complete module-analysis
  result/diagnostic baselines against c339db731 preserve the refactored path.
  Build, typecheck, scoped lint and whitespace checks pass. The uncached full
  thread-pool suite passes 8,836 tests in 587 files (88.38s; bodies 9.48s).
  Expression-mode code preparation and value-returning runtime execution are
  next prerequisites for guest eval; this analysis API alone does not evaluate.
- Expression compilation and value-returning execution (2026-09-11): failing
  source-compiler, generic execution and native integration tests reproduced
  discarded eval results and string/docstring confusion. Source compilation now
  accepts explicit exec/eval modes (exec remains default), selects expression
  analysis for eval, and preserves its identity in compiled module metadata.
  Nested functions/generators and constants use the shared program compiler.
  Literal pooling includes eval root strings rather than skipping them as docs.
  Module-frame execution returns expression values without writing __doc__, and
  the concrete runtime propagates the result. Cleanup restores callers and
  preserves masked fatal limits while avoiding checkpoints after an already
  propagating ExecutionLimitError. All 1,052 focused tests pass. Seventeen
  concrete eval results match CPython, including closures, generator expressions,
  lambda generators, comprehensions, large integers and lone-surrogate strings.
  The initial differential fixture lacked generator exception support; rerunning
  with the existing exception-enabled fixture passed all cases. An incorrect
  Uint32Array assertion was corrected to inspect runtime CodePointString points.
  Build, typecheck, scoped lint and whitespace checks pass. The final uncached
  full thread-pool suite passes 8,850 tests in 587 files (79.31s; bodies 9.47s).
  Guest compile/eval/exec builtins, interactive single mode, compiler flags,
  namespace defaults and full interpreter/safe-fs publication remain unfinished.
- Explicit/inherited future compiler flags (2026-09-11): seventeen failing tests
  reproduced ignored explicit flags, inherited grammar and missing validation.
  Public source compilation and parser/analysis options now accept futureFlags;
  validation rejects nonintegral, negative and unsupported bits before bitwise
  truncation. The obsolete nested_scopes bit is accepted but does not invent
  lexical nesting. Analysis snapshots option records before callbacks and keeps
  explicit bits separate from source-declared futureFeatures. Token cursors seed
  inherited Barry grammar without sharing mutable feature sets. Whole-program
  and standalone function/class compilation combine explicit legacy bits with
  active source directives throughout nested code. All nineteen focused tests
  pass, including callback mutation and cross-compilation isolation. All 512
  future-bit combinations match CPython across 1,024 nested code graphs and
  2,048 exec/eval inequality grammar cases; the grammar rerun explicitly requires
  PythonSyntaxError rather than accepting arbitrary failures as syntax rejection.
  Build, typecheck, scoped lint and whitespace checks pass. The uncached full
  thread-pool suite passes 8,869 tests in 588 files (64.25s; bodies 7.90s).
  Guest builtin argument binding, dont_inherit/caller extraction, non-future
  compiler flags and interactive single mode remain separate unfinished work.
- Guest compile builtin adapter (2026-09-11): the new native builtin binds
  source/filename/mode, optional flags/dont_inherit/optimize and keyword-only
  _feature_version through explicit filename and compiler capabilities. It
  preserves source identity, C-int index conversion and filename/flag/truth/
  optimize/feature conversion order. Caller future bits are queried only when
  inheritance is enabled; invalid flags, optimize values and modes fail before
  backend invocation. AST func_type requests are accepted only with ONLY_AST.
  Missing/duplicate/unexpected keyword precedence, suggestions and None diagnostics
  were corrected from CPython differential evidence and failing regressions.
  Final checks preserve cancellation without re-metering an already fatal exit.
  All twenty builtin tests and 1,046 focused builtin/native integration tests pass.
  A guest compile call uses the real source compiler and code publisher in the
  explicit string exec/eval fixture, validating filename and future metadata.
  All 161 binding/diagnostic cases match CPython. Build, typecheck, scoped lint and
  whitespace checks pass. The uncached full thread-pool suite passes 8,890 tests
  in 589 files (71.59s; bodies 9.07s). This is a capability-driven builtin adapter,
  not completed default backend publication: byte/buffer/AST source handling,
  filesystem-name policy, single/func_type implementation, non-future flags,
  optimization policy, caller extraction and guest eval/exec remain unfinished.
- Filesystem path/name protocols (2026-09-11): new reusable primitives preserve
  native str/bytes identity, invoke type-level __fspath__ once, reject invalid
  results without recursive coercion, and decode bytes using UTF-8/surrogateescape
  or an explicit decoder capability. They return code-point storage, preserving
  lone and distinct paired surrogates, and perform no path normalization, NUL
  rejection, authorization or I/O. Fatal failures propagate without re-metering;
  callback-masked cancellation and decoder allocation remain checked. Fifteen
  focused primitive tests pass after correcting an initial parameterized-test row
  shape. Two failing compiler integration tests then established byte/path-like
  filename support and CPython's embedded-null-character diagnostic. The explicit
  native fixture now uses the decoder and compiles guest Path/bytes filenames.
  All 1,062 focused tests pass. All 69,893 byte decodes match CPython fsdecode,
  including every one/two-byte input, sampled triples and four-byte boundaries.
  Build, typecheck, scoped lint and whitespace checks pass. The uncached full
  thread-pool suite passes 8,906 tests in 590 files (75.25s; bodies 8.32s).
  The compiler's existing UTF-16 filename bridge still needs rich code-point
  identity support for distinct surrogate pairs. This is not completed safe-fs
  authorization/file-object integration or default backend publication.
- Retained compiler filename values (2026-09-11): six failing compiler tests
  established the rich filename contract, followed by two failing builtin/native
  tests reproducing descriptor rejection and lost guest filename identity.
  CompilationFilename now separates host diagnostic displayName from an already
  allocated generic guest value. Source options snapshot/freeze descriptors before
  callbacks; module/function/class/generator metadata shares the retained value
  without converting it through UTF-16 or allocating it again. Explicit undefined
  constants remain distinct from absent source metadata. The guest compile adapter
  accepts and snapshots the same descriptor, and its native fixture preserves
  original str identity or decodes byte paths into code-point strings. All 1,082
  focused tests pass. Filename identity and exact code-point contents match CPython
  across 157 nested code graphs including adjacent surrogate pairs, lone surrogates
  and supplementary characters. Legacy string options and diagnostic display names
  remain supported. Build, typecheck, scoped lint and whitespace checks pass.
  The uncached full thread-pool suite passes 8,913 tests in 591 files (65.61s;
  bodies 7.89s). Guest syntax-exception filename publication still needs to retain
  the original value rather than relying solely on the host diagnostic spelling;
  default compilation/eval/exec and safe-fs publication remain unfinished.
- Guest compiler exception filename retention (2026-09-11): the compile adapter
  now uses the execution-owned exception preparation capability to retain the
  original guest filename in SyntaxError.filename and args, including distinct
  adjacent surrogate code points. Native integration verifies SyntaxError,
  IndentationError and TabError identity. Ordinary backend errors remain unchanged;
  cancellation during exception preparation remains fatal. Expanding these checks
  exposed unexpected/missing indentation reported as plain SyntaxError. Six failing
  parser regressions established that defect before introducing typed cursor error
  construction and the correct compound-suite exception class. The focused run
  passes 1,094 tests; 43 direct CPython comparisons agree on indentation exception
  classes. Build, typecheck, scoped lint and whitespace checks pass. The uncached
  full thread-pool suite passes 8,922 tests in 591 files (66.11s; bodies 8.14s).
  Exact diagnostic span/message parity, default compile/eval/exec publication and
  safe-fs integration remain unfinished; this is not full interpreter completion.
- Byte source encoding declaration scanner (2026-09-11): introduced a separate
  metered header scanner after a failing missing-module test run established the
  absent capability. It recognizes initial UTF-8 BOMs, coding cookies on eligible
  first/second physical lines, CR/LF/CRLF, exact Python UTF-8/Latin-1 normalization,
  and conflicting BOM declarations. Unknown codec names are retained for explicit
  decoder lookup, not silently accepted as UTF-8. Text sources must bypass header
  scanning. All 25 focused cases pass, including cancellation/allocation/scan limits
  and avoiding scans beyond the first two lines. Compared against CPython 3.14's
  tokenizer helper implementation and 270 direct Python header-detection cases
  (universal newlines normalized for tokenize.readline): all agree. The initial
  differential harness had an escaped-newline quoting error, fixed with String.raw
  before obtaining any comparison result. This scanner does not yet decode bytes,
  validate codec names, or extend the guest compile backend. Build, typecheck and
  scoped lint and whitespace checks pass. The uncached full thread-pool suite
  passes 8,947 tests in 592 files (63.37s; bodies 7.55s).
- Byte-source compiler integration (2026-09-11): compileSourceProgram now accepts
  Uint8Array as well as text. A separate metered decoder snapshots input, rejects
  NULs before codec lookup, consumes header declarations, and supports strict UTF-8,
  Latin-1 and ASCII plus Python's aliases. Additional codecs use an explicit
  SourceByteDecoder capability, exported as part of the public options contract;
  callback work/output allocations remain the capability's responsibility. Text
  coding comments stay inert. Ten failing compiler tests established missing byte
  support (an initial it.each byte-row shape was corrected and rerun before the
  fix). The guest compile fixture now uses the actual byte compiler after its own
  failing integration check. A further failing test caught double BOM consumption:
  the decoder now preserves the initial BOM for the source cursor to consume once.
  Four failing alias tests established repeated/edge separator normalization before
  correction. Snapshot isolation, unknown codec rejection, error translation,
  allocation/step limits and cancellation have focused coverage. All 995 expanded
  CPython byte-compilation comparisons agree on acceptance and resulting docstring
  values, including aliases, invalid bytes, non-ASCII text and BOMs. Build,
  typecheck, scoped lint and whitespace checks pass. The uncached full thread-pool
  suite passes 8,969 tests in 593 files (65.65s; bodies 7.87s).
  Exact decode diagnostic metadata (especially undeclared invalid UTF-8), the
  complete codec catalogue, buffer/AST guest source inputs, default builtin
  registration and eval/exec remain unfinished. The low-level text source cursor
  accepts an initial BOM; Python compile(str) rejects it, requiring a separate
  guest/text compiler boundary audit rather than changing lexical behavior blindly.
- Guest compilation source conversion (2026-09-11): added the text/buffer branch
  used by the guest compiler fixture. Guest str conversion rejects raw surrogate
  runs with original code-point storage and exact UTF-8 encode-error ranges before
  any UTF-16 merging can occur. Bytes and explicit contiguous buffer leases become
  copied byte inputs; no __str__, __bytes__ or iterable fallback participates.
  Guest acquisition errors become compile's TypeError, while host faults and fatal
  cancellation stay intact. Every acquired lease is released, including cancelled
  acquisition and failed copying. The source compiler now distinguishes initial
  text BOMs (rejected) from byte/file BOMs. Explicit first-write-only diagnostic line
  attribution preserves BOM text and exact offsets instead of applying file-line
  normalization. Missing-helper, text-BOM, exact diagnostic, source-line attribution
  and native surrogate acceptance failures preceded their fixes. Focused runs pass;
  585 direct CPython Unicode conversion comparisons agree, and 20 text-BOM errors
  match exact CPython messages, filenames, line/offset ranges and text. Build,
  typecheck, scoped lint and whitespace checks pass. The uncached full thread-pool
  suite passes 8,983 tests in 594 files (73.41s; bodies 7.60s). AST source
  dispatch and canonical bytearray/memoryview publication remain separate unfinished
  work; buffer support here uses the existing explicit lease capability.
- Compiler Unicode exception source identity (2026-09-11): a failing guest
  regression confirmed that UnicodeEncodeError.object and args[1] reconstructed
  equal strings instead of retaining the original source object; direct CPython
  compilation confirmed both identity requirements. Exception preparation now
  accepts named retained guest values for syntax filenames and Unicode objects.
  The guest source converter passes its original str when preparing a surrogate
  encoding failure. Existing native faults without retained values still use the
  original fallback conversion. Compiler filename retention uses the same named
  contract and remains covered. Three focused failures covered the revised
  capability call and cancellation during preparation before implementation.
  The 1,064-test focused run passes, plus two native encode/decode identity tests.
  Build, typecheck, scoped lint and whitespace checks pass. The uncached full
  thread-pool suite passes 8,987 tests in 594 files (137.22s; bodies 12.56s).
  This does not yet retrofit every other native encoder with original-object
  retention or establish full codec/interpreter completion.
- Default __debug__ constant (2026-09-11): the optimization audit found that even
  unoptimized __debug__ reads incorrectly consulted guest namespaces. Three failing
  tests established missing pooled constants, undefined generic values, and wrong
  nested runtime results when globals/builtins shadow the name. The literal pool
  now maps normalized __debug__ name expressions to the same typed True constant
  as explicit literals, preserving AST and analyzed scope identities and allowing
  tuple pooling. Additional coverage verifies one allocation for repeated/debug
  normalization spellings and explicit True. Native coverage includes module,
  function default/body, class body/method, lambda and comprehension reads.
  CPython directly confirms True despite shadowed globals/builtins. The focused
  1,042-test run and the subsequent literal-pool tests pass. Build, typecheck, lint
  and whitespace checks pass. The uncached full thread-pool suite passes 8,991
  tests in 594 files (75.07s; bodies 8.89s). Optimization levels
  1/2 still need __debug__=False, assertion elimination and shared nested-code policy;
  this prerequisite fix does not claim that compile(optimize=...) is implemented.
- Compiler optimization levels (2026-09-11): eight failing source/native tests
  established ignored optimization and invalid host levels before implementation.
  Resolved host levels 0/1/2 are validated and snapshotted before compiler callbacks;
  the guest fixture resolves its default -1 to its baseline 0. Levels
  1/2 omit executable assertions, pool __debug__ as False, and skip assertion literal
  allocations. Level 2 additionally strips module/function/class docstrings. The
  iterative assertion pass rebuilds compound suites without mutating the analyzed
  AST or function/class identity keys. Original scope analysis preserves generator
  classification and locals bound inside removed assertions. All compound suite
  forms, a 20,000-level supplied AST, allocation limits and option mutation have
  focused coverage. The focused 1,085-test run passes; build, typecheck and scoped
  lint pass. Thirty CPython execution comparisons across all three levels match
  assertion effects, nested debug values, docstrings, generator return values,
  unbound locals, context managers, match, loops and try suites. The first two
  differential attempts exposed fixture setup differences (__doc__ fallback and
  missing next), corrected explicitly before counting comparisons. Whitespace
  checks pass. The uncached full thread-pool suite passes 9,004 tests in 595 files
  (74.00s; bodies 8.33s). General dead-code/constant optimization, complete guest code metadata,
  default builtin registration, AST/single modes and additional codecs remain open.
- Guest eval/exec call adapters (2026-09-11): added one shared explicit-backend
  factory after a missing-module red test established absent adapters. Binding
  retains positional-only source, positional/keyword globals and locals, exec's
  keyword-only closure, None defaults, count/duplicate/unknown-key precedence and
  keyword spelling suggestions. Eval returns the backend value; exec discards it
  and returns None. Neither adapter discovers host eval, ambient namespaces, nor
  filesystem access. Backend inputs retain original guest identities and all work
  shares the execution meter; cancellation during backend failure remains fatal.
  Seventeen focused tests pass. A native integration supplies the real source
  compiler/runtime for module-namespace text eval and exec, verifying values,
  namespace writes and None return. All 1,884 direct CPython binding comparisons
  match across counts and ordered keyword combinations. Build, typecheck and
  scoped lint and whitespace checks pass. The uncached full thread-pool suite
  passes 9,022 tests in 596 files (80.90s; bodies 8.62s). Full namespace admission,
  default locals/builtin insertion, closure/code-object execution, eval whitespace
  handling, and canonical default registration remain backend work, not claimed
  by the call adapter or its explicitly restricted integration fixture.
- Dynamic namespace selection (2026-09-11): introduced a metered selector after
  its missing-module red test. It preserves eval/exec's distinct validation order,
  dictionary-vs-subscriptable-mapping diagnostics, caller-default laziness,
  globals-as-default-locals behavior, no-frame errors and existing __builtins__
  values including None. Missing builtins are inserted through intrinsic dictionary
  storage before source admission, but not after invalid locals or cancellation.
  Original dictionary-subclass objects remain selected identities; item overrides
  are bypassed for builtin insertion. Default frame locals and mapping-slot checks
  remain explicit host policies rather than implicit reflection. Sixteen unit tests
  and the 1,051-test focused run pass. Native integration verifies separate globals
  and locals, global fallback, custom mapping locals, writes, namespace keywords,
  insertion before syntax failure and dictionary-subclass identity/override bypass.
  All 128 CPython namespace validation/insertion comparisons match. CPython's
  builtin implementations were inspected for ordering and frame-default rules.
  Build, typecheck, scoped lint and whitespace checks pass. The uncached full
  thread-pool suite passes 9,041 tests in 597 files (83.56s; bodies 9.48s). Optimized
  caller-local snapshots, canonical backend registration, code/closure handling and
  general globals-subclass namespace adapters remain unfinished integration work.
- Dictionary-subclass execution namespaces (2026-09-11): reproduced adapter
  failure on native subclass storage and missing construction validation before
  implementing payload-backed writes/deletes with original reflected identity.
  CPython 3.14.7 probes exposed the separate read rules: LOAD_GLOBAL invokes
  subclass item slots, whereas LOAD_NAME's global fallback and function builtin
  selection use intrinsic dictionary access. Added explicit intrinsic lookup to
  namespace adapters and routed module/class fallback and builtin selection
  accordingly. A failing native eval/exec comparison was reproduced before the
  fallback fix. Subclass locals retain their separate mapping protocol adapter.
  Native tests cover overridden reads, missing keys, propagated failures, writes,
  deletion, function and class access, frame identity and required invocation
  context. Exact dictionaries retain direct access without guest callbacks.
  Build, typecheck, scoped lint and whitespace checks pass; the uncached full
  thread-pool suite passes 9,043 tests in 597 files (69.19s; bodies 8.31s).
  Canonical dynamic backend registration, optimized default locals, code objects
  and closure execution remain unfinished; this is not a full eval/exec claim.
- Dynamic text/buffer source admission (2026-09-11): seven failing regressions
  established missing eval whitespace normalization and eval/exec-specific source
  type errors. The shared conversion now accepts an explicit compile/eval/exec
  mode, retaining compile as its default. Eval removes only initial ASCII spaces
  and tabs after Unicode validation, preserving original Unicode error offsets
  and source identity. Byte and buffer inputs follow the same rule; copied buffers
  are released before compilation and whitespace scanning is metered. CPython's
  builtin source was inspected to distinguish initial pointer advancement from
  ordinary lexer handling of trailing whitespace. All 208 CPython comparisons of
  text/byte whitespace admission and exception classes match. Native integration
  executes padded string/byte eval, retains exec indentation errors and handles
  invalid source types. The focused conversion suite passes 25 tests, including
  fatal budget enforcement (its initial allowance was corrected to exclude source
  construction). Build, typecheck, scoped lint and whitespace checks pass. The
  uncached full thread-pool suite passes 9,055 tests in 597 files (64.77s; bodies
  8.24s). Code-object execution remains a separate pending backend branch.
- Next:
  remaining scope/compiler audits, interpreter runtime,
  resource controls, runtime modules, and safe-fs integration. Parsing and static
  analysis do not establish interpreter execution.
- Workspace lockfile registration and packaging integration remain pending.
- Package README creation awaits the requested permission under repository rules.
- No push or release was requested.
