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
agent: claude-code:anthropic/claude-opus-4.7
```

## Template Variables

Ralph supports `{{ variable }}` syntax in doc bodies. Variables are interpolated before the prompt is sent to the agent but preserved as-is in the file.

| Variable | Resolves to |
|---|---|
| `{{ current_file }}` | Absolute path of the Ralph doc being run |
| `{{ current_iteration }}` | Current one-based Ralph iteration number |
| `{{ max_iterations }}` | Configured maximum Ralph iterations |

```markdown
---
agent: claude-code
iterations: 3
---
# Improve {{ current_file }}

Review and improve the plan in this file.
```

## Doc Discovery

Docs are auto-discovered from `.poe-code/ralph/plans/` — you almost never need to pass a path manually.

1. Scan `.poe-code/ralph/plans/` under the current working directory for `.md` files
2. One doc found — use it
3. Multiple — prompt for selection
4. None — fail

## Custom Plan Directory

By default docs are discovered from `.poe-code/ralph/plans/`. To use a different directory:

```bash
# Set plan directory in project config (.poe-code/config.json)
# { "ralph": { "plan_directory": "docs/plans" } }

# Or via env
POE_RALPH_PLAN_DIRECTORY=docs/plans poe-code ralph run

# Or point to a specific doc directly
poe-code ralph run docs/plans/refactor-auth.md
```

## Runtime Workspaces

When validating Ralph against a remote runtime such as E2B, create a fresh temporary workspace with `mkdtemp`, put only the Ralph plan and intended test files in that directory, pass the plan path directly, and run with `--cwd <tmpdir>`. Do not aim Ralph runtime tests at the poe-code checkout or a parent repository; Ralph agents are expected to edit their working directory across iterations, and remote runtime downloads overwrite the tmpdir copy after each iteration so the next iteration sees the prior edits.

## Dashboard Configuration

Ralph runs can render the live dashboard in terminal TTY mode.

```bash
# One-off flags
poe-code ralph run --tui
poe-code ralph run --no-tui

# Config default (.poe-code/config.json)
# { "ralph": { "tui": true } }

# Env override
POE_RALPH_TUI=true poe-code ralph run
```

## Archive Configuration

Ralph archives completed docs by default. Disable this with `poe-code ralph run --no-archive`, `{ "ralph": { "archive": false } }`, or `POE_RALPH_ARCHIVE=false`.

## CLI

```bash
poe-code ralph init [doc]  [--agent <name>] [--iterations <n>]
poe-code ralph run  [doc]  [--agent <name>] [--iterations <n>] [--cwd <path>] [--archive|--no-archive] [--tui|--no-tui]
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
