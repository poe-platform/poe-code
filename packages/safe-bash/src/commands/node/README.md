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
import { Budget, run, makeFsModule, declareHostOperation } from "poe-code/safe-js";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(nodeCommands({
  runtime: {
    run, makeFsModule, declareHostOperation,
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
- `node FILE` reads a virtual file, including `.js` files. `node -` and bare
  `node` read source from stdin once, leaving no guest input. File and inline
  programs retain stdin for data. `--` ends command-option parsing.
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
  exposes the asynchronous helpers. All reads use the invocation's VFS, virtual
  cwd, cancellation signal, and interpreter value limits.
  The `stdio` and `command` SafeJS modules remain accessible.
- `require("./data.json")` loads UTF-8 JSON from the virtual filesystem and
  returns a guest value before the next statement. Relative paths use the entry
  file's directory, or virtual cwd for eval, print, and stdin source; absolute
  virtual paths are also supported. A UTF-8 BOM is accepted. Resolved paths share
  a guest cache within one invocation, preserving object identity and mutations;
  filesystem writes do not invalidate the cache. Missing files throw
  `MODULE_NOT_FOUND`; invalid JSON throws `SyntaxError` and is not cached.
  Reads and parsing retain cancellation and interpreter value limits. Package
  search, extension inference, local JavaScript loading, and JSON imports are
  not supplied.
- `path` and `node:path` support `require`, default, named, and namespace imports.
  The POSIX helpers are `join`, `normalize`, `resolve`, `relative`, `basename`,
  `dirname`, `extname`, and `isAbsolute`, with `sep`, `delimiter`, and `posix`.
  Resolution uses the virtual cwd. Windows paths, `parse`, and `format` are not supplied.

SafeJS syntax and runtime semantics apply, with top-level `await`, bare-name
imports, and the explicit filesystem promise and path import names above.
`--input-type=module` is accepted; CommonJS input mode, other synchronous fs,
native modules, package/local JavaScript loading, `process.exit`, and the native Node
event loop are not supplied. Other `node:` and slash-containing import specifiers
remain rejected. Runtime hooks and filesystem adapters are trusted host code.

## Configuration

`nodeCommands({ runtime, limits?, replace? })` is opt-in and separate from
`agentCommands()`. `replace` defaults to `false`; duplicates fail unless set to
`true`. `createNodeCommand({ runtime, limits? })` returns one command definition;
`createNodeCommands({ runtime, limits?, replace? })` returns an array for custom
registries. All three execute the same runner.

The `SafeJsRuntime<Budget>` contract requires `run`, `createBudget`, `makeFsModule`,
and `declareHostOperation`. `run` receives injected `bindings` for the virtual
process and virtual JSON/builtin require helpers, guest modules, an `importSpecifiers`
allowlist for the filesystem promise and path names, a fresh budget, signal,
filename, and console sink. Use SafeJS's public factories as shown, or provide an
implementation that honors that contract, including
`declareHostOperation(operation, policy, { awaitResult: true })`: finish the
host operation and copy its result or throw its error at the guest call site,
without exposing a guest Promise. There are no runtime environment switches.

| `limits` option | Default |
| --- | --- |
| `maxSourceBytes` | 1 MiB of supplied source |
| `maxInputBytes`, `maxOutputBytes` | 8 MiB each; output combines stdout/stderr |
| `timeoutMs` | 5,000 |
| `maxSteps` | 100,000 |
| `maxCallDepth` | 128 |
| `stringLength` | 1 MiB |
| `arrayLength` | 100,000 |
| `dataSize` | 16 MiB |

Invalid options and parse failures return status 2; guest failures return 1;
command/interpreter limits return 124. Successful programs return their virtual
exit code, initially 0. Parent cancellation follows the shell's rejection contract.
Shell limits still apply independently. Cancellation is cooperative and cannot
undo completed effects or stop uncooperative host work; budgets do not bound RSS.

## Explicit worker provider

The separate `nodeCommands({ provider, grants?, replace? })` API remains available
for hosts supplying a `NodeRuntimeProvider` for the restricted synchronous profile
below. Do not combine `provider`/`grants` with `runtime`/`limits`.
`createNodeWorkerProvider` accepts an explicitly authorized static engine adapter;
it never discovers or loads SafeJS automatically. Entry URLs and identity strings
are configuration, not byte authentication or host authorization. Guest code does
not receive native Worker/SAB/ports, host filesystem, or native process objects.

The profile is NP1-CJS-WRQ-L-SYNC-1: -e/--eval, primitive -p/--print, .cjs entry and noninteractive stdin source; finite process argv/env and synchronous text fs/JSON/POSIX path facades. .js, ESM/TLA, npm/npx, package search, local JavaScript require, buffers, asynchronous fs, process.exit, Promise constructor and native eval/Function/subprocess fallback are refused. Promise.race([]) is the qualified pending-job idiom, not proof that every guest job settles.

All seven grants default to false: sourceRead, dataRead, dataWrite, jsonModules, stdinRead, stdoutWrite, stderrWrite. Grants authorize the supplied VFS namespace; configure the filesystem's actual authority separately. Entry files require sourceRead; stdin source requires sourceRead plus stdinRead. Inline source is already supplied data. JSON modules require dataRead plus jsonModules and fresh canonical-path authorization on every require; aliases share a per-invocation guest cache, writes do not invalidate it. Paths remain virtual and pathname checks are not atomic backing-identity guarantees. Writes use checked w/wx VFS operations. Capability denial is distinct from a genuinely typed provider EROFS error.

Source/data decoding uses UTF-8 replacement. Exactly one leading BOM is stripped from source and JSON-module text, but not ordinary file text. Writes encode text as UTF-8. Only the declared finite text overloads are accepted; no Promise substitutes for readFileSync/writeFileSync. The source-admission/lowering and interpreted value checks are module-owned code requiring qualification with the chosen engine; bare public engine bytes alone do not establish containment.

The owner registers cleanup before acquisition. Provider prepare is inert. A start rejection is escaping execution, not an inferred profile error based on class, code or equality. An internal profile selection returns an explicit profileFailure completion. Caller reason wins, then escaping execution/control/sink, cleanup failure, then numeric status. Fatal failure aborts only invocation-private parent work before provider retirement; normal entry-return cutoff drains already admitted work. Parent FS errors retain their actual reference until postcopy delivery. Only genuine typed FS-operation errors may become selected own-data guest DTOs; stack/cause are never read or transported. Ordinary FS-shaped errors and sink/control failures remain raw.

Status0/1/2 means clean entry return / guest failure / private profile failure only after confirmed provider retirement and owned parent cleanup. Unknown acquisition/exit or failed cleanup is not clean. Raw command invocation preserves actual reasons; enclosing public Shell applies its existing error mapping. Bounded diagnostic publication is awaited, including publisher cleanup, and records undefined fault presence without replacing the primary reason. It may report diagnosis unavailable; it does not serialize arbitrary errors.

The fixed16MiB command-owned logical ledger includes a1MiB diagnostic reserve. The reference transport uses a197056-byte SAB;5s is admission-only, not a whole invocation or cleanup bound. V8 old32/young8/code8/stack4MiB limits are separate from the logical ledger and not RSS. Source256KiB bounds the combined trusted facade and interpreted user program, not every raw256KiB input. Separate operation/read/write/output quotas can make individual maxima unreachable together. Providers must honor their declared VFS/source bounds; these checks do not promise preallocation control over arbitrary host providers or all native guest allocations.

The reference owner closes admission at the actual entry-return marker after required output, wakes blocked sync transport on cancellation and confirms Worker exit. This lifetime-retirement profile can abandon guest continuations; it is not all-jobs-settled semantics. Node-local services and errors do not add fields to shared ShellLimits, Budget or AST contracts. No shared budget is reset.
