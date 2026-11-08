# Virtual node: bounded design, not an implementation

Seal class: **post-existing-source inspection / preimplementation**, 2026-08-28.
Owner: delegated Node design leaf; writes only this directory. All proposed
interfaces and programs here are classified design data, not canonical executable
tests. No new product/engine/oracle runs, probes, builds, installs or private
checkout access occurred. A design seal is not an execution freeze or acceptance.

## 1. Decision and evidence boundary

The user retains `node` (42,460; 3.15%, user-supplied), excludes npm/npx product
commands, and requires useful execution, not a successful stub. Curie's audit
`dcaa5ccc54fb31b48d16a207484ea15a3bbedc91` finds no product node. This proposal
does not change that finding. Full Node compatibility is incompatible with the
authority restrictions: arbitrary native addons, OS processes, ambient environment,
host files, sockets and the real Node runtime cannot simultaneously be available
and forbidden. A finite interpreted compatibility profile is feasible in principle;
the accepted SafeJS hooks do **not** currently implement the proposed profile.

Recommend **NP1, a text/JSON virtual Node profile**, gated on an explicitly supplied,
qualified interpreter provider. It executes real expressions and scripts, reads and
edits actual authorized VFS files, and consumes pipeline bytes. Keep the `safejs`
command separate. Do not rename it or claim Node22, full compatibility, readiness,
superiority, or completion of the overall user request. An async-only profile is a
possible smaller follow-up decision, not a silent substitute for NP1's sync calls.

Evidence IDs below resolve in `SOURCES.json`:

- **A1** is accepted commit `f199787165ed3cfba82152cde31c5b794e03fad0`:
  G01/G02/G03 in installed/moved layouts, six prior workflow passes, 30 prior semantic
  assertions. G02 status124 and G03 status1 were expected. These are prior measured
  capabilities, not new runs or Node tests. The package hash is
  `6b5863d51ecd6484b79b7141a2004c04b775f9894d5b80bb016a02ffbefed40e`.
  Retain package-only/source-membership qualifications: 43/268 paths newly proved,
  35 missing trees, no fresh complete source reconstruction. Do not promote this
  package evidence to live HEAD acceptance or reason-identity proof.
- **P1–P7** bind inspected integration source to the frozen composition's selected
  base commit/blobs, not latest product HEAD. Their inspected live bytes matched
  those frozen bytes; this is a narrow equality check, not a live product gate.
  **L1–L3** are separately labeled live contracts at the recorded commit.
- **E1–E9** are public source at engine
  `bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`; retrieved bytes matched both SHA256
  and Git blob IDs in the existing frozen63-file inventory. No private files were
  read or copied. **E10/E11** are the public index/README at that commit, separately
  hashed, not part of the prior63-file executed closure claim.
- **N1–N7** use official **Node v22.15.0** documentation as a fixed comparison
  baseline, not moving latest. Prior A1 host tooling was v22.22.2; that is a distinct
  historical execution version, not the baseline used here or a product version.
  No new Node oracle captured argv, diagnostics, scheduler order or bytes.

## 2. What the actual SafeJS engine permits and does not establish

The official package README exists at the exact engine commit (E11); it is not
safe.js.org or the unrelated research project. Its high-level sandbox and fs
claims describe the upstream package, not automatic virtual-bash conformance.

