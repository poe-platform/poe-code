# @poe-code/agent-script

**Run agent orchestration as code, not as a state machine.**

Agent-script is a tiny, deterministic JavaScript-subset interpreter. You write the orchestration as a regular `async/await` script; the runtime sandboxes it, snapshots it on every yield, and only lets it touch the host through modules you register.

It is the engine behind Poe Code's pipelines, experiment loops, and superintendent runs.

## Why use it

- **Orchestration as code.** Multi-agent shapes — pipeline, experiment, superintendent, custom — are just JS. No DSL, no JSON state machine, no per-step LLM round trip.
- **Deterministic & sandboxed.** No `eval`, no `new`, no `class`, no `this`, no regex literals, no `function` keyword. Imports are limited to modules you register. Budgets cap steps, depth, deadlines, string and array sizes.
- **Crash-safe long runs.** Every `await` yields a snapshot. The scheduler writes them atomically to disk on an interval. A run can be resumed against the original source — the source hash is verified before restore.
- **File-based plans.** A `.ajs` file or a markdown file with YAML frontmatter and a `js` fenced block is the unit of work. Frontmatter holds the plan; the script walks it.
- **MCP code mode.** Connect to an MCP server once, then call tools imperatively from the script — no LLM in the loop for the orchestration layer.

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
npx poe-agent-script examples/pipeline.md
```

`poe-agent-script` is a zero-cost local runner for markdown harness files. It
reads the first `js` fenced block, lints it against the example module registry,
then runs it with stub host modules: `agent.spawn` returns a canned successful
summary, `git` and `metric` are deterministic fakes, and logs are printed as
JSONL. If a markdown file has no `js` block, the CLI keeps backwards-compatible
demo mode and dispatches `kind: pipeline`, `superintendent`, or `experiment`
frontmatter to the bundled shapes.

Use `poe-code harness run` when you want the same lint-and-run flow against real
configured agents and host integrations.

### 2. MCP code mode

Letting an LLM call MCP tools turn-by-turn is expensive, slow, and non-deterministic. With agent-script, the LLM produces (or you author) a script that calls MCP tools directly:

```js
import { client, server } from "mcp";

const fs = await client(server({ command: "mcp-fs", args: ["--root", "/tmp/work"] }));
const tools = await fs.tools();
const result = await fs.tool("read_file", { path: "/tmp/work/notes.md" });
```

The host wires up the actual transport via a `connectMcp` callback (see [`src/modules/mcp.ts`](src/modules/mcp.ts)). The script just composes calls.

### 3. Sandboxed user scripting

Embed agent-script in your own product when you want to let users (or models) write small programs against a fixed set of capabilities you control. The sandbox guarantees they cannot reach outside the modules you registered, can't allocate unbounded memory, and can't run forever.

## Spec — index card

| Aspect | Detail |
| --- | --- |
| **Source unit** | one module body; `import` from registered modules only |
| **Allowed** | `const`, `let`, arrays, objects, destructuring, rest, spread, arrow funcs (incl. `async`), top-level `await`, `if`, `for`, `for...of`, `while`, `break`, `continue`, `try`/`catch`/`finally`, `throw`, `return`, template literals, optional chaining |
| **Disallowed** | `function`, `class`, `new`, `this`, `var`, `do…while`, `switch`, labels, regex literals, generators, `eval`, `Function` |
| **Lint extras** | `await` only at top level or inside `async` arrows; lambdas can't close over outer `let`; no `__proto__` / `prototype` / `constructor`; no regex args to `String#split` / `replace` / `replaceAll`; `Array#sort` only takes an arrow returning a number |
| **Built-in globals** | `console`, `Error` and friends, `Math`, `Object`, `Array`, `Promise.all` / `race` / `allSettled` / `any` |
| **Determinism** | `Math.random()` requires `randomSeed`; otherwise unbound. Snapshots include the RNG state. |
| **Snapshots** | written at most every `snapshotIntervalMs` (default 30 s) to `snapshotPath`; resumed via `restore()` if `sourceHash` matches |
| **Budgets** | `maxSteps`, `deadline`, `maxCallDepth`, `stringLength`, `arrayLength` |
| **Cancellation** | `AbortSignal`, observed at every host call and yield point |

## Supported globals

These are pre-bound in every script — you don't need to import them.

- **`Promise.all(values)`** — wait for every promise; rejects on the first rejection
- **`Promise.race(values)`** — settle with the first promise to settle, fulfilled or rejected
- **`Promise.allSettled(values)`** — never rejects; resolves to `{ status, value | reason }` entries
- **`Promise.any(values)`** — resolves with the first fulfillment; rejects with `AggregateError` only if all reject
- **`Math`** — `abs`, `ceil`, `exp`, `floor`, `log`, `max`, `min`, `pow`, `round`, `sign`, `sqrt`, `trunc`, plus `E`, `PI`, and `random` (only when `randomSeed` is set)
- **`Object`** — `keys`, `values`, `entries`, `fromEntries`, `assign`, `freeze`
- **`Array`** — `isArray`, `from`, `of`
- **`JSON`** — `parse`, `stringify` (replacer must be `null`/`undefined`; indent must be number/string/undefined)
- **`console`** — `log`, `error` (routed to the `sink` you pass to `run()`)
- **`Error`, `TypeError`** — callable factories, e.g. `throw Error("…")`. `new` is forbidden; the factory call is the supported form.
- **`String`, `Number`, `Boolean`** — value coercion factories, e.g. `String(value)`

What is **not** available as a global: `Promise` constructor, `Date`, `RegExp`, `Map`, `Set`, `WeakMap`, `WeakSet`, `Symbol`, `BigInt`, `Reflect`, `Proxy`, `globalThis`, `setTimeout`, `setInterval`, `fetch`, `URL`, and the other `*Error` constructors (`RangeError`, `SyntaxError`, `ReferenceError`). Expose a host module if you need any of them.

