# NP1-CJS v1 — candidate contract, not implementation

2026-08-28. ROOT selects this first slice, not original NP1 completion. All names
below are **proposed**, not exports or measured provider features. Optional injected
qualifying provider; zero command/core runtime dependencies. No bundled Node/version
claim, host subprocess/eval/native fallback, autoload/deep import, engine/export/private
modification. Node22.15.0 is a comparison baseline, not a compatibility certificate
(BINDINGS D1–D8). Original36 remain unrun; CASE-MAPPING is not a new pass denominator.

## 1. Entry and language

Prefix options are `-e SOURCE`, `--eval SOURCE`, `--eval=SOURCE`, corresponding
`-p`/`--print` forms, and one `--input-type commonjs` or `--input-type=commonjs`.
No short-option clustering/attached operands. A selector consumes its next token
literally, including empty or dash-leading text; absence is usage failure. Before
an argument tail, another selector is a conflict, unknown options refuse, and `--`
ends option recognition. After the first non-option tail token, everything is
literal. A file selector ends parsing immediately; following `--inspect` is data.
Bare `--`/no operands/`-` selects stdin source, never REPL. An input-type option
with a file refuses. Only `.cjs` files qualify: `.js`, extensionless, `.mjs`, trailing-
slash entries and other suffixes refuse **before source/stat/package lookup**.
A permitted `.cjs` path resolving to a directory fails EISDIR during authorized
source acquisition; that type cannot be known without an adapter observation.
No package metadata search.

Eval accepts statements; print accepts exactly one expression, not a statement list
or empty input. Print outputs primitive String conversion plus LF: undefined, null,
booleans, strings, numbers including NaN/Infinity; -0 prints0. Objects/functions/
promises refuse, never inspect/coerce them. Eval empty source succeeds without stdin
acquisition. `argv` is [`/virtual/bin/node`, ...tail] for eval/print; insert absolute
virtual filename for file, `-` for stdin. File-only `__filename`/`__dirname` are
immutable virtual strings; absent for inline/stdin. No `module`/`exports` wrapper API.

Closed grammar: strict lexical bindings `let/const/var`, literals (number/string/
boolean/null, dense arrays, own-data object properties/shorthand/computed string
keys), empty statements, blocks, expressions, assignments, if/else, while/do/ordinary for, break/
continue, ordinary/async function declarations/expressions/arrows, calls, return,
throw/try/catch/finally, await **inside async functions only**. Operators: arithmetic
`+ - * / % **`, relational, `=== !== == !=`, `! && || ??`, ternary, `typeof void`,
numeric updates, compound arithmetic assignment, and record-property delete.
Member/index access and parentheses are included; guest functions accept at most16
parameters/arguments, with ordinary missing-argument undefined semantics. Parameter
defaults are deferred. A complete-source syntax allowlist is required, not regex filtering.
Primitive coercions only; object coercion hooks refuse. No destructuring/spread/rest,
for-in/of, classes, regex, generators, templates, accessors, symbols, BigInt, prototype
mutation, dynamic import, ESM/TLA, eval/Function, timers, Buffer, network or packages.
Unlisted syntax refuses at complete-source preflight. Syntax errors use one bounded
diagnostic; no guest effect precedes parsing. Literal unsupported direct `require`
targets refuse at preflight; computed targets refuse at that call, **after earlier
effects**, without constant-folding execution or rollback.

## 2. Exact guest inventory

Arity/type failures are catchable `ERR_VNODE_UNSUPPORTED`. No implicit optional
arguments beyond this table. Module functions are detachable; receiver-sensitive
methods require their actual guest kind. Callbacks are same-session guest functions,
invoked by the evaluator, never host callbacks. Intrinsic objects/members are frozen;
ordinary records, arrays and JSON cache values remain mutable and accounted.
For the version-bound intrinsic route, ordinary calls have the async flag absent;
promise-fs calls deliberately produce guest Promises (async flag true in that ABI).
Promise.resolve/reject/then/catch/finally synchronously return guest Promise objects;
they are not transparently awaited sync results. Constructor and callback support
must be separately qualified; a factory label alone proves none of this.