| Source reference at frozen engine | Inspected behavior and implication |
| --- | --- |
| E1 `src/run.ts:81`, `:155`, `:175`, `:236`, `:564` | `RunOptions` has injected bindings/modules, budget and signal. `run` resets the supplied budget, parses an executable module, resolves imports, then interprets. A single expression is special-cased; multi-statement blocks are not a Node eval completion implementation. Calling `run` separately for modules would reset allowance and lose a single guest realm. |
| E2 `src/parse/parser.ts:475`, `:537`, `:558`, `:571`, `:648` | There are different parse/parseModule/parseExecutableModule paths; regex handling differs. The grammar includes orchestration constructs such as top-level return with a value. It is not a CommonJS wrapper parser. Parse entry points take source/filename, not an exposed parse-resource budget. A source byte cap alone does not prove bounded parser nesting/work. |
| E3 `src/interp/interpreter.ts:175`, `:1155` | Results include returnValue/snapshot/stats; ordinary completed blocks return no value. `safejs -p` cannot supply Node's general eval completion just by printing returnValue. NP1 therefore admits one expression for `-p`, rather than pretending statement completion works. |
| E4 `src/interp/host-bridge.ts:334`, `:434`, `:451`, `:493`, `:642`, `:682` | Synchronous host values and promise results follow different paths. An async VFS call becomes a guest promise, not a synchronous guest fs result. Host results are copied with per-copy alias tracking; guest callbacks are wrapped as async host functions. Error metadata/cause conversion is not preservation of every raw thrown identity. Promise cancellation can settle the wrapper before underlying work ends. |
| E5 `src/interp/cancel.ts:15`, `:94`, `:128` | Binding wrapping checks cancellation and races promises; it observes some late rejections. It does not create ownership/retirement of the host operation. Existing signal/reason comparisons cannot be adopted as the new command's provenance authority. |
| E6 `src/interp/budget.ts:187` | Reset clears counters/retained data. Interpreter budgets are not the shared Shell command budget; allocating one per import or callback would evade a command-wide cap. |
| E7 `src/interp/values.ts:24`, E4 `:763` | Guest values use branded closures/promises/collections and copied objects, not arbitrary native objects. No guest Buffer/Uint8Array contract is established. Do not inject host process, fs, Stream, constructors, proxies or a require function connected to host resolution. |
| E8 `src/modules/registry.ts:47`, `:82`, `:121` | Static imports bind exact entries from an injected export registry with per-resolution wrapping. This is neither VFS resolution nor CommonJS caching nor a graph of ESM live bindings. Namespace records and repeated returned host objects cannot be assumed to have Node module identity. |
| E9 `src/interp/globals/console-json.ts`, E10 `src/index.ts:1` | JSON/console globals and public parse/run/budget exports exist. None is a public Node realm factory, sync-host continuation, primitive completion formatter, or invocation retirement API. Public parseModule helps inspection; it is not an accepted Node frontend. |

The accepted virtual-bash `SafeJsRuntime` requires only run/createBudget/
makeFsModule/declareHostOperation (P2). Its command injects fs/stdio/command (P1),
not Node globals. The explicit fs bridge has promise-based methods and typed VFS
options (P6); it does not solve sync fs. `makeSafeJsShellModule` accepts a supplied
executor, fs, signal and replay policy (P4); it is not implicitly authorized Shell
dispatch. A1 used an explicitly bound context.invoke bridge, not a fresh Shell.
The existing bridge `withSignal` creates AbortError/races work (P5); copying it
would not meet raw-reason and cooperative-retirement requirements.

**Provider blockers:** a Node-facing parser/admission pass; guest-native mutable
process/module objects; genuine sync suspension; a single budgeted guest realm and
job queue; raw control-error channel plus cooperative drain. These are new work,
not source-inspection passes. No unapproved upstream patch is an available feature.

## 3. NP1 guest surface and deliberate boundaries

N1 documents eval/print/stdin selection; N2 process state and streams; N3 fs API
forms; N4 caching; N5 ESM; N6 POSIX paths; N7 write backpressure. NP1 intentionally
supports fewer overloads and a declared virtual scheduling profile.

