# Structured commands: bounded jq subset

This subtree implements a dependency-free `jq` command with a tokenizer, parsed
AST, and lazy asynchronous interpreter. Runtime code never uses `eval`, the
`Function` constructor, a host process, or a native jq executable. Files are read
only through the command's supplied virtual filesystem. This is a useful jq
subset, not complete jq, and is not evidence of superiority to jq or just-bash.

## Public API

The public entry point is this subtree's `index.ts`. Root/package integration is
owned separately; these examples do not imply a published package subpath.

The exported types and signatures are:

```ts
interface StructuredCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<JqLimits>;
}

declare function createStructuredCommands(
  options?: StructuredCommandsOptions,
): readonly CommandDefinition[];

declare function structuredCommands(
  options?: StructuredCommandsOptions,
): VirtualShellPlugin;
declare const defaultJqLimits: Readonly<JqLimits>;
```

`createStructuredCommands()` returns one definition, named `jq`.
`structuredCommands()` returns a plugin named `structured-commands`, usable with
`shell.use(structuredCommands())`. Registration rejects an existing `jq` unless
`replace: true` is supplied. Neither entry point edits another command registry
until setup/registration. Limits are validated and copied when definitions are
created; the exported defaults are frozen. Execution budgets are per invocation.
`CommandContext.invoke` is not used.

## Command line

```sh
jq [options] [FILTER] [FILE ...]
jq [options] -f PROGRAM_FILE [FILE ...]
```

Without a filter, the command uses `.`. Without input files, it consumes stdin.
Each `-` input operand means stdin; other operands resolve relative to the virtual
cwd. `-f` reads the program from the virtual filesystem, not the host filesystem;
there is no automatic `/dev/stdin` mapping. Input files are processed in order.

| Option | Meaning |
| --- | --- |
| `-r`, `--raw-output` | Emit strings without JSON quotes; other values remain JSON. |
| `-j`, `--join-output` | Imply raw output and omit the trailing LF for every output value, including nonstrings. |
| `-R`, `--raw-input` | Read LF-delimited strings instead of JSON; preserve CR, BOM, and final partial records. |
| `-c`, `--compact-output` | Compact JSON instead of two-space pretty JSON. |
| `-s`, `--slurp` | Collect JSON values into one array; with `-R`, collect verbatim text into one string, including LF. |
| `-n`, `--null-input` | Run once with null; do not acquire stdin or open data files, even with `-s`. |
| `-e`, `--exit-status` | Base successful execution status on the last output value. |
| `--arg NAME TEXT` | Bind a string variable. |
| `--argjson NAME JSON` | Bind exactly one parsed JSON value. |
| `-f`, `--from-file` | Read the following operand as a virtual program file. |
| `--` | End option parsing, including for a negative numeric filter. |

The short output/input/status flags may be combined, such as `-crne`. `-f` must
be separate, not combined into `-cf` or attached to its operand. Long options
take separate operands, not `--option=value`. Unsupported flags fail rather
than being ignored. Repeated argument names retain their first binding, matching
the tested native build. `$ARGS.named` exposes named bindings and
`$ARGS.positional` is an empty array; positional-argument flags are not supported.
An explicit `--arg ARGS ...` is retained in `$ARGS.named.ARGS`; it does not
replace the automatic `$ARGS` object. Its insertion order is `positional`, then
`named`, matching the captured native build.

Every output value ends in LF unless `-j` is set. Embedded newlines in raw strings are preserved.
Ordinary successful execution returns 0. With `-e`, no emitted result returns 4,
last result null/false returns 1, and any other last result returns 0. Empty
strings, zero, and empty containers are true-valued. A later input that emits no
results does not erase the previous result used by `-e`.

Raw input splits on LF only, not CRLF as a unit: `a\r\n` becomes `"a\r"`.
Empty raw stdin emits no records; each blank line emits an empty string, and a
trailing LF does not create an extra record. Raw slurp emits one empty string
even for empty input. Data files and stdin are concatenated in operand order,
so a partial record carries into the next file. Repeated `-` operands consume
stdin only once in raw mode. Raw UTF-8 decoding has per-file boundaries;
byte chunks within a file may split codepoints. `-n` bypasses all raw data
sources, even with `-s`, but still compiles the filter first.

