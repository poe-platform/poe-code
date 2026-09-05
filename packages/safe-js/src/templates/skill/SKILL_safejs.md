---
name: poe-code-safejs
description: "Author SafeJS harness pairs (.md/.ajs) for poe-code harness run. Triggers on: SafeJS, safe-js, safejs, write a harness, .ajs, harness pair."
---

## What Runs

`poe-code harness run <path>` is the real harness runner. It reads a `.md` file
and the same-basename `.ajs` file, validates Markdown frontmatter against the
`.ajs` `schema` export, lints the `.ajs` source, then executes the default export
with real agent spawns.

`npx --package poe-code poe-safe-js <script.safejs>` runs standalone scripts with
canned agent responses. Use it for isolated syntax, lint, and control-flow probes
with the stub's supported modules. It does not load `.md`/`.ajs` harness pairs or
provide their `schema` module, so it cannot validate a pair's frontmatter/schema.
It does not prove real model behavior. Explicit `--fs` and `--mcp-config`
capabilities are real, not stubs.

## Pair Layout

`.md`: YAML frontmatter at the top, optional prose after it. Put all required
inputs here, including `principles: [...]` when prompts must inherit hard
constraints. Do not put executable JavaScript in Markdown.

`.ajs`: top-level imports, an exported `schema` for frontmatter validation, and
an exported default async function for runtime logic. Spawn agents from the
default function, not from schema initializers. Return a serializable summary.

## Spawning Agents

`spawn(definition, options)` resolves to `{ exitCode, stdout, stderr, summary,
durationMs, usage? }`, including nonzero exits. Inspect `exitCode` to recover or
set `check: true` to require success. Checked failures throw `AgentSpawnError`
with the complete result in `error.result`. Transport errors and cancellation
always reject. Read `summary` for the agent's response. Real harness
runs show a numbered lifecycle line for every spawn, so sequential loop spawns
remain readable.

Set `options.label` when the prompt is generated, verbose, or sensitive. The
label is used only for lifecycle output and is not sent to the agent:

```js
await spawn(frontmatter.agent, { label: `Review ${target}`, prompt, check: true });
```

`poe-code harness run` retries transient spawn failures up to five attempts with
exponential backoff. The CLI shows every failed attempt, the next delay, and a
warning for returned failures or a final error for checked failures. Permanent
configuration and authentication failures are not retried. Tuple calls passed
to `spawn.parallel` use the same lifecycle and
default retry behavior. Use `spawn.retry(definition, options, retryOptions)` only
when a particular script needs a different retry policy; `maxAttempts` is always
capped at five.

`spawn.parallel(calls, { check: true })` checks the group and throws a
`SpawnParallelError` with `index`, `result`, and `results`. With `failFast: false`,
every call finishes before checking results. Without `check`, nonzero results
are returned in input order. Per-call `check: true` still rejects; with
`failFast: false`, thrown failures are collected in `AggregateError.errors`.
The retry policy runs before the result policy, including unchecked calls.

## Supported JavaScript

Both runners accept `--mcp-config <json-path>` with a host-owned `servers` map
of named stdio (`command`, optional `args`, `cwd`, `env`) or HTTP (`url`, optional
`headers`) configurations. Scripts use `import {servers} from "mcp"` or
`await client(server("name"))`; they cannot choose arbitrary commands or URLs.
Connections are lazy and closed after each run. Stdio environments are empty
unless explicitly configured. Tool calls are effectful: uncertain pending calls
require reconciliation, not blind reissue on resume.

Environment access is also explicit: both runners accept `--env-config <json-path>`
with `{ "allow": ["NAME"], "values": { "NAME": "value" } }`. Omit `values` to
grant the named host variables; an explicit values map never falls back to the
host environment. Scripts use `import {get} from "env"`. `get(name)` returns
undefined only for a granted but missing value; denied names throw an Error with
`code: "ENV_ACCESS_DENIED"` and `variable: name`. Names are exact, not trimmed.
Frontmatter never grants access. Checkpoints and output may contain granted
secrets, including historical values retained during replay.

Linted harness files support arrows, ordinary functions (including async
functions), synchronous generators, closures over `const`, `let`, parameters, and imports,
`async`/`await`, regex literals, sandbox constructor calls, `const`/`let`/`var`,
destructuring, spread, optional chaining, nullish coalescing, template
literals, assignments/member assignment, `if`/`else`, `for`, `for...in`,
`for...of`, `while`, `do...while`, labels, `try`/`catch`/`finally`, `throw`,
`switch`, `this`, and `return`.

