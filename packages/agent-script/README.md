# @poe-code/agent-script

Parse, lint, execute, and checkpoint agent-script programs.

`@poe-code/agent-script` is the small runtime used for harness-style scripts in Poe Code. It gives you:

- a parser for the agent-script language subset
- a linter for syntax, module, and safety rules
- a runtime for executing scripts against registered host modules
- snapshot helpers for dump/restore flows
- a file-based harness runner for `.ajs` files and markdown plans

## Overview

Agent-script is a constrained JavaScript-like language designed for deterministic, host-mediated automation. Scripts import named modules that you register from the host, then run inside the subset interpreter.

`runHarness()` is the usual entrypoint for plan-style documents:

- `.ajs` files are treated as raw scripts
- markdown files load YAML frontmatter, then execute the first `js` fenced block
- if a markdown file has no fenced `js` block, the markdown body is treated as the script source

## API

### `parse(source, filename?)`

Parses a single top-level expression or statement and returns an AST with source spans.

- Use this for tooling, syntax inspection, or tests.
- Throws on parse errors or disallowed syntax.

### `lint(source, options?)`

Returns diagnostics for the agent-script subset and registered modules.

Options:

- `filename?`: filename used in diagnostics. Defaults to `<input>`.
- `modules?`: registered module metadata used to validate `import` statements.

Diagnostics include:

- parse/disallowed syntax errors
- unknown modules and unknown exports
- unknown identifiers
- closure and async-safety checks
- subset-specific method restrictions
- a small set of warnings for unused bindings and unnecessary patterns

### `run(source, options?)`

Executes a script module and returns:

- `{ ok: true, returnValue?, snapshot, stats }` on success
- `{ ok: false, error, snapshot, stats }` on interpreter errors

Options:

- `bindings?`: extra top-level host bindings
- `budget?`: interpreter budget instance
- `modules?`: runtime module registry
- `randomSeed?`: deterministic seed for `Math.random()`
- `signal?`: abort signal for cancellation
- `snapshot?`: prior snapshot validated through `restore()`
- `snapshotIntervalMs?`: periodic snapshot write interval
- `snapshotPath?`: file path written by the snapshot scheduler
- `sink?`: console sink used by the subset `console` globals

### `dump(resultOrPromise)`

Serializes a run snapshot to formatted JSON.

- Accepts a completed `RunResult`
- Accepts the pending promise returned by `run()`
- When used with an in-flight `run()` promise, resolves to the latest yielded snapshot

### `restore(snapshot, { source })`

Validates that a stored snapshot still matches the current source by comparing `sourceHash`.

- Returns the snapshot unchanged when the hash matches
- Throws when the source changed since the snapshot was taken

### `runHarness(filepath, options)`

Loads a harness document from disk, lints it, and executes it.

Options:

- `modulesFor(frontmatter, meta)`: returns the runtime module registry for that file
- `signal?`: abort signal for cancellation
- `snapshotPath?`: file path written by the snapshot scheduler

Behavior:

- For markdown files, `frontmatter` is the parsed YAML mapping and `meta` includes `filepath`, `kind`, and `version`
- For `.ajs` files, `frontmatter` is `{}` and `kind` / `version` are `undefined`
- Lint errors throw `LintError` before execution
- The `harness` module is automatically excluded for raw `.ajs` scripts

## Language Subset

### In

- `import` declarations from registered host modules
- `const` and `let`
- arrays, objects, destructuring, rest, and spread
- arrow functions, including `async` arrows
- `await` at top level and inside `async` arrows
- `if`, `for`, `for...of`, `while`, `break`, and `continue`
- `try` / `catch` / `finally`, `throw`, and `return`
- template literals
- property access, optional chaining, and function calls
- primitive values plus plain array/object data

### Out

- `function` declarations and expressions
- generators
- `class`
- `new`
- `this`
- `var`
- `do...while`
- `switch`
- `with`
- labels
- regex literals
- `eval` and `Function`

### Runtime and lint restrictions

- `await` is only valid at script top level or inside `async` arrows
- lambdas cannot close over outer `let` bindings
- `__proto__`, `prototype`, and `constructor` property access is rejected
- `String#split()` does not accept regex separators
- `String#replace()` and `String#replaceAll()` do not accept regex search values or function replacers
- `Array#sort()` only accepts comparators that are arrows returning a number

## Registered Modules

### Runtime shape

`run()` expects a module registry shaped like this:

```ts
const modules = {
  moduleName: {
    exportedName: valueOrFunction
  }
};
```

You can use either plain objects or `Map`s at both levels:

```ts
const modules = new Map([
  [
    "custom",
    new Map([
      ["hello", (name: string) => `hello ${name}`]
    ])
  ]
]);
```

Each export can be:

- a sandbox-copyable value: `string`, `number`, `boolean`, `null`, `undefined`, plain arrays, plain objects
- a host function
- an async host function

Host functions are wrapped automatically so subset code can call them safely.

### Lint shape

`lint()` only needs module metadata, not live functions. The simplest shape is an export list:

```ts
const lintModules = {
  custom: ["hello"]
};
```

For source-backed modules, you can also register:

```ts
const lintModules = {
  custom: {
    exports: ["hello"],
    filename: "/repo/custom.ajs",
    source: 'exported source used for dependency checks'
  }
};
```

That richer shape lets the linter detect source-module cycles.

## Adding A Custom Module

1. Create a host object that exposes the functions or values you want the script to import.
2. Register it under a module name in `run({ modules })`.
3. If you lint separately, register the same module name and exported names in `lint({ modules })`.
4. If you need explicit host/sandbox copying, use `deepCopyToSandbox()` and `deepCopyFromSandbox()`.

Minimal custom module:

```ts
import { lint, run } from "@poe-code/agent-script";

const source = [
  'import { greet } from "custom";',
  'return await greet("Ada");'
].join("\n");

const runtimeModules = {
  custom: {
    greet: async (name: string) => `hello ${name}`
  }
};

const diagnostics = lint(source, {
  filename: "example.ajs",
  modules: {
    custom: ["greet"]
  }
});

if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
  throw new Error("Script did not lint cleanly.");
}

const result = await run(source, {
  modules: runtimeModules
});

if (!result.ok) {
  throw new Error(result.error.message);
}

console.log(result.returnValue);
```

## Harness Example

```ts
import { makeHarnessModule, runHarness } from "@poe-code/agent-script";

const result = await runHarness("/repo/docs/plans/example.md", {
  modulesFor(frontmatter, meta) {
    return {
      harness: makeHarnessModule(frontmatter, meta),
      custom: {
        greet: (name: string) => `hello ${name}`
      }
    };
  }
});
```

## Environment variables

This package does not read package-level environment variables.

Notes:

- `run()`, `lint()`, `parse()`, `dump()`, `restore()`, and `runHarness()` do not read environment variables on their own
- `makeEnvModule(allowList)` reads from the current process environment, but only for names you explicitly allow

## Configuration

This package does not read package-level config files.

Runner options:

- `lint()` reads `filename` and `modules`
- `run()` reads `bindings`, `budget`, `modules`, `randomSeed`, `signal`, `snapshot`, `snapshotIntervalMs`, `snapshotPath`, and `sink`
- `runHarness()` reads `modulesFor`, `signal`, and `snapshotPath`
