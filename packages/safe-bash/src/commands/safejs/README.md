# Optional SafeJS shell command

Source-module exports:

- `safeJsCommands(options?)`: a `VirtualShellPlugin` registering **only `safejs`**.
- `createSafeJsCommands(options?)`: independent command definitions.
- `defaultSafeJsLimits`, `SafeJsCommandLimitError`, and structural runtime/options types.

This subtree does not add package-root exports, manifest entries or a private
package dependency. Root integration is a separate owner's task. There is no
`js` alias and no Node.js CLI compatibility claim. All production imports are
project code or Node builtins. Guest source goes only to the injected SafeJS
interpreter: never to host `eval`, `Function`, a VM evaluator, or a subprocess.

## Actual integration boundary

The injected APIs were inspected and exercised from the existing local
`poe-code/packages/safejs` package (`@poe-code/safejs`, private version `0.0.1`).
The command does not guess an API or install/load that private package itself.
The host supplies the legitimate `run`, `Budget`, `makeFsModule` and
`declareHostOperation` implementations:

```ts
import { Budget, declareHostOperation, makeFsModule, run } from "@poe-code/safejs";
import { MemoryFileSystem, Shell, standardCommands } from "./src/index.js";
import { safeJsCommands } from "./src/commands/safejs/index.js";

const fs = new MemoryFileSystem();
await fs.mkdir("/work");
const shell = new Shell({ fs, cwd: "/work", env: { PROJECT: "virtual" } })
  .use(standardCommands())
  .use(safeJsCommands({
    runtime: {
      run,
      createBudget: limits => new Budget(limits),
      makeFsModule,
      declareHostOperation,
    },
    limits: { timeoutMs: 3000, maxOutputBytes: 1024 * 1024 },
  }));

const result = await shell.exec(`printf 'hello é\\n' | safejs -e '
  import { readText, write } from "stdio";
  import { writeFile } from "fs";
  import { args, cwd, env } from "command";
  const text = await readText();
  await writeFile("result.txt", text + args[0]);
  await write(cwd + ":" + env.PROJECT + ":" + text);