| Surface | Proposed support | Explicit refusal/deviation |
| --- | --- | --- |
| CLI | `node -e SOURCE [--] ARG...`, `-p EXPR`, `FILE ARG...`, `- ARG...`, no operand = source from stdin; `--eval`, `--print`, `--input-type=commonjs\|module` for inline/stdin | No REPL/TTY inference, clustered flags, preloads, loaders, inspector, test/watch, env-file, npm/npx. Unknown/missing/conflicting flags fail before source acquisition. `-p` is one expression in commonjs mode, not arbitrary statements or module printing. |
| Entry grammar | `.cjs` commonjs, `.mjs` module; `.js` or extensionless entry only when no package.json in the authorized ancestor chain selects/affects interpretation | NP1 rejects a discovered package.json for ambiguous entry types rather than ignoring it; `.cjs`/`.mjs` remain explicit. No TypeScript. No implicit auto-detection. UTF8, optional initial BOM/hashbang; unsupported syntax rejected on the entire entry before guest execution. |
| JavaScript | literals; arrays/plain records; const/let; property/index access; arithmetic/comparison; if/loops; functions/arrows; async/await and promise chaining; try/catch/throw; bounded JSON.parse/stringify | No class, eval, Function, dynamic import, generators, regex, BigInt, Symbol, typed arrays, prototype mutation or arbitrary reflection. No top-level return. Module mode permits top-level await; commonjs requires an async function for await. Admission is lexical/AST-based, not regex rewriting. |
| process | guest-native argv, argv0=`node`, execPath=`/virtual/bin/node`, env copy, cwd(), exitCode initially undefined | execPath is a virtual identifier, not an executable host path. No version/versions/platform/PID disclosure, chdir, binding, getBuiltinModule, exit, signals, nextTick, process events or OS authority. `--version` refuses, not a fake Node version. env mutation accepts string values/delete only and never changes parent Shell state; non-string coercion is outside NP1. exitCode accepts undefined or integer0..255 only. |
| argv | script: `[execPath, absoluteVirtualEntry, ...args]`; eval/print: `[execPath, ...args]`; stdin: `[execPath, '-', ...args]` | Preserve exact strings after the selector/`--`; do not reinterpret guest flags. These are proposed conventions pending an admitted Node oracle, not new measured parity. |
| output | stdout/stderr `.fd`=1/2 and `write(string[, 'utf8'])`; console.log/error one primitive argument; print a primitive plus LF | Guest-blocking write awaits the ByteSink then returns boolean true, never a Promise or pre-settlement success. No callback overload, events/drain API, stream piping or binary overload. This serial virtual output profile is not Node's platform-dependent event-loop timing. Objects/functions/promises from `-p` fail instead of JSON-stringifying/printing a stub; use JSON.stringify explicitly. |
| input | stdin.fd=0; `fs.readFileSync(0, 'utf8')` consumes remaining command stdin | stdin stream methods are explicitly unsupported, not an empty/fake stream. File/eval sources leave stdin untouched; stdin-as-source consumes it once and guest fd0 sees EOF. No TTY assumption from stdinIsDefault. `fs.promises.readFile(0)` is not admitted. |
| fs | `readFileSync(path, 'utf8')`, `writeFileSync(path, text[, options])`, `readdirSync(path)`; promise counterparts through `fs.promises` and `fs/promises` | String paths/data; read encoding must be explicit utf8; writes default utf8, flags w or wx only. UTF8 decode uses replacement for malformed file bytes. No Buffer-return overload, other encodings, URL paths, native descriptors except sync read fd0, callback APIs, handles, stat objects, chmod, unlink/rm/rmdir, streams/watch or transactions. Unsupported options fail before the affected provider operation. |
| path | POSIX join/resolve/normalize/dirname/basename/extname/relative/isAbsolute, sep and delimiter | Pure strings; resolve defaults to guest cwd. No win32/host cwd. Path normalization alone never grants filesystem authority. |
| builtins | `require('fs'\|'fs/promises'\|'path'\|'process')` and their `node:` aliases; module-mode static imports of the same surfaces | Guest-native module identities, fs.promises aliases the promises module. No other builtin, automatic eval builtin globals, host require, packages, NODE_PATH, network imports, module/createRequire/vm, native addons, timers, workers, child_process, WASI or fetch. |
| local modules | commonjs require of explicit relative/absolute `.json`, loaded at the call, cached by resolved VFS filename within one invocation | No local executable JS modules, cycles, exports/main resolution, extension probing, directory indexes, node_modules or ESM JSON attributes. Local executable modules are a separately scoped successor, not supported because the main script loads. |

Primitive rendering: strings raw; undefined/null/booleans conventional spellings;
numbers use JS spelling except preserve `-0`; console/print add LF. This formatting
is a specified virtual profile, not util.inspect parity. Other globals are absent;
unsupported sensitive globals/operations fail explicitly, never call the host.
JSON behavior for admitted plain data must be real (including parse failure), not
canned. All proposed positive/negative identities are unexecuted in CASES.json.
Static builtin imports permit default, namespace and named exports only from the
listed surfaces. Entry exports are outside NP1. Reserve the injected require binding
against rebinding/shadowing; admission must resolve lexical bindings, not mistake a
string mentioning require for an import. Prototype/constructor escape operations
are refused; JSON keys remain inert data, never magic host property setters.

