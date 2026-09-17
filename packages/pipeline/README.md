# @poe-code/pipeline

Step-based task pipeline for running task plans through the existing agent spawn infrastructure.

## Quickstart

```bash
# 1. Install pipeline support files
poe-code pipeline install --local

# 2. Create a plan — use your coding agent (Claude Code, Codex, etc.) to write
#    a markdown plan

# 3. Generate a pipeline plan from the feature plan using /poe-code-pipeline-plan
#    (skill installed in step 1)

# 4. Run it
poe-code pipeline run
```

## Example Plan

```md
---
kind: pipeline
version: 1
tasks:
  - id: fix-timeout
    title: Fix timeout bug
    prompt: Fix the timeout regression in session refresh.
    status:
      implement: open
      test: open
      commit: open

  - id: add-retry
    title: Add retry logic
    prompt: |
      Add exponential backoff retry to the HTTP client.
      Cover edge cases: max retries, non-retryable status codes.
    status:
      implement: open
      security_review: open
      test: open
      commit: open
---

# Context

Fix the session refresh timeout regression and add retry handling.
```

Each step becomes its own agent execution. Steps are resolved from `.poe-code/pipeline/steps.yaml` (or `~/.poe-code/pipeline/steps.yaml`). See [Step Configuration](#step-configuration).

## Step Configuration

Pipeline ships with no hardcoded steps. Definitions are resolved from:

1. `~/.poe-code/pipeline/steps.yaml` (global)
2. `.poe-code/pipeline/steps.yaml` (project, overrides global by step name)

## Environment Variables

This package does not read public environment variables directly. The CLI resolves config and agent credentials before calling the runner.

## Configuration Options

Pipeline config is split between `.poe-code/config.json`, `.poe-code/pipeline/steps.yaml`, and plan frontmatter. `plan.plan_directory` controls discovery, `pipeline.tui` controls the dashboard default, and `pipeline.archive` controls successful-plan archiving. Step definitions accept `prompt`, `agent`, `model`, `mode`, and inherited `mcp`, `setup`, and `teardown` settings.

```yaml
steps:
  implement:
    prompt: |
      {{id}}: {{title}}
      {{prompt}}
      Follow TDD. Add or update focused tests first, then implement.
    agent: codex
    model: "<model-id>"

  security_review:
    mode: read
    prompt: |
      {{id}}: {{title}}
      Review changed code for auth, injection, secrets, and validation issues.
    agent: claude-code
```

Supported placeholders: `{{id}}`, `{{title}}`, `{{prompt}}`, `{{plan_path}}`.

Any prompt can include external files with `{{file 'path'}}`:

```yaml
steps:
  implement:
    prompt: |
      {{file 'docs/implement-instructions.md'}}
      Task: {{id}} — {{title}}
      {{prompt}}
```

Each step can override `agent`, `model`, and `mode`. An omitted `mode` uses the shared `agent-spawn` default (`auto`).

Pipeline plans validate task shapes before execution. Unknown task properties,
empty inline step names, and empty task-status step names are rejected. A task
with an empty step key is still considered runnable instead of being treated as
complete.

`{{file 'path'}}` document variables may read only files inside the project root.

## MCP Servers

The optional `mcp` key passes MCP servers to every agent execution:

```yaml
mcp:
  my-server:
    command: npx
    args: [my-server]
    env:
      API_KEY: secret

tasks:
  - id: use-server
    title: Task using MCP
    prompt: Do something with the MCP server.
    status: open
```

## Lifecycle Hooks

Two optional hooks run outside the task loop:

```yaml
setup:
  prompt: Prepare the workspace — install dependencies, run migrations, etc.

teardown:
  mode: read
  prompt: Run final checks and report results.
```

Hooks can be defined in `steps.yaml` (shared defaults) or in the plan file (per-plan override). To disable an inherited hook, set it to `false`:

```yaml
setup: false
tasks: ...
```

If setup fails, no tasks run. If teardown fails, the pipeline returns `stopReason: "failed"`.

## Execution Semantics

Pipeline processes tasks sequentially in plan order:

1. Resolve plan path and step definitions
2. Serialize calls for the same plan within the current process (no disk locks)
3. Select next runnable task or step
4. Spawn one agent execution
5. Persist status after agent exits
6. Continue until a stop condition

Stop conditions: all work complete, a task/step fails, cancellation, or `maxRuns` reached.

Pass `--worktree` to the `poe-code pipeline run` CLI to run the whole pipeline in one managed git worktree and reconcile successful output afterward. Worktree mode requires a clean source checkout before the run starts. The root `poe-code` SDK wrapper also supports worktrees; the package-level runner below does not accept a `worktree` option.

A failed task or step blocks all later tasks.

### Cancellation

No intermediate status is written before spawn. If an execution is aborted, the task stays at its prior status and the next queued call can proceed.

### Plan Archiving

When all tasks complete successfully, the plan moves to an `archive/` folder next to the plan file. Plans already complete at start are not archived. Disable this with `poe-code pipeline run --no-archive` or `{ "pipeline": { "archive": false } }` in config.

## Plan Discovery

Plans are auto-discovered from markdown files in the shared plan directory,
`docs/plans` by default. Explicit `--plan` paths can still point at YAML files.

1. Scan the shared plan directory for markdown files with `kind: pipeline`
2. One plan found — use it with `--yes`, otherwise prompt with completion stats
3. Multiple — prompt with completion stats, or use the first path alphabetically with `--yes`
4. None — prompt for path, or fail with `--yes`

## Custom Plan Directory

By default plans are discovered from `docs/plans`. To use a different directory:

```bash
# Set plan directory in project config (.poe-code/config.json)
# { "plan": { "plan_directory": "docs/plans" } }

# Or via env
POE_PLAN_DIRECTORY=docs/plans poe-code pipeline run

# Or point to a specific file directly
poe-code pipeline run --plan docs/plans/my-feature.md
```

## Dashboard Configuration

Pipeline's live dashboard shows the current task and step, the plan sequence, and concise agent actions. Type a message and press Enter to run it after the selected plan. Queue several messages with repeated submissions; Alt+Up/Down selects their target plan. Ctrl+P switches to adding another plan at the end of the sequence.

Esc opens browsing controls: `v` shows all tasks and queued work, `d` expands action details, and `i` returns to the input. Ctrl+C cancels the run. Failed or limited plans leave later queue items pending.

```bash
# One-off flags
poe-code pipeline run --tui
poe-code pipeline run docs/plans/first.md docs/plans/second.md --tui --after-plan "Review the API" --after-plan "Verify the tests"
poe-code pipeline run --no-tui

# Config default (.poe-code/config.json)
# { "pipeline": { "tui": true } }

# Env override
POE_PIPELINE_TUI=true poe-code pipeline run
```

## CLI

```bash
poe-code pipeline install [--agent <name>] [--local|--global] [--force]
poe-code pipeline validate <file> [--preview]
poe-code pipeline plan-path
poe-code pipeline run [plans...] [--agent <name>] [--model <model>] [--tui|--no-tui] [--after-plan <message>] [--task <id>] [--plan <path>] [--plans <paths...>] [--max-runs <n>] [--worktree]
```

Example:

```bash
poe-code pipeline run --plan docs/plans/my-feature.md
```

## Package API

```ts
import { runPipeline } from "@poe-code/pipeline";

const result = await runPipeline({
  agent: "claude-code",
  cwd: process.cwd(),
  homeDir: "/home/test",
  plan: ".poe-code/pipeline/plans/plan-auth.md",
  maxRuns: 5,
  runAgent: async ({ agent, prompt, mode, cwd, model, mcpServers, signal }) => {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
});
```

`runPipelineSequence({ plans, afterEachPlan, ...options })` runs a sequence with the same agent runner. `afterEachPlan` mirrors the repeatable `--after-plan` flag and also applies to plans added while running. Follow-ups use the selected run agent/model and the target plan's MCP servers and log directory.

For live input, supply a `queue` from `createRunQueue` in `@poe-code/agent-harness-tools` instead of `plans` and `afterEachPlan`. Call `queue.enqueueMessage(text, planId?)` or `queue.enqueuePlan(path)` while the sequence is running. `onQueueChange` receives immutable ordered snapshots; results include every completed plan, message result, and the final queue state. The root `poe-code` SDK exports both `runPipelineSequence` and `createRunQueue` with its default agent runner and optional worktree support.

Exports: `runPipeline`, `runPipelineSequence`, `resolvePlanPath`, `parsePlan`, `writeTaskStatus`, `loadPipelineConfig`, `loadResolvedSteps`, `selectNextExecution`, `buildExecutionPrompt`.

## Testing Helper

```ts
import { createPipelineSimulation, successTurn, failTurn } from "@poe-code/pipeline/testing";

const sim = createPipelineSimulation({
  projectSteps: {
    implement: { mode: "yolo", prompt: "Implement {{id}}" }
  },
  plan: {
    tasks: [
      {
        id: "task-1",
        title: "Demo task",
        prompt: "Do the thing",
        status: { implement: "open" }
      }
    ]
  },
  turns: [successTurn()]
});

const result = await sim.run();
```

## Variables

The optional `vars` field defines string values available as `{{var_name}}` in all prompts:

```yaml
vars:
  plan_doc: "{{file 'docs/plans/my-feature.md'}}"
  env: staging

tasks:
  - id: deploy
    title: Deploy to staging
    prompt: |
      {{plan_doc}}
      Deploy the feature to {{env}}.
    status: open
```

Use `{{file 'path'}}` to include file contents. Paths resolve relative to the project root.

Built-in step placeholders (`{{id}}`, `{{title}}`, `{{prompt}}`, `{{plan_path}}`) take precedence over vars with the same name.