Usage/file errors return 2, compile errors 3, and data/runtime/limit errors 5.
Ordinary filter errors retain completed output, emit a located diagnostic, and
continue with later top-level inputs. Parse errors, resource limits, cancellation
and host failures do not use that recovery path. Diagnostic messages are bounded
and their accumulated charge uses `maxOutputBytes`, separately from stdout's
counter. Compiler, input-parser and evaluation diagnostics match the frozen
profile only where verified; not every unsupported filter or I/O diagnostic is
native-byte compatible. `-e` aggregation also depends on later results/errors.

Host stdout/stderr write failures retain their original exception identity,
including host-thrown `JqError` and `FsError("EIO")`; exception origin, not class,
prevents conversion to a jq filter status or fallback diagnostic. No further
output or input acquisition is attempted after such failure; iterator cleanup
still runs. This root-approved command policy retains the grammar handoff's
behavior and is an **observable typed-sink behavior change** from older source,
not native parity or a stale-native assertion. The canonical sink assertion's
separate independently reviewed test-only update is complete (`538a7f8`); see
`tests/commands/structured-stress/jq-grammar-final-review/REPORT.md` and the final
`tests/commands/structured-stress/jq-grammar-seal-final/REPORT.md` (`ea11ceb`).
Shared byte I/O and shell contracts are unchanged. Cancellation and downstream
pipe closure propagate; shell handling is separate.

## Supported grammar and behavior

Compilation validates the complete filter, including dead branches, function
arity, bound variable names, strings, and assignment path forms before acquiring
stdin, opening data files, or emitting stdout. Reading the `-f` program itself is
necessarily earlier. Shell redirection effects are outside this command's scope.

- Identity `.`, JSON scalar literals, `#` line comments, and `$name` variables.
- Property access `.foo`, `.foo.bar`, `."unusual key"`, `.["key"]`, computed
  indexes `.[EXPR]`, and chained indexing. Bare identifier access must touch its
  dot: `if . then ...` does not become a property named `then`.
- Array indexes, including negatives and fractional numbers truncated toward
  zero. Missing properties/indexes return null; invalid container/key types
  raise an error. Object membership checks own properties only. Index generators
  run before base generators, including assignment paths.
- Array/string slices `.[START:END]`, omitted/null endpoints, and negative
  endpoints. Slice bounds currently require safe integers. Strings slice by
  Unicode codepoint, not UTF-16 code unit. Start, end, and base generators are
  consumed lazily in that order; early consumers do not evaluate unused bounds.
- Iteration `.[]` over arrays or object values, preserving object insertion
  order, including numeric-looking and prototype-looking keys.
- Parentheses, comma result generators, pipes, array construction `[FILTER]`,
  and object construction `{a: FILTER}`, `{a}`, `{(KEY_FILTER): VALUE_FILTER}`.
- Arithmetic `+ - * / %`, unary minus, comparisons `== != < <= > >=`, Boolean
  `and`, `or`, `not`, and alternative `//`. Arithmetic/comparison Cartesian
  products evaluate RHS outermost; object fields expand left-to-right.
- Conditional `if CONDITION then FILTER elif CONDITION then FILTER else FILTER
  end`. An `else` is required. Attached `.then`, `.else`, and `.end` still work
  as properties.
- Postfix `?` suppresses jq evaluation errors, but cannot suppress resource-limit
  errors, aborts, or host I/O failures.
- Assignment `=`, update `|=`, and arithmetic updates `+= -= *= /= %= //=` on
  identity, chained property/index paths, iteration, and parenthesized comma
  paths. Array extension inserts nulls and is checked before allocation.

Filters are generators. A pipe invokes its right side for every left result;
`select` can repeat its input if its predicate emits multiple true values;
`map` collects all mapped results. Boolean short-circuiting preserves generator
cardinality. `//` drops false/null left results and evaluates its right side only
if the entire left stream had no other results.

