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
npx tsx packages/superintendent/src/cli.ts run <doc> [--agent <builder-agent>] [--worktree]
npx tsx packages/superintendent/src/cli.ts validate <doc>
npx tsx packages/superintendent/src/cli.ts complete <doc> [--reason <text>]
npx tsx packages/superintendent/src/cli.ts builder run <doc>
npx tsx packages/superintendent/src/cli.ts inspector list <doc>
npx tsx packages/superintendent/src/cli.ts inspector run <doc> [name]
```

Behavior notes:

- `run` starts the full loop and uses the live dashboard in terminal output. Builder agent resolution is `--agent <id>` first, then an explicit `builder.agent` in the plan frontmatter, then configured default agent. If none is set, `--yes` accepts the `claude-code` fallback; otherwise the CLI prompts. Pass `--worktree` to run the builder loop in a managed git worktree and reconcile successful output afterward.
- `validate` checks frontmatter, supported prompt variables, inspector names, and the Task Board shape.
- `complete` force-transitions the document status to `completed`.
- `builder run` executes only the builder role.
- `inspector run` executes one named inspector, or all configured inspectors when `name` is omitted.

Invalid config is reported instead of falling back to defaults, and missing
documents produce domain not-found errors.

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
  resolveSuperintendentDoc,
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
- `resolveSuperintendentDoc`
- `updateStatus`
- `transitionState`
- `incrementRound`
- `parseTaskBoard`
- `hasTaskBoard`
- types: `ResolvedSuperintendentDoc`, `SuperintendentDocumentFileSystem`, `SuperintendentDoc`, `SuperintendentFrontmatter`, `StatusBlock`, `TaskBoard`, `TaskItem`

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
- `extends` — optional relative path to a superintendent base file; resolves from the current document's directory
- `mcp` — optional map of named MCP server definitions
- `builder` — required builder role config
- `inspectors` — optional map of inspector role configs keyed by inspector name
- `superintendent` — required superintendent role config
- `owner` — required owner role config
- `max_rounds` — optional number, defaults to `100`
- `status` — required runtime status block

### Frontmatter inheritance

A superintendent plan can inherit frontmatter from a project-local base file:

```yaml
---
kind: superintendent
version: 1
extends: ./_bases/coding.md

owner:
  prompt: |
    Approve this feature-specific behavior.
status:
  state: in_progress
  round: 0
  review_turn: 0
---
```

Base files use `kind: superintendent-base` and contribute frontmatter only. The child document keeps its own markdown body and `## Task Board`.

```yaml
---
kind: superintendent-base
version: 1
builder:
  prompt: |
    Build {{plan.path}}.
superintendent:
  prompt: |
    Review {{builder.summary}}.
owner:
  prompt: |
    Approve.
max_rounds: 100
---
```

Path-valued `extends` must be a non-empty relative path. A base may also declare `extends` relative to its own directory. Cycles and chains deeper than five files are rejected.

Child frontmatter deep-merges over the base. Set a map entry to `null` to remove an inherited entry:

```yaml
inspectors:
  testing: null
```

### `mcp.<name>` config

- `command` — required executable
- `args` — optional string array of arguments
- `timeout` — optional positive number of seconds for tool-call timeout

### Role config

The `builder`, each `inspectors.<name>`, `superintendent`, and `owner` blocks support:

- `agent` — optional agent id. Parsed roles default to `claude-code`; `superintendent run` resolves an omitted builder agent from `--agent`, configured defaults, the `--yes` fallback, or an interactive prompt.
- `mode` — optional spawn mode
- `prompt` — required prompt template
- `mcp` — optional map of MCP server definitions available only to this role

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
