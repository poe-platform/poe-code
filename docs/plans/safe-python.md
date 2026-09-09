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
- Next:
  remaining scope/compiler audits, interpreter runtime,
  resource controls, runtime modules, and safe-fs integration. Parsing and static
  analysis do not establish interpreter execution.
- Workspace lockfile registration and packaging integration remain pending.
- Package README creation awaits the requested permission under repository rules.
- No push or release was requested.
