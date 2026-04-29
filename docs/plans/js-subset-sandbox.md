---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# agent-script

A safely-evaluated JavaScript subset that **is** the harness. The script drives the orchestration — spawns agents, calls MCP tools, persists state, branches and loops — using a small set of host primitives. Zero runtime deps.

## 1. What we're building

A JavaScript subset, evaluated by JavaScript, but safely — like a sandbox. The script is the harness: it owns the control flow. Today's harnesses (experiment, superintendent, pipeline) are different YAML/markdown formats glued to different runners; under agent-script they collapse into one model — a script + a curated set of host primitives.

Purpose:

- agent-script *is* the harness; no separate harness file format
- MCP composition and execution from inside the script
- existing harness packages (experiment, superintendent, pipeline) become thin runners that expose primitives and load an `.ajs` file

Constraints:

- zero runtime deps
- no `async`/`await` keywords in the subset; host primitives are sync-looking but async-internally (the interpreter is async and `await`s host calls between subset steps)
- adversarial-safe: from-scratch parser + tree-walking interpreter; subset code never holds host references; step/time/memory budgets enforced

Non-goals:

- not a full JS implementation
- not a generic scripting language outside the agent-script runner — the host primitives are the API

## 2. User-facing shape

### 2.1 Package

New package `@poe-code/agent-script`. Zero runtime deps. Public API:

```ts
import { parse, lint, run, dump, restore } from "@poe-code/agent-script";

// Lint — strongly recommended before run; flags every disallowed construct.
const diagnostics = lint(source, { filename: "pipeline.ajs", modules });
// diagnostics: Array<{ severity, code, message, filename, line, column, span, hint? }>

// Run — fresh execution
const result = await run(source, {
  filename: "pipeline.ajs",
  modules,                         // registered modules: Record<name, ModuleExports>
  budget: {
    steps: 10_000_000,
    ms: 6 * 60 * 60 * 1000,
    stringLength: 10_000_000,
    arrayLength: 1_000_000,
    callDepth: 256,
  },
  signal: abortController.signal,
  snapshotPath: "pipeline.snapshot.json",  // optional; runtime checkpoints here
});

// result.ok            — boolean
// result.returnValue   — final expression / explicit return; usually ignored
// result.error         — { kind, message, filename, line, column, excerpt, caret }
// result.snapshot      — last serialized interpreter state (also written to snapshotPath)
// result.stats         — { stepsUsed, durationMs, peakCallDepth, hostCalls }

// Pause — request a graceful checkpoint. Runtime serializes at the next yield point.
//          Returns the serialized snapshot once the in-flight host call settles.
const snapshot = await dump(result);

// Restore — resume from a snapshot rather than starting fresh.
const result2 = await restore(snapshot, { source, modules, budget, signal });
```

The package-level `run` and `restore` are async because the interpreter is async — subset code uses `async`/`await` and the interpreter awaits real host promises behind the scenes.

### 2.2 The subset

**In:**

- literals: number, string, template strings (no tagged templates), boolean, null, undefined, array, object
- identifiers, `const`, `let` (no `var`)
- arithmetic / comparison / logical / nullish-coalescing / optional-chaining operators
- ternary
- member access, computed member access, function calls
- arrow functions, including async arrows: `async (x) => { const y = await spawn(...); return y; }`
- `await` expressions inside async functions and at the top level of the script
- object and array destructuring; spread/rest in arrays, objects, params, call args
- block statements, `if`/`else`, `for...of`, `for` (C-style), `while`, `return`, `break`, `continue`
- `try`/`catch`/`finally`, `throw`
- ES module imports — bare specifiers only: `import { x } from "name"`, `import x from "name"`, `import * as ns from "name"`. `name` resolves against the runner's module registry. No relative paths, no URL imports.
- top level: either a single bare expression *(file = expression)*, or statements ending in `return value;`

**Out:**

- `function` keyword, `class`, `new`, `this`, generators (`function*`, `yield`)
- `import`/`export` from filesystem paths, dynamic `import()`, `require`, `eval`, `Function`
- regex literals, `RegExp`, `BigInt`, `Symbol`
- prototype access (`__proto__`, `prototype`, `constructor`)
- `with`, labels, `var`, `do`/`while`, `switch` (deferred — add later if asked)

