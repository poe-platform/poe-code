# @poe-code/safejs

**Run agent orchestration as code, not as a state machine.**

SafeJS is a tiny, deterministic JavaScript-subset interpreter. You write the orchestration as a regular `async/await` script; the runtime sandboxes it, snapshots it on every yield, and only lets it touch the host through modules you register.

It is the engine behind Poe Code's pipelines, experiment loops, and superintendent runs.

## Why use it

- **Orchestration as code.** Multi-agent shapes — pipeline, experiment, superintendent, custom — run as a JavaScript subset. No DSL, no JSON state machine, no per-step LLM round trip.
- **Deterministic & sandboxed.** No `eval`, no `Function` constructor, no `class`, no dynamic import, no `globalThis`, and no filesystem, process, subprocess, or network access unless you register a module for it. Imports are limited to modules you register. Budgets cap steps, depth, deadlines, string, array, and collection sizes.
- **Crash-safe long runs.** Every `await` yields a snapshot. The scheduler writes them atomically to disk on an interval. A run can be resumed against the original source — the source hash is verified before restore.
- **File-based plans.** A `.safejs` file, legacy `.ajs` file, or markdown file with YAML frontmatter and a `js` fenced block is the unit of work. Frontmatter holds the plan; the script walks it.
- **MCP code mode.** Connect to an MCP server once, then call tools imperatively from the script — no LLM in the loop for the orchestration layer.

## Sandbox by design

SafeJS runs untrusted-by-default code. Nothing reaches the host by default — no filesystem, `exec`, `process`, or network primitives — and there is no escape hatch: no `eval`, no `Function`, no dynamic `import()`, no `globalThis`. A script can only touch the host through modules the caller registers in `run({ modules })`.

When you need subprocess or HTTP capability, build a host module with the _exact_ surface you want to expose (the specific commands or URLs) and register it explicitly. The bundled modules (`agent`, `git`, `harness`, `log`, `metric`, `mcp`, `env`, `time`, `fail`) follow that rule; treat them as the model for anything you add. The same advice holds for the filesystem: when a harness only needs a few paths, a purpose-built module naming them is narrower — and better — than the `fs` module below.

### The optional `fs` module

`makeFsModule({ root, fs })` is bundled but never registered for you. It exists only once an embedder puts it in the registry; `poe-code harness run --fs` and `poe-safejs --fs` are the flags that do that.

Its surface is `node:fs/promises`, not a poe-shaped subset of it: `access`, `appendFile`, `chmod`, `copyFile`, `cp`, `link`, `lstat`, `mkdir`, `mkdtemp`, `readFile`, `readdir`, `readlink`, `realpath`, `rename`, `rm`, `rmdir`, `stat`, `symlink`, `truncate`, `utimes`, `writeFile`, plus `constants` (`F_OK`, `R_OK`, `W_OK`, `X_OK`, `COPYFILE_EXCL`).

**Compliance rule for the Node-backed module.** Calls delegated to `node:fs/promises` preserve its results and error metadata (`name`, `message`, `code`, `errno`, `syscall`, `path`, and `dest`), subject to the supported-result and capability restrictions below. Native argument validation that SafeJS delegates remains runtime-dependent: for example, a fractional `access` mode can be rejected with `RangeError`/`ERR_OUT_OF_RANGE` or accepted by the host Node version. Differential conformance tests cover delegated behavior; SafeJS-owned validation follows the stable contract below rather than claiming exact native parity across Node versions.

**Stable path-validation errors (Node >=18.18).** For filesystem operation path arguments, except for the explicitly refused Buffer/URL forms below, invalid types raise `TypeError` with `code: "ERR_INVALID_ARG_TYPE"`; NUL-bearing strings raise `TypeError` with `code: "ERR_INVALID_ARG_VALUE"`. Diagnostics name the offending argument and describe the received value before path normalization, confinement probes, or filesystem I/O. These SafeJS-owned Node-style diagnostics are stable, not copies of each Node version's wording, and apply with or without a root and with shared adapters. In particular, a NUL-bearing `mkdtemp` prefix always receives the coded `ERR_INVALID_ARG_VALUE` rejection; SafeJS does not reproduce Node 18.18.2's uncoded native TypeError for that input. This normalization does not translate backend errors or narrow Node >=18.18 support.