Plain assignment evaluates the RHS on the root input and emits one updated
root for each RHS result. `|=` evaluates its RHS on each old path value, uses
only the first produced result, and deletes paths whose RHS produces nothing.
Discarded RHS branches are not evaluated. Repeated ordinary paths update
repeatedly; repeated deletion paths delete only once. Deletions use original
array positions. Values are copied on modification; assignments cannot mutate
another result or create object cycles.
Deleting an absent path leaves its ancestors unchanged, including null and
out-of-range array indexes. Deleting the root with `. |= empty` emits null.

Arithmetic-update RHS evaluation/cardinality follows the observed local
`jq-1.7.1-apple` behavior: RHS evaluated on the root, one updated root per RHS
result. For example `.a += (1,2)` produces two roots. The jq manual describes
these using an update-equivalence shorthand; this implementation does not claim
cross-version parity beyond its recorded tests.

### Functions

| Functions | Accepted arity and behavior |
| --- | --- |
| `empty`, `select(f)`, `map(f)`, `map_values(f)` | Generator filtering/mapping; `map_values` keeps only the first result per entry and drops empty updates. |
| `length`, `keys`, `keys_unsorted`, `type` | Array/object/string/numeric lengths and type information; sorted keys use codepoint ordering. |
| `nan`, `infinite`, `isnan`, `isinfinite`, `isfinite` | Zero arguments only. `isfinite` means numeric and not infinite: NaN is true, both infinities and all nonnumbers are false. |
| `values`, `strings`, `numbers`, `booleans`, `arrays`, `objects`, `nulls`, `scalars`, `iterables` | Type/value filters; `values` removes null only. |
| `has(key)`, `contains(value)` | Own-key/index existence and recursive containment; array `has` truncates fractional indexes but does not wrap negative indexes. |
| `sort`, `sort_by(f)`, `unique`, `unique_by(f)`, `group_by(f)` | Stable sorting/grouping with recursive jq-style type ordering; key filters may produce multiple values. |
| `add`, `reverse`, `min`, `max`, `min_by(f)`, `max_by(f)` | Array operations; empty `add`, min, and max return null. |
| `any`, `any(f)`, `any(g; f)`, `all`, `all(f)`, `all(g; f)` | Array/object predicates or explicit generator predicates; short-circuiting and empty-generator identities. |
| `join(separator)` | Join array elements or object values in insertion order. Strings pass through, null becomes empty text, numbers/booleans use `tostring`; nested containers error. |
| `first`, `first(f)`, `last`, `last(f)`, `limit(n; f)` | Lazy first/limited consumption; `first(empty)` emits nothing, `last(empty)` emits null; `limit` requires a nonnegative safe integer. |
| `range(end)`, `range(start; end)`, `range(start; end; step)` | Lazily consume argument generators in start/end/step order; finite numeric progression, exclusive end; zero step emits nothing, nonprogress/overflow errors. |
| `tostring`, `tonumber`, `tojson`, `fromjson` | Decimal-preserving JSON conversion; `tonumber` requires a JSON number string or preserves an existing numeric value. |
| `to_entries`, `from_entries`, `with_entries(f)` | Entry conversion and transformation; entry keys must be strings. Key aliases `key`, `Key`, `name`, `Name` select the first value other than false/null; values use the first present `value`/`Value` field, retaining false/null. |

`join` evaluates its separator filter on the original input, once per produced
separator, then emits one complete joined result. An empty separator generator
emits nothing, even for input that otherwise cannot be iterated. An empty
container produces an empty string for each separator result. Separators are
only used between elements: null means no text; other nonstring separator
values error only if a second element exists. Separator evaluation errors still
occur for empty/singleton containers. Argument generators remain lazy under
`first`/`limit`, and outputs preceding later separator errors are retained.
Object-value iteration follows this native build, not just array-only examples.
Numeric conversion retains the documented binary64/decimal-rendering gaps.

JSON object storage and serializers preserve insertion order and own keys
`__proto__`, `constructor`, and `prototype`, without modifying host prototypes.
Duplicate JSON keys keep the last value at their original insertion position.
Sorting uses null, false, true, numbers, strings, arrays, objects in that order;
objects compare sorted key sets before recursively comparing values.
Ordering descends through arrays/objects even when both operands alias the same
container. A nested NaN can therefore make `. < .` true while same-reference
`. == .` remains true. Equality's identity shortcut is deliberately separate
from ordering. Finite values, Unicode key ordering and work/cancellation checks
retain their existing paths; recursive alias comparisons now charge that work.

