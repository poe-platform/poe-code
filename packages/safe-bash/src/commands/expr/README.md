# expr — bounded integer, string and worker-only BRE evaluation

This module implements argv-token evaluation, including evaluated `match` and
`:` using an additive operation in the existing regex executor. Skipped regex
branches submit and compile zero jobs. No untrusted regex compiles or executes
on the main thread. There is no private executor, native subprocess, `eval`, host
filesystem access, or runtime dependency. This is not a full GNU parity claim;
the supported BRE profile and explicit unsupported cases are described below.

Historical partial checkpoint `85675366` and its separate `d96f9ffe` evidence
retain the original pending-regex behavior and 1,381-case nonregex result. Those
immutable receipts are not rewritten or counted as regex acceptance.

## Module-local API

`src/commands/expr/index.ts` exports:

- `createExprCommand(options?: ExprCommandsOptions): CommandDefinition`
- `createExprCommands(options?: ExprCommandsOptions): readonly CommandDefinition[]`
- `exprCommands(options?: ExprCommandsOptions): VirtualShellPlugin`
- Types `ExprCommandsOptions` and `ExprLimits`.

`ExprCommandsOptions` has `replace?: boolean`, `limits?: Partial<ExprLimits>`,
and `regex?: RegexExecutionOptions`. Regex options use the existing executor
policy, admission queue and worker lifecycle without changing defaults. The plural
factory contains exactly one definition named `expr`. Plugin registration
rejects a collision before mutation unless `replace: true` is explicit.

These exports are now also exposed at the root and explicit
`virtual-bash/commands/expr` subpath, with expr in the default aggregate.
`AgentCommandsOptions.expr` accepts family limits, omitting `replace` and `regex`.
Aggregate top-level regex and replacement are authoritative. Unknown runtime
nested `expr.regex`/`expr.replace` fields are ignored, including when the global
regex option is omitted; direct factories retain their own existing options.
This mechanical integration does not change the accepted engine or its guard.
The three approved shared protocol/client/worker files gain the new operation;
legacy grep/rg/glob descriptors, reply validation and matching are unchanged.
Build emits the physical module at
`dist/commands/expr/index.js`. Independent c3 packed/moved-consumer evidence
(`beba7b00`, bound in `tests/commands/expr-stress/initial-profile-handoff-20260827/REPORT.md`)
passes 19/19 physical-module smoke checks. Those are historical module checks,
not acceptance of this new public/default integration, whose different-agent
review is separate. The INITIAL restricted profile and limitations remain.

## Grammar and results

Each token is one argv element. In increasing precedence, all binary operators
associate left:

| Level | Operators |
| --- | --- |
| 1 | `|` |
| 2 | `&` |
| 3 | `< <= = == != >= >` |
| 4 | `+ -` |
| 5 | `* / %` |
| 6 | `:` |
| Prefix | `length STRING`, `index STRING CHARS`, `substr STRING POS LENGTH`, `match STRING REGEXP` |
| Primary | `( EXPRESSION )`, `+ TOKEN`, literal argument |

Prefix arguments recursively accept prefixes and primaries, not unparenthesized
lower-precedence binary expressions. `+ TOKEN` consumes the following token
literally, even a keyword, `+`, or parenthesis. A bare right parenthesis is a
syntax error. Other operator-looking tokens can be literals when in operand
position, as in GNU 9.7; prefix keywords require their arguments. The shell must
quote its own metacharacters before this command receives argv.

Integers are decimal digits with optional leading minus, not leading plus or
whitespace. Literal spelling, including leading zeros, is retained until numeric
coercion. Arithmetic uses bounded `BigInt` values, never floating-point operands.
Division truncates toward zero; remainder has the dividend's sign. Division and
remainder by zero, or noninteger arithmetic operands, produce status 2.
Configured digit/work/allocation exhaustion produces explicit status 3 rather
than wrapping, rounding, or returning a truncated result.

Comparison is numeric only if both operands have integer syntax; otherwise it
uses the explicit byte-collation profile. `|` returns the first true value, or
integer zero when both are false. `&` returns its left value if both are true,
otherwise integer zero. Empty strings and minus-optional all-zero strings are
false. `+0`, a lone minus, and nonnumeric strings are true.

