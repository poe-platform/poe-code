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

These are physical module exports, **not a root export or published package
subpath**. No default aggregate registration or package configuration is changed.
The three approved shared protocol/client/worker files gain the new operation;
legacy grep/rg/glob descriptors, reply validation and matching are unchanged.
Build emits the physical module at
`dist/commands/expr/index.js`. Source/build testing is not proof of installation
in a standalone moved package; independent packed-consumer proof remains pending.

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
| 6 | `:` (evaluation pending) |
| Prefix | `length STRING`, `index STRING CHARS`, `substr STRING POS LENGTH`, `match STRING REGEXP` (match evaluation pending) |
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

All argv syntax is parsed before evaluation, including skipped branches.
Short-circuiting suppresses arithmetic, comparison and regex evaluation, not
syntax validation. GNU's prefix `length`, `index`, and `substr` computations
still occur within skipped expressions; their resource limits still apply.
Malformed skipped regex text is not compiled. As a bounded AST implementation,
this checkpoint reports whole-expression syntax errors before earlier evaluation
errors if both exist; GNU's interleaved parser can report the earlier arithmetic
error instead. Diagnostics use bounded human-readable messages, not full GNU
quoting/help trailers. These diagnostic/error-order gaps are not blanket waivers
on canonical tests or full GNU diagnostic parity claims.

`length` counts characters under the selected profile. `index` returns the
one-based first character position matching any member of CHARS, or zero.
`substr` uses one-based positions; noninteger, zero/negative, or out-of-range
positions, and noninteger/nonpositive lengths, yield empty. Very large valid
lengths clamp to remaining subject length after digit/work validation.

Successful evaluation writes the exact result bytes followed by LF. Status 0
means true, 1 false, 2 invalid expression/profile/argv, and 3 bounded resource or
execution/output failure. Cancellation is rethrown unchanged, including an
errno-shaped reason. A rejected diagnostic sink remains a rejection.

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

- `LC_ALL`, then `LC_CTYPE`, then `LANG`, default `C`, selects character behavior.
- `C`/`POSIX`: UTF-8 encoded **bytes** are the character units.
- `C.UTF-8`/`C.utf8`: Unicode scalar units, not UTF-16 units or graphemes.
  Combining marks count separately. No normalization is performed. The scanner
  treats malformed intermediate bytes individually; no scalar-array allocation
  or silent replacement decoding is used for string operations.
- Comparison independently consults `LC_ALL`, `LC_COLLATE`, `LANG`, default `C`.
  Only the same four profile names are supported, with byte collation; no
  `localeCompare`, ambient locale, language-specific collation or libc guarantee.
- Unsupported profiles fail only when the relevant character/string comparison
  operation executes. Pure arithmetic is not locale-dependent.

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
| `maxNodes` | 4,096 | AST nodes |
| `maxDepth` | 128 | Parser recursion and constructed AST depth; flat binary chains also have depth |
| `maxSteps` | 8,000,000 | Shared parse/evaluation work and logical allocation charges for this invocation |
| `maxStringBytes` | 65,536 | Per-value byte allocation and conservative arithmetic render bound |
| `maxOutputBytes` | 65,537 | Final stdout allocation including LF, checked before allocation/write |
| `maxRegexPatternBytes` | 8,192 | Pre-admission pattern bytes (hard ceiling 65,536) |
| `maxRegexNodes` | 4,096 | Combined BRE AST and compiled instructions (ceiling 8,192) |
| `maxRegexDepth` | 64 | BRE group nesting (ceiling 128) |
| `maxRegexStates` | 16,384 | Cumulative search states, including alternatives (ceiling 65,536) |
| `maxRegexAllocatedUnits` | 1,000,000 | Cumulative logical worker allocation units (ceiling 4,000,000) |

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
charge before work; evaluation yields to the event loop after approximately
4,096 charged units. Argument validation/parsing are synchronous and bounded by
argv/node/depth limits. Diagnostics are fixed-size bounded messages outside the
stdout byte limit, so even a tiny stdout allowance can report its failure.

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

Supported common constructs: literals, dot (including newline), contextual
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
to captures inside nullable repeated subexpressions. The last restriction follows
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