The pinned numeric profile is `jq-1.7.1-apple`, informed by the jq 1.7 manual
and tagged `jq-1.7.1` `builtin.jq`, `jv.c` and `jv_aux.c`. In particular,
`isfinite` is not JavaScript `Number.isFinite`. Decimal literals keep their
representation on copies; predicates/arithmetic read the binary64 value without
mutating it. A finite decimal overflow such as `1e400` can thus fail `isfinite`
while retaining its literal rendering/comparison representation. Parsed NaN and
arithmetic NaN are numbers and truthy even though both print as null; allocated
literal identity and arithmetic scalar equality need not agree.

## Streaming, limits, and cancellation

Non-slurp input is incrementally decoded/scanned and holds only the current
JSON value, bounded decoder blocks, and the upstream chunk, rather than joining
all stdin. Complete containers/strings and delimited scalar values are evaluated
before EOF. Slurp and collector filters intentionally materialize bounded arrays.
The byte parser distinguishes quoted strings, escapes, numeric tokens and BOM
state across chunks and JSON file boundaries. The initial JSON BOM is accepted;
later/malformed BOM handling follows the bounded frozen profile. Invalid UTF-8
inside data strings is replaced using native-profile grouping. Lone escaped low
surrogates become replacement characters; unpaired high surrogates error. Raw
input repairs malformed UTF-8 with per-file decoder boundaries and retains BOM
as text. Program files still require valid UTF-8. Original input bytes and
repaired/escaped value bytes are charged separately. These are the delivered
grammar handoff's behaviors, not new decoder or recovery changes in this batch.

Raw record mode emits each LF-completed record before EOF and awaits stdout
before advancing the decoder or reading more input. Raw slurp intentionally
waits for all sources. `maxValueBytes` counts the compact JSON representation
of each raw record or the entire slurped string (quotes and escaped control
characters included), even with raw output. Raw strings do not consume an
array-collection slot per line. The existing cumulative input, output, result,
work, source, AST, and collection limits still apply; `-j` removes only the
output delimiter byte, not result accounting.

All fields of `JqLimits` are readonly numbers:

| Limit | Default | Scope |
| --- | ---: | --- |
| `maxInputBytes` | 67,108,864 | Cumulative stdin/data-file chunks; also a separate aggregate argv-byte cap. |
| `maxValueBytes` | 8,388,608 | Each encoded input value, compact serialized value, materialized result collection, accumulated sort keys, and aggregate variable payload. |
| `maxOutputBytes` | 16,777,216 | Total stdout bytes, including indentation, raw output, and line endings. |
| `maxSourceBytes` | 65,536 | Filter source, inline or from a program file. |
| `maxDepth` | 128 | JSON container nesting, including constructed values. Hard configuration ceiling: 256. |
| `maxAstDepth` | 64 | Parser recursion and final AST depth. Hard configuration ceiling: 128. |
| `maxSteps` | 1,000,000 | Evaluation, validation, traversal/comparison, decoder/scanner, and generator work; includes hidden expansion without stdout. |
| `maxResults` | 100,000 | Number of values emitted to stdout. |
| `maxCollectionSize` | 100,000 | Array/object/collector/path-list lengths and argv count. |

Limits must be positive safe integers. Limit errors cannot be swallowed with
`?`. Exact compact accounting includes delimiters: `[0]` costs 3 bytes and
`{"a":0}` costs 7. Negative zero is retained as `-0`. Diagnostic output is
separate from stdout limits, limited to one message of at most 1,000 UTF-16 code
units plus the `jq: ` prefix and LF (at most 4,005 UTF-8 bytes).

These are logical work/value limits, not an exact resident-memory or wall-clock
quota. Object copies, path storage, UTF-16 strings, and serializer scratch space
have bounded overhead beyond their compact byte sizes. Whole input chunks are
charged before processing, so over-limit chunking may affect how much earlier
output was already emitted. Upstream allocations remain the host's responsibility.