A single async token cursor performs awaited reductions in encounter order with
one invocation Budget; active regex jobs are submitted and awaited once, without
reparse or replay. Earlier active failures can precede later syntax errors.
Inactive branches still enforce syntax, arity, structural node/depth and work
limits, but carry no operand values: no operand encoding, numeric conversion,
locale operation, prefix reduction or regex compilation/submission. Global argv
validation and diagnostic quoting still apply; skipping is not zero-work or
zero-allocation. Suppressing skipped string prefixes is explicit project policy,
not universal GNU short-circuit equivalence. Bounded human-readable diagnostics
do not claim full GNU quoting/help parity or waive canonical assertions.

`length` counts characters under the selected profile. `index` returns the
one-based first character position matching any member of CHARS, or zero.
`substr` uses one-based positions; noninteger, zero/negative, or out-of-range
positions, and noninteger/nonpositive lengths, yield empty. Very large valid
lengths clamp to remaining subject length after digit/work validation.

Successful evaluation writes the exact result bytes followed by LF. Status 0
means true, 1 false, 2 invalid expression/profile/argv, and 3 bounded resource or
execution failure. Cancellation is rethrown unchanged, including an
errno-shaped reason. Rejected stdout and diagnostic sinks preserve the original
rejection; they do not trigger another diagnostic or become quota failures.

Only a sole `--help` or `--version` requests informational output, identifying
virtual-bash rather than a fabricated GNU version. An initial `--` is removed
once. Unknown flag-looking tokens are ordinary operands, not an option-parser
error; additional tokens can still make the expression invalid. This matches
the pinned GNU 9.7 controls rather than generic Unix flag parsing.

## Bytes and Unicode

Argv is JavaScript string data. NUL and lone UTF-16 surrogates are rejected with
status 2 instead of silently replacing/truncating information. Valid argv is
encoded as UTF-8. Intermediate/result values are bytes: C-locale `substr é 1 1`
returns byte `c3` followed by LF, without replacement decoding.

- The first nonempty `LC_ALL`, `LC_CTYPE`, then `LANG`, default virtual `C`,
  selects character behavior. Empty values fall through; whitespace does not.
- `C`/`POSIX`: UTF-8 encoded **bytes** are the character units.
- `C.UTF-8`/`C.utf8`: Unicode scalar units, not UTF-16 units or graphemes.
  Combining marks count separately. No normalization is performed. The scanner
  treats malformed intermediate bytes individually; no scalar-array allocation
  or silent replacement decoding is used for string operations.
- Exactly `en_US.UTF-8` additionally selects qualified Unicode scalar **character
  encoding** for `length`, `index`, `substr`, and admitted BRE literals, dot and
  captures. This is not full named-locale ctype or collation support and does not
  rewrite the name to `C.UTF-8`. Other spellings, modifiers and UTF-8 suffixes
  are not aliases. Combining marks remain separate, without normalization.
- Comparison independently consults `LC_ALL`, `LC_COLLATE`, `LANG`, default `C`.
  It uses the same nonempty precedence, but accepts only `C`, `POSIX`, `C.UTF-8`
  and `C.utf8`, with byte collation. Nonnumeric comparisons under named or
  unknown collation still explicitly fail, even ASCII equality. There is no
  `localeCompare`, ambient locale, language-specific collation or libc guarantee.
- If either effective `LC_CTYPE` or `LC_COLLATE` is outside those four baseline
  names, matching refuses every unescaped bracket opener before worker admission.
  This covers locale-sensitive ranges, classes, equivalence and collating elements,
  **and conservatively refuses literal and negated lists** such as `[a]`, `[é]`
  and `[^a]`; these lists are not being classified as inherently locale-sensitive.
  Escaped literal brackets (`\[`) remain admissible. Plain literals, dot,
  captures and other admitted forms reuse the unchanged bounded worker; admission
  does not promise that every BRE is valid or supported.
  Both subject and pattern byte caps precede the escape-aware byte scan. Its
  entire linear work is charged before reading pattern bytes; the worker receives
  the remaining invocation work budget. No locale protocol, main-thread regex,
  host locale lookup or additional dependency is introduced.
- Unsupported profiles fail only when the relevant character/string comparison
  operation executes. Arithmetic, numeric comparisons and literal values do not
  reject irrelevant locale categories.

The local pinned Darwin GNU oracle supports the tested `C` and `C.UTF-8`
profiles. Its `C.utf8` name falls back to bytes, so the virtual `C.utf8` scalar
alias is explicitly **not qualified as that host's native behavior**. No GNU/Linux
or Apple expr profile is certified by these observations.

## Limits and lifecycle

All options are positive safe integers; `maxDepth` additionally cannot exceed
256. Defaults are invocation-local, not a replacement for shared Shell budgets.

