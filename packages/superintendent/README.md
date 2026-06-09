# @poe-code/superintendent

Superintendent workflow package for parsing superintendent plan documents, running the builder/inspector/superintendent loop, exposing CLI + MCP commands, and providing deterministic testing helpers.

## Package overview

This package provides:

- markdown document parsing for superintendent plans with YAML frontmatter
- Task Board parsing and runtime status writers
- runtime orchestration for builder, inspectors, superintendent, and owner review
- cmdkit command groups that can be composed into CLI, SDK, and MCP surfaces
- testing helpers for in-memory loop simulation

The canonical workflow artifact is a single markdown file with frontmatter plus a required `## Task Board` section in the body.

## CLI commands and usage

Local development entrypoint:

```sh
npx tsx packages/superintendent/src/cli.ts --help
```

Built entrypoint:

```sh
node packages/superintendent/dist/cli.js --help
```

Main commands:

```sh
npx tsx packages/superintendent/src/cli.ts run <doc> [--agent <builder-agent>]
npx tsx packages/superintendent/src/cli.ts validate <doc>
npx tsx packages/superintendent/src/cli.ts complete <doc> [--reason <text>]
npx tsx packages/superintendent/src/cli.ts builder run <doc>
npx tsx packages/superintendent/src/cli.ts inspector list <doc>
npx tsx packages/superintendent/src/cli.ts inspector run <doc> [name]
```

Behavior notes:

- `run` starts the full loop and uses the live dashboard in terminal output. Builder agent resolution is `--agent <id>` first, then an explicit `builder.agent` in the plan frontmatter. If both are omitted, non-`--yes` runs prompt even when a default agent is configured; `--yes` uses the configured default agent when set, otherwise the `claude-code` fallback.
- `validate` checks frontmatter, supported prompt variables, and the Task Board shape.
- `complete` force-transitions the document status to `completed`.
- `builder run` executes only the builder role.
- `inspector run` executes one named inspector, or all configured inspectors when `name` is omitted.

## MCP tool names

MCP server entrypoint:

```sh
npx tsx packages/superintendent/src/mcp.ts
```

Installed binary:

```sh
poe-superintendent-mcp
```

Exposed server tools:

- `superintendent.run`
- `superintendent.validate`
- `superintendent.complete`
- `superintendent.builder.run`
- `superintendent.inspector.list`
- `superintendent.inspector.run`

Runtime-injected workflow tool:

- `workflow_transition` — injected automatically for superintendent/owner runs when the current state allows transitions
- `builder.run` — available to superintendent turns for targeted builder follow-ups
- `inspector.run` — available to superintendent turns for targeted inspector reruns

`superintendent.run` uses the same runtime loop as the CLI command, but the MCP surface runs without the interactive dashboard.

## SDK API summary

Import from the package root:

```ts
import {
  parseSuperintendentDoc,
  updateStatus,
  transitionState,
  incrementRound,
  parseTaskBoard,
  hasTaskBoard,
  runLoop,
  runBuilder,
  runInspector,
  runAllInspectors,
  resolveTemplate,
  createLoopState,
  applyTransition,
  isComplete,
  superintendentGroup
} from "@poe-code/superintendent";
```

### Document

- `parseSuperintendentDoc`
- `updateStatus`
- `transitionState`
- `incrementRound`
- `parseTaskBoard`
- `hasTaskBoard`
- types: `SuperintendentDoc`, `SuperintendentFrontmatter`, `StatusBlock`, `TaskBoard`, `TaskItem`

### Runtime

- `runLoop`
- `runBuilder`
- `runInspector`
- `runAllInspectors`
- `resolveTemplate`
- types: `LoopCallbacks`, `BuilderResult`, `InspectorResult`, `TemplateContext`

### State

- `createLoopState`
- `applyTransition`
- `isComplete`

### Testing

Re-exported from `./testing/index.js`:

- `createSuperintendentSimulation`
- `successTurn`
- `failTurn`
- `builderTurn`
- `inspectorTurn`
- `superintendentTurn`
- `ownerApproveTurn`
- `ownerRejectTurn`

### Commands

- `superintendentGroup`

## Environment variables

Superintendent-specific config env var:

- `POE_SUPERINTENDENT_PLAN_DIRECTORY` — override where `superintendent run` discovers plan docs
- `POE_SUPERINTENDENT_TUI` — when `true`, enable the live dashboard by default for terminal TTY runs

The package also respects these generic runtime variables:

- `HOME` / `USERPROFILE` — used when resolving workflow-relative document paths for `run`
- `EDITOR` / `VISUAL` — used by the dashboard edit action; falls back to `vi`

## Configuration options

Configuration lives in the superintendent markdown document frontmatter.

### Required document shape

```yaml
---
kind: superintendent
version: 1
builder:
  # agent is optional; omit it to use the configured default, prompt, or --yes fallback
  agent: claude-code
  prompt: |
    Build {{plan.path}}
superintendent:
  agent: claude-code
  prompt: |
    Review {{builder.summary}}
owner:
  agent: claude-code
  prompt: |
    Approve {{superintendent.summary}}
status:
  state: in_progress
  round: 0
  review_turn: 0
---
# Plan

## Task Board

- [ ] First task
```

### Root frontmatter fields

- `kind` — required, must be `superintendent`
- `version` — required numeric document version
- `mcp` — optional map of named MCP server definitions
- `builder` — required builder role config
- `inspectors` — optional map of inspector role configs keyed by inspector name
- `superintendent` — required superintendent role config
- `owner` — required owner role config
- `max_rounds` — optional number, defaults to `100`
- `status` — required runtime status block

### `mcp.<name>` config

- `command` — required executable
- `args` — optional string array of arguments
- `timeout` — optional positive number of seconds for tool-call timeout

### Role config

The `builder`, each `inspectors.<name>`, `superintendent`, and `owner` blocks support:

- `agent` — optional agent id. Parsed roles default to `claude-code`; `superintendent run` resolves the builder agent from `--agent`, explicit frontmatter, an interactive prompt, or—when `--yes` is set—the configured default agent followed by the `claude-code` fallback.
- `mode` — optional spawn mode
- `prompt` — required prompt template
- `tools.mcp` — optional list of MCP server names declared under the root `mcp` map

### Status block

- `state` — required: `in_progress`, `review`, or `completed`
- `round` — required number
- `review_turn` — required number

### Body requirements

The markdown body must include a `## Task Board` section with checkbox list items:

```md
## Task Board

- [ ] open task
- [x] completed task
```

### Supported prompt template variables

The validator/runtime currently supports:

- `{{plan.path}}`
- `{{builder.summary}}`
- `{{builder.log}}`
- `{{inspectors.<name>}}`
- `{{superintendent.summary}}`
- `{{owner.feedback}}`