The interpreter checks `AbortSignal` during work and yields to the event loop
after roughly 1,024 charged steps at cooperative checkpoints. Command byte I/O
uses the shared `readBytes`/`writeBytes` cancellation helpers; filesystem reads
receive the same signal, with explicit `maxBytes` for `readFile` fallback.
Stalled reads/writes/iterator cleanup stop waiting on abort and late rejections
are observed. Synchronous builtins are bounded but not preemptible, and an
uncooperative host operation cannot be forcibly terminated or undone. Callers
should supply a deadline signal when they require a wall-clock deadline.

## Deliberate gaps

- Not the entire jq language: no user definitions/modules, `as` binding,
  recursion, labels/break, interpolation,
  regex/date/math libraries, formats such as `@csv`, or arbitrary jq builtins.
- Assignment paths do not include slices, piped selections, optional paths, or
  computed object/array constructions. These are compilation errors, not silent
  approximations. Ordinary reads can still use pipes and slices.
- Slice endpoints are integer-only even though native jq accepts some fractional
  bounds. `limit` count and additional function overloads are likewise restricted
  to the documented signatures.
- Numeric literals retain decimal precision and scale, with normalized decimal
  exponent spelling. Arithmetic, numeric `length`, and unary minus convert to
  binary64; mixed literal/computed comparisons also use binary64. See the
  version-pinned numeric checkpoints below. Input numeric tokens include the
  frozen nonstandard NaN/infinity spellings, leading zeroes, leading plus and
  trailing decimal points; quoted lookalikes remain strings. Filter numeric
  grammar is narrower, accepting leading zeroes/trailing decimal points and
  `nan`/`infinite` builtins, not every data-token spelling. This is not universal
  numeric parity across jq builds, arbitrary exponent workloads or all math.
- Invalid input syntax stops the command, unlike recoverable filter errors.
  Diagnostic and exit-state parity is limited to the pinned, recorded profile.
- No streaming path-event mode, colors, sorted-output flag,
  file-variable flags, jq environment builtins, or host process/file access.

## Source-author verification evidence

The following sections retain historical checkpoints, not current aggregate
acceptance. Later grammar work supersedes their strict-decoder, stop-first and
nonfinite-rejection statements. The two review fixes and unchanged-cohort
evidence are recorded in
`tests/commands/structured-stress/jq-grammar-review-fixes/REPORT.md`; a different
independent reviewer completed source acceptance and separate test-only updates
(`95966ca`/`1d93186`, native `50434b3`, host `538a7f8`, seal `c0055e1`). See
`tests/commands/structured-stress/jq-grammar-final-review/REPORT.md` for unchanged
source/compiled 1344/1344 pre/post and
`tests/commands/structured-stress/jq-grammar-seal-final/REPORT.md` (`ea11ceb`) for
3758/3758 structured tests and scoped typecheck success; its global typecheck
retains 14 unowned WebDAV consumer errors. These are prior independent results,
not reruns for this documentation update. No self-acceptance or full-jq claim.

