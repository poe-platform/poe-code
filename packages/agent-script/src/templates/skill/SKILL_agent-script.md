---
name: poe-code-agent-script
description: "Author agent-script harness pairs (.md/.ajs) for poe-code harness run. Triggers on: agent-script, write a harness, .ajs, harness pair."
---

## What Runs

`poe-code harness run <path>` is the real harness runner. It reads a `.md` file
and the same-basename `.ajs` file, validates Markdown frontmatter against the
`.ajs` `schema` export, lints the `.ajs` source, then executes the default export
with real agent spawns.

`npx poe-agent-script <path>` is only a stub dry-runner. It uses canned agent
responses and is good for syntax, lint, schema, frontmatter, and control-flow
checks before paying for real spawns. It does not prove real model behavior.

## Pair Layout

`.md`: YAML frontmatter at the top, optional prose after it. Put all required
inputs here, including `principles: [...]` when prompts must inherit hard
constraints. Do not put executable JavaScript in Markdown.

`.ajs`: top-level imports, an exported `schema` for frontmatter validation, and
an exported default async function for runtime logic. Spawn agents from the
default function, not from schema initializers. Return a serializable summary.

## Spawning Agents

`spawn(definition, options)` resolves to `{ exitCode, stdout, stderr, summary,
durationMs, usage? }`. Read `summary` for the agent's response. Real harness
runs show a numbered lifecycle line for every spawn, so sequential loop spawns
remain easy to follow.

Set `options.label` when the prompt is generated, verbose, or sensitive. The
label is used only for lifecycle output and is not sent to the agent:

```js
await spawn(frontmatter.agent, { label: `Review ${target}`, prompt });
```

`poe-code harness run` retries transient spawn failures up to five attempts with
exponential backoff. The CLI shows every failed attempt, the next delay, and a
prominent final error. Permanent configuration and authentication failures stop
immediately. Tuple calls passed to `spawn.parallel` use the same lifecycle and
default retry behavior. Use `spawn.retry(definition, options, retryOptions)` only
when a particular script needs a different retry policy; `maxAttempts` is always
capped at five.

## Supported JavaScript

Agent-script is smaller than project TypeScript. Supported after the runtime
fixes: arrow functions, `async`/`await`, `const`/`let`, destructuring, spread,
optional chaining, nullish coalescing, template literals, binary operators,
logical operators, conditional operators, `if`/`else`, `for`, `for...of`,
`while`, `try`/`catch`/`finally`, `throw`, and `return`.

Not supported: regex literals, classes, `new`, `this`, `var`, generators,
`do...while`, `switch`, labels, and mutable member-target assignment such as
`obj.x = value` or `items[i] = value`. Build replacement objects/arrays instead.

## Schema Initializers

The `schema` export initializer is evaluated in isolation. Earlier outer `const`
bindings are not in scope; only the `schema` module import is available. Inline
shared shapes even when that repeats a few fields. Keep the schema expression
pure and declarative; do not reference helper constants outside the initializer
or rely on runtime imports during schema extraction.

## Common Pitfalls

- Bare `String(x)` and `Math.PI` are lint-clean after lint-known-globals; older
  branches may still reject known globals at lint time.
- Do not pass regex args to `String#split` or `String#replace`; regex literals
  and `new RegExp(...)` are unsupported.
- Async arrows still cannot close over outer `let`. Use `const`, pass
  parameters, or keep async code in the default function body.
- `for...of` only works on arrays, not strings, maps, sets, or generic
  iterables.
- Schema extraction only sees `schema`; runtime imports are irrelevant there.

## Local Validation

Dry-run with the stub before real spawns, then use the real runner when agent
responses and side effects matter:

```bash
npx poe-agent-script path/to/harness.md
poe-code harness run path/to/harness.md
```

## Snapshot And Resume

Long harness runs should use snapshots.

```bash
poe-code harness run path/to/harness.md --snapshot-path tmp/harness.snapshot.json
poe-code harness run path/to/harness.md --snapshot-path tmp/harness.snapshot.json --resume
```

Snapshots record interpreter state across await points. Resume validates that the
`.ajs` source still matches the snapshot; if the source changed, start fresh
without `--resume`.

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
    const review = await spawn(frontmatter.agent, { prompt });
    reviews.push({ target, review });
  }

  return { ok: true, reviewed: reviews.length, reviews };
};
```
