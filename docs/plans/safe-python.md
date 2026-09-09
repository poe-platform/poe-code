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
- Next:
  compound statements, type aliases, and enclosing-scope validation
  normalization, the complete grammar/parser and evaluator, then runtime modules
  and safe-fs integration. Tokenization does not establish interpreter execution.
- Workspace lockfile registration and packaging integration remain pending.
- Package README creation awaits the requested permission under repository rules.
- No push or release was requested.
