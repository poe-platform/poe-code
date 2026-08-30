# yq query-gap v1: fixed-baseline source diagnosis

Status: sealed static diagnosis for root choice, dated 2026-08-28. This packet
does not authorize or implement yq, YAML, query, CLI, limit, or counter behavior.
All examples are illustrative and **not executed**. Line numbers bind commit
`5137a74ec855a32d8a8860eb66b62eb44d11e290`; the read live files have identical
SHA-256 bytes. `evidence.json` records identities and classifications.

Symbols below describe existing jq limits, not proposed yq numbers: `S` source
bytes, `M` value bytes, `O` output bytes, `D` value depth, `A_d` AST depth, `C`
collection members, `W` steps, and `R` outward results. Existing defaults are at
`src/commands/structured/limits.ts:20-25`; adopting them for yq remains unapproved.

## Finding A — finite compiler, missing general work/checkpoint accounting

Illustration: query `[.,.,.,.]`, input `null`. Parser support comes from array
primary `parser.ts:142-143`, comma precedence `parser.ts:19-23`, and expression
construction `parser.ts:116-131`. Classification: supported by source; not run.

Control/data path:

1. `parser.ts:79-82` scans `Buffer.byteLength(source)`, rejects above `S`, then
   calls synchronous `tokenize`.
2. `parser.ts:33-66` scans and appends tokens. The number/name/symbol paths call
   `source.slice(offset)` at `:55-63`; they do not call `Budget.step/tick` and
   cannot await. Every loop consumes at least one UTF-16 code unit or throws.
3. `parser.ts:116-190` consumes tokens and allocates AST nodes. Only a numeric
   literal calls `decimalNumber(..., budget)` at `:163-164`; ordinary tokens and
   AST construction do not charge or yield. Assignment validation can rescan an
   existing path through `isPath` (`:68-77`, called at `:125-126`).
4. `parser.ts:191-220` performs a second synchronous AST walk with no charge or
   checkpoint. Error diagnostics rescan/split source at `:90-101`; retained
   diagnostic bytes are checked only after each message at `:201-205`.

This is not unbounded compilation. Let `T` be token count. UTF-8 byte admission
implies `source.length <= S`; each token consumes at least one code unit, so
`T <= S + 1` including end. The grammar creates constant AST nodes per consumed
token (a conservative structural bound is `nodes <= 3T + 1`), and AST depth is
checked at `:113-118` and `:193-218`. There is no independent AST-node limit.
Suffix regex scans, repeated `isPath`, and per-error source diagnostics can make
uncharged source work quadratic in `S`; token/AST/pending storage remains `O(S)`,
while retained errors are bounded by `O`. A finite 64 KiB traversal is therefore
neither an unbounded resource bomb nor a cooperative-preemption guarantee.

Minimal choices: no parser change is needed for a qualified initial profile that
claims only source/depth bounds. If exact compile work is later required, the
smallest compatible extension is an optional synchronous token/AST guard whose
default is absent; yq can charge/check cancellation. It still cannot yield.
Making compilation cooperatively yield requires an async compiler entry point and
is a deliberate signature/control-flow change, not a prerequisite to the initial
profile. Existing seams are `resources.test.ts:47-58` (“depth limits cover inputs,
constructed outputs, and source AST”), `:79-91` (“input, source, output, slurp and
result budgets enforce boundary values”), and `cli.test.ts:76-87` (“compile errors
precede stdin iterator creation and data-file effects”).

## Finding B — string `length` materializes an uncharged transient collection

Illustration: query `length`, input `"abc"`, result conceptually `3`. The function
table admits `length/0` at `parser.ts:24-32`; calls are built at `:166-172`.
Classification: supported by source; expected result is illustrative, not run.

`Interpreter.run` charges one async tick on AST entry (`interpreter.ts:24-26`) and
dispatches the call (`:95`). For a string, `length` executes
`Array.from(input).length` at `interpreter.ts:210-217`. The array allocation occurs
without `budget.collection`, `budget.value`, a per-code-point `step/tick`, or a
preallocation guard; the small numeric result is yielded directly. Existing input
or prior-result validation bounds the string to `M` UTF-8 bytes through
`limits.ts:69-98`, hence code-point count `N <= M`. The operation is finite for a
fixed invocation, but it turns one scalar graph node into `N` transient array
entries. Because `M` and `C` are independent configurable limits, `C` does not
bound this allocation and `N/C` is not globally bounded across configurations.
No source proof establishes JS heap or RSS bytes per entry.

