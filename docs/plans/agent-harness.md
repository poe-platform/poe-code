---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# agent-harness

A generic runner for agent-script-based harnesses, paired with co-located markdown documents that supply prompts and config.

## 1. What we're building

A new package, `@poe-code/agent-harness`, that runs a **harness pair**:

- `<name>.ajs` — orchestration script (agent-script source, the program the runtime executes)
- `<name>.md` — complementary markdown document with YAML frontmatter (prompts, agent config, status, research brief)

The `.ajs` is the orchestrator; the `.md` is data the orchestrator reads. The runtime pairs them by filename, lints + executes the `.ajs`, and exposes the markdown's frontmatter and body to the script via the `harness` module (or an extension of it).

This package replaces the bespoke runtimes in `@poe-code/experiment-loop`, `@poe-code/ralph`, `@poe-code/pipeline`, and `@poe-code/superintendent`. Each becomes a harness pair shipped as a built-in template, not a hand-written TypeScript loop.

Non-goals:

- Not a new language. Reuses `agent-script` parser/linter/runtime as-is.
- Not a replacement for `agent-harness-tools` runtime helpers (lock, hooks, run-logs, select-agent). Those keep their place; agent-harness uses them for cross-cutting concerns.
- Not removing the existing CLI commands' UX surface (`experiment run`, `ralph run`, ...). The CLI wrappers stay; their internals call the harness runner instead of the bespoke loop.
- No regex-based markdown parsing or templating system invented here — uses the existing `agent-script` loader.

## 2. User-facing shape

A harness is a pair of files with the same basename, in the same directory:

```text
.poe-code/harnesses/ralph/
  ralph.ajs       # orchestrator
  ralph.md        # plan / prompt / frontmatter (the document being run)
```

### The `.ajs` orchestrator

ESM-shaped. One required default export (the entry), one optional named export (the frontmatter schema). No top-level `return`. No manual cancellation handling — the interpreter aborts between host calls, the snapshot scheduler persists progress, `restore()` resumes.

```js
import { S } from "schema";
import { spawn } from "agent";
import { event } from "log";

export const schema = S.Object({
  iterations: S.Optional(S.Number({ minimum: 1, default: 3 })),
  agent: S.Optional(S.String({ default: "claude-code" })),
  status: S.Object({
    state: S.Enum(["open", "in_progress", "completed", "failed"] as const),
    iteration: S.Number({ minimum: 0 }),
  }),
});

export default async (frontmatter) => {
  const { kind, filename, body } = import.meta;

  for (let i = frontmatter.status.iteration; i < frontmatter.iterations; i++) {
    const r = await spawn({ agent: frontmatter.agent, prompt: body });
    event("iteration.completed", { kind, file: filename, i, summary: r.summary });
  }
};
```

Contract:

- `export default` — required, must be an async arrow. Receives the validated frontmatter as its single argument. Its return value is the harness result.
- `export const schema` — optional. If present, the loader evaluates it against `toolcraft-schema` builders and validates the `.md` frontmatter before invoking the entry. If absent, the entry receives the raw frontmatter map.
- `import.meta` — exposes `{ kind, version, filename, dirname, body }` of the **paired `.md`**, matching Node's ESM `import.meta` extensions. `body` is the markdown content below the YAML header.

### The `.md` plan

Plain markdown with YAML frontmatter. The frontmatter conforms to whatever `export const schema` declares; the body is free-form prose the orchestrator can use as the prompt.

```markdown
---
$schema: https://poe-platform.github.io/poe-code/schemas/harnesses/ralph.schema.json
kind: ralph
version: 1
agent: claude-code
iterations: 3
status:
  state: open
  iteration: 0
---
# Refactor the auth module

Split the monolithic auth.ts into separate files for session management,
token validation, and middleware. Keep all existing tests passing.
```

### CLI

```bash
# run a harness pair
poe-code harness run .poe-code/harnesses/ralph/ralph.md

# discover-and-run from .poe-code/harnesses/
poe-code harness run

# scaffold a new harness pair
poe-code harness new my-loop

# list installed harnesses
poe-code harness list
```

The runner pairs `.md` ↔ `.ajs` by basename in the same directory, lints the `.ajs`, validates the `.md` frontmatter against the extracted schema, then executes the entry.

### Built-in harnesses

`@poe-code/agent-harness` ships these as templates that `harness new <kind>` scaffolds:

- `ralph` — iterative single-agent loop
- `experiment` — measure, mutate, keep-or-revert via git
- `pipeline` — sequenced tasks with builder/reviewer roles
- `superintendent` — builder + parallel inspectors + judge + owner

Each is one `.ajs` + one `.md`. The existing `experiment run` / `ralph run` / etc. CLI commands keep their UX surface but delegate to the harness runner internally.

## 3. Implementation details and technical decisions

To be drafted next.

## 4. Interfaces and test plan

To be drafted next.

## 5. Code plan

To be drafted next.