## 4. Sync bridging, module admission, cache and authority

**Choose continuation-based sync suspension**, not a Promise masquerading as
readFileSync. At an admitted sync intrinsic, the interpreter saves its continuation,
awaits a host adapter request, then resumes with a guest value or throws a guest
error. No guest statement/job/callback runs during that suspension. The host event
loop remains responsive and unrelated Shell invocations can progress. This needs
an interpreter facility, not adding `await` to user source, Atomics/deasync/native
execution, or snapshotting the entire VFS. Existing SafeJS `run`/host callbacks do
not expose it. Promise fs instead returns a guest promise and schedules its reaction
in the same invocation's bounded job queue. This is the largest NP1 feasibility gate.

Host grants name *operations* on an already authority-limited VFS, not unchecked
path prefixes: sourceRead, dataRead, directoryRead, dataWrite, stdinRead,
stdoutWrite, stderrWrite, jsonModules. Absent grants deny. Registration alone does
not enable FS writes/network. Every acquisition validates args/options/remaining
caps and authorizes before admission. The provider cannot receive raw CommandContext
or arbitrary FileSystem/host modules; it receives only the adapter below.

Authority binds the actual configured VFS namespace, including remote adapters
explicitly configured by its host; this may entail provider-managed remote I/O but
never a guest socket/fetch grant. A narrowed subdirectory grant requires an adapter
that enforces traversal/symlink/provider authority, or refusal. Lexical prefix tests,
realpath-then-open and identity comparison are not race-free confinement. If a
provider cannot establish the requested namespace authority, reject configuration
before entry reading, not after a potentially escaping call. Do not fabricate inode,
mode, strong rmdir, stat or remote transaction promises. Borrow context.fs; never
dispose the shared filesystem or siblings. Env comes only from supplied exported
context.env; NODE_OPTIONS/NODE_PATH remain inert data, not configuration inputs.

Admission order: validate CLI/provider profile/grants; register root cleanup; acquire
bounded source; parse and validate all syntax; validate static imports and direct
literal forbidden require targets; then instantiate the realm and execute. Preparation
may read authorized source/package metadata, so “before effects” here means before
guest output/mutation/host-call execution, not zero provider observations or shell
redirection effects. The outer Shell may already have opened a redirected file.

Runtime require can accept a computed string for a supported builtin or `.json`.
Resolve relative JSON from the entry directory (inline/stdin from cwd); absolute
names remain virtual. Reject NUL, schemes, encoded-URL interpretations, unsupported
suffixes and targets outside the bound authority. Resolve through the actual VFS
path contract, honoring symlinks only where confinement is enforced. Cache key is
resolved virtual filename plus invocation namespace, not provider clients or host
paths. First successful load creates one mutable guest object; repeat aliases return
that same guest reference. Failed loads are not cached. Read at first require, not
preloaded: an earlier write must be visible. After loading, later writes do not
invalidate the cache. No cache survives invocation completion or leaks across Shells.

Literal unsupported imports are refused before entry execution; computed require
refusals occur **at the call**, before that call's I/O but after any earlier statements.
There is no global no-effects promise and no rollback. A caught refusal may continue;
an uncaught one maps to the declared error. Dynamic `import()` syntax is rejected in
the complete entry parse. A future dynamic/local loader must repeat admission for
each module, cannot retroactively erase caller effects, and needs separate decisions
for circular exports, ESM live bindings, graph-wide budgets and cache invalidation.

## 5. Proposed host/provider contract (markdown type data only)

These names are **proposed**, not virtual-bash exports. Root integration owns any
future registration/API change. `Entry`, `Limits` and `InvocationState` mean the
exact tables here; `PreparedEntry` is opaque, session-bound and source-hash-bound;
`GuestValueRef` never exposes an engine/host object outside that session.

