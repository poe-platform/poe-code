# @poe-code/safejs

**Run agent orchestration as code, not as a state machine.**

SafeJS is a tiny, deterministic JavaScript-subset interpreter. You write the orchestration as a regular `async/await` script; the runtime sandboxes it, snapshots it on every yield, and only lets it touch the host through modules you register.

It is the engine behind Poe Code's pipelines, experiment loops, and superintendent runs.

## Why use it

- **Orchestration as code.** Multi-agent shapes — pipeline, experiment, superintendent, custom — are just JS. No DSL, no JSON state machine, no per-step LLM round trip.
- **Deterministic & sandboxed.** No `eval`, no `Function` constructor, no `class`, no dynamic import, no `globalThis`, and no built-in filesystem, process, subprocess, or network access. Imports are limited to modules you register. Budgets cap steps, depth, deadlines, string, array, and collection sizes.
- **Crash-safe long runs.** Every `await` yields a snapshot. The scheduler writes them atomically to disk on an interval. A run can be resumed against the original source — the source hash is verified before restore.
- **File-based plans.** A `.safejs` file, legacy `.ajs` file, or markdown file with YAML frontmatter and a `js` fenced block is the unit of work. Frontmatter holds the plan; the script walks it.
- **MCP code mode.** Connect to an MCP server once, then call tools imperatively from the script — no LLM in the loop for the orchestration layer.

## Sandbox by design

SafeJS runs untrusted-by-default code. The interpreter ships **no** `fs`, `exec`, `process`, or network primitives, and there is no escape hatch: no `eval`, no `Function`, no dynamic `import()`, no `globalThis`. A script can only touch the host through modules the caller registers in `run({ modules })`.

When you need filesystem, subprocess, or HTTP capability, build a host module with the _exact_ surface you want to expose (the specific paths, commands, or URLs) and register it explicitly. Don't ship a generic `fs` module — narrow the capability to what this harness actually needs. The bundled modules (`agent`, `git`, `harness`, `log`, `metric`, `mcp`, `env`, `time`, `fail`) follow that rule; treat them as the model for anything you add.

## Scripts are JavaScript

A `.safejs` body reads like a small JS program. No DSL, no decorators, no custom syntax — capabilities are imports, options are object literals, control flow is plain `if`/`for`/`try`. Anything that would need a non-JS shape — version pins, runtime config, metadata, schedules — belongs in the markdown frontmatter or the caller's options, not in the script body.

The default linter intentionally keeps harness code conservative. It accepts the common orchestration subset and rejects some runtime-supported JavaScript forms, such as `function`, `var`, `switch`, `this`, and most `new` expressions. Embedders that call `run()` directly can execute the broader parser/runtime subset, but `poe-code harness run` and `poe-safejs` lint first.

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
npx poe-safejs examples/pipeline.md
```

`poe-safejs` is a zero-cost local runner for markdown harness files. It
reads the first `js` fenced block, lints it against the example module registry,
then runs it with stub host modules: `agent.spawn` returns a canned successful
summary, `git` and `metric` are deterministic fakes, and logs are printed as
JSONL. If a markdown file has no `js` block, the CLI keeps backwards-compatible
demo mode and dispatches `kind: pipeline`, `superintendent`, or `experiment`
frontmatter to the bundled shapes. Use `runHarness()` for raw `.safejs` or legacy `.ajs` files.

Use `poe-code harness run` when you want the same lint-and-run flow against real
configured agents and host integrations.

### 2. MCP code mode

Letting an LLM call MCP tools turn-by-turn is expensive, slow, and non-deterministic. With SafeJS, the LLM produces (or you author) a script that calls MCP tools directly:

```js
import { client, server } from "mcp";