Verified August 26, 2026 against the local native oracle `jq-1.7.1-apple` and
the primary [jq 1.8 manual](https://jqlang.org/manual/v1.8/). The manual is a
language reference, not evidence that this subset implements jq 1.8 in full.

```sh
node --unhandled-rejections=strict --import tsx --test 'tests/commands/structured/*.test.ts'
npm run typecheck
npm run build
```

At this implementation checkpoint all 147 focused tests pass, with no skips;
global build and owned-source/test strict typechecking pass. An earlier global
typecheck passed, but the final rerun encountered other workers' newly added
`tests/commands/bytes/checksums/helpers.ts` and
`tests/commands/bytes/encoding/helpers.ts`, whose corresponding source indexes
were not yet present (TS2307). Those files were not changed by this worker.
The suite includes 88 fixed native-oracle
cases and 210 seeded differential comparisons (seed `0x5a17c0de`), CLI/status
cases, every two-way UTF-8 split, prototype keys, exact limits, hidden Cartesian
expansion, and cancellation/late-rejection checks. Oracle subprocesses exist
only in tests, with 2-second/512-KiB bounds; absent jq causes an explicit oracle
test skip, not an assumed pass. Hazardous source/input/allocation/expansion and
CPU cancellation cases run in killable test children with 1-second deadlines.
The 11-test streaming/cancellation suite also passed 20 separate repetitions
with `--unhandled-rejections=strict`; the built subtree ESM import passed.

Actual Shell tests register both plugins and verify:

```sh
printf '%s\n' '{"a":1}' '{"a":2}' | jq -c '.a' | jq -sc 'add'
jq -nc 'range(1000000000)' | head -n 1
```

These produce `3\n` and `0\n` respectively, status 0. Relative virtual `-f`
pipelines, signal propagation, stalled host operations, and early pipe closure
are exercised. These source-author functional checks are not a broad performance
comparison. Independent stress evidence is recorded separately below.

## Independent stress verification

The independent stress/fix worker captured native expectations without consulting
virtual outputs, then recorded failing regressions before changing source. The
initial gate failed all 18 targeted cases; the 203-case broader corpus exposed
two more failures. A separate read-only reviewer supplied 19 additional failing
cases, independently rechecked against native jq before fixes.

The fixes cover read/index and assignment traversal order, lazy slice/range
arguments, absent-path and root deletion, `from_entries` key fallback,
`last(empty)`, and `$ARGS` ordering/binding. Public signatures and dependencies
are unchanged. The earlier explicit-ARGS override statement was incorrect and
is corrected above; it is not a native jq compatibility guarantee across builds.

The new suite is native-independent: 240 frozen native stdout/status fixtures
(18 initial + 203 corpus + 19 reviewer), with separate preflight, invalid JSON,
UTF-8, resource, cancellation, seeded chunking, and real MemoryFS pipeline tests.
Native jq is only required by the optional `verify-native.ts` command. Runtime
error wording is project-specific and is not native-byte-matched. See
`tests/commands/structured-stress/README.md` for reproduction and gate results.

At that historical checkpoint object overloads of `any`/`all` and decimal
rendering remained deferred; the later fixes below address them. Fractional
slice endpoints and other listed grammar gaps remain. Strict malformed JSON/UTF-8 rejection is intentional even
where this native build accepts nonstandard input. These tests establish neither
full jq parity nor superiority to jq or just-bash.

## Focused capability author increment

The subsequent author increment adds raw input (`-R`/`--raw-input`), join output
(`-j`/`--join-output`), and `join(separator)`, without other builtins, grammar,
dependencies, or exported signature changes. The two capability commits include
their native-derived regressions and documentation. Native processes are only
optional test capture/replay tools; new committed tests always run without jq.

Author verification: 684/684 combined structured tests, 537/537 native-free
stress tests with no skips, scoped/global typechecks, and global build pass.
New captures comprise 74 raw-input and 129 join rows, not distinct categories:
187 match native output/status, while 16 separately document existing safety or
numeric policies (12 invalid UTF-8, one stop-on-first runtime error, three
numeric rendering cases). The original 240 frozen references remain unchanged
and pass. All ten earlier semantic fixes remain covered. No separate-worker
final acceptance is claimed; the root will assign a verifier after this handoff.

## Quantifier regression fix (August 26, 2026)

`any` and `all` now iterate object values in insertion order as well as arrays.
All three jq overloads are accepted: no arguments, a condition, and
`any(generator; condition)` / `all(generator; condition)`. Empty conditions
produce no candidates; empty generators give false for `any` and true for
`all`. Both generator and condition short-circuit without evaluating later
errors. Shared quotas and cancellation still propagate through `?`.

Exact frozen jq-1.7.1-apple regression reproduction:

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/structured-stress/independent-increment/quantifier-fixes.test.ts
```

The focused gate passes 30/30 tests, including 27 exact native vectors and
quota/cancellation checks; the existing owned suite still passes 684/684.
The complete 155-case matrix moves from 55 exact / 92 stdout-status differences
/ 8 diagnostic-only to 75 / 72 / 8. This fixes the independently frozen
quantifier categories, not the numeric,
Unicode, or error-continuation categories. It is not a full parity claim.

## Decimal regression fix (August 26, 2026)

The numeric representation now distinguishes parsed decimals from computed
binary64 values. JSON input, filter literals, `--argjson`, `fromjson`, and
`tonumber` preserve significant digits and trailing fractional zeroes. Copies,
updates to unrelated fields, type filters, sorting, conversions and `join`
retain that representation. A decimal remains a jq number, not an iterable
object; the internal representation is not a new package export.

Decimal spelling is canonicalized rather than blindly retaining the input
token: `12.3400` stays `12.3400`, `42e+02` becomes `4.2E+3`, and `1e-400`
becomes `1E-400`. Negative numeric input retains its sign/scale, whereas unary
minus in a filter is arithmetic and converts to a double. Literal/literal
comparisons use sign, coefficient and decimal exponent without rounding;
mixed literal/double comparisons follow the native build's double fallback.

Arithmetic and numeric `length` round the decimal coefficient to 17 significant
digits with ties-to-even before binary64 conversion, matching the inspected
build. Computed values have a separate shortest-double renderer: `1e20+0`
prints `1e+20`, `length` of `0.0000001` prints `1e-07`, and length of
`123456789012345678901234567890` prints `123456789012345680000000000000`.
Computed infinities serialize as the signed largest finite double and computed
NaN as JSON null; division by zero remains an error. A `range` preserves its
literal first value before stepping arithmetically and retains its existing
nonprogress/overflow guard.

These rules are pinned to `/usr/bin/jq`, `jq-1.7.1-apple`, build
`--with-oniguruma=builtin`; they are not claims about every jq version/build.
Primary research used the jq 1.7 manual's Identity discussion and the
`jq-1.7.1` tag's `src/jv.c`, `src/jv_dtoa.c`, `src/jv_print.c`,
`src/decNumber/decContext.c`, and `src/builtin.jq`:

```text
https://jqlang.org/manual/v1.7/
https://github.com/jqlang/jq/tree/jq-1.7.1/src
```

### Numeric safety and acceptance

No dependencies, process spawning, host filesystem access, or eval were added
to the product. Coefficients are bounded strings, not expanded powers or
unbounded BigInts. Exponents are bounded to the native decimal context; an
out-of-range coefficient retains decimal infinity identity for comparisons or
rounds to the minimum exponent without allocating exponent-sized strings.
Overflowed literals still sort beyond finite decimal literals such as `1e400`,
even though both would convert to binary64 infinity. The frozen native
boundary is maximum adjusted exponent `999999999`, minimum coefficient
exponent `-1147483646` for this context. Zeroes retain a clamped scale.

Parsing, decimal comparisons, value accounting and serialization charge
length-proportional work to the existing shared step budget. Evaluation yields
through `Budget.tick`; quotas stay uncatchable through `?`. Byte limits cover
canonical output and all the earlier input/source/output limits still apply.
Tests cover huge exponent text, 100,000-digit coefficients, near-equal long
comparisons, repeated hidden serialization, all numeric token split positions,
generator error ordering, blocked sinks/reads and late rejection observation.
Hazard workers have 128 MiB V8 heaps, five-second deadlines and bounded output.
Limits remain logical, not exact resident-memory accounting. An individual
bounded synchronous parse/comparison/string operation is not preemptible;
cancellation is observed at checks and between yielded evaluation work.

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/structured-stress/independent-increment/numeric-fixes.test.ts tests/commands/structured-stress/independent-increment/numeric-safety.test.ts tests/commands/structured-stress/independent-increment/quantifier-fixes.test.ts tests/commands/structured-stress/independent-increment/safety.test.ts
node --import tsx tests/commands/structured-stress/independent-increment/phase2-report.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/structured-stress/independent-increment/native-regressions.test.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/structured-stress/independent-increment/additive-regressions.test.ts
```

The focused gates pass **202/202**; the existing owned suite remains **684/684**.
The original frozen comparison improves from **55 exact / 92 stdout-status
differences / 8 diagnostic-only** to **117 / 30 / 8 out of 155**. All 53 valid
numeric rows and 21 quantifier rows match exact native bytes. The original
raw gate remains **118 pass / 38 fail**, including its integrity test.
The additive raw gate remains **78 pass / 4 fail** (81 vectors plus integrity).
Those four are diagnostic mismatches in incorrectly grouped author probes,
retained verbatim alongside separate correctly grouped probes. No failed raw
comparison is skipped, weakened or relabeled as a pass. Detailed categories,
hashes, exact commands and author/final-verifier boundaries are in the stress
README. Public command/plugin signatures and limit option names are unchanged;
numeric output bytes, comparisons, accepted large literals and work charging
intentionally change. Consumers must not expect the old rounded numeric text.

### Historical Unicode and recovery proposal

This preserved proposal predates the delivered grammar handoff. Current decoder,
recovery and diagnostic behavior is described above; this is not a pending
strict-mode policy or evidence that the two-fix batch changed those mechanisms.

Strict UTF-8 and stop-first-error remain the implementation's existing deliberate
deviations, **not user-requested features or compatibility passes**. Standard jq
compatibility should improve in a separately approved change:

- Replace malformed UTF-8 with native-compatible byte-sequence grouping, not
  simply a default TextDecoder. Preserve per-file decoder boundaries while
  allowing raw text records to span files. Match lone-low-surrogate replacement
  and unpaired-high-surrogate rejection separately. Charge original input bytes
  before decoding and repaired/escaped value bytes afterwards, including
  replacement expansion; keep chunk yielding, bounded carry and cancellation.
- Recover from ordinary uncaught filter errors at each top-level input value,
  retaining completed output and evaluating later inputs. Do not recover from
  parse errors, quota exhaustion, cancellation, EPIPE, filesystem failures or
  unexpected host errors. Freeze a separate native exit-state matrix for `-e`,
  empty generators, final errors, later false/null results, slurp and files
  before changing aggregation. Add an approved aggregate diagnostic byte budget
  so repeated errors cannot amplify stderr without bound; retain backpressure.

Any retained strict mode should be an explicitly approved choice, not a silent
claim that jq behavior is unsupported by user request. No decoder/recovery
policy, new public switch, broad grammar feature or diagnostic format changes
are part of this fix. A different independent final verifier is still required.

## Literal split integration (August 26, 2026)

`split(separator)` is now registered with exactly one argument. Separators are
evaluated lazily on the original input, in generator order; input validation
occurs only for a produced separator. Empty input yields `[]`; an empty separator
splits Unicode code points, not UTF-16 units or grapheme clusters. Nonempty
separators match literally and non-overlapping, preserving empty fields and NUL.
Non-string operands, including null, error. No two-argument regex overload,
grammar broadening, decoder/recovery policy, public plugin API, limit names,
runtime dependencies, host process execution or eval were added.

The helper charges linear matching/preprocessing work, collection size and
encoded aggregate value bytes; the command writer retains output/result budgets.
Cancellation yields during scanning, preprocessing and code-point expansion;
optional filters cannot suppress cancellation or quota exhaustion. Synchronous
validation and individual allocations remain non-preemptible.

Verified: helper **67/67**, command **81/81**, six-backend aggregate interop
**6/6**, existing author suite **684/684**, numeric/quantifier regressions
**202/202**, and scoped strict TypeScript checks. All **69/69** pinned native
recaptures match exact stdout/stderr/status. Product comparison is **44 exact,
25 diagnostic-only, zero stdout/status differences**; virtual error decoration
is not claimed as native-byte parity. An obsolete author test rejecting split/1
now checks the deliberately unsupported split/2 instead.

Common flow: `jq -R -s 'split("\n") | map(select(length > 0))'`, with stdin
`alpha\nbeta\n`, emits the native pretty-printed `["alpha","beta"]` array.
Memory, real, mock S3, loopback WebDAV, mount and overlay tests also read named
files, pipe `cat`, persist/reopen JSON, and run `find | xargs rg | sed | awk | jq`
with this filter. These are actual aggregate-plugin/virtual-filesystem tests,
not helper results labeled as interoperability.

The original 6a259ff matrix assertions now pass **71/79**: split is fixed, but
six ENOENT and two EROFS diagnostic expectations still differ. Another worker's
`d0fed8f` changes those expectations; that revised live matrix passes **79/79**.
Neither its expectation changes nor its diagnostic acceptance are this worker's
fix. The original assertions remain separately reproduced, without editing the
matrix. Exact commands, hashes, provenance and root/Poincare handoff are in
`tests/commands/structured-stress/split-increment/README.md`. Broader native raw
gates remain **196 pass / 42 fail**; this is not full jq or shell parity.