Method coverage on plain values follows ECMAScript with a few removals: `String#split` / `replace` / `replaceAll` reject regex separators and function replacers, and `Array#sort` only accepts an arrow comparator returning a number. See `src/interp/methods/` for the full list.

## Built-in host modules

Registered by the caller via the factory functions exported from the package. None of them are auto-installed — you choose which to wire up per run.

| Import | Factory | What it gives the script |
|---|---|---|
| `agent` | `makeAgentModule(spawnAgent)` | `spawn(definition, { prompt, mode, model, mcp, cwd, timeoutMs })` |
| `git` | `makeGitModule(cwd)` | `head`, `checkpoint`, `commit`, `revert`, `diff` |
| `harness` | `makeHarnessModule(frontmatter, meta)` | `tasks`, `agents`, `meta` (kind, version, filepath, frontmatter), `applyConstraints(prompt)` |
| `log` | `makeLogModule(sink?)` | `info`, `error`, `event` (JSONL by default) |
| `metric` | `makeMetricModule(npmRunner)` | `run(name)` — runs an npm script and parses its last numeric line |
| `mcp` | `makeMcpModule(connectMcp)` | `server(handle)`, `client(handle)` → `{ tools(), tool(name, args) }` |
| `env` | `makeEnvModule(allowList)` | `get(name)` — only for names in the allowlist |
| `time` | `makeTimeModule({ now?, random? })` | `now`, `uuid` |
| `fail` | `makeFailModule()` | `default(message)` — throws `HarnessFailure` |

## Quick start

```ts
import { lint, run } from "@poe-code/agent-script";

const source = `
  import { greet } from "custom";
  return await greet("Ada");
`;

const modules = {
  custom: { greet: async (name) => `hello ${name}` }
};

const errors = lint(source, { modules: { custom: ["greet"] } })
  .filter((d) => d.severity === "error");
if (errors.length > 0) throw new Error(errors.map((d) => d.message).join("\n"));

const result = await run(source, { modules });
if (!result.ok) throw result.error;
console.log(result.returnValue); // "hello Ada"
```

## Harness files

`runHarness(filepath, options)` loads a script from disk, lints it, then runs it.

- `.ajs` files: the entire file is the script. Frontmatter is `{}`. The `harness` module is auto-excluded since there's nothing for it to surface.
- `.md` files: YAML frontmatter is parsed; the **first** `js` fenced block is the script. If there is no fenced block, the entire markdown body is treated as script source.

```ts
import { makeHarnessModule, runHarness } from "@poe-code/agent-script";

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

Returns diagnostics for the agent-script subset and registered modules.

- `filename?` — used in diagnostics, defaults to `<input>`
- `modules?` — registered module metadata used to validate `import` statements

Diagnostics cover parse errors, unknown modules and exports, unknown identifiers, closure and async-safety violations, subset-specific method restrictions, and warnings for unused bindings.

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
const modules = new Map([
  ["custom", new Map([["hello", (name: string) => `hello ${name}`]])]
]);
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

## Gotchas

- **No mutable closures.** Lambdas cannot capture an outer `let`. The idiomatic loop is recursion (see `examples/experiment.md`) or `for…of` whose body does not return a closure that reads the loop variable.
- **No `function` at all.** Use arrow functions everywhere. The lint error is explicit but easy to hit when porting existing JS.
- **Markdown parsing is greedy and quiet.** Only the first `js` fenced block runs.
- **Snapshots are source-pinned.** Editing the script invalidates every prior snapshot for it. There is no migration path; bump or fork the file if you need to keep an old run resumable.
- **`Math.random()` is unbound by default.** Pass `randomSeed` to enable it. Snapshots persist the RNG state so resumes stay deterministic.
- **`Promise.all` is fine; user-defined concurrency primitives are not.** `Promise` is exposed only for `all` / `race` / `allSettled` / `any`. There is no `new Promise(...)`.
- **Agent failures throw.** `agent.spawn` rejects when the child agent's `exitCode !== 0`. Catch it if your shape needs to recover.
- **MCP module is BYO transport.** `makeMcpModule` requires a `connectMcp` callback that returns a working `listTools` / `callTool` connection. The package does not bundle a transport.
- **`env` module is allowlisted.** `makeEnvModule(["FOO"])` will only return `FOO`. Anything else returns `undefined` even if it's set in `process.env`.
- **Budgets are hard limits, not soft warnings.** Hitting `maxSteps` or `deadline` throws `SandboxError` with `code: "budgetExceeded"`. There is no graceful degradation; size budgets generously for your workload or wrap the run in your own retry policy.

## What's not here yet

- No regex support of any kind (literals, `RegExp`, regex args to string methods).
- No user-defined classes or prototype chains.
- No streaming/iterator protocol — `for…of` works on arrays, not generators.
- No filesystem, network, or process modules in the box. Build them as host modules with the surface you actually want to expose.
- No multi-file imports — a script is a single module body. Compose by registering more modules.

## Environment variables

This package does not read package-level environment variables. `makeEnvModule(allowList)` reads from `process.env`, but only for names in `allowList`. `parse`, `lint`, `run`, `dump`, `restore`, and `runHarness` do not read environment variables on their own.

## Configuration

This package does not read package-level config files. Runner options come through the call sites:

- `lint({ filename, modules })`
- `run({ bindings, budget, modules, randomSeed, signal, snapshot, snapshotIntervalMs, snapshotPath, sink })`
- `runHarness({ modulesFor, signal, snapshotPath })`
