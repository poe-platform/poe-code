# yq query adapter v1: design-only pre-freeze proposal

Status: proposed for a different root pre-code freeze; no implementation or test
exists. The original `evidence.json` is frozen. This packet is static source
inspection, not native/reference/product behavior proof.

## Settled policy and proposed CLI

The settled profile is restricted YAML 1.2 Core only: real collections/scalars,
block scalars, streams, bounded backward aliases, string keys, and rejection of
duplicates, cycles/forward aliases, merge keys, custom tags, non-finite numbers,
and unsafe integral values. YAML is the default output; `-o json` selects JSON.
The query language is the existing bounded jq dialect, not full Mike Farah yq.
Schema selection and all writes are refused.

The following CLI details are **proposals awaiting freeze**, despite their exact
wording here:

```text
yq [eval|e] [FLAGS] [--] [FILTER [FILE...]]
yq eval-all|ea [FLAGS] [--] [FILTER [FILE...]]
FLAGS := -p F | --input-format F | --input-format=F
       | -o F | --output-format F | --output-format=F
       | -I N | --indent N | --indent=N
       | -c | --compact-output | -r | --unwrapScalar
       | -e | --exit-status | -s | --slurp | -n | --null-input
F(input) := auto|yaml|json; F(output) := yaml|json
```

An optional command name is recognized only at argv position zero; otherwise
`eval` is implicit. Options then precede operands. `--` ends option recognition,
not operand roles. Short flags do not cluster and attached short operands are
refused. Unknown/duplicate value options, missing operands, schema flags
(`--yaml-schema` in any form), and `-i`, `--inplace`, `--in-place`, or
`--allow-lossy-write` return usage status 2 before input acquisition.

The first operand is always FILTER; it defaults to `.` only when absent. Therefore
`yq data.yaml` treats `data.yaml` as a filter; files require `yq . data.yaml`.
No files means stdin. `-` is a file operand and may occur once among named files.
`-n` evaluates once against null and refuses files, `-s`, and `eval-all`.
`eval` runs once per composed document; `-s` runs once against one array of all
documents. `eval-all` is a Mike-Farah-style *name only*: in this jq-shaped profile
it is exactly forced slurp and refuses `-s`; it does not expose Mike Farah document
context/operators. Input `auto` selects JSON only for named `.json` operands and
YAML otherwise; stdin is YAML.

`-c` and `-r` require JSON output. Raw mode emits only string results unquoted;
other values use JSON. Each query yield is one output document, not one result per
input document: zero yields produce no bytes; many yields from one input produce
many documents. Ordering is operand, input-document, then generator-yield order.
YAML has no directive/header, places `---\n` before every result after the first,
and ends each result with LF. JSON/raw emits each result followed by LF. An explicit
empty YAML document is null; an empty stream has no input document. Slurp/eval-all
has one array input and its yields still follow the same output rule.

Every input and yielded graph is recursively validated before query/encoding.
Only finite numbers are accepted; every mathematically integral `number` or
`Decimal.double` must be a safe integer. CLI/VFS errors are 2, query compile errors
3, no result under `-e` is 4, and YAML composition/query runtime/validation/limit
errors are 5. `-e` otherwise uses the final global yielded result (false/null: 1;
other: 0). Caller cancellation, stdout/stderr sink failure, EPIPE, and escaping
cleanup/control failures are not mapped to status.

## Smallest private adapter

The smallest candidate is one new internal file, with no barrel/root export and
no jq move or evaluator copy:

```ts
// proposed: src/commands/structured/query-core.ts
export type QueryValue = Json;
export type QueryObject = Record<string, QueryValue>;
export interface CompiledQuery { readonly _ast: Ast }
export interface QueryCoreOptions {
  readonly signal: AbortSignal;
  readonly limits: JqLimits;
  readonly variables?: ReadonlyMap<string, QueryValue>;
}
export interface QueryCore {
  readonly budget: Budget;
  object(): QueryObject;
  put(target: QueryObject, key: string, value: QueryValue): void;
  number(canonicalLexeme: string): number | Decimal;
  compileOnce(source: string): Promise<CompiledQuery>;
  run(program: CompiledQuery, input: QueryValue): AsyncGenerator<QueryValue>;
  measure(value: QueryValue): number;
  encodeJson(value: QueryValue, pretty: boolean, maxBytes: number): string;
}
export function createQueryCore(options: QueryCoreOptions): QueryCore;
```

