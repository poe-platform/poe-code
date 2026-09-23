# Node with pluggable SafeJS

`nodeCommands({ runtime })` registers `node` using an injected SafeJS interpreter.
It shares the shell's virtual filesystem, stdin, stdout, stderr, cwd, exported
environment, and cancellation signal. No engine is loaded implicitly and no
native subprocess is started.

JavaScript integration registers only `node`, never `safejs` or `js`. The legacy
SDK names `safeJsCommands` and `createSafeJsCommands` expose the portable SafeJS
registration factories; they use the same Node-style arguments
and require the same explicit runtime configuration. They do not add shell aliases.
Browser and workerd root and command-subpath exports provide the SafeJS-backed
factories without the native provider implementation.

```ts
import { Shell, createMemoryFileSystem, nodeCommands } from "poe-code/safe-bash";
import { Budget, run, makeFsModule, declareHostOperation, parseSourceModule } from "poe-code/safe-js";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(nodeCommands({
  runtime: {
    run, makeFsModule, declareHostOperation, parseSourceModule,
    createBudget: options => new Budget(options),
  },
}));
try {
  const result = await shell.exec("node -p '1 + 2'");
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

## Programs and I/O

- `node -e SOURCE` / `--eval` evaluates JavaScript; `node -p EXPRESSION` /
  `--print` prints the expression, including `undefined`. Objects print as JSON,
  not Node's inspection format. Console formatting uses SafeJS, not Node format strings.
- `node --require ./setup.cjs` / `node -r ./setup.cjs` runs a virtual CommonJS
  module before the program. Repeat the flag to run preloads in order;
  `--require=PATH` and `-rPATH` also work. Preload paths resolve from virtual cwd,
  including for file entries in another directory. Use explicit `.cjs`, `.js`,
  or `.json` paths, or the supported builtin names below. Check mode skips
  preloads. No host modules or environment-driven preloads are loaded.
- `node --enable-source-maps` maps guest error stacks through version 3 source
  maps from `sourceMappingURL` comments. Maps may be inline JSON data URLs or
  files in the explicit VFS, resolved relative to the program (or virtual cwd
  for eval/stdin). `sourceRoot` and mapped line/column positions are honored.
  Missing, invalid, remote, and indexed maps retain generated locations; maps
  never grant filesystem or network access. Map reads share source byte limits,
  deadlines, and cancellation. Decoded entries and filenames obey array, string,
  and data limits. The injected `run` must honor the optional
  `sourceLocation` diagnostic callback, as the SafeJS implementation does.
- `node --check FILE` / `node -c FILE` checks the complete source without running
  statements or resolving imports. Omit `FILE` or use `-` to check stdin;
  `--input-type=module`, `--input-type=commonjs`, and `--` remain available. Inject `parseSourceModule` as
  shown above. Valid syntax returns 0 with no output; invalid syntax returns 1
  with a diagnostic. Check mode cannot be combined with eval or print.
- `node FILE` reads a virtual file, including `.js` files. `node -` and bare
  `node` read source from stdin once, leaving no guest input. File and inline
  programs retain stdin for data. `--` ends command-option parsing.
- `node --input-type=commonjs` runs eval, print, or stdin source as an interpreted
  Script with invocation-local `module` and `exports`, the virtual `require`
  helpers below, `__filename` (`[eval]` or `[stdin]`), and `__dirname` (`.`).
  Reassigning `module.exports` leaves the original `exports` reference intact.
  Static imports, exports, and top-level `await` fail before guest statements run;
  async functions and callbacks remain available. The flag cannot select a file.
- `process.argv` starts with `/virtual/bin/node`, then the absolute filename or
  `-` for file/stdin programs, then supplied arguments. Eval/print omit a filename.
- `process.cwd()` and `process.env` expose virtual state, never host state.
  Environment edits remain local to one invocation. Set `process.exitCode` to an
  integer from 0–255; it is applied when the program finishes normally.
- `__dirname` is `.` for eval, print, and stdin programs, and the absolute virtual
  parent directory for `.js` and `.cjs` files. It is absent with
  `--input-type=module` and in `.mjs` files.
- `TextEncoder` encodes UTF-8 into guest `Uint8Array` values; `encodeInto`
  writes complete code points into a supplied byte view and reports bytes written.
- `Buffer` provides guest-owned bytes with `from`, `alloc`, `concat`, `byteLength`,
  `isBuffer`, and `isEncoding`, plus encoding-aware `toString`, shared `slice` /
  `subarray` views, `equals`, and `toJSON`. String encodings follow Node, including
  UTF-8, hex, base64, base64url, ASCII, Latin-1, and UTF-16LE. Copies and views
  remain inside the interpreter and obey its array, string, and data limits.
  Native Buffer capabilities and the remaining Node Buffer methods are not supplied.
- `process.stdin.readText()` and `readBytes(size?)` read bounded input;
  `process.stdout.write(text)` and `process.stderr.write(text)` are async writes.
  Await I/O; these helpers do not implement Node's event-driven stream API.
- `setTimeout(callback, delay?, ...args)` schedules guest callbacks, including
  during top-level `await`; `clearTimeout(id)` cancels them. The command waits for
  pending callbacks and nested timers before applying `process.exitCode`.
  Delays use Node's integer millisecond normalization. Timers use numeric IDs;
  Node's `Timeout` methods, intervals, and immediates are not supplied. Pending
  timer work is bounded by `arrayLength`, and all waits and callbacks share the
  command deadline, cancellation signal, output limit, and interpreter budget.
- Async VFS access supports `import { readFile, writeFile } from "fs"`,
  named, default, and namespace imports from `fs/promises` or `node:fs/promises`,
  `import fs from "fs"`, and `require("fs/promises")` or
  `require("node:fs/promises")`.
  `fs` and `node:fs` also support require, default, named, and namespace imports
  of `readFileSync(path, encoding)` (or `{ encoding }`) for text reads. It returns
  the text or throws the VFS error before the next guest statement; the host
  event loop remains asynchronous. An encoding is required; binary reads and
  other synchronous filesystem operations are not supplied. `fs.promises`
  exposes the asynchronous helpers. `fs.readFile(path, encoding, callback)`
  also supports asynchronous text callbacks: success supplies `(null, text)` and
  failure supplies the VFS error. The command waits for callback reads and their
  nested timers; callbacks share timer admission limits, cancellation, and budgets.
  The existing Promise-returning `fs.readFile(path, encoding)` remains supported.
  All reads use the invocation's VFS, virtual
  cwd, cancellation signal, and interpreter value limits.
  The `stdio` and `command` SafeJS modules remain accessible.
- `require("./data.json")` loads UTF-8 JSON from the virtual filesystem and
  returns a guest value before the next statement. Relative paths use the entry
  file's directory, or virtual cwd for eval, print, and stdin source; absolute
  virtual paths are also supported. A UTF-8 BOM is accepted. Resolved paths share
  a guest cache within one invocation, preserving object identity and mutations;
  filesystem writes do not invalidate the cache. Missing files throw
  `MODULE_NOT_FOUND`; invalid JSON throws `SyntaxError` and is not cached.
  Reads and parsing retain cancellation and interpreter value limits.
- `require("./setup.cjs")` and `require("./setup.js")` execute virtual CommonJS
  modules using guest Script evaluation, with `exports`, `require`, `module`,
  `__filename`, `__dirname`, and `this === exports`. Nested relative dependencies
  resolve from the requiring module's directory. Preloads and the entry program
  share a cache, including partial exports during circular loads; failed loads
  are removed from the cache. BOMs and shebangs are accepted. Modules share the
  invocation's execution, output, deadline, and cancellation limits. Module reads
  share `maxSourceBytes` with the entry source, counting every uncached read.
  Package search, extension inference, ESM loading,
  and JSON imports are not supplied.
- `path` and `node:path` support `require`, default, named, and namespace imports.
  The POSIX helpers are `join`, `normalize`, `resolve`, `relative`, `basename`,
  `dirname`, `extname`, and `isAbsolute`, with `sep`, `delimiter`, and `posix`.
  Resolution uses the virtual cwd. Windows paths, `parse`, and `format` are not supplied.

SafeJS syntax and runtime semantics apply, with top-level `await`, bare-name
imports, and the explicit filesystem promise and path import names above.
`--input-type=module` and `--input-type=commonjs` are accepted; other synchronous fs,
native modules, package loading, `process.exit`, and the native Node
event loop are not supplied. Other `node:` and slash-containing import specifiers
remain rejected. Runtime hooks and filesystem adapters are trusted host code.

## Configuration

`nodeCommands({ runtime, limits?, replace? })` is opt-in and separate from
`agentCommands()`. `replace` defaults to `false`; duplicates fail unless set to
`true`. `createNodeCommand({ runtime, limits? })` returns one command definition;
`createNodeCommands({ runtime, limits?, replace? })` returns an array for custom
registries. All three execute the same runner.

The `SafeJsRuntime<Budget>` contract requires `run`, `createBudget`, `makeFsModule`,
and `declareHostOperation`. Optional `parseSourceModule(source, filename)` enables
syntax checking; it must parse all supplied source, throw on invalid syntax, and
never execute code or resolve imports. The public SafeJS parser checks its module
syntax subset, including strict module grammar; this is not full native Node
CommonJS syntax validation. Source byte limits and cancellation/deadline checks
still apply; the synchronous parser is trusted host work and is not preemptible
or charged to the interpreter execution-step budget. `run` receives injected `bindings` for the virtual
process and virtual JSON/builtin require helpers, guest modules, an `importSpecifiers`
allowlist for the filesystem promise and path names, a fresh budget, signal,
filename, and console sink. Use SafeJS's public factories as shown, or provide an
implementation that honors that contract, including
`declareHostOperation(operation, policy, { awaitResult: true })`: finish the
host operation and copy its result or throw its error at the guest call site,
without exposing a guest Promise. Virtual CommonJS modules and CommonJS input use
the interpreter's guest `eval` capability inside a wrapper. It never uses native
eval. SafeJS syntax and value limits still apply.

`--env-file PATH` and `--env-file-if-exists=PATH` load dotenv assignments from the
virtual filesystem. Exported shell variables take precedence; later files override
earlier files. Quoted values may span lines. Loading never changes the parent
shell or host environment, and `NODE_OPTIONS` remains an ordinary guest variable.
Environment-file bytes share the source/module byte allowance.

`--version`/`-v` reports the identity explicitly supplied as `runtime.node.version`;
without that metadata it returns a configuration diagnostic, never the host Node
version. `--completion-bash` emits Bash completion for frontend options and runtime
capabilities. An adapter may declare `runtime.node.options`, for example
`{ "--no-warnings": "boolean", "--max-old-space-size": "value" }`, only when it
implements those semantics. Admitted options are normalized and passed to `run`
as `options.nodeOptions`; adapters must apply them or fail execution. The stock
SafeJS hooks do not declare native V8, warning, buffer, or permission flags.
Undeclared flags remain refused. Runtime flags never replace command budgets or
authorize host filesystem access; a V8 heap limit is not a SafeJS memory or CPU
limit. `--` and script operands stop option parsing as usual.

All `limits` fields are optional and omitted by default: `maxSourceBytes`,
`maxInputBytes`, `maxOutputBytes`, `timeoutMs`, `maxSteps`, `maxCallDepth`,
`stringLength`, `arrayLength`, and `dataSize`. Supplying one field leaves the
others unlimited. Only explicit interpreter budgets reach the injected runtime.

Invalid options and execution parse failures return status 2; syntax-check failures return 1; guest failures return 1;
command/interpreter limits return 124. Successful programs return their virtual
exit code, initially 0. Parent cancellation follows the shell's rejection contract.
Shell limits still apply independently. Cancellation is cooperative and cannot
undo completed effects or stop uncooperative host work; budgets do not bound RSS.

## Explicit worker provider

The separate `nodeCommands({ provider, grants?, limits?, replace? })` API remains available
for hosts supplying a `NodeRuntimeProvider` for the restricted synchronous profile
below. Do not combine `provider`/`grants` with `runtime`. Provider `limits` use the
restricted profile fields, such as `sourceBytes`, `operations`, `outputBytes`,
`admissionMs`, `memoryBytes`, `steps`, and individual Worker heap/stack budgets.
Each is optional; an omitted field is unlimited. Transfer chunks remain 64 KiB
while total payloads, metadata, operations, and frame counts have no default cap.
`createNodeWorkerProvider` accepts an explicitly authorized static engine adapter;
it never discovers or loads SafeJS automatically. Entry URLs and identity strings
are configuration, not byte authentication or host authorization. Guest code does
not receive native Worker/SAB/ports, host filesystem, or native process objects.

The profile is NP1-CJS-WRQ-L-SYNC-1: -e/--eval, primitive -p/--print, .cjs entry and noninteractive stdin source; finite process argv/env and synchronous text fs/JSON/POSIX path facades. .js, ESM/TLA, npm/npx, package search, local JavaScript require, buffers, asynchronous fs, process.exit, Promise constructor and native eval/Function/subprocess fallback are refused. Promise.race([]) is the qualified pending-job idiom, not proof that every guest job settles.

All seven grants default to false: sourceRead, dataRead, dataWrite, jsonModules, stdinRead, stdoutWrite, stderrWrite. Grants authorize the supplied VFS namespace; configure the filesystem's actual authority separately. Entry files require sourceRead; stdin source requires sourceRead plus stdinRead. Inline source is already supplied data. JSON modules require dataRead plus jsonModules and fresh canonical-path authorization on every require; aliases share a per-invocation guest cache, writes do not invalidate it. Paths remain virtual and pathname checks are not atomic backing-identity guarantees. Writes use checked w/wx VFS operations. Capability denial is distinct from a genuinely typed provider EROFS error.

Source/data decoding uses UTF-8 replacement. Exactly one leading BOM is stripped from source and JSON-module text, but not ordinary file text. Writes encode text as UTF-8. Only the declared finite text overloads are accepted; no Promise substitutes for readFileSync/writeFileSync. The source-admission/lowering and interpreted value checks are module-owned code requiring qualification with the chosen engine; bare public engine bytes alone do not establish containment.

The owner registers cleanup before acquisition. Provider prepare is inert. A start rejection is escaping execution, not an inferred profile error based on class, code or equality. An internal profile selection returns an explicit profileFailure completion. Caller reason wins, then escaping execution/control/sink, cleanup failure, then numeric status. Fatal failure aborts only invocation-private parent work before provider retirement; normal entry-return cutoff drains already admitted work. Parent FS errors retain their actual reference until postcopy delivery. Only genuine typed FS-operation errors may become selected own-data guest DTOs; stack/cause are never read or transported. Ordinary FS-shaped errors and sink/control failures remain raw.

Status0/1/2 means clean entry return / guest failure / private profile failure only after confirmed provider retirement and owned parent cleanup. Unknown acquisition/exit or failed cleanup is not clean. Raw command invocation preserves actual reasons; enclosing public Shell applies its existing error mapping. Bounded diagnostic publication is awaited, including publisher cleanup, and records undefined fault presence without replacing the primary reason. It may report diagnosis unavailable; it does not serialize arbitrary errors.

The command-owned logical memory ledger is unlimited unless `memoryBytes` is
configured. The reference transport uses a 197056-byte SAB for transfer chunks.
`admissionMs` optionally bounds admission and execution until the entry returns;
cleanup remains independently owned. Worker heap/stack fields are supplied only
when configured, and do not bound RSS. Providers receive only explicit caller budgets in `request.limits` and must
honor them; these checks do not preempt arbitrary host code or native allocations.

The reference owner closes admission at the actual entry-return marker after required output, wakes blocked sync transport on cancellation and confirms Worker exit. This lifetime-retirement profile can abandon guest continuations; it is not all-jobs-settled semantics. Node-local services and errors do not add fields to shared ShellLimits, Budget or AST contracts. No shared budget is reset.