' suffix | cat`);
```

This example is for a host application which already legitimately supplies the
private package. Imports from `./src` are repository-root source imports, not
claims about published subpaths. The local verification suite instead imports
the actual four source modules through an explicitly configured absolute path;
an in-memory TypeScript probe verifies the uncast assignment to
`SafeJsRuntime<Budget>` with the real types. Nothing in the private checkout is
written or built by this command's tests.

`runtime` is a trusted host capability, not guest data. `run` must be the actual
safe interpreter, `createBudget` must return a fresh actual Budget for each
invocation, and the module/declaration factories must preserve SafeJS's host
boundary. Supplying an unsafe runner invalidates any sandbox expectation.
`runtime` is optional solely to allow an explicit not-installed result: without
it, execution returns **127** without reading source/stdin; help still works.
Partial runtime objects fail configuration validation. `replace: true` permits
replacing an existing `safejs` registry entry; default registration rejects it.

`command.env` is an own-entry data dictionary, not an Object-prototype capability.
The command copies it into a prototype-free record so literal `__proto__`,
`constructor` and `prototype` keys remain data through the injected engine.
Guest changes do not mutate the caller's environment. This does not repair or
promise support for arbitrary raw-engine capability records or constructor metadata.

The command checks cancellation before invoking the runtime and rethrows the
caller's exact cancellation reason. The separate filesystem and shell bridges
retain their established sanitized `AbortError`/`ABORT_ERR` boundary; they do not
promise raw reason identity or expose private reason objects to guest code.
No signal is omitted, budget reset or global rejection handler installed to
work around an external engine limitation.

## Command grammar

```text
safejs [-p|--print] [-e SOURCE [--] ARG... | FILE ARG... | - ARG...]
safejs [-p|--print]                 # source from stdin
safejs -h|--help
```

- `-e SOURCE`, `-eSOURCE`, `--eval SOURCE`, `--eval=SOURCE` take **complete
  SafeJS source**, not an automatically wrapped expression. Top-level `return`
  is supported by the actual interpreter. Inline/file modes leave stdin for
  guest data; stdin-source mode consumes it as source and gives the guest EOF.
- Parsing stops when source/file is selected. Remaining words are exact guest
  arguments. Immediately after inline source, one optional `--` is removed.
  Before a filename, `--` allows a dash-leading filename. `-` selects stdin.
  There is no interactive REPL and no second stdin stream for stdin-source mode.
- `-p`/`--print` must precede source selection. A returned string is written
  verbatim plus LF; JSON data is serialized plus LF; an undefined top-level
  return produces nothing. Without `-p`, only guest stdio/console emits output.
  This does not implement Node's `-p` expression evaluation.
- Source files are read only through `context.fs`, relative to the virtual cwd,
  not the source file's directory. Parent symlinks are left for the VFS to
  resolve. Streaming reads are used when advertised/available; otherwise
  `readFile` receives `maxBytes` and the result is bounded again before parsing.
  A backend that ignores `maxBytes` can allocate its buffered result before that
  final check. Source must be UTF-8; one leading BOM is stripped after byte limits.
- Unknown options fail with status 2. Runtime limits are host configuration,
  not guest-adjustable flags. Other CLI flags, harness Markdown/frontmatter,
  file/module import resolution, snapshot/restore and entry-point selection are
  not implemented. Only the three module names below are registered.

## Guest modules

### `command`

```js
import { args, cwd, env, setExitCode } from "command";
```

`args` excludes argv0, source and command flags. `cwd` and `env` are snapshots of
the invoking command context, not host `process.cwd()`/`process.env`. SafeJS
copies these into guest values. Guest changes to those objects do not update
the shell or subsequent invocations. There is no `process` global or `chdir`
operation added by this plugin. `setExitCode(integer)` accepts 0 through 255,
does **not** terminate execution, and the last call wins on otherwise successful
completion. Errors/budget exhaustion override it.

### `stdio`

| Function | Behavior |
| --- | --- |
| `await readBytes(size = 65536)` | Returns an array of up to `size` byte integers, or `null` at EOF. Size must be 1..65536. Reads consume one shared cursor and are serialized in issue order. Chunk boundaries need not fill the requested size. |
| `await readText()` | Reads remaining stdin under the cumulative input-byte cap, decodes strict UTF-8, and returns a string. Preserves a data BOM and multibyte characters across chunks. A previous byte read may leave an invalid UTF-8 tail; decoding then fails rather than silently replacing bytes. |
| `await write(text)` / `await error(text)` | UTF-8 string output to stdout/stderr; no implicit newline. Non-string input is rejected. |
| `await writeBytes(bytes)` / `await errorBytes(bytes)` | Exact byte-array output to stdout/stderr. Arrays contain at most 65536 integers in 0..255. |

Output writes share an ordered, bounded queue; async methods await their writes
and honor downstream backpressure. Pending output is drained before completion,
including output already issued before a guest error. `console.log` and
`console.error` use this queue as well, but their SafeJS sink interface is
synchronous: they cannot impose per-call awaited backpressure. The total output
cap bounds their queued data, and failures terminate the invocation.

Console arguments are strings or bounded JSON values separated by spaces plus
LF. Undefined console arguments render `undefined`. **There is no Node percent
interpolation, custom inspection, `toJSON` execution or getter invocation.**
`-p` and console serialize JSON incrementally under the remaining output cap,
including repeated references; cyclic/non-data values and depth over 64 fail.
JSON object undefined values are omitted, array undefined/hole values become
null, and non-finite numbers become null. Acyclic JSON output is not a dump of
SafeJS closures, promises, internal objects or snapshots.

### `fs`

The command reuses `makeSafeJsFsModule` from `src/integrations/safejs`, which
passes `createNodeFsBridge(context.fs, { cwd, signal })` to the injected actual
SafeJS `makeFsModule`. It never falls back to native filesystem operations.
The guest's supported fs operations/options are exactly that existing bridge
and actual module surface, not a new Node compatibility layer. In particular,
use explicit text encoding for `readFile(path, "utf8")`; raw Buffer-returning
fs operations are rejected by the inspected SafeJS module. Use stdio byte arrays
for binary command pipelines.

The entire injected VFS is a capability: this plugin does not create a smaller
root or hide virtual files. Supply appropriately confined/readonly adapters
and a sanitized virtual environment. Fs writes are immediately visible to the
shell and future invocations. They are **not transactional**: an error or abort
does not roll back earlier writes. Fs I/O does not count toward stdin/stdout byte
caps; its own VFS limits and SafeJS data budget are separate. Backend allocation
before host-to-guest conversion and late uncooperative writes are not prevented
by a sandbox data-size limit.

## Replay and sessions

Every invocation gets new modules, cursor, output queue and requested Budget;
guest variables are not a persistent REPL session. Only shared VFS mutations
persist. No snapshot/backend/resume provider is passed to `run` by this plugin.

All stdio reads/writes and `setExitCode` use the injected
`declareHostOperation(operation, "read-side-effect")`: consuming stdin cannot
be safely repeated, and output is an effect. The actual fs factory retains its
existing read/reissue and write/effect policies. Tests inspect actual markers
and journal entries; SafeJS intentionally drops consumed `re-issue` reads from
the completed journal. Console sink effects and pre-interpreter source reads
are not guest host-call journal entries. Consequently, adding resume later
requires explicit reconciliation; do not treat this command as resumable or
reissue pending stdio by copying a snapshot into a custom runner wrapper.

## Budgets and exit statuses

| Host limit | Default |
| --- | ---: |
| `maxSourceBytes` | 1 MiB |
| `maxInputBytes` | 8 MiB, cumulative guest stdin consumption |
| `maxOutputBytes` | 8 MiB, combined guest stdout + stderr + printed return |
| `timeoutMs` | 5000 |
| `maxSteps` | 100000 |
| `maxCallDepth` | 128 |
| `stringLength` | 1048576 |
| `arrayLength` | 100000 |
| `dataSize` | 16777216 |

Values must be nonnegative safe integers; timeout is 1..2147483647 ms. All
interpreter fields are supplied to the actual Budget, including an absolute
deadline covering source loading plus execution. A timer also interrupts
blocked host work. This is cooperative cancellation plus SafeJS's interpreter
budget checks, not hard preemption of synchronous parsing, a hostile injected
runner, arbitrary native regex work, or a backend which ignores its signal.

Input/output quota violations remain fatal even when the guest catches an I/O
rejection. Command-originated abort is published one microtask after recording
the first failure, allowing the actual SafeJS host bridge to attach observers
to a newly returned rejected promise before cancellation. Real-runtime tests
cover this rejection race for text, bytes and both console sinks.

| Outcome | Result |
| --- | --- |
| Normal completion | 0, or the guest's validated `setExitCode` |
| Guest/runtime/VFS/invalid UTF-8/serialization error | 1 |
| Usage or actual `ParseError` | 2 |
| Command limits, deadline or SafeJS `budgetExceeded` | 124 |
| No injected runtime | 127 |
| Parent cancellation | Rejects with the original parent reason; not converted into a success/status |

Parent signal reaches the runner, VFS bridge and byte I/O. Pending source/sink
rejections are observed, source iterators are released, and stale callbacks
cannot emit after invocation completion. An operation already performing an
uncooperative external side effect cannot be undone. Diagnostics are outside
guest output caps, limited to 4096 message characters, and bounded by the
remaining deadline (one millisecond grace after expiry). A failed stderr is
not written again; a blocked diagnostic can be dropped. Host help/not-installed
messages are control output, not guest-budget output.

## Author verification and explicit upstream defect

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/safejs/*.test.ts
SAFEJS_LOCAL_ROOT=/Users/kjopek/Workspace/poe-code/packages/safejs \
  node --unhandled-rejections=strict --import tsx --test tests/commands/safejs/*.test.ts
```

