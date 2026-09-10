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
- Next:
  remaining scope/compiler audits, interpreter runtime,
  resource controls, runtime modules, and safe-fs integration. Parsing and static
  analysis do not establish interpreter execution.
- Workspace lockfile registration and packaging integration remain pending.
- Package README creation awaits the requested permission under repository rules.
- No push or release was requested.