| Intrinsic | Exact forms and semantics |
|---|---|
| `JSON.parse` | `(string)` only; standard JSON data; malformed input guest SyntaxError. |
| `JSON.stringify` | `(value)` or `(value, undefined, integer0..10)`; JSON-compatible records/dense arrays/primitives; undefined omitted from records, null in arrays, top-level undefined result; nonfinite numbers null. Cycles throw TypeError. Callable `toJSON`, functions elsewhere, accessors and replacers refuse without invocation; noncallable `toJSON` is ordinary data. |
| `Object.keys`, `Object.hasOwn`, `Array.isArray` | `(recordOrArray) -> string[]`, `(recordOrArray,string) -> boolean`, `(value) -> boolean`; own-key ordering: index keys ascending then other keys insertion order. No constructor calls. |
| array members | `.length`; `.push(...values)`0..16 -> length; `.map(callback)` -> dense array, callback(value,index,array), captured initial length; callback mutation allowed subject to dense-array invariant; deleted/missing index refuses, never skips accounting. |
| string members | `.length`, numeric indexing; `.slice(start[,end])` integer indexes; `.trim()`; no regex/locale methods. |
| `Promise` | `new Promise(executor)` with guest resolve/reject functions; static `.resolve(value)`, `.reject(reason)`; instance `.then(onFulfilled[,onRejected])`, `.catch(onRejected)`, `.finally(callback)`; omitted/undefined handlers allowed for then; others require guest functions. Same-session Promise adoption only, not foreign thenables; first settlement wins. |
| guest errors | `Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`: call/new with0 or1 string argument; own name/message, optional adapter code/path/syscall; no host stack/cause/prototype exposure. |
| globals | undefined, NaN, Infinity, above inventory, require, process, console; functions expose name/length only. No global host object or constructor escape. |
| process | guest-owned argv dense string array and env string record copied from explicit exported context; mutations local, no coercing env assignment; cwd()0 -> fixed virtual cwd; execPath fixed; exitCode initially undefined, writable integer0..255; stdin frozen `{fd:0}`, stdout/stderr fd1/2 with write(string) -> true **after awaited sink completion**. No stream/event/callback APIs or exit(). |
| console | log/error0..16 primitives -> undefined; join primitive strings with spaces then LF, no format substitution; stdout/stderr respectively. |
| POSIX path | join/resolve0..16 strings; normalize/dirname/extname/isAbsolute1 string; basename1 string plus optional string suffix; relative2 strings; sep `/`, delimiter `:`, posix self; resolve/relative use invocation cwd. No host path access. |

Own `__proto__`/`constructor` JSON keys are inert, retained, round-trippable data;
they neither invoke setters nor expose constructors. Arrays have only dense indices
and length; growing beyond length, creating holes or extra properties refuses.
No wider interpreter dialect is implicitly admitted.

## 3. Text VFS, modules and grants

`require(string)` accepts only `fs`, `fs/promises`, `path`, `process` and their
`node:` aliases, plus explicit relative/absolute `.json` paths. Aliases share one
guest object; `fs.promises` is the promises module. No directory listing, extension
search, package metadata or local executable modules. JSON resolves from the frozen
entry directory (inline/stdin cwd), not provider-supplied `from`. Cache key is
invocation namespace plus canonical virtual filename. Reauthorize each require;
first successful read produces one guest value, aliases preserve identity, failures
are not cached, subsequent writes do not invalidate it. Resolution consumes quotas.

| API | Finite overloads |
|---|---|
| fs.readFileSync / fs.promises.readFile | `(pathOrZero,'utf8')`, `(pathOrZero,{encoding:'utf8'})`, `(path,{encoding:'utf8',flag:'r'})`; returns string / Promise<string>. Omitted encoding refuses binary output. |
| fs.writeFileSync / fs.promises.writeFile | `(path,string)`, `(path,string,'utf8')`, `(path,string,options)`; options exactly any subset of encoding:'utf8', flag:'w'\|'wx', including empty; returns undefined / Promise<undefined>. |

`undefined` options/fields, null, URL, buffers, other fds/flags/encodings/mode/flush/
signals/callbacks refuse before acquisition; no coercion/getters. `w` creates or
truncates, `wx` requires actual exclusive creation or catchable ENOTSUP **before
mutation**; never check-then-write. Granted read-only VFS yields actual EROFS, not
grant denial. Promise writes are independently admitted; overlapping writes have
no ordering/atomicity guarantee unless the caller awaits sequencing. No rollback.

Grant argument omitted or `{}` denies all; present undefined is invalid. Its only
optional keys are boolean sourceRead/dataRead/dataWrite/jsonModules/stdinRead/
stdoutWrite/stderrWrite. Source file needs sourceRead; stdin source needs sourceRead
AND stdinRead; inline source needs neither. Text paths need dataRead or dataWrite;
JSON requires jsonModules AND dataRead; fd0 needs stdinRead; output needs its named
grant, including diagnostics. Missing authority throws catchable ERR_VNODE_DENIED
at guest calls, or terminal status2 during source admission. Source authority never
implies data authority. Grants bind actual confined namespace/operations, not path
prefixes. Refuse unsupported confinement before source acquisition. No host paths,
ambient env/network, raw FileSystem/CommandContext or provider-invented entry.

Decode UTF8 incrementally with replacement, preserving split sequences and flushing
incomplete tails; bytes are counted **before** decoding. Strip exactly one leading
U+FEFF only from source and JSON-module text; ordinary data preserves BOM, JSON.parse
does not strip it. Encode lone UTF16 surrogates as U+FFFD. No shebang support.
Source stdin owns one stream through EOF; subsequent fd0 reads return empty, never
replay source bytes. Eval/file data stdin is consumed once; concurrent fd0 reads
refuse EBUSY; completed reads thereafter return empty. Retained chunks are copied
before producer advance; trusted producer allocation itself needs qualification.
Any failed/cancelled fd0 acquisition retires that iterator; it cannot be retried or
replayed. The data call can catch ordinary EBUSY/FS errors, not caller cancellation.

## 4. Provider, schemas and ownership