```text
type Stop = { origin: 'caller' | 'local-limit'; reason: unknown };
type Outcome =
  | { kind: 'complete'; exitCode: number; completion: GuestValueRef }
  | { kind: 'guest-error'; diagnostic: GuestDiagnostic }
  | { kind: 'control-error'; error: unknown; origin: 'caller' | 'execution' | 'local' };
interface NodeProfileProvider {
  readonly profile: 'virtual-node-np1';
  readonly implementationId: string;
  create(scope: InvocationScope): NodeProfileSession;
}
interface NodeProfileSession {
  prepare(entry: Entry, limits: Limits): Promise<PreparedEntry>;
  execute(entry: PreparedEntry, state: InvocationState, host: NodeHost): Promise<Outcome>;
  stop(stop: Stop): void;
  close(): Promise<void>;
}
interface InvocationScope {
  readonly signal: AbortSignal;
  registerCleanup(cleanup: () => void | Promise<void>): void;
  track<T>(acquire: () => Promise<T>): Promise<T>;
}
interface NodeHost {
  request(operation: HostRequest): Promise<HostReply>;
}
type HostRequest =
  | { op: 'readText'; path: string; encoding: 'utf8'; purpose: 'data' | 'json-module' }
  | { op: 'writeText'; path: string; text: string; flag: 'w' | 'wx' }
  | { op: 'readDirectory'; path: string }
  | { op: 'resolveJson'; from: string; specifier: string }
  | { op: 'readStdinText' }
  | { op: 'writeOutput'; destination: 'stdout' | 'stderr'; text: string };
type HostReply = { kind: 'value'; value: string | string[] | boolean | undefined }
  | { kind: 'fs-error'; code: string; path?: string; syscall?: string; message: string }
  | { kind: 'control-error'; error: unknown; origin: 'caller' | 'execution' | 'local' };
```

Provider ownership: one new session per command; the provider owns guest realm,
intrinsics, synchronous continuations, promise jobs, JSON objects/cache and terminal
state. It constructs process/env in the guest, captures exitCode on completion, and
never hands raw host objects to the guest. fs-error becomes an ordinary catchable
guest Error with faithful available fields, not invented errno/Node stacks. The
adapter retains raw host/control failures out-of-band; guest Error copying must not
erase the original. Operation input must be exact own-data records with typed finite
fields, no getters/coercion/extras; cross-realm input validation cannot depend on
prototype identity. Host JavaScript providers remain trusted, not sandboxed by TS.
Guest catch blocks cannot intercept control-error or quota termination to resume
execution; only ordinary fs/guest errors are catchable. The adapter records control
provenance before delivering it and never reconstructs it from guest-visible fields.

Host ownership: the command owns source acquisition, adapter/grants, borrowed fs
and signals, stdin iterator, per-destination output operations, local limits and
failure precedence. It registers a single idempotent cleanup synchronously with
context.registerCleanup before provider creation, input acquisition or output
operation creation. Provider create must register its child cleanup before any
owned acquisition; prepare itself must be cooperative/bounded. Scope.track checks
admission synchronously *before* calling acquire, retains settlement and observes
rejections. No resource-acquiring Promise can be created first and tracked later.

No direct Shell Budget API is present in inspected CommandContext (P7). NP1 performs
one existing registry dispatch and exposes no child command invocation. The enclosing
Shell keeps its shared budget; provider compute/I/O limits do not reset/replace it.
Any future invoke grant must call the bound context.invoke (literal argv, middleware,
shared budgets/signals, exact replaceEnv semantics), never create another Shell.

On every terminal path, first close acquisition admission and stop guest scheduling;
then await provider retirement, admitted cooperative operations, stdin return, output
drains and registered child scopes; finally release local listeners/timers. finally
and registered cleanup share the same promise, including concurrent Shell.dispose.
Successful body completion is not public success until admitted jobs/reactions have
quiesced and cleanup has settled. Unawaited fs promises remain tracked; late rejections
are observed. A rejected cleanup alone cannot turn into success.
Top-level completion alone is not a terminal path: normal execution first drains
the admitted guest job graph to quiescence under the same limits, then closes it.
Failure/cancellation instead closes immediately and retires already admitted work.