const fs = await client(server({ command: "mcp-fs", args: ["--root", "/tmp/work"] }));
const tools = await fs.tools();
const result = await fs.tool("read_file", { path: "/tmp/work/notes.md" });
```

The host wires up the actual transport via a `connectMcp` callback (see [`src/modules/mcp.ts`](src/modules/mcp.ts)). The script just composes calls.

### 3. Sandboxed user scripting

Embed SafeJS in your own product when you want to let users (or models) write small programs against a fixed set of capabilities you control. The sandbox guarantees they cannot reach outside the modules you registered, can't allocate unbounded memory, and can't run forever.

## Spec — index card

| Aspect                         | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source unit**                | one module body; `import` from registered modules only                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Linter-approved syntax**     | `const`, `let`, arrays, objects, destructuring, rest/spread, object spread, arrows including `async` arrows, top-level `await`, `if`/`else`, `for`, `for...of`, `for...in`, `while`, `do...while`, labels, `break`, `continue`, `try`/`catch`/`finally`, `throw`, `return`, binary/logical/conditional expressions, assignments and updates, member assignment, template literals, optional chaining, nullish coalescing, regex literals, and `new RegExp(...)` |
| **Runtime-only syntax**        | the parser/runtime also handle `function` declarations and expressions, generator functions, `var`, `switch`, `this`, and constructor calls for sandbox constructors. The default linter reports these forms for harnesses unless suppressed.                                                                                                                                                                                                                   |
| **Disallowed syntax**          | `class`, async generators, `with`, `eval`, `Function`, dynamic import, `import.meta` assignment, BigInt literals, legacy octal forms, and HTML-style comments                                                                                                                                                                                                                                                                                                   |
| **Lint extras**                | `await` only at top level or inside `async` arrows; arrows cannot close over outer `let`; host calls should be awaited or intentionally returned; `Array#sort` comparators must be arrows returning numbers; large literals and unreachable code are reported                                                                                                                                                                                                   |
| **Built-in globals**           | `console`, `JSON`, `Error`, `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`, `AggregateError`, `Math`, `Object`, `Array`, `String`, `Number`, `Boolean`, `Map`, `Set`, `RegExp`, `Promise` helpers, `structuredClone`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `Infinity`, `NaN`                                                                                                                                                              |
| **Determinism**                | Pass `randomSeed` for deterministic `Math.random()`; snapshots include seeded RNG state. Harness runs also provide replayable `time.now()` / `time.uuid()` through the `time` module.                                                                                                                                                                                                                                                                           |
| **Snapshots**                  | written at most every `snapshotIntervalMs` (default 30 s) to `snapshotPath`; resumed via `restore()` if `sourceHash` matches                                                                                                                                                                                                                                                                                                                                    |
| **Budgets**                    | `maxSteps`, `deadline`, `maxCallDepth`, `stringLength`, `arrayLength`, and collection entry limits                                                                                                                                                                                                                                                                                                                                                              |
| **Cancellation**               | `AbortSignal`, observed at every host call and yield point                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Unsupported language edges** | prototype chains are intentionally absent; `Function#bind` is not implemented; generator frames suspended mid-iteration cannot be snapshotted; the regex engine does not support backreferences, lookaround, named groups, or Unicode property escapes                                                                                                                                                                                                          |

## Supported globals

These are pre-bound in every script — you don't need to import them.