| Limit | Default | Enforcement |
| --- | ---: | --- |
| `maxArgumentBytes` | 65,536 | Sum of UTF-8 argv bytes, preflight before encoding; count also limited to `4 * maxNodes` |
| `maxNumericDigits` | 1,024 | Raw decimal digits excluding minus before BigInt conversion; arithmetic and generated numeric result digits |
| `maxNodes` | 4,096 | Logical expression nodes, including inactive syntax |
| `maxDepth` | 128 | Parser recursion and carried expression depth; flat binary chains also have depth |
| `maxSteps` | 8,000,000 | Shared parse/evaluation work and logical allocation charges for this invocation |
| `maxStringBytes` | 65,536 | Per-value byte allocation and conservative arithmetic render bound |
| `maxOutputBytes` | 65,537 | Normal stdout and diagnostic bytes including LF, checked before output encoding/allocation/write |
| `maxRegexPatternBytes` | 8,192 | Pre-admission pattern bytes (hard ceiling 65,536) |
| `maxRegexNodes` | 4,096 | Combined BRE AST and compiled instructions (ceiling 8,192) |
| `maxRegexDepth` | 64 | BRE group nesting (ceiling 128) |
| `maxRegexStates` | 16,384 | Cumulative search states, including alternatives (ceiling 65,536) |
| `maxRegexAllocatedUnits` | 1,000,000 | Cumulative logical worker allocation units (ceiling 4,000,000) |

Every normal diagnostic obeys `maxOutputBytes`, including argument, arithmetic,
worker, resource and unknown-execution errors. Failed output admission emits
only `expr: output bytes limit exceeded\n`: one fixed 34-byte emergency diagnostic,
awaited and exempt from the normal quota, with status 3. It contains no caller
tokens or command name. This is not an absolute combined stdout/stderr byte cap.
Diagnostic sizing precedes interpolation and UTF-8 encoding; reporting an
exhausted work/string budget does not require spending that exhausted budget.

Regex requests receive the remaining invocation `maxSteps`, capped at 50,000,000
per request; successful worker work is charged back to the invocation. Subject
bytes are capped by `maxStringBytes` and a hard 1,048,576-byte worker ceiling.
Logical allocation units bound arrays, compiler nodes, capture-state copies and
search-path history; they are not heap bytes or an RSS promise. Worker resource
limits and distinct startup/active deadlines remain an additional guard. Limits
can reject valid native patterns or inputs; no partial match is returned on a cap.

Numeric literals used only as strings need not fit `maxNumericDigits`. Numeric
coercion charges input-size squared before BigInt construction; arithmetic
charges the product of operand sizes before the operation. Arithmetic render
space is conservatively checked before arithmetic and `toString`; the transient
result is bounded by operand digit bounds, then its actual digits are checked.
Small generated index/count values use bounded safe-integer formatting. Work
limits can reject an operation before a more specific result-digit limit.
Conservative allocation checks can reject an arithmetic expression even when
its final text would fit. Budget accounting is logical, not a total heap/RSS or
wall-clock guarantee; configurable limits are trusted host policy.

Index uses bounded scanning rather than allocating a scalar array/set. Loops
charge before work; async parser/evaluation checkpoints yield when at least
4,096 charged units have elapsed since the previous yield, not every iteration.
Global argument validation remains synchronous and bounded by argv limits.
Ordinary diagnostics obey the output quota; only the fixed 34-byte emergency
has the separate allowance described above.

Direct execution never accesses stdin, not even its iterator/getter. Actual
Shell input ownership is tested separately against its standard-command baseline;
this does not claim the Shell never acquires its supplied input. Output uses
`writeBytes` with the supplied signal and awaits backpressure. Completed writes
cannot be undone; cancellation observes late rejections but cannot force an
uncooperative host sink to stop. Every invocation uses `withRegexSession`, which
synchronously registers the same idempotent cleanup before opening a session or
acquiring workers, and awaits it in `finally`. Sibling invocations share the
executor without per-invocation executor disposal. Direct contexts may omit the
hook; `finally` still closes their session. Registration rejection prevents
admission; closing one session cancels its admitted work, not a sibling's work.

## BRE profile

`bre-worker.ts` is imported by worker dispatch only and refuses execution on the
main thread. A bounded parser produces instructions for an explicit interpreter;
no pattern is translated to JavaScript RegExp. Matching starts at byte zero and
enumerates bounded alternatives, selecting the longest whole match. On equal
whole lengths the first greedy/ordered path wins; GNU9.7 controls include
`\\(a\\|aa\\)a*` versus `\\(a*\\)a*`. This is not a claim that every POSIX
subexpression tie or GNU implementation corner has been reproduced.