Shared adapter mode is not a claim of exact native-node conformance: the supplied adapter and bridge determine supported operations and errors, and unsupported operations do not fall back to the host filesystem.

**Deviations that throw.** Each names the unsupported capability rather than coercing, ignoring, or approximating it:

- Buffer results. The sandbox has no `Buffer`/`Uint8Array`, so a call whose node answer would be one (no encoding, `encoding: "buffer"`, `encoding: null`) is refused. Every string encoding node supports is supported.
- `bigint: true` on `stat`/`lstat`.
- `Buffer` and `URL` path arguments, both of which node accepts. An integer path is **not** a deviation: `fs/promises` has no descriptor path form, so node blames its argument type like any other non-string and the module says the same thing.
- The `signal` option — cancelling a run is the host's to request via `run({ signal })`, not the script's.
- `FileHandle`/`open`, streams, `watch`, `opendir`, and the callback/sync APIs: not exported.
- `Date` stat fields — the `*Ms` numbers are exposed instead.
- Any option node declares that the module cannot honour, and any option node does not declare at all. A silently ignored option is a worse deviation than a refused one.

**Deviations that diverge.** Neither announces itself the way the refusals above do:

- `error.stack` is sandbox-shaped rather than a node stack. The bridge rewrites the frames to the script's own, so node's frames are neither available to a script nor meaningful to one that ran none of them; node's text survives only in the `name: message` header the stack is still headed by. Reading a property is not a call there is anything to refuse.
- Given both a bad path and another bad argument, SafeJS blames the path where node may blame the other. The module validates paths itself — `root` rewrites them before node sees them — so `readFile(42, "utf9")` reports the encoding in node and the path here. Each error is still node's own, shaped as node shapes it; only which of two invalid arguments is reported can differ.

**`root` confinement.** Without `root` or `adapter`, the module delegates to `node:fs/promises` (or the injected `fs`) without path confinement. Node-backed relative roots and paths retain their host-working-directory semantics. With a root and no explicit adapter `cwd`, relative paths resolve against `root`. Every resulting path — including the second path of `rename`, `copyFile`, `cp`, `link`, and `symlink`, and the `mkdtemp` prefix — must satisfy confinement. Escapes via `..`, absolute paths, symlink targets, or hardlinks reject with a node-shaped `EACCES` carrying the matching `errno`, the attempted `syscall`, `path`, and `dest`, so a script branches on `error.code` exactly as it would against real node. node's own errnos survive the check: a symlink loop inside root still surfaces `ELOOP`. `cp`'s `dereference: true` is refused under a root — `cp` is the one call that reads a whole tree, a link nested inside it is never canonicalized, and node would copy an escaping target inside root under a name every later check reads as contained.

With `adapter`, an optional absolute virtual `cwd` supplies the relative-path base, never a host directory or a confinement root. When `cwd` is omitted, rooted calls retain their canonical-root-relative default and unrooted calls start at virtual `/`.

The adapter-only SDK options are `cwd?: string` and `signal?: AbortSignal`. `cwd` must be absolute and NUL-free; it need not itself be inside `root`, but every operation's resulting paths still undergo confinement checks. A caller may supply a borrowed host signal with `makeFsModule({ ...await resolveFsConfig(config), signal })`; it is not automatically linked to a run signal and has no JSON representation. Both options require `adapter`; they do not change the legacy Node-shaped `fs` mode. Cancellation cannot undo host effects already admitted.

**`readdir` order** is filesystem-dependent, exactly as in node: node does not sort, and neither does this. Compare names as a set.

**Resume policies** are declared per operation. Reads (`access`, `lstat`, `readFile`, `readdir`, `readlink`, `realpath`, `stat`) re-issue after a restore; every operation that mutates the filesystem is `read-side-effect` and is not blindly re-applied.

**Platforms.** darwin and linux. `makeFsModule` throws on win32 rather than half-supporting it: node answers a different code there, a path carries a drive letter confinement has no rule for, and a symlink needs a privilege a script cannot hold — so an embedder is told at startup rather than by the first call that lands.