- **`Promise`** — `all`, `race`, `allSettled`, `any`, `resolve`, `reject`; sandbox promises expose `then`, `catch`, and `finally`
- **`Math`** — numeric methods including `abs`, `acos`, `acosh`, `asin`, `asinh`, `atan`, `atan2`, `atanh`, `ceil`, `cbrt`, `clz32`, `cos`, `cosh`, `exp`, `expm1`, `floor`, `fround`, `hypot`, `imul`, `log`, `log1p`, `log10`, `log2`, `max`, `min`, `pow`, `round`, `sign`, `sin`, `sinh`, `sqrt`, `tan`, `tanh`, `trunc`, plus standard constants and `random`
- **`Object`** — `keys`, `values`, `entries`, `hasOwn`, `is`, `fromEntries`, `assign`, `freeze`, `isFrozen`
- **`Array`** — callable/constructable array factory plus `isArray`, `from`, `of`
- **`String`** — value coercion plus `raw`, `fromCharCode`, `fromCodePoint`
- **`Number`** — value coercion plus `isFinite`, `isNaN`, `isInteger`, `isSafeInteger`, `parseInt`, `parseFloat`, and standard numeric constants
- **`Boolean`** — value coercion
- **`Map`, `Set`** — sandbox collection constructors and methods (`get`/`set`/`has`/`delete`/`clear`/`forEach`/`keys`/`values`/`entries`, as applicable). Harness lint reports most `new` expressions, so direct harness code should avoid these unless the lint diagnostic is deliberately suppressed.
- **`RegExp`** — callable or constructable regex factory; regex literals are supported
- **`Error`, `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`, `AggregateError`** — callable factories; constructor calls work at runtime, but harness lint accepts the callable form by default
- **`JSON`** — `parse`, `stringify` (replacer must be `null`/`undefined`; indent must be number/string/undefined)
- **`console`** — `log`, `error` (routed to the `sink` you pass to `run()`)
- **Miscellaneous** — `structuredClone`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `Infinity`, `NaN`

What is **not** available as a global: the `Promise` constructor, `Date`, `WeakMap`, `WeakSet`, `Symbol`, `BigInt`, `Reflect`, `Proxy`, `globalThis`, `setTimeout`, `setInterval`, `fetch`, `URL`, and other browser or Node globals. Expose a host module if you need any of them.

Method coverage on plain values follows ECMAScript with a few removals. Arrays include the common iteration, search, copy, and mutation methods; strings include regex-aware `match`, `matchAll`, `search`, `split`, `replace`, and `replaceAll`; numbers include `toString`, `toFixed`, `toExponential`, and `toPrecision`; functions expose `call` and `apply`, but not `bind`. See `src/interp/methods/` for the full list.

## Built-in host modules

Registered by the caller via the factory functions exported from the package. None of them are auto-installed — you choose which to wire up per run.

| Import    | Factory                                | What it gives the script                                                                     |
| --------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `agent`   | `makeAgentModule(spawnAgent)`          | `spawn(definition, { prompt, mode, model, mcp, cwd, timeoutMs })`                            |
| `git`     | `makeGitModule(cwd)`                   | `head`, `checkpoint`, `commit`, `revert`, `diff`                                             |
| `harness` | `makeHarnessModule(frontmatter, meta)` | `tasks`, `agents`, `meta` (kind, version, filepath, frontmatter), `applyConstraints(prompt)` |
| `log`     | `makeLogModule(sink?)`                 | `info`, `error`, `event` (JSONL by default)                                                  |
| `metric`  | `makeMetricModule(npmRunner)`          | `run(name)` — runs an npm script and parses its last numeric line                            |
| `mcp`     | `makeMcpModule(connectMcp)`            | `server(handle)`, `client(handle)` → `{ tools(), tool(name, args) }`                         |
| `env`     | `makeEnvModule(allowList)`             | `get(name)` — only for names in the allowlist                                                |
| `time`    | `makeTimeModule({ now?, random? })`    | `now`, `uuid`                                                                                |
| `fail`    | `makeFailModule()`                     | `default(message)` — throws `HarnessFailure`                                                 |

## Quick start

```ts
import { lint, run } from "@poe-code/safejs";

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
- `.md` files: YAML frontmatter is parsed; the **first** `js` fenced block is the script. If there is no fenced block, the entire markdown body is treated as script source.

```ts
import { makeHarnessModule, runHarness } from "@poe-code/safejs";

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

Diagnostics cover parse errors, unknown modules and exports, import cycles, unknown identifiers, closure and async-safety violations, subset-specific method restrictions, and warnings for unused bindings.

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

Executes a script module. Resolves to:

- `{ ok: true, returnValue?, snapshot, stats }` on success
- `{ ok: false, error, snapshot, stats }` on interpreter errors

Options: `bindings`, `budget`, `modules`, `randomSeed`, `signal`, `snapshot` (prior snapshot), `snapshotIntervalMs`, `snapshotPath`, `sink`.

### `dump(resultOrPromise)`

Serializes a snapshot to formatted JSON. Accepts either a completed `RunResult` or the in-flight promise from `run()` (in which case it resolves to the latest yielded snapshot).

### `restore(snapshot, { source })`

Validates a stored snapshot against the current source via `sourceHash`. Returns it unchanged on match, throws on mismatch.

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

The runtime accepts plain objects or `Map`s at both levels:

```ts
const modules = new Map([["custom", new Map([["hello", (name: string) => `hello ${name}`]])]]);
```

For lint, the simplest shape is just an export list:

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

- **No mutable closures.** Lambdas cannot capture an outer `let`. The idiomatic loop is recursion (see `examples/experiment.md`) or `for…of` whose body does not return a closure that reads the loop variable.
- **Harness lint rejects `function`.** The runtime can execute function declarations and expressions, but linted harnesses should use arrows. The lint error is explicit but easy to hit when porting existing JS.
- **Markdown parsing is greedy and quiet.** Only the first `js` fenced block runs.
- **Snapshots are source-pinned.** Editing the script invalidates every prior snapshot for it. There is no migration path; bump or fork the file if you need to keep an old run resumable.
- **Seed `Math.random()` when replay matters.** Pass `randomSeed` to make random values deterministic. Snapshots persist the seeded RNG state so resumes stay deterministic.
- **`Promise.all` is fine; user-defined promise constructors are not.** `Promise` is exposed for static helpers and promise instances expose `then`, `catch`, and `finally`. There is no `new Promise(...)`.
- **Agent failures throw.** `agent.spawn` rejects when the child agent's `exitCode !== 0`. Catch it if your shape needs to recover.
- **MCP module is BYO transport.** `makeMcpModule` requires a `connectMcp` callback that returns a working `listTools` / `callTool` connection. The package does not bundle a transport.
- **`env` module is allowlisted.** `makeEnvModule(["FOO"])` will only return `FOO`. Anything else returns `undefined` even if it's set in `process.env`.
- **Budgets are hard limits, not soft warnings.** Hitting `maxSteps` or `deadline` throws `SandboxError` with `code: "budgetExceeded"`. There is no graceful degradation; size budgets generously for your workload or wrap the run in your own retry policy.

## What's intentionally limited

- Harness lint rejects `function`, `var`, `switch`, `this`, and most `new` expressions even though the parser/runtime can execute many of them. Prefer arrows, `const`/`let`, `if`/loops, callable error factories, and `RegExp(...)` / regex literals in harness code.
- No user-defined classes or prototype chains.
- No async generators. Synchronous generators work, but a generator suspended mid-iteration cannot be snapshotted.
- Regex support covers common literals, `RegExp`, and string methods, but not backreferences, lookaround, named groups, or Unicode property escapes.
- `Map` and `Set` work at runtime, but their constructors require `new`, so linted harnesses need an explicit suppression to construct them directly.
- No filesystem, network, or process modules in the box. Build them as host modules with the surface you actually want to expose.
- No multi-file imports — a script is a single module body. Compose by registering more modules.

## Environment variables

This package does not read package-level environment variables. `makeEnvModule(allowList)` reads from `process.env`, but only for names in `allowList`. `parse`, `lint`, `run`, `dump`, `restore`, and `runHarness` do not read environment variables on their own.

## Configuration

This package does not read package-level config files. Runner options come through the call sites:

- `lint({ filename, modules })`
- `run({ bindings, budget, modules, randomSeed, signal, snapshot, snapshotIntervalMs, snapshotPath, sink })`
- `runHarness({ modulesFor, signal, snapshotPath })`