**Closures capture `const` only.** A lambda may close over `const`-bound variables, function parameters, and module imports. Closing over a `let`-bound variable is a lint error: "closure cannot capture mutable binding `x`; use `const`, or pass as a parameter." This rule keeps closure environments serializable and makes snapshot pause/resume tractable. `let` is intentionally local; if you need shared mutable state, model it with a `const` reference to an object or array (those values are mutable; the binding isn't).

**Promises.** Promise built-ins are subset values, not real JS Promises. Behavior:

- `Promise.all(iter)`, `Promise.allSettled(iter)`, `Promise.race(iter)`, `Promise.any(iter)`, `Promise.resolve(v)`, `Promise.reject(v)` — provided as built-ins
- `await p` resolves to the value, or throws the rejection reason
- async arrows always return a subset Promise
- not spec-compliant: no `then`/`catch`/`finally` chaining, no microtask ordering guarantees, no PromiseSubclassing. The intent is "concurrency for orchestration," not Promise/A+ conformance

**Values:** plain JS primitives, plain objects, plain arrays, subset functions (closures), and subset Promises — all in the interpreter's own value space. No host references ever leak in. Property reads on objects look up own keys only — no prototype walking.

### 2.3 Host API exposed by default

Always-available globals:

```js
console.log(...args), console.error(...args)
JSON.parse(text), JSON.stringify(value, null?, indent?)
Math.{min, max, abs, floor, ceil, round, trunc, sign, pow, sqrt, log, log2, log10, exp, sin, cos, tan, PI, E, random}
Object.{keys, values, entries, fromEntries, freeze, assign}
Array.{isArray, from, of}
String, Number, Boolean              // coercion functions only, not constructors
Error(message), TypeError(message)   // sandbox-internal error values
```

Methods on primitive and built-in values (intercepted by the interpreter — no host prototype is exposed):

```js
// strings
.length
.charAt(i), .charCodeAt(i), .codePointAt(i)
.includes(s), .startsWith(s), .endsWith(s), .indexOf(s), .lastIndexOf(s)
.slice(a, b), .substring(a, b), .substr(a, n)
.split(separator)                    // string separator only — no RegExp
.replace(needle, replacement)        // both args strings — no RegExp, no fn replacer
.replaceAll(needle, replacement)
.toLowerCase(), .toUpperCase()
.trim(), .trimStart(), .trimEnd()
.padStart(n, pad?), .padEnd(n, pad?)
.repeat(n)
.concat(...others)
.normalize()

// arrays
.length
.map(fn), .filter(fn), .find(fn), .findIndex(fn), .some(fn), .every(fn)
.reduce(fn, init?), .reduceRight(fn, init?)
.forEach(fn), .flatMap(fn), .flat(depth?)
.includes(v), .indexOf(v), .lastIndexOf(v)
.join(sep?), .slice(a, b), .concat(...others)
.sort(cmp?), .reverse()
.push(...v), .pop(), .shift(), .unshift(...v)

// numbers
.toString(radix?), .toFixed(d), .toPrecision(p)
```

Caller-injected globals (per `globals` option) are deep-copied into sandbox value space on entry. Functions injected as globals are wrapped: subset args are unwrapped to host values, the host fn runs, its return is deep-copied back into sandbox space. Throws from host functions become sandbox `Error` values with the host stack stripped. No live host references ever cross the boundary.

Subset functions (lambdas) passed *into* host calls (e.g. as a callback) are wrapped the other way: invoking them from the host re-enters the interpreter under the same step/time budget.

### 2.4 Modules

Capabilities live behind ES module imports, not implicit globals. The runner registers a module registry; `import { x } from "name"` resolves against that registry. Bare specifiers only — no filesystem paths, no node_modules, no relative imports.

The script's imports are explicit, the linter validates every name, and the harness can't accidentally use a capability that wasn't registered.

Built-in modules a runner can register:

```js
// agent — spawn an agent. agentDef is a frontmatter agent definition (or any matching record).
// agentDef.prompt is the system persona; opts.prompt is the user message.
// Returns a Promise. Throws on non-zero exit; wrap in try/catch to handle.
import { spawn } from "agent";
await spawn(agentDef, { prompt, mcp?, model?, mode?, cwd?, timeoutMs? });
// -> { exitCode, stdout, stderr, summary, durationMs }

// harness — frontmatter data and runner metadata
import { tasks, agents, meta } from "harness";
// `tasks`, `agents` come from frontmatter; `meta` is { kind, version, filepath, ... }

// git
import { head, checkpoint, commit, revert, diff } from "git";
await commit({ message, files? });

// mcp
import { server, client } from "mcp";
const search = server({ command, args?, env? });
const c = await client(search);
const tools = await c.tools();          // [{ name, description, schema }]
const out = await c.tool(name, args);

// metric (npm scripts named metric:*)
import { run as runMetric } from "metric";
await runMetric("tests");               // -> number

// log
import { info, error, event } from "log";
event("task.done", { id: "fix-auth" });  // dashboards subscribe to events

// env (curated, not process.env)
import { get } from "env";
get("BUILDER_AGENT");

// fail
import { fail } from "fail";
fail("setup did not complete");

// random / now / uuid
import { random, now, uuid } from "time";
```

Module APIs are async by default for anything that talks to the outside world. Pure-data modules (`harness`, `env`) are sync.

Custom modules: harness packages register additional modules. Pipeline might add a `tasks` module with helpers; experiment-loop might add a `journal` module if it wants persistent attempt history. Modules are the extension surface.

Multiple import forms are accepted:

```js
import { spawn } from "agent";        // named
import * as git from "git";           // namespace — git.commit(...), git.head()
import { run as runMetric } from "metric";  // alias
import fail from "fail";              // default (if module declares one)
```

The runner picks which modules to register for a given run. A pipeline runner registers `agent`, `harness`, `mcp`, `log`, `fail`, `time`. An experiment runner adds `git`, `metric`. The linter knows the registered module list and reports unknown imports against that list.

### 2.5 Async and concurrency

Subset code uses `async`/`await` and `Promise.*` directly. Sequential, parallel, and racing variants are all expressible.

```js
// sequential
await spawn(agents.builder, { prompt: "Install deps." });
await spawn(agents.builder, { prompt: "Run migrations." });

// parallel
const reports = await Promise.all(
  inspectors.map((insp) => spawn(insp, { prompt: `Inspect: ${builder.summary}` })),
);

// race — first to finish wins; others continue but their results are dropped
const winner = await Promise.race([
  spawn(agents.fastModel, { prompt }),
  spawn(agents.slowModel, { prompt }),
]);

// allSettled — collect mixed success/failure
const outcomes = await Promise.allSettled(branches);
```

Internals:

1. The interpreter is an `async function` over the AST.
2. Module functions registered by the host are normal `async` host functions; on call, the interpreter `await`s them and returns a subset Promise that resolves to the result.
3. `Promise.all` / `race` / `allSettled` / `any` map onto host `Promise.*` for scheduling, but subset Promises are the values authors see.
4. Step budget counts AST node visits across all live execution contexts. Wall-clock budget covers the whole run.
5. Cancellation: when the runner's `signal` aborts, the next host call throws `SandboxError("aborted")` and any `await` on a pending host promise rejects with the same. Scripts can `try`/`catch` to clean up.

Closures inside parallel branches share scope — but since closures only capture `const` bindings, there is no read/write race on captured state. Mutation of objects referenced by const bindings is visible across branches; treat shared mutable structures inside a `Promise.all` with the same care as in any concurrent JS.

### 2.6 File format — markdown + frontmatter + script

A harness file is markdown with YAML frontmatter and a single fenced ```js block in the body. The frontmatter declares **data** (agents, tasks, MCP servers, metrics); the script orchestrates.

```md
---
kind: pipeline
version: 1

agents:
  builder:
    agent: claude-code
    model: claude-opus-4-7
    mode: yolo
    prompt: |
      Implement the task. Write tests first, then the change.
  reviewer:
    agent: claude-code
    mode: read
    prompt: |
      Review the diff for correctness and tests.

mcp:
  search:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-everything"]

tasks:
  - id: fix-auth
    title: Fix auth timeout
    prompt: Fix the auth timeout regression in session refresh.
---

# Auth pipeline

Markdown body — prose for humans, agents that read this file, or future you.

\```js
import { spawn } from "agent";
import { tasks, agents } from "harness";
import { server } from "mcp";
import { commit } from "git";
import { event } from "log";

const search = server({ command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] });

await spawn(agents.builder, { prompt: "Install deps." });

await tasks.reduce(async (previous, task) => {
  await previous;
  event("task.started", { id: task.id, title: task.title });
  await spawn(agents.builder, {
    prompt: `${task.id}: ${task.title}\n\n${task.prompt}`,
    mcp: { search }
  });
  await spawn(agents.reviewer, { prompt: `Review the changes for ${task.id}.` });
  await commit({ message: `feat: ${task.id} - ${task.title}` });
  event("task.completed", { id: task.id, title: task.title });
}, (async () => {})());
\```
```

The runner:

1. Reads the file, splits frontmatter from body.
2. Parses frontmatter (YAML) into a JS object.
3. Extracts the **first** fenced `js` (or `ajs`) code block from the body. Other code fences are inert prose.
4. Builds the `harness` module from frontmatter (`tasks`, `agents`, `meta`) and registers it alongside the runner's other modules.
5. Lints the script against the registered module set; aborts on any error-severity diagnostic.
6. Runs the script with the module registry available to `import`.

Inspectors are just agents. There is no `inspectors` schema; you put them under `agents` and the script decides which to call when:

```yaml
agents:
  builder:    { agent: claude-code, prompt: "..." }
  security:   { agent: claude-code, mode: read, prompt: "Review for security." }
  perf:       { agent: claude-code, mode: read, prompt: "Review for performance." }
  judge:      { agent: claude-code, prompt: "Approve or reject." }
```

```js
import { spawn } from "agent";
import { agents } from "harness";

const inspectors = [agents.security, agents.perf];
for (const insp of inspectors) {
  await spawn(insp, { prompt: `Inspect: ${out.summary}` });
}
```

Pure-script files (no frontmatter, no markdown) use the `.ajs` extension. The `harness` module is unavailable in that case; the script imports only what the runner registers.

### 2.7 Pause and resume — interpreter snapshot

Because we own the AST and the interpreter, we can serialize the *live* state of a paused script. No journal, no replay, no determinism constraint — the resumed script picks up at the exact AST node where it stopped, with the exact scope it had.

What the snapshot contains:

- **AST identity** — content hash of the parsed source, so a resume against an edited file fails loudly instead of corrupting state.
- **Code pointer** — the AST node ID currently being evaluated (or the `await` it's suspended on).
- **Scope chain** — every active scope frame as `{ parentId, bindings: Record<name, value> }`. Bindings are JSON-friendly because:
  - `const` values are immutable references; the snapshot stores the value at pause time.
  - `let` values are local to their block and never escape into closures, so they're always serializable scalars or plain objects.
- **Call stack** — activation records `{ astNodeId, scopeId, awaitingPromiseId? }`.
- **Pending Promises** — each subset Promise has an ID; pending Promises capture which host call they're awaiting. On resume, the host call is *not* re-issued — instead, the runner is responsible for either (a) carrying the in-flight promise across the snapshot (only possible if the host process didn't exit), or (b) re-issuing the host call and letting the script see the new result. The runner picks the policy per primitive — `git.commit` is non-idempotent (re-issue would double-commit) so the runner records a "tentative commit" tag and on resume reads `git.head()` to decide; `spawn` is treated as already-completed if its agent process exited, otherwise re-issued.
- **Closures-as-values** — `{ kind: "fn", astNodeId, capturedScopeId }`. Restored by reattaching to the deserialized scope.
- **Module bindings** — names → module identifiers; module instances are reconstructed by the runner (registry lookup), not serialized.

When the runner snapshots:

- Periodically: every N seconds (default 30s).
- On signal: SIGINT/SIGTERM triggers `dump()` at the next yield point.
- On explicit `dump()` from the host: API call returns once the in-flight host operation settles.

When the runner resumes (`restore`):

- Reads the snapshot.
- Re-parses the source, hashes the AST. Mismatch → reject: `source changed since snapshot was taken (hash X expected, got Y); pass --reset to discard`.
- Reconstructs scope chain and call stack from JSON.
- Re-attaches modules from the registry.
- Resumes the interpreter at the saved code pointer.

What this gives us:

- Plain JS authoring — no special primitives, no determinism rules, no `once`. The script just runs.
- True pause: a hung overnight superintendent run can be `dump`ed, the laptop closed, and `restore`d from the snapshot file the next morning.
- Cheap re-runs: kill mid-execution, resume picks up at the same `await`. No re-spawning agents, no re-committing.

Limitations:

- Snapshot resolution is bounded by yield points (`await`s). A snapshot can't land mid-expression in synchronous subset code; it lands at the next yield. For orchestration scripts this is fine — host calls are frequent.
- Editing the source invalidates the snapshot. Author opts to `--reset` and start fresh.
- Snapshot size is roughly proportional to live state. A pipeline holding a `tasks` array of 1000 items keeps that array in the snapshot.

Opt-out: `run` with no `snapshotPath` does no checkpointing.

### 2.8 Example — pipeline (`pipeline.md`)

```yaml
---
kind: pipeline
version: 1
agents:
  builder:
    agent: claude-code
    mode: yolo
    prompt: |
      Implement the assigned task. Follow TDD — write tests first.
  reviewer:
    agent: claude-code
    mode: read
    prompt: |
      Review the diff for correctness, tests, and obvious regressions.
mcp:
  search:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-everything"]
tasks:
  - id: fix-auth
    title: Fix auth timeout
    prompt: Fix the auth timeout regression in session refresh.
  - id: add-retry
    title: Add HTTP retry
    prompt: Add exponential backoff retry to the HTTP client.
---
```

Body:

```js
import { spawn } from "agent";
import { tasks, agents } from "harness";
import { server } from "mcp";
import { commit } from "git";
import { event } from "log";

const search = server({ command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] });

await spawn(agents.builder, { prompt: "Install deps and run migrations." });

await tasks.reduce(async (previous, task) => {
  await previous;
  event("task.started", { id: task.id, title: task.title });
  await spawn(agents.builder, {
    prompt: `${task.id}: ${task.title}\n\n${task.prompt}`,
    mcp: { search }
  });
  await spawn(agents.reviewer, { prompt: `Review the changes for ${task.id}.` });
  await commit({ message: `feat: ${task.id} - ${task.title}` });
  event("task.completed", { id: task.id, title: task.title });
}, (async () => {})());
```

### 2.9 Example — superintendent (`superintendent.md`)

```yaml
---
kind: superintendent
version: 1
agents:
  builder:
    agent: claude-code
    prompt: |
      Build the plan referenced in the document body.
  security:
    agent: claude-code
    mode: read
    prompt: |
      Review for auth, injection, secrets, validation issues.
  perf:
    agent: claude-code
    mode: read
    prompt: |
      Review for performance regressions and obvious inefficiencies.
  tests:
    agent: claude-code
    mode: read
    prompt: |
      Verify tests cover the changes and pass.
  judge:
    agent: claude-code
    prompt: |
      Given builder summary and inspector reports, approve or reject.
  owner:
    agent: claude-code
    mode: read
    prompt: |
      Final owner review. Approve or reject.
maxRounds: 50
---
```

Body:

```js
import { spawn } from "agent";
import { agents, meta } from "harness";
import { fail } from "fail";

const inspectors = [agents.security, agents.perf, agents.tests];
const maxRounds = meta.frontmatter.maxRounds ?? 50;
let lastSummary = null;

for (let round = 0; round < maxRounds; round++) {
  const builder = await spawn(agents.builder, {
    prompt: `Continue. Prior summary: ${lastSummary ?? "(none)"}`,
  });

  const reports = await Promise.all(
    inspectors.map((insp) => spawn(insp, { prompt: `Inspect:\n\n${builder.summary}` })),
  );

  const verdict = await spawn(agents.judge, {
    prompt: `Builder: ${builder.summary}\n\nInspectors:\n${
      reports.map((r, n) => `- ${inspectors[n].agent}: ${r.summary}`).join("\n")
    }\n\nApprove or reject.`,
  });

  if (verdict.summary.toLowerCase().includes("approved")) {
    const owner = await spawn(agents.owner, { prompt: `Verdict:\n\n${verdict.summary}` });
    if (owner.summary.toLowerCase().includes("approved")) return;
  }

  lastSummary = verdict.summary;
}

fail(`max rounds (${maxRounds}) reached without owner approval`);
```

Three inspectors run concurrently via `Promise.all`, cutting wall time roughly to the slowest inspector. A snapshot taken mid-loop captures the round counter, last summary, and any in-flight inspections; restore picks up from the same `await`.

### 2.10 Example — experiment loop (`experiment.md`)

```yaml
---
kind: experiment
version: 1
agents:
  experimenter:
    agent: claude-code
    prompt: |
      Make a single focused change to improve the metric. The journal of prior
      attempts is provided in each turn — do not repeat what didn't work.
metric:
  name: tests
  direction: maximize
maxKept: 5
---
```

Body:

```js
import { spawn } from "agent";
import { agents, meta } from "harness";
import { checkpoint, commit, revert } from "git";
import { run as runMetric } from "metric";

const baseline = await runMetric("tests");
const maxKept = meta.frontmatter.maxKept ?? 5;
const attempts = [];
let kept = 0;

while (kept < maxKept) {
  const savepoint = await checkpoint();
  const attempt = attempts.length + 1;

  try {
    await spawn(agents.experimenter, {
      prompt: `Improve "tests".\n\nLast attempts:\n${
        attempts.slice(-10).map((a) => JSON.stringify(a)).join("\n")
      }`,
    });
    const score = await runMetric("tests");

    if (score >= baseline) {
      await commit({ message: `experiment ${attempt}: kept (score=${score})` });
      kept += 1;
      attempts.push({ event: "kept", attempt, score });
    } else {
      await revert(savepoint);
      attempts.push({ event: "discarded", attempt, score });
    }
  } catch (e) {
    await revert(savepoint);
    attempts.push({ event: "failed", attempt, error: e.message });
  }
}
```

`attempts` is a plain JS array. A snapshot captures it directly — no journal sidecar, no replay. Restore puts the array back as it was at the moment of pause.

### 2.11 The harness — wiring

"The script is the harness" means the script owns control flow, but a harness *layer* still exists: it loads the markdown, parses frontmatter, extracts the script block, registers modules, runs the interpreter, owns the snapshot file, and surfaces dashboard / cancellation / signals to the outer process.

`@poe-code/agent-script` provides:

- parser, linter, interpreter, snapshot/restore
- `runHarness(filepath, { modules, snapshotPath?, signal? })` — the loader: reads markdown, splits frontmatter, extracts the `js` block, lints, runs with the registered modules, checkpoints to `snapshotPath`
- standard module **factories** that build the registered module record: `makeAgentModule(spawnAgent)`, `makeHarnessModule(frontmatter, meta)`, `makeMcpModule(mcpClient)`, `makeGitModule(cwd)`, `makeMetricModule(npmRunner)`, `makeLogModule(events)`, `makeEnvModule(allowList)`, `makeFailModule()`, `makeTimeModule()`

Each existing package becomes a thin wrapper that picks the module bundle and registers a CLI:

```ts
// @poe-code/pipeline
import { runHarness, makeAgentModule, makeHarnessModule,
         makeMcpModule, makeLogModule, makeEnvModule,
         makeFailModule, makeTimeModule } from "@poe-code/agent-script";
import { spawnAgent } from "@poe-code/agent-spawn";
import { connectMcp } from "@poe-code/tiny-mcp-client";

export async function runPipeline(filepath: string, signal: AbortSignal) {
  return runHarness(filepath, {
    signal,
    snapshotPath: `${filepath}.snapshot.json`,
    modulesFor: (frontmatter, meta) => ({
      agent:   makeAgentModule(spawnAgent),
      harness: makeHarnessModule(frontmatter, meta),
      mcp:     makeMcpModule(connectMcp),
      log:     makeLogModule(),
      env:     makeEnvModule(["BUILDER_AGENT"]),
      fail:    makeFailModule(),
      time:    makeTimeModule(),
    }),
  });
}
```

That's the whole pipeline package — a CLI command + this wiring. No YAML schema, no status writer, no task selector, no step resolver, no template engine, no `once`/`state` machinery. Roughly an order of magnitude smaller than today's `@poe-code/pipeline`.

`@poe-code/superintendent` adds a TUI subscriber on the `log` module's event channel. `@poe-code/experiment-loop` adds `makeGitModule` and `makeMetricModule`. The shared CLI scaffolding (file discovery, `--yes`, `--tui`, `--reset` to discard the snapshot) lives in a tiny CLI helper.

The frontmatter `kind` field is informational — humans and editors use it to know what kind of file this is. The runner doesn't dispatch on it; the user invokes the runner they want (`poe-code pipeline run`, `poe-code experiment run`).

(Open question: should there be a single `poe-code run <file>` that dispatches on `kind` and picks the module bundle automatically? Tracked in Level 3.)

### 2.12 Linter

A separate, deterministic pass over the parsed AST. Runs before execution by default in `runHarness`; also exposed standalone as `lint(source, { filename, modules })` and as a CLI command:

```sh
poe-code agent-script lint pipeline.md
```

Rules (each carries a stable code so users can suppress with comments if they ever need to):

| Code | Severity | Description |
| ------ | ---------- | ------------- |
| `AS001` | error | Disallowed syntax: `function`, `class`, `new`, `this`, generators, `var`, `do`/`while`, `switch`, `with`, labels, regex literals, `eval`, `Function`. |
| `AS002` | error | Closure captures mutable binding — lambda closes over a `let`-bound name. Hint: change to `const`, or pass as a parameter. |
| `AS003` | error | Unknown identifier. Lists the declared/imported names in scope; suggests near-matches via Levenshtein. |
| `AS004` | error | Unknown module — `import` from a name not registered in the runner's module list. Lists registered module names. |
| `AS005` | error | Unknown export — `import { x }` where `x` is not exported by the named module. Lists actual exports. |
| `AS006` | warning | Unused import. |
| `AS007` | warning | Unused `const`/`let` binding. |
| `AS008` | error | `await` outside async function or top level. |
| `AS009` | error | Async arrow returning a host promise without `await` (likely the author forgot to await). Hint: add `await` or document that you really want a Promise back. |
| `AS010` | warning | Top-level `let` capturing host-call results that are never read again — likely unintended. |
| `AS011` | error | Prototype access (`__proto__`, `.prototype`, `.constructor`). |
| `AS012` | error | Disallowed property method — e.g. `String.prototype.replace` with a function or RegExp argument; `Array.prototype.sort` with an unsupported comparator pattern. |
| `AS013` | error | Reserved name: a top-level binding shadows a built-in module name (`agent`, `git`, `mcp`, ...). |
| `AS014` | error | Cyclic import. |
| `AS015` | warning | `Promise.race` with a single promise — likely a typo for `await`. |

Diagnostic shape:

```ts
type Diagnostic = {
  code: string;        // "AS002"
  severity: "error" | "warning";
  message: string;
  filename: string;
  line: number;
  column: number;
  span: { start: { line, column }, end: { line, column } };
  hint?: string;       // actionable suggestion
};
```

The runner aborts before execution if any error-severity diagnostic is reported.

### 2.13 Errors

Every error carries `filename`, `line`, `column`, a one-line code excerpt with a caret, and a message that names the offending construct. Examples:

```text
ParseError: harness.ajs:12:8

  10 | return {
  11 |   builder: {
  12 |     prompt: `Build ${plan path}`,
     |                        ^
  13 |   },

Unexpected identifier "path" — did you mean "plan.path"?
```

```text
SandboxError: harness.ajs:7:14

   6 | const inspectors = ["a", "b", "c"];
   7 | return inspectors.map(fn);
     |              ^

Cannot call undefined value "fn". The identifier "fn" is not defined in this scope.
```

```text
SandboxError: harness.ajs:23:3

  22 | while (true) {
  23 |   tasks.push(makeTask());
     |   ^

Step budget exceeded (1,000,000 steps). Likely an infinite loop. Increase budget.steps in the runner if intentional.
```

```text
DisallowedSyntaxError: harness.ajs:4:1

   3 |
   4 | async function build() {
     | ^

Async functions are not supported in the sandbox subset. Use a synchronous function or a top-level expression.
```

Errors are values, not host `Error`s — the runner formats them. Errors thrown from host-injected functions surface as `SandboxError` with the host stack scrubbed and a short summary preserved.

## 3. Implementation details and technical decisions

Pending — drafted after Level 2 sign-off.

## 4. Interfaces and test plan

Pending — drafted after Level 2 sign-off.

## 5. Code plan

Pending — drafted after Level 2 sign-off.