It directly imports `parse`, `Interpreter`, `Budget`, `object`/`put`,
`decimalNumber`, and `stringify`. One session owns one Budget and variable map;
`compileOnce` rejects a second call, asynchronously prechecks source/cancellation,
then calls `parse` once. One Interpreter and AST serve every input document.
`run` closes its iterator in `finally`, charges `tick()` and `value()`, increments
and checks `budget.results` before each outward yield, and never creates a Budget
per document. The yq consumer must finish/encode a yielded value before requesting
the next. A JqError crosses with phase metadata for the command to map; the adapter
does not catch cancellation reasons or sink errors.

`QueryValue` is exactly existing `Json`: null, Boolean, string, number/Decimal,
array, or ordered object. Objects are null-prototype identities created by
`object()` and populated by `put()`; key order is insertion order and aliases are
distinct deep copies. Parser-local raw YAML lexemes are not query nodes. Accepted
numbers are converted through `decimalNumber(canonicalLexeme, budget)`; Decimal
retains normalized `.text` plus binary64 `.double`, not original spelling. Raw
lexeme/style metadata is discarded after composition. Inputs and yielded values
are borrowed, mutation-forbidden graphs for the duration of each call.

The yq tokenizer/composer, not existing `jsonValues`, owns both YAML and strict
JSON input. Static inspection shows the jq JSON path replaces malformed UTF-8 and
overwrites duplicate object keys, whereas this profile requires fatal decoding
and duplicate rejection. Any retained fragment from `readBytes` is copied before
advancing its producer; a `subarray` view is not retained as owned input.

Actual baseline charging is narrower than the desired contract: `Budget.step()`
checks cancellation and monotonic `maxSteps`; `tick()` adds one step and yields
after the private counter crosses 1,024; `value()` walks and charges one step per
node while bounding depth/value bytes; Interpreter `run()` ticks per AST visit and
selected loops; jq itself increments `results` after a yield; `stringify()` steps
per node while buffering parts. `parse()` bounds source/AST depth and charges
numeric literals, but its tokenizer/general compiler traversal neither charges
work nor yields.

## Blockers and approval-gated minimum extension

The narrow adapter is sufficient for evaluator reuse, compile-once, and monotonic
existing query steps/results. It is **not** sufficient to claim the sealed global
accounting contract. `Budget.steps`/yield threshold are private; synchronous
`parse()` cannot cooperatively yield; the parser allocates tokens/AST before a
general work admission; Interpreter sometimes copies arrays/objects or builds
collections before `value()`/`collection()`; `stringify()` allocates a full parts
list/string; and there is no retained-byte/node lease API. An adapter cannot see
or pre-admit those operations without duplicating evaluation.

If root requires those guarantees, the minimum future extension needs separate
approval for edits to `limits.ts`, `parser.ts`, `interpreter.ts`, and `input.ts`:
an injected `QueryAccounting` with synchronous `reserveWork`, pre-allocation
`reserve(kind, bytes, nodes)`/idempotent `release`, `reserveResult`, and async
`checkpoint`; async compiler checkpoints; allocation hooks before evaluator
copies/collects; and a count-then-chunk JSON encoder. It adds no deadline/runtime
Budget API. Existing jq behavior and tests must remain unchanged. Until frozen,
yq must not claim exact global work, allocation, or yield guarantees.

The exact proposed implementation write-set for that later freeze is new files
`src/commands/structured/query-core.ts`, `src/commands/yq/index.ts`,
`src/commands/yq/options.ts`, `src/commands/yq/accounting.ts`,
`src/commands/yq/yaml-parser.ts`, `src/commands/yq/yaml-compose.ts`,
`src/commands/yq/yaml-encoder.ts`, `src/commands/yq/command.ts`, and
`tests/commands/yq.test.ts`; plus only the four approval-gated structured edits
named above if the stronger guarantees are selected. No jq.ts, contract, root
export, package export, dependency, or default/aggregate-registration edit is in
that set. The proposed family entry point in `src/commands/yq/index.ts` is:

```ts
export interface YqCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<YqLimits>;
}
export interface YqLimits { /* the separately frozen counters below */ }
export function createYqCommand(options?: YqCommandsOptions): CommandDefinition;
export function createYqCommands(options?: YqCommandsOptions): readonly CommandDefinition[];
export function yqCommands(options?: YqCommandsOptions): VirtualShellPlugin;
```

This internal family API is itself a freeze proposal, not an exposed or supported
capability. Any later root/package export or aggregate registration belongs to its
integration owner and requires separate approval and inventory synchronization.

## Accounting and I/O proposal (all numbers non-normative)