**Refreshing the node-truth fixture.** `npm run record:fs-conformance` drives the shared case table against real `node:fs/promises` under `os.tmpdir()`, cleans up after itself, and writes the entry for the platform it ran on, leaving every other platform's recording untouched. Run it on each platform the suite runs on, since node's fs errors are the platform's. The suite fails — rather than quietly proving nothing — when the running platform has no recording, or when a recording is missing a case the table defines, so adding a case forces a re-record. Never hand-edit the fixture.

## Scripts are JavaScript

A `.safejs` body reads like a small JS program. No DSL, no decorators, no custom syntax — capabilities are imports, options are object literals, control flow is plain `if`/`for`/`try`. Anything that would need a non-JS shape — version pins, runtime config, metadata, schedules — belongs in the markdown frontmatter or the caller's options, not in the script body.

The default linter accepts runtime-supported `var`, `switch`, `this`, sandbox constructor calls, and top-level `await` inside control-flow blocks. Both `poe-code harness run` and `poe-safejs` lint before execution; host-escape forms such as `eval` and `Function` remain disallowed.

## At a glance

```js
import { spawn } from "agent";
import { agents, tasks } from "harness";
import { event } from "log";

for (const task of tasks) {
  event("task.started", { id: task.id });
  const build = await spawn(agents.builder, { prompt: task.prompt });
  const review = await spawn(agents.reviewer, { prompt: build.summary });
  event("task.completed", { id: task.id, review: review.summary });
}
```

That snippet runs inside the sandbox. `agent`, `harness`, and `log` are host modules registered by the caller; everything else is plain JavaScript.

## Use cases

### 1. Multi-agent orchestrator

You have several agent personas (builder, reviewer, judge, owner, …) and want to run them in a specific shape. Write the shape as a script.

See:

- `examples/pipeline.md` — sequential builder → reviewer over a list of tasks
- `examples/superintendent.md` — builder + parallel inspectors + judge + owner, with rounds
- `examples/experiment.md` — checkpoint → attempt → measure → keep-or-revert loop

Run any of them with the bundled CLI:

```bash
npx --package poe-code poe-safejs examples/pipeline.md
```

`poe-safejs` is a zero-cost local runner for markdown harness files. It
reads all executable fenced blocks in order, lints them against the example module registry,
then runs it with stub host modules: `agent.spawn` returns a canned successful
summary, `git` and `metric` are deterministic fakes, and logs are printed as
JSONL. If a markdown file has no `js` block, the CLI keeps backwards-compatible
demo mode and dispatches `kind: pipeline`, `superintendent`, or `experiment`
frontmatter to the bundled shapes. Use `runHarness()` for raw `.safejs` or legacy `.ajs` files.