Exact record/union schemas and caps live in BINDINGS.json (normative data, not code).
Validate bounded own data descriptors, required/extra/symbol fields, dense
array lengths and exact primitives before copying or coercion. Cross-realm structural
records pass; accessors/holes/extras/missing/explicit undefined refuse unless the
schema explicitly permits undefined. Proxies/host JS are trusted, not sandboxed by
validation. Invalid guest arguments throw; invalid provider protocol escapes as
TypeError(`NP1-CJS protocol: <schema>`), no host operation or success fallback.
Inherited fields never satisfy required fields; inherited enumerable extras refuse.
Ordinary intrinsic prototypes themselves are not a cross-realm rejection criterion.

Proposed provider lifecycle: register cleanup BEFORE create(scope); prepare(entry,
limits) once; execute(prepared,state,channel) once; drainToQuiescence() after top-level
settlement; stop(control); close() idempotent shared promise. Scope synchronously
registers and tracks acquisition before starting it. Creation/prepare failure,
stop/close failure and late rejection all use that same barrier. Raw reason presence
is separate from value, including undefined; no identity-based origin inference.

Provider owns same-engine evaluator/factory/guest-value validation, prepared-entry
hash/session identity, builtin objects, JSON cache and allocation accounting, including
intrinsic bypass values. Factory is host-supplied, never guest-accessible. Cross-session
values/prepared entries/channels refuse; close retires them. No concurrent reentry
into one session; sync intrinsic suspension retains the guest execution turn; host
completion must not reenter guest. Separate invocations share neither cache nor quota.
Source correction6abfe0bb establishes a possible internal seam, not this lifecycle.
Bridge recipe570e5acc+5aeb915c is independent proof preparation, never CLI coverage.

The required quiescence hook tracks every guest Promise (including async-function
results and unreachable pending promises), runnable reaction, active guest frame and
admitted host operation. Only all-zero pending/runnable/active counts and settled
operations permit success. After each turn, drain FIFO runnable reactions; at the
empty checkpoint select earliest still-unhandled rejection by rejection sequence.
A handler attached before that checkpoint prevents selection. No runnable work but
pending guest promises waits for progress/deadline, then124; event-loop idleness is
not success. If an engine cannot supply this hook and accounting, it cannot qualify.
The execute completion is provisional: print its permitted primitive once before
draining reactions; the quiescence receipt supplies the final exitCode after async
jobs. Never finalize using an exitCode captured before those jobs completed.

Destination closure terminates guest scheduling noncatchably at the failing write,
closes new admission, but does NOT abort admitted sibling file/stderr work or their
signals. Drain them without executing further guest reactions; retain prior effects.
Raw handler rejects the actual destination reason after cleanup. A controlled EPIPE
single-command Shell route yields141/no diagnostic; arbitrary reasons/pipelines
are not universally141. Ordinary guest errors are catchable, caller/control/limits
are not. Selection after cleanup: caller cancellation > first escaping failure
(including destination/contract failure) > local limit > guest error > exitCode/0.
Earlier selected undefined cannot be masked by later cleanup error.

## 5. Admission, accounting and publication

Validate bounded context/CLI, profile/provider/grants; register ownership; reserve
source; obtain/decode source; parse/preflight; allocate guest state; execute; drain;
close; publish result. Caller/control check precedes each admission; then descriptor/
arity validation, bounded path/options, grant, quota reservation, tracking, acquisition.
Failed/denied attempts consume request/work allowances, not nonexistent I/O bytes.
Reserve against remaining capacity with subtraction, safe integers only; overflow
is limit failure. Release only unused reservations/live ownership, never cumulative
work/read/write/output/step counters. No per-call, module, callback or rerun reset.

Accounting table in BINDINGS assigns context, parsing, builtins/JSON, path resolution,
graphs/mutations, pending jobs, error text and output preallocation. Actual VFS calls
must honor bounded read/allocation and exclusive creation; a returned huge buffer
followed by a check is inadequate. No claim bounds existing caller-owned inputs,
provider RSS, hidden native allocations or uncooperative cleanup duration. Required
hard admission concerns owned allocations/operations. Cleanup remains pending until
cooperative resources retire, even after the5000ms execution deadline.

Reuse Shell's supplied signal and budgeted sinks: one outer dispatch charges one
Shell command, each actual output byte charges its shared output budget once. JS
steps/loops, VFS bytes and JSON work use these supplemental invocation caps, NOT
Shell command units. CommandContext exposes no shared source/step debit API; no
invented Budget is installed and guest source is not claimed debited to Shell source.
Shell errors/cancellation retain raw provenance rather than becoming local124.

Diagnostics are one UTF8 line from BINDINGS templates, capped1024 bytes, no stacks;
quote variable text by JSON string escaping where specified. No diagnostic bypasses
output/grant caps: omit a whole inadmissible line, retain selected status. Sink
failure escapes instead of reporting success. One write reserves its whole UTF8
size before publication; earlier output/file changes remain. Known FsError codes
retain code/path/syscall, no host message coercion. Raw handler rejection and Shell
mapped result are distinct observations (CASE-MAPPING). Different review remains
required before implementation; no claim closes Raman's HOLD.