Starting points only: cumulative input 64 MiB; raw/composed value 8 MiB; scalar
1 MiB; source 64 KiB; depths 128/64; 1,000,000 shared work units; 100,000 shared
results/collection items; 1,024 documents/anchors/aliases; 100,000 composed plus
alias-copy nodes per document; 64 MiB simultaneously retained logical bytes; and
16 MiB combined stdout/stderr with a 4 KiB diagnostic reserve. Reset lifetime is
exactly one command invocation, across every operand/document, slurp array,
alias copy, query result, validation/count pass, and encode pass.

Proposed counter rules are also awaiting freeze. Raw input and source use exact
received UTF-8 byte counts; argv/filter use `Buffer.byteLength`. Parser work adds
one unit per decoded code point, token, composed node, and copied alias node, plus
one per 1,024 copied scalar UTF-8 bytes. Compiler work adds one per source code
point, token, and AST node. Query work remains every actual existing
`Budget.step(count)` unit rather than an invented instruction count. Result count
is incremented once before each outward generator yield. Validation and both
count/encode passes add one work unit per visited node and one per 1,024 emitted
UTF-8 bytes. All counters use checked safe-integer addition and fail before the
operation whose addition would exceed its maximum; none reset at file/document,
parser, compiler, interpreter, result, or encoder boundaries.

The freeze must separately seal parser bytes/code points/tokens/nodes; compiler
source/tokens/AST; interpreter actions/results/collections; encoder validation,
count, separators/newlines/raw bytes; and accounting overflow/error labels. Alias
subtree bytes and nodes are cached on a completed anchor and both reserved before
each deep-copy allocation. No forward/current anchor can supply a cache.

Retained logical bytes count owned raw chunks, incremental decoded UTF-8 text,
token/graph storage, composed-expanded value, current yielded result, encoder
buffer, and the whole slurp array simultaneously; leases release only when the
representation is unreachable. This is a deterministic logical ledger, not JS
heap/RSS. Streaming bounds cumulative input but YAML necessarily retains a whole
current document; slurp necessarily retains all documents. Use `readStream` when
truthfully available. A fallback calls `readFile(...,{maxBytes: remaining})` and
checks the returned length, but cannot promise the provider did not allocate an
unbounded result before honoring/rejecting that request.

Before each document write, validate/count the entire encoded document including
its separator and trailing LF; admit it only if stdout bytes plus the document plus
the untouched diagnostic reserve fit the combined maximum. Thus a discovered
limit writes none of that document. Physical sink failure may still leave a
partial write. Diagnostics are UTF-8, LF-terminated, input-free, and admitted
all-or-nothing from the reserve; if the preferred message does not fit, emit the
fixed `yq: limit: maxOutputBytes\n` fallback if possible. Every stdout, separator,
newline, raw byte, and stderr byte decrements the same ledger.

## Cancellation, cleanup, and prospective matrix

The command registers one idempotent close synchronously before iterator/output
acquisition and uses it from `finally`; admission closes first and admitted
cooperative iterators/resources drain before settlement. Stdout and stderr owned
operations are siblings so closing stdout does not cancel stderr or other work.
Check the borrowed signal at every awaited I/O and proposed checkpoint. Preserve
existing precedence: root-caller reason, escaping execution/control failure,
cleanup failure, then numeric outcome. Completed effects remain; opaque or
unenrolled host work is observed but not preempted or promoted to a cleanup
barrier. No local timeout/deadline is proposed.

Prospective, unimplemented cases: implicit/e/eval and ea/eval-all argv boundaries;
`--` and leading-dash filter/file; every refused schema/write spelling; Core scalar
boundaries, duplicates/tags/merge; backward/missing/forward/cyclic/exponential
aliases; multi-file/multi-doc/empty/slurp and zero/many query yields; ordered
dangerous keys and Decimal boundaries; compile-once/shared-counter exhaustion;
all retained representations and pre-allocation refusal; UTF-8/chunk reuse;
count-before-write, reserve exhaustion, backpressure/partial sink failure; exact
cancellation reason, cleanup order, and nonsettling opaque host qualification.

Primary scope sources: [YAML 1.2.2](https://yaml.org/spec/1.2.2/), the historical
[YAML 1.1 merge type](https://yaml.org/type/merge.html), and pinned Mike Farah
[v4.53.3 root source](https://github.com/mikefarah/yq/blob/v4.53.3/cmd/root.go)
for naming comparison only. These citations and source inspection are not native
proof or a latest/parity claim.
