# expr — bounded nonregex checkpoint

This module implements argv-token integer/string evaluation. **This checkpoint
is not the complete expr feature:** `match` and `:` parse, but evaluated regex
operations return status 3 (`bounded expr BRE protocol is pending`). Skipped
regex branches do not compile or execute. The root-owned bounded-worker
first-capture protocol is awaiting explicit shared-scope approval. No untrusted
regex compiles or executes on the main thread, and there is no private executor,
native subprocess, `eval`, host filesystem access, or runtime dependency.

## Module-local API

`src/commands/expr/index.ts` exports:

- `createExprCommand(options?: ExprCommandsOptions): CommandDefinition`
- `createExprCommands(options?: ExprCommandsOptions): readonly CommandDefinition[]`
- `exprCommands(options?: ExprCommandsOptions): VirtualShellPlugin`
- Types `ExprCommandsOptions` and `ExprLimits`.

`ExprCommandsOptions` has `replace?: boolean`, `limits?: Partial<ExprLimits>`,
and `regex?: RegexExecutionOptions`. Regex options use the existing executor
policy validation; this checkpoint acquires no regex resources. The plural
factory contains exactly one definition named `expr`. Plugin registration
rejects a collision before mutation unless `replace: true` is explicit.

These are physical module exports, **not a root export or published package
subpath**. No default aggregate registration, package configuration, existing
module, or other command is changed. Build emits the physical module at
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
uncooperative host sink to stop. This no-resource checkpoint needs no invocation
cleanup registration. Regex integration must use the existing synchronously
registered idempotent session cleanup, never per-invocation executor disposal.

## Verification

Build first, then run scoped author tests:

```sh
npm run build
node --import tsx --test tests/commands/expr/*.test.ts
node --import tsx tests/commands/expr-author/capture.ts --capture
```

Canonical tests are evidence-read-only. The optional capture requires its flag,
writes to a newly created OS temporary directory, and never overwrites committed
evidence. Native tests use controlled bounded local argv, a timeout/output cap,
and the authenticated GNU 9.7 binary at the existing metadata-stress oracle
location. Missing/mismatched prerequisites **fail qualification**, not skip/pass.
Product code never executes this native utility.

Primary semantic references inspected: official GNU Coreutils manual sections
`expr invocation`, `String expressions`, `Relations for expr`, and the official
coreutils `v9.7/src/expr.c`. The rolling online manual is not a pinned 9.7 oracle.
The reproducible author cohort compares exact status, stdout bytes, and stderr
for its own controls. It does not include regex evaluation or stand in for an
independent holdout, package-install test, full gate, universal parity, native
superiority, deployed-service behavior, or performance comparison.