`SAFEJS_LOCAL_ROOT` is **test-only**; the production command never reads it or
loads from it. It must point to an already available checkout with its existing
local tooling. Missing configuration skips the explicit real-runtime tests,
not the always-runnable contract tests. Contract fixtures deliberately do not
interpret their input and are evidence only for wiring/lifecycle validation,
not sandbox safety or SafeJS language support.

August 26, 2026, Node v22.22.2: **64 checks passed with local SafeJS enabled**:
39 always-runnable contract checks and 25 local checks, of which one is a real
type-compatibility probe and one records the following upstream defect rather
than claiming constructor support. Real behavior covers shell pipelines,
65,539 binary bytes, multibyte UTF-8/BOM, virtual files, readonly denial, args,
env/cwd, host-capability denial, guest errors, cancellation, budget rejection,
partial effects, host-call policies and shell output quotas.

The combined command and existing bridge suites passed **92/92** with the
actual local runtime. Lifecycle plus local-runtime checks also passed five
strict-unhandled-rejection repetitions of **56/56**. Without local configuration,
the command suite reports **39 passes and 25 explicit skips**, not 64 passes.
Owned-source/test strict TypeScript checks and the project production build pass.
The final whole-project typecheck encountered two concurrent, unowned errors in
`tests/commands/diff-patch-stress/gnu-target/calibration.test.ts`; scoped success
does not waive that global check.