Precedence: root-caller cancellation > escaping execution/control failure > local
cancellation. Preserve exact caller reason identity outside the guest (including
undefined, primitives, objects and errno-shaped reasons); never infer provenance
from reason equality, AbortError names or a mapped exit status. Reasons are not
serialized/recreated to throw. An escaping failure that already occurred must not
be hidden by a subsequent local abort. Caller abort can still win at final selection.
Stdout ownedOutput enrollment is destination-specific: closing it drains its admitted
work; it does not cancel stderr/file work or the command's sibling scopes. The Shell
selects early-pipe outcome under its own policy; do not hardcode success/status141.
Destination closure is not a call to session.stop: its local output scope closes,
while already admitted sibling work remains owned and must settle.

No finite timeout can forcibly retire an uncooperative host promise in-process.
Only cooperative providers qualify for bounded-settlement claims; observe opaque
late failures without claiming resources stopped. Cancellation cannot undo writes.
No snapshot/replay/resume is enabled; read-side-effect is an upstream replay label,
not permission or exactly-once protection.

## 6. Initial caps, failures and acceptance decisions

Proposed defaults (not measured tuning): source256KiB; parser tokens65,536 and
nesting128; total guest steps100,000; call depth128; guest retained data8MiB;
string length1,048,576 UTF16 units; array/record entries65,536; pending jobs/host
operations32; total host calls1,024; JSON cache entries32/total text1MiB;
stdin1MiB; per-file/aggregate read1MiB/4MiB; aggregate write4MiB;
combined stdout+stderr1MiB; directory entries4,096; wall deadline5,000ms.
One command-wide allowance spans source, module loading, callbacks and promises;
no repeated `run` resets. Depth/size/steps must charge parser, JSON traversal,
string/array builtins and continuation resumption, not only AST statements.
Track retained producer chunks as owned copies before advancing/finalizing iterators.
Byte caps count encoded bytes, not JS length; admit complete output writes only.
Check write byte limits before calling VFS. Stream input/source where supported;
providers with only unbounded readFile need an explicit bounded-allocation contract
or refusal for hard memory claims. These are logical caps, not absolute host RSS.

Normal completion returns guest exitCode or0. CLI/policy refusal2, guest parse/runtime
failure1, local limit124, unavailable/inadequate provider127. Caller cancellation and
escaping host failures propagate through the existing Shell contract after cleanup,
not a fabricated status. Stable virtual diagnostics are `node: CODE: detail\n`;
no Node-stack/errno byte-parity claim. If stderr fails, preserve the failure rather
than reporting diagnostic success. CASES.json gives exact bytes only where settled
by this proposal; null plus a reason means intentionally unresolved, never a pass.
Diagnostics use the same output-byte allowance. If a complete bounded diagnostic
cannot fit, omit it while retaining the failure/status; do not bypass the cap or
emit partial diagnostic bytes. This omission is distinct from a failing stderr sink.

### Root decisions required

1. **D1:** Approve NP1 as a labeled useful subset, without claiming the full node
   requirement finished. Keep local executable modules/stream API gaps visible.
2. **D2:** Select a legitimate injected provider with a public sync-continuation,
   guest-value and lifecycle contract, or authorize a separate zero-dependency TS
   interpreter effort. Frozen SafeJS is not a drop-in. No private patch/vendor grant
   follows from this design; optional injection does not satisfy a bundled default.
3. **D3:** Approve NP1 sync semantics and serial stdout profile, or explicitly choose
   a separately named async-only profile/case revision. Never fake synchronous fs.
4. **D4:** Approve per-invocation authority-limited VFS grants and deny-by-default
   writes; choose how the host proves confinement/cooperative bounded reads.
5. **D5:** Decide optional registration versus a future bundled interpreter. No
   provider means nonzero unavailable, not an installed working node. Any default
   aggregate/export/inventory changes require root ownership and a separate grant.
6. **D6:** Authorize a future independently reviewed implementation and bounded
   Node22 oracle/lifecycle campaign against these unexecuted identities, including
   missing stream/local-module workflows. This seal grants no execution. Historical
   evidence and mapfile1d3744a6 remain unchanged; no XAN/arrays/YQ platform work.

Stop condition for design: these four artifacts are sealed after syntax/data review.
Stop condition for eventual product admission: actual non-stub provider execution,
independent byte/state/lifecycle evidence and disclosed compatibility gaps, not merely
successful provider injection or this case inventory.
