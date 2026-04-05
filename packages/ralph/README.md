# @poe-code/ralph

Simple iterative markdown loop. Give it a markdown doc, it runs an agent on it repeatedly for N iterations.

## Quickstart

```bash
# 1. Write a markdown doc with your task description

# 2. Initialize Ralph config in the doc's frontmatter
poe-code ralph init

# 3. Run the loop
poe-code ralph run
```

## Example Doc

A plain markdown file. Ralph adds YAML frontmatter to track agent, iterations, and status.

```markdown
---
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

### Multiple agents

Agents cycle round-robin across iterations:

```yaml
agent:
  - claude-code
  - codex
```

### Specifying a model

Use `agent:provider/model` notation:

```yaml
agent: claude-code:anthropic/claude-opus-4.6
```

## Doc Discovery

Docs are auto-discovered from `.poe-code/ralph/plans/` — you almost never need to pass a path manually.

1. Scan `.poe-code/ralph/plans/` and `~/.poe-code/ralph/plans/` for `.md` files
2. One doc found — use it
3. Multiple — prompt for selection
4. None — fail

## CLI

```bash
poe-code ralph init [doc]  [--agent <name>] [--iterations <n>]
poe-code ralph run  [doc]  [--agent <name>] [--iterations <n>]
```

## Package API

```ts
import { runRalph } from "@poe-code/ralph";

const result = await runRalph({
  agent: "claude-code",
  cwd: process.cwd(),
  homeDir: "/home/test",
  docPath: ".poe-code/ralph/plans/refactor-auth.md",
  maxIterations: 3,
  runAgent: async ({ agent, prompt, cwd, model, signal }) => {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
});
```

Exports: `runRalph`, `discoverDocs`, `parseFrontmatter`, `writeFrontmatter`.

## Testing Helper

```ts
import { createRalphSimulation, successTurn, failTurn } from "@poe-code/ralph/testing";

const sim = createRalphSimulation({
  docContent: "# Do the thing\nMake it better.",
  maxIterations: 2,
  turns: [successTurn(), successTurn()]
});

const result = await sim.run();
```