**Known private-runtime defect, not fixed or hidden:** direct `run` of
`throw new Error("constructed")` works without a signal but fails with
`Error is not a constructor.` when given a signal. The command necessarily
passes a signal and inherits that failure. `interp/cancel.ts` recreates closures
without their `construct` property. A test reproduces both direct runner paths
and the command path. `throw "message"` and callable `Error("message")` work;
this does not establish general constructor support. No private source was
patched and cancellation was not disabled to manufacture compatibility.

Inspected private checkout HEAD: `c015ded2c3b850eaf5c0448c4950997c1ddb4ee8`.
This is an observed local checkout identity, not a claim its whole working tree
is clean. The live type test reports source SHA256 values; inspected values:

| Private source | SHA256 |
| --- | --- |
| `src/run.ts` | `0ad27b6b50ceabc2e92c64a8950e9e8faa1a477745be400ad0fcbb2534683f5f` |
| `src/interp/budget.ts` | `861f58d5db16232ec9cacaf77e25f20842376a510ecc6582f12d8488daecf639` |
| `src/interp/host-bridge.ts` | `5839aa1b00e0116f73f107c5cc5e85010cc94d304a241bb18ee90be701b1f8de` |
| `src/modules/fs.ts` | `99fc3a501ce906aa2021f298ef8803b63d2272de5f412dfcdf3714757510b142` |

These are author-side integration checks, not the separately assigned verifier,
an exhaustive SafeJS security audit, universal adapter durability, full Node/Bash
support, or evidence of superiority over another virtual shell.

## Independent stress verification, August 26, 2026

The stress writer remeasured the author baseline (64/64 with the actual
local engine; 39 passed/25 skipped without it) and the combined author/bridge
scope (92/92), then added 51 checks. Full owned conventional scopes report
115/115 with the engine and 59 passed/56 skipped without it. Five strict
lifecycle/local/independent repetitions each report 107/107. Scoped and global
typechecking plus production build passed at this fresh check.

These totals include 10 explicitly labeled upstream-defect characterizations
and one type-only probe: 55 tests execute the actual engine, including those
10 characterizations, not 115 successful guest behaviors. A separate desired
semantics probe remains **0 passed/9 failed**. The signal wrapper also loses
Map/Set/RegExp construction, Array static methods and own `__proto__` data;
raw pre-aborted pure runs can succeed. No plugin TypeScript or private source
was changed by that worker, and signal propagation remains enabled.

Final inclusive runs containing that probe report **115 passed/9 failed out of
124** with the engine and **59 passed/65 skipped out of 124** without it. The
engine-enabled inclusive run exits nonzero; upstream compatibility is unresolved.

These are historical stress-writer results. The separate read-only final review
at `/tmp/safe-bash-safejs-independent-final-review.txt`, linked by the current
`/tmp/safe-bash-safejs-upstream-checkpoint.txt`, independently refreshed the
115 conventional passes, inclusive 115 passes/9 failures, and no-env inclusive
59 passes/65 skips on August 26, 2026. Private engine files changed externally
between snapshots; stability was verified only across that review's final gate,
not since the earlier author/writer hashes. Plugin runtime remains unchanged;
no plugin implementation or adapter bug was confirmed by this bounded review.

The reviewer also verified a separate actual-engine lifecycle limitation: an
injected host callback aborts and supplies a rejected promise; the engine
surfaces the abort, then a separate unhandled host rejection terminates strict
Node. Expected behavior is to preserve the abort while observing the existing
promise's rejection, without an unhandled rejection. The unapplied proposal
is to observe existing promises before early-abort returns in both upstream
promise wrappers, retaining cancellation and listener cleanup, not global
rejection suppression. This action module is not installed by default by the
plugin. Evidence is external at `/tmp/safe-bash-safejs-abort-in-action.mjs` and
`/tmp/safe-bash-safejs-final-action-abort.log`; **no durable executable regression
exists for this observation**. It is not among the nine desired probes and
does not increase any passing count. This documentation handoff ran no engine
or tests and made no private-engine changes.

Exact commands, snapshot-specific counts and hashes, failed desired probes and the
unapplied upstream patch proposal are in
`tests/commands/safejs-stress/README.md` and
`tests/commands/safejs-stress/UPSTREAM_PATCH_PROPOSAL.md` (workspace-relative).
Passing characterization is not upstream compatibility acceptance or a
comprehensive security claim.