Within the locale admission boundary above, supported common constructs are
literals, dot (including newline), contextual
`^`/`$` (no per-line anchors), bracket lists/negation/ASCII ranges, ASCII named
classes, escaped groups, backreferences 1–9 to closed groups, `*`, GNU `\\+`,
`\\?`, `\\|`, and `\\{m\\}`, `\\{m,n\\}`, `\\{m,\\}`. Numeric intervals
have a 32,767 grammar bound and compile within the instruction/work limits.
Only the syntactically first capture determines the expr value. No capture means
matched character count; a failed match with captures or an unmatched first
capture means empty bytes. A participating empty capture is distinct in the
protocol even though expr prints the same empty result.

The transport explicitly reports **original-input byte spans**, never UTF-16
code units or scalar indices. In C/POSIX, matching is byte-based and a capture
may split UTF-8; output preserves those bytes. In the UTF-8 profile, matching uses
scalar values plus a map to original byte boundaries; the main thread validates
span shape/bounds and scalar boundaries, then counts scalars for noncapture
results. Invalid UTF-8 in a regex operand is an explicit unsupported error, not
replacement decoding. BOMs remain input. Pattern syntax is checked even when
the subject is empty.

Explicitly unsupported (status 2, no fake nonmatch): GNU word/buffer/alphabetic
escapes, leading escaped repetitions, stacked repetitions, repeated anchors,
collating symbols/equivalence classes, class range endpoints, non-ASCII range
endpoints, named locale classes on non-ASCII UTF-8 subjects, and backreferences
to captures marked by the nullable-repeat guard. That guard propagates a flag
into a repeat child when already flagged or when `maximum > 1` and the child
is nullable, marks captures under that flag, and refuses references to marked
captures. It does not refuse all nullable capture backreferences; maximum-one
repeats alone do not trigger it, but may inherit a flagged ancestor. Nullability
treats anchors/backreferences conservatively as nullable, recurses through groups,
accepts repeats with minimum zero or nullable child, requires every sequence
child, and accepts any alternative child. The restriction follows
an author native discrepancy (`aaa : '\\(a*\\)*\\1'`); the original dirty
capture is preserved, not converted to a pass. Other nested/repeated capture
corners remain subject to independent review. Unsupported profiles are deliberate
capability limits, not statements that the corresponding GNU syntax is invalid.

## Verification

Build first, then run scoped author tests:

```sh
npm run build
node --import tsx --test tests/commands/expr/*.test.ts
node_modules/.bin/tsc -p tests/commands/expr/tsconfig.json
node --import tsx tests/commands/expr-author/capture.ts --capture
node --import tsx tests/commands/expr-author/capture-regex.ts --capture
```

Canonical tests are evidence-read-only. The optional capture requires its flag,
writes to a unique new directory (nonregex: OS temporary; regex: owned author
tree), and never overwrites committed evidence. Regex capture returns nonzero
when native differences remain, including documented unsupported cases. Native
tests use controlled bounded local argv, a timeout/output cap,
and the authenticated GNU 9.7 binary at the existing metadata-stress oracle
location. Missing/mismatched prerequisites **fail qualification**, not skip/pass.
Product code never executes this native utility.

Primary semantic references inspected: official GNU Coreutils manual sections
`expr invocation`, `String expressions`, `Relations for expr`, and the official
coreutils `v9.7/src/expr.c`. The rolling online manual is not a pinned 9.7 oracle.
The author cohorts compare exact status, stdout bytes and stderr and retain
unsupported cases separately from exact matches. Canonical tests explicitly
assert rejection for documented gaps; this is safety/contract acceptance, not
native parity for those cases. No author cohort stands in for an independent
holdout, package-install test, full gate, universal parity, native superiority,
deployed-service behavior, or performance comparison. GNU9.7 on Darwin and Apple
are separate oracles; only the pinned GNU9.7 binary is used here. No Linux claim.

Primary sources checked with web.run on 2026-08-27: official coreutils v9.7
`src/expr.c` (`docolon`) and `doc/coreutils.texi`; GNU Grep Fundamental Structure
and the rolling GNU Coreutils String expressions manual. `docolon` uses
`RE_SYNTAX_POSIX_BASIC` with `RE_CONTEXT_INVALID_DUP` and `RE_NO_EMPTY_RANGES`
cleared, `newline_anchor = 0`, anchored `re_match`, and `re_nsub`/register 1 for
capture selection. The native author controls qualify the implemented subset,
not all semantics permitted by those flags.