Public classes support constructors, instance/static methods and fields, static
blocks, inheritance, `super`, and `new.target`. Private elements, accessors, and
default class exports remain unsupported; built-in inheritance and portable
custom-prototype snapshots remain incomplete.

Top-level `await` also works inside control-flow blocks. `new Map(...)`,
`new Set(...)`, and `new Promise(executor)` do not require lint suppressions.

Not supported: async generators, `eval`, `Function`, dynamic
imports, BigInt literals, and Node/browser globals such as `process`, `fetch`,
`setTimeout`, or `globalThis`.

## Schema Initializers

The `schema` export initializer is evaluated in isolation. Earlier outer `const`
bindings are not in scope; only the `schema` module import is available. Inline
shared shapes even when that repeats a few fields. Keep the schema expression
pure and declarative; do not reference helper constants outside the initializer
or rely on runtime imports during schema extraction.

## Common Pitfalls

- `Map` and `Set` methods `keys()`, `values()`, and `entries()` return live,
  single-use iterators. Use `Array.from(...)` or spread when you need an array
  snapshot; use `iterator.next()` to consume one entry.
- Ordinary user constructors expose `.prototype` and support `instanceof`.
  Built-in prototype graphs remain incomplete, and custom prototype-linked
  values still have copy/snapshot restrictions.
- `for...in` rejects destructuring in the loop head. Destructure in the body.
- Bare function calls set `this` to `undefined` (strict semantics).
- Generators cannot `await`.
- Suspended synchronous generators can cross snapshot boundaries when their
  captured state is snapshotable. Pending host effects still need reconciliation.
- Schema extraction only sees `schema`; runtime imports are irrelevant there.

## Local Validation

Use a standalone probe for isolated language/runtime checks. Validate and run the
actual harness pair with the real runner; that command is not a dry-run and can
spawn agents or perform granted capability effects:

```bash
npx --package poe-code poe-safe-js path/to/probe.safejs
poe-code harness run path/to/harness.md
```

## Snapshot And Resume

Long harness runs should use snapshots.

Budget failures remain fatal inside the script. The host can request
`dump(originalRunPromise, { onFailure: "checkpoint" })` after failure and resume
with an explicitly larger budget. Both CLIs support `--max-steps` and
`--data-size`; never silently retry with unlimited resources. Current failure
checkpoints preserve completed effects, but pending effects still need
reconciliation and unsupported state can prevent recovery.

```bash
poe-code harness run path/to/harness.md --snapshot-path tmp/harness.snapshot.json
poe-code harness run path/to/harness.md --snapshot-path tmp/harness.snapshot.json --resume
```

Snapshots record interpreter state across await points. Resume validates the
`.ajs` source and execution semantics. For changed source or supported older
execution markers, use `poe-code harness migrate old.json --from original.ajs
--inspect`, reconcile outstanding operations, and confirm the old execution and
callbacks are stopped. Then provide `--to continuation.ajs --plan migration.json
--output next.json`. The plan contains explicit `state` and digest-bound
`reconciliation`; the continuation reads `import.meta.migration`. Migration never
runs old frames or effects and refuses to overwrite files. See SafeJS's
`MIGRATION.md` for receipt details and supported formats. Starting fresh without
`--resume`, or repeating old work in the continuation, can repeat host effects.

## Constraint Propagation

Principles in frontmatter do not automatically change arbitrary prompt strings.

Declare them in the `.md`:

```yaml
principles:
  - Keep providers declarative.
  - Do not add provider-specific branches.
```

Call `harness.applyConstraints(promptString)` before every spawn that must
inherit frontmatter principles.

## Template Pair

`review-harness.md`:

```markdown
---
title: Provider review
agent: codex
targets:
  - packages/providers/src/index.ts
principles:
  - Keep providers declarative.
  - Do not add provider-specific branches.
---

Review provider implementation targets.
```

`review-harness.ajs`:

```js
import { spawn } from "agent";
import * as harness from "harness";
import { S } from "schema";

export const schema = S.Object({
  title: S.String(),
  agent: S.String(),
  targets: S.Array(S.String()),
  principles: S.Optional(S.Array(S.String()))
});

export default async (frontmatter) => {
  if (frontmatter.targets.length === 0) {
    return { ok: true, reviews: [] };
  }

  const reviews = [];
  for (const target of frontmatter.targets) {
    const prompt = harness.applyConstraints(`Review ${target} for provider pitfalls.`);
    const review = await spawn(frontmatter.agent, { prompt, check: true });
    reviews.push({ target, review });
  }

  return { ok: true, reviewed: reviews.length, reviews };
};
```