`--fs` registers the [`fs` module](#the-optional-fs-module) — a real filesystem, unlike the
stubs above — confined to `--fs-root <path>`, which defaults to the script's directory.
`--fs-root` without `--fs` is a usage error.

Both this CLI and `poe-code harness run` also accept `--fs-config <path>` for explicit
Node filesystem configuration. The JSON file contains `{ "adapter": { "type": "memory", "options": {} } }`
or, for an existing machine directory, `{ "adapter": { "type": "real", "options": { "root": "/srv/project" } }, "root": "/work", "cwd": "/work/src" }`.
The real adapter's `options.root` is an absolute host directory; the outer `root`
is optional, absolute virtual confinement. Omitting it adds no module confinement.
Optional `cwd` is an absolute virtual relative-path base, independent of both roots.
Omitting `cwd` preserves the module's rooted default rather than injecting `/`.
The config-file path resolves against invocation cwd, but configured roots and
virtual `cwd` are not host-cwd-relative or remapped into a worktree. `signal` is
not a config-file option. `--fs-config` cannot be repeated or
combined with `--fs` or `--fs-root`. Execution validates configuration shape, virtual
roots, virtual `cwd`, and adapter option syntax before construction or script/snapshot I/O, except
for reading the config itself. Real directory existence/access checks necessarily
run during construction. A harness dry run previews the parsed configuration without
constructing or checking the backend.

Use `poe-code harness run` when you want the same lint-and-run flow against real
configured agents and host integrations.

### 2. MCP code mode

Letting an LLM call MCP tools turn-by-turn is expensive, slow, and non-deterministic. With SafeJS, the LLM produces (or you author) a script that calls MCP tools directly:

```js
import { client, server } from "mcp";

const fs = await client(server("files"));
const tools = await fs.tools();
const result = await fs.tool("read_file", { path: "/tmp/work/notes.md" });
```

The host grants named stdio or HTTP servers through `makeMcpModule({ servers, requestTimeoutMs?, closeTimeoutMs?, maxToolPages?, signal?, fetch?, spawn? })` or either CLI's `--mcp-config <path>`. Connections are lazy and cleaned up per run; see [`MCP.md`](MCP.md) for configuration, environment policy, methods, and replay.

### 3. Sandboxed user scripting

Embed SafeJS in your own product when you want to let users (or models) write small programs against a fixed set of capabilities you control. The sandbox guarantees they cannot reach outside the modules you registered, can't allocate unbounded memory, and can't run forever.

## Spec — index card

| Aspect                         | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source unit**                | one module body; `import` from registered modules only                                                                                                                                                                                                                                                                                                                                                                                          |
| **Linter-approved syntax**     | `const`, `let`, `var`, arrays, objects, destructuring, rest/spread, ordinary and async functions, synchronous generators, arrows, top-level `await` including nested control flow, `if`/`else`, `switch`, `this`, loops, labels, `break`, `continue`, `try`/`catch`/`finally`, `throw`, `return`, expressions, assignments and updates, template literals, optional chaining, nullish coalescing, regex literals, and sandbox constructor calls |
| **Disallowed syntax**          | `class`, async generators, `with`, `eval`, `Function`, dynamic import, `import.meta` assignment, BigInt literals, legacy octal forms, and HTML-style comments                                                                                                                                                                                                                                                                                   |
| **Lint extras**                | host calls should be awaited or intentionally returned; large literals and unreachable code are reported                                                                                                                                                                                                                                                                                                                                        |
| **Built-in globals**           | `console`, `JSON`, `Error`, `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`, `AggregateError`, `Math`, `Object`, `Array`, `String`, `Number`, `Boolean`, `Map`, `Set`, `RegExp`, `Promise`, `structuredClone`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `Infinity`, `NaN`                                                                                                                                                      |
| **Determinism**                | `Math.random()` is resumable by default; `randomSeed` selects a reproducible sequence, and snapshots retain RNG state. Harness runs also provide replayable `time.now()` / `time.uuid()` through the `time` module.                                                                                                                                                                                                                             |
| **Snapshots**                  | written at most every `snapshotIntervalMs` (default 30 s) to `snapshotPath`; resumed via `restore()` if `sourceHash` matches                                                                                                                                                                                                                                                                                                                    |
| **Budgets**                    | `maxSteps`, `deadline`, `maxCallDepth`, `stringLength`, `arrayLength`, and collection entry limits                                                                                                                                                                                                                                                                                                                                              |
| **Cancellation**               | `AbortSignal`, observed at every host call and yield point                                                                                                                                                                                                                                                                                                                                                                                      |
| **Unsupported language edges** | prototype chains and binary `in` are unsupported; synchronous source generators can be reconstructed by replay, not opaque host iterators/native frames; regex flags are `g/i/m/s`, not `u/y`; backreferences, lookaround, named groups, and Unicode property escapes are unsupported                                                                                                                                                           |

## Supported globals

These are pre-bound in every script — you don't need to import them.

- **`Promise`** — constructor and static `all`, `race`, `allSettled`, `any`, `resolve`, `reject`; sandbox promises expose `then`, `catch`, and `finally`
- **`Math`** — numeric methods including `abs`, `acos`, `acosh`, `asin`, `asinh`, `atan`, `atan2`, `atanh`, `ceil`, `cbrt`, `clz32`, `cos`, `cosh`, `exp`, `expm1`, `floor`, `fround`, `hypot`, `imul`, `log`, `log1p`, `log10`, `log2`, `max`, `min`, `pow`, `round`, `sign`, `sin`, `sinh`, `sqrt`, `tan`, `tanh`, `trunc`, plus standard constants and `random`
- **`Object`** — `keys`, `values`, `entries`, `hasOwn`, `is`, `fromEntries`, `assign`, `freeze`, `isFrozen`
- **`Array`** — callable/constructable array factory plus `isArray`, `from`, `of`
- **`String`** — value coercion plus `raw`, `fromCharCode`, `fromCodePoint`
- **`Number`** — value coercion plus `isFinite`, `isNaN`, `isInteger`, `isSafeInteger`, `parseInt`, `parseFloat`, and standard numeric constants
- **`Boolean`** — value coercion
- **`Map`, `Set`** — sandbox collection constructors and methods (`get`/`set`/`has`/`delete`/`clear`/`forEach`/`keys`/`values`/`entries`, as applicable).
- **`RegExp`** — callable or constructable regex factory; literals and flags `g`, `i`, `m`, `s` are supported, but flags `u` and `y` are not
- **`Error`, `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`, `AggregateError`** — callable and constructable factories
- **`JSON`** — `parse`, `stringify` (replacer must be `null`/`undefined`; indent must be number/string/undefined)
- **`console`** — `log`, `error` (routed to the `sink` you pass to `run()`)
- **Miscellaneous** — `structuredClone`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `Infinity`, `NaN`

What is **not** available as a global: `Date`, `WeakMap`, `WeakSet`, `Symbol`, `BigInt`, `Reflect`, `Proxy`, `globalThis`, `setTimeout`, `setInterval`, `fetch`, `URL`, and other browser or Node globals. Expose a host module if you need any of them.

SafeJS implements a subset of ECMAScript methods. Arrays include the common iteration, search, copy, and mutation methods; strings include regex-aware `match`, `matchAll`, `search`, `split`, `replace`, and `replaceAll`; numbers include `toString`, `toFixed`, `toExponential`, and `toPrecision`; functions expose `call`, `apply`, and `bind`. See `src/interp/methods/` for the implemented methods.

Structural receiver mutations such as adding a Map entry inside its own `forEach` callback or pushing onto an array inside its own `reduce` callback are rejected with `SandboxError` code `reentry`. This restriction is separate from read-only array callback composition and direct Map/Set `for...of` iteration; it is not a blanket ban on nested reads or live collection iteration.

Source-function own-property assignments such as `configured.option = 3` are unsupported and throw `TypeError`. Function arity and captured callable property data are separate contracts: host callback adapters preserve the source signature's `length` in the tested direct-argument and array-property paths, including default, rest, and bound signatures. This does not enable property writes or imply full native function reflection; see [checkpoint callback contracts](CHECKPOINT_REPLAY.md#external-reconciliation).

## Built-in host modules

Registered by the caller via the factory functions exported from the package. None of them are auto-installed — you choose which to wire up per run.

| Import    | Factory                                  | What it gives the script                                                                                                                                |
| --------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`   | `makeAgentModule(spawnAgent)`            | `spawn(definition, { prompt, mode, model, mcp, cwd, timeoutMs, check })` — returns nonzero results unless `check: true`; checked errors retain `result` |
| `git`     | `makeGitModule(cwd)`                     | `head`, `checkpoint`, `commit`, `revert`, `diff`                                                                                                        |
| `harness` | `makeHarnessModule(frontmatter, meta)`   | `tasks`, `agents`, `meta` (kind, version, filepath, frontmatter), `applyConstraints(prompt)`                                                            |
| `log`     | `makeLogModule(sink?)`                   | `info`, `error`, `event` (JSONL by default)                                                                                                             |
| `metric`  | `makeMetricModule(npmRunner)`            | `run(name)` — runs an npm script and parses its last numeric line                                                                                       |
| `mcp`     | `makeMcpModule({ servers, ...options })` | Named stdio/HTTP clients: `tools()`, `tool(name, args)`, `toolBatch(calls)`, `close()`; custom connectors remain supported                              |
| `env`     | `makeEnvModule(allowListOrOptions)`      | `get(name)` — explicit grants; denied reads throw, granted missing values return `undefined`                                                            |
| `fs`      | `makeFsModule({ root?, fs? })`           | `node:fs/promises`, optionally confined to `root` — see [the optional `fs` module](#the-optional-fs-module)                                             |
| `time`    | `makeTimeModule({ now?, random? })`      | `now`, `uuid`                                                                                                                                           |
| `fail`    | `makeFailModule()`                       | `default(message)` — throws `HarnessFailure`                                                                                                            |

## Quick start

```ts
import { lint, run } from "poe-code/safejs";

const source = `
  import { greet } from "custom";

  const user = { profile: { name: "Ada" }, tags: ["admin", "builder"] };
  const { profile: { name }, tags: [primaryTag] } = user;
  const greeting = await greet(name);

  return \`\${greeting} [\${primaryTag ?? "user"}] \${user.profile?.name}\`;
`;

const modules = {
  custom: { greet: async (name) => `hello ${name}` }
};

const errors = lint(source, { modules: { custom: ["greet"] } }).filter(
  (d) => d.severity === "error"
);
if (errors.length > 0) throw new Error(errors.map((d) => d.message).join("\n"));

const result = await run(source, { modules });
if (!result.ok) throw result.error;
console.log(result.returnValue); // "hello Ada [admin] Ada"
```

That prints `"hello Ada [admin] Ada"`.

## Harness files

`runHarness(filepath, options)` loads a script from disk, lints it, then runs it.

- `.safejs` and legacy `.ajs` files: the entire file is the script. Frontmatter is `{}`. The `harness` module is auto-excluded since there's nothing for it to surface.
- `.md` files: YAML frontmatter is parsed; executable fenced blocks form one script in document order. If there is no executable fenced block, the entire markdown body is treated as script source.

```ts
import { makeHarnessModule, runHarness } from "poe-code/safejs";

const result = await runHarness("docs/plans/example.md", {
  modulesFor: (frontmatter, meta) => ({
    harness: makeHarnessModule(frontmatter, meta),
    custom: { greet: (name) => `hello ${name}` }
  }),
  snapshotPath: ".cache/example.snapshot.json"
});
```

## API

### `parse(source, filename?)`

Parses a single top-level expression or statement and returns an AST with source spans. Throws on parse errors or disallowed syntax.

### `lint(source, options?)`

Returns diagnostics for the SafeJS subset and registered modules.

- `filename?` — used in diagnostics, defaults to `<input>`
- `modules?` — registered module metadata used to validate `import` statements

Diagnostics cover parse errors, unknown modules and exports, import cycles, unknown identifiers, async-safety violations, subset-specific method restrictions, and warnings for unused bindings.

### Lint vs. runtime

Lint validates names and imports before runtime. By default it knows the built-in
globals listed above, but it does not inspect `run({ bindings })` or host module
objects. Pass `modules` when the script imports host modules, and pass
`allowedGlobals` for any extra names you provide through `bindings`.

The harness CLI mirrors its stub runtime by calling `lint(source, {
allowedExportNames: ["schema"], filename, modules })`, where `modules` is derived
from the example registry. `runHarness()` derives the same `modules` metadata from
`modulesFor(frontmatter, meta)`. External editors or CI checks should use the
same `filename`, `modules`, `allowedExportNames`, and any extra `allowedGlobals`
as the runner they are mirroring.

### `run(source, options?)`

Executes a script module. A fulfilled call returns one of these shapes:

- `{ ok: true, returnValue?, snapshot, stats }` on success
- `{ ok: false, error, snapshot, stats }` for a returned interpreter diagnostic

The `run()` promise can also reject, including for application throws and API failures. Handle both channels: catch rejection around `await run(...)` and check `result.ok` when it fulfills. Source shape can affect the failure channel; lint acceptance does not establish runtime support. A guest return value such as `{ ok: false }` is application data and can appear inside an API result with `ok: true`; inspect `returnValue` separately.

Options: `bindings`, `budget`, `modules`, `randomSeed`, `signal`, `snapshot` (prior snapshot), `snapshotIntervalMs`, `snapshotPath`, `sink`.

### `dump(resultOrPromise, { mode?, onFailure? })`

Serializes a snapshot to formatted JSON. Accepts a completed `RunResult` or the original `run()` promise. The default `mode: "capture"` requests the next yield and rejects capture while an injected host call is active. An external caller can use `mode: "replay"` to capture the latest yielded replay checkpoint during a pending host call; it does not serialize the live host operation. After rejection, `{ onFailure: "checkpoint" }` requests current replay state without changing the failure. See [external checkpoint rules](CHECKPOINT_REPLAY.md#external-checkpoints-during-host-waits) and [RECOVERY.md](RECOVERY.md).

### `restore(snapshot, { source })`

Validates a stored snapshot against the current source via `sourceHash`. Returns it unchanged on match, throws on mismatch. For changed source or supported older execution semantics, use the explicit `inspectSnapshotMigration()` / `migrateSnapshot()` continuation workflow in [MIGRATION.md](MIGRATION.md).

New runs use `jobs-v7`. Genuine `jobs-v6` snapshots retain v6 execution semantics on restore and later dumps; this compatibility does not retroactively repair historically broken raw-Promise v6 captures. Never rewrite version markers to force replay. See [execution compatibility](CHECKPOINT_REPLAY.md#execution-compatibility).

Raw `SnapshotBackend.write(snapshot)` inputs have shallow bindings: nested references can change after capture while copied primitives need not. Use public `dump`/`restore` artifacts for portable replay. Already serialized bytes cannot be changed by later source mutations, but a subsequent dump can differ, including in outer legacy projections. Tested canonical replay graphs and native observations remain intact despite real legacy function-marker alias/name loss; this is not universal whole-dump stability. See [raw views and serialized checkpoints](CHECKPOINT_REPLAY.md#raw-views-and-serialized-checkpoints).

### `runHarness(filepath, options)`

Loads, lints, and runs a harness file.

- `modulesFor(frontmatter, meta)` — returns the module registry for that file
- `signal?`, `snapshotPath?`

`LintError` is thrown before execution if lint reports errors.

## Adding a custom module

1. Build a host object exposing the values or async functions the script should see.
2. Register it under a name in `run({ modules })`.
3. Mirror the same name and exported names in `lint({ modules })` if you lint separately.
4. For explicit boundary copying, use `deepCopyToSandbox` / `deepCopyFromSandbox`.

For external recovery of a pending host call, match the genuine `hostCallResumeProvider` request and supply its real outcome and required callback disposition. Convert a reconstructed source-function callback result with that active invocation's `context.toSandboxValue`, after awaiting the appropriate `context.replayed` result. The generic copier rejects native functions; the context converter is not a general function importer and rejects adapters from another invocation. Conversion does not invoke the returned source function or replace callback identity/order evidence. See [external reconciliation](CHECKPOINT_REPLAY.md#external-reconciliation).

The runtime accepts plain objects or `Map`s at both levels:

```ts
const modules = new Map([["custom", new Map([["hello", (name: string) => `hello ${name}`]])]]);
```

For lint, an export list is enough when cycle diagnostics are not needed:

```ts
const lintModules = { custom: ["hello"] };
```

Source-backed modules (used to detect cross-module cycles) take a richer shape:

```ts
const lintModules = {
  custom: { exports: ["hello"], filename: "/repo/custom.ajs", source: "…" }
};
```

`AS-IMPORT-CYCLE` only runs against source-backed modules. External tooling that
wants cycle diagnostics must pass each module with `filename` and `source`; a
bare export-list registry such as `{ custom: ["hello"] }` remains valid for
import/export validation, but cycle detection is a no-op because the linter has
no module bodies to inspect.

## Gotchas

- **Ordinary restore is source- and execution-pinned.** Formatting-only changes can remain compatible; structural or execution-semantics changes require an explicit continuation migration. Inspect the old checkpoint, reconcile outstanding operations, select application state, and create a new checkpoint with `migrateSnapshot()` or `harness migrate`; see [MIGRATION.md](MIGRATION.md). No old frames or effects execute during migration.
- **Budgets remain host-controlled.** Exhaustion throws fatal `SandboxError`; the host can explicitly capture a current failure checkpoint and resume with a larger budget. Replay work is charged again, unsupported state can prevent recovery, and pending effects require reconciliation; see [RECOVERY.md](RECOVERY.md).
- **Old captures cannot recover lost data.** A Map capture that already split shared callable identities lacks the information needed to reconstruct the original alias. Preserve the artifact and reconcile application state before an authorized reset or migration; current replay is not a retroactive repair. See [collection identity](CHECKPOINT_REPLAY.md#collection-identity-and-older-captures).
- **Old argument digests may require reset.** In tested plain/nested-object cases, current host argument digest construction does not call source `toJSON`; old captures whose digest depended on that call refuse with reset required before host re-issue or proof-provider execution. The tested old named-array control still replays. This is not a rule for every old capture or a universal non-invocation guarantee. Reconcile prior effects before restarting; see [argument digests](CHECKPOINT_REPLAY.md#argument-digests-and-source-tojson).

## What's intentionally limited

- No user-defined classes or prototype chains.
- No async generators. Synchronous source generators can be reconstructed from source and replay history, including a suspended source loop; opaque host iterators and native generator frames are not serialized. Checkpoint timing and host recovery still apply; see [synchronous source generators](CHECKPOINT_REPLAY.md#synchronous-source-generators).
- Regex support covers common literals, `RegExp`, and string methods with flags `g`, `i`, `m`, and `s`. Other flags, including `u` and `y`, are rejected. Backreferences, lookaround, named groups, and Unicode property escapes are separate unsupported syntax.
- Binary `in` is unsupported even when lint accepts it. For an own-property check, use `Object.hasOwn(object, key)`; it does not implement prototype-chain membership. Handle both `run()` failure channels described above.
- No network or process modules in the box. Build them as host modules with the surface you want to expose. The bundled `fs` module is off until registered, and a narrower module is preferable when a harness only needs a few paths.
- No multi-file imports — a script is a single module body. Compose by registering more modules.

## Environment Variables

This package does not read package-level environment variables. `makeEnvModule(allowList)` grants exact named reads from `process.env`; `{ allow, values }` supplies explicit values without ambient fallback. Both CLIs register it only with `--env-config`. Denied reads throw `ENV_ACCESS_DENIED`; granted missing values return `undefined`. See [ENV.md](./ENV.md) for configuration, CLI/SDK parity, and secret-bearing checkpoint handling. `parse`, `lint`, `run`, `dump`, `restore`, `runHarness`, and `makeFsModule` do not read environment variables on their own.

## Configuration

This package does not read package-level config files. Runner options come through the call sites:

- `lint({ filename, modules, fix, fixRanges })`
- `run({ bindings, budget, modules, randomSeed, signal, snapshot, snapshotIntervalMs, snapshotPath, sink })`
- `runHarness({ modulesFor, signal, snapshotPath })`
- `makeFsModule({ root, fs, adapter, cwd, signal })` — `root` confines every path argument to that directory, and adds no confinement when omitted. `fs` injects a Node-shaped implementation, defaulting to `node:fs/promises`; alternatively, `adapter` supplies a shared `FileSystem` instance from the public `poe-code/safe-fs` entry (the `@poe-code/safe-fs` workspace is private). Supplying both rejects. Adapter-only `cwd` sets the absolute virtual relative-path base independently of `root`; omission retains rooted defaults or virtual `/` when unrooted. Relative adapter roots remain anchored at `/`, not at `cwd`. The optional host `signal` is supplied directly to this SDK factory, never through JSON. Node-backed paths and roots keep their host-working-directory semantics. Registering the returned module under a name in `run({ modules })` is what gives a script a filesystem at all.

`poe-safejs` exposes the Node-backed module through `--fs` and `--fs-root <path>`; `poe-code harness run` exposes the same pair, rooted at the harness directory by default. These flags retain their existing host-path behavior, including legacy worktree mapping. Both CLIs use the shared SDK helpers for `--fs-config`: `parseFsConfig(json)` validates the JSON envelope, virtual root, and virtual `cwd` without I/O; `resolveFsConfig(config, { registry? })` validates adapter options and constructs the adapter, preserving omitted `root` and `cwd` rather than adding defaults. Register `makeFsModule(await resolveFsConfig(config))` in an SDK module registry for the same access. The initial Node registry contains `memory` and `real`. An optional caller `ReadonlyMap` adds named descriptors with synchronous, I/O-free `validateOptions(options)` and an existing `FileSystemFactory`-compatible `create(options)` binding; duplicate built-in names reject. Wrapper and remote adapters can use these bindings without CLI backend branches, but are not additional built-in JSON adapters in this slice. No credentials or executable modules are loaded implicitly. These helpers configure Node filesystem access; neither virtual confinement nor backend capability flags establish an OS sandbox or grant browser access to a machine directory. A custom CLI `modulesFor` registry may add other modules, but cannot replace an explicitly configured `fs` module.