Contrast: string multiplication is not this gap. `values.ts:118-125` rejects a
non-finite count or byte product above `M` before calling `text.repeat`; repeated
copies are bounded by `M`. String concatenation at `values.ts:101-107` does check
after forming `left + right` and evaluates concatenation twice in source, but two
individually bounded strings give finite at-most-`2M` encoded payload before the
`M` check. That is a finite postallocation factor, not the selected missing
collection-size bound.

External source/AST/input-graph/result admission cannot type-safely close the
`Array.from` operation: a filter can derive a string before `length`. A static AST
subprofile can reject every `length` call, but that also rejects safe null/number/
array/object cases and is a deliberate jq-dialect reduction. The smallest local
allocation fix is to count code points with a non-collecting loop in only the
string branch. Keeping that loop uncharged preserves current accepted results and
limit outcomes by default; adding `step`, `collection`, or checkpoints changes
limit/cancellation behavior and requires separate approval (or an optional guard
whose absent default preserves jq). Regression seams are
`semantics.test.ts:28,98-102` (`semantic matrix 22: length,.[1:2]`) and
`resources.test.ts:60-77` (“limits protect hidden Cartesian expansion,
collections, and emitted results”).

## Finding C — JSON encoding is byte-bounded but retains whole representations

Illustration: query `.`, input `[[["x"]]]`. Identity is built at
`parser.ts:133-140`; JSON arrays/strings are built at `input.ts:49-159` and the
completed graph is validated at `:104-110`. Classification: supported by source;
not run.

Before output, `jq.ts:169-175` ticks, validates the result graph, checks `R`, and
passes remaining output bytes into `stringify`. `input.ts:290-316` retains every
encoded fragment in `parts`, checks cumulative UTF-8 bytes before `parts.push`,
then joins all parts into a second whole string. `jq.ts:175-180` retains that text,
forms the suffixed text, converts it to a UTF-8 `Buffer`, checks its size, and only
then awaits the sink. Pretty indentation is created at `input.ts:307,312`.

Let `E <= O` be the admitted encoded document bytes and `s` the 0/1-byte suffix.
At the language-representation level, the stringify phase retains at most `E`
fragment payload plus an `E` joined string; the caller phase can retain the `E`
text, an `E+s` template result, and an `E+s` byte buffer. Thus a conservative
payload envelope is `M + max(2E, 3E+2s)`, excluding array/object/string metadata,
allocator slack, ropes, GC lag, and encoder internals. It is not an RSS bound.
For `d` nested singleton arrays around a scalar whose JSON length is `q`, compact
length is `2d+q`, while the current two-space pretty form is `2d^2+4d+q`; `D`
and `O` still bound it. An over-limit indentation fragment is itself allocated
before `append`, but its length is at most `2D+1`; scalar/key fragments are bounded
by the already validated graph. This is finite retained amplification, not a
genuine missing document-size bound.

An `append` callback that still returns a string does not lower this peak. The
minimal compatible extension is a separate count-then-chunk JSON encoder entry
point, leaving `stringify` as the default existing jq path. Alternatively yq can
own that bounded JSON encoder without touching `input.ts`. A future YAML encoder
is distinct code and does not prove reuse or safety of the JSON encoder. Neither
choice supplies whole-engine leases or RSS accounting. Existing seams are
`resources.test.ts:9-19` (“compact JSON byte accounting is exact at container
boundaries”), `cli.test.ts:35,41-44` (`CLI stream/status matrix 26`, pretty output),
and `streaming.test.ts:20-29` (“non-slurp emits before EOF and honors output
backpressure”).

## Minimal root choice

A truthful initial profile can use one compile and one invocation-wide existing
`Budget`, plus yq-owned admission for source, YAML/JSON input bytes and graphs,
outward result graphs/count, and encoded output. It may claim finite cap-derived
resource bounds and existing query steps/results. It must explicitly disclaim
exact compiler work, fail-before-allocation, retained-heap/RSS, and hard
preemption. On that qualified profile, no four-file parser/interpreter/budget/input
rewrite is a prerequisite.

If root requires closure of the diagnosed `length` allocation, the concrete
prerequisite is only that string branch: either approve the non-collecting local
implementation, or have the private adapter reject `length` during static AST
admission. The latter is a deliberate behavior change. This narrow diagnosis is
not a whole-engine no-transient-allocation proof. String repeat is not this
blocker. Public `eval-all`, slurp, numeric/counter rules, YAML parser/encoder work,
writes, and broader query semantics remain unratified and outside this packet.
