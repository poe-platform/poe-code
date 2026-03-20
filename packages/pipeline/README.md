# @poe-code/pipeline

Step-based task pipeline for running YAML plans through the existing agent spawn infrastructure.

Pipeline replaces the unbounded Ralph loop with a fixed sequence of task executions:

- A task can run once in stepless mode
- A task can define an ordered map of steps
- Each step is one agent execution
- Status is managed by code, not by agent output

This package is the core runtime behind `poe-code pipeline run`.

## Install Workflow

The intended setup flow is:

```bash
poe-code pipeline install --local
```

That command installs the `poe-code-pipeline-plan` skill for the selected agent and scaffolds:

- `.poe-code/pipeline/steps.yaml`
- `.poe-code/pipeline/plans/`

Supported install flags:

- `--agent <name>`
- `--local`
- `--global`
- `--force`

Behavior notes:

- `--local` writes project files under the current repository and installs the skill into the agent's local skill directory
- `--global` writes `~/.poe-code/pipeline/*` and installs the skill into the agent's global skill directory
- existing `steps.yaml` is preserved unless `--force` is set
- with `--yes`, install defaults to `claude-code` and `--local`
- the scaffolded `steps.yaml` contains commented examples only; uncomment or replace them to opt into stepped tasks

The installed `/plan` skill tells the agent to keep every task self-contained and to treat `steps.yaml` as user-editable source of truth.

## Core Model

A plan is a YAML file containing only tasks.

Each task has:

- `id`
- `title`
- `prompt`
- `status`

`status` is polymorphic:

- Scalar task status: `open`, `done`, `failed`
- Step-status map: ordered step name to `open`, `done`, `failed`

When a task uses a scalar `status`, Pipeline runs the task once with the task prompt directly.

When a task uses a step-status map, Pipeline:

1. Resolves step definitions
2. Picks the first `open` step in map order
3. Interpolates the step instruction
4. Runs one agent execution for that step
5. Marks that step `done` or `failed`

## Plan Format

```yaml
tasks:
  - id: quick-fix
    title: Fix timeout bug
    prompt: Fix the timeout regression in session refresh.
    status: open

  - id: auth-hardening
    title: Harden auth flow
    prompt: |
      Improve auth validation and session handling.
    status:
      implement: done
      security_review: done
      refactor: open
      test: open
      bug_sweep: open
```

Validation rules:

- `tasks` must be an array
- task `id` values must be unique
- scalar task statuses must be `open`, `done`, or `failed`
- step statuses must be `open`, `done`, or `failed`
- if a task references a step by name, that step must exist in resolved step config

Authoring rules:

- each task should be self-contained
- a task prompt should include the context needed to execute that task
- do not rely on implicit dependencies between tasks
- if no step configuration exists, use scalar task statuses such as `status: open`

## Step Configuration

Pipeline ships with no hardcoded steps.

Step definitions are resolved from:

1. `~/.poe-code/pipeline/steps.yaml`
2. `.poe-code/pipeline/steps.yaml`

Project config overrides global config by step name.

```yaml
steps:
  implement:
    instruction: |
      {{id}}: {{title}}
      {{prompt}}
      Follow TDD. Add or update focused tests first, then implement.

  security_review:
    mode: read
    instruction: |
      {{id}}: {{title}}
      Review changed code for auth, injection, secrets, and validation issues.
```

Supported placeholders:

- `{{id}}`
- `{{title}}`
- `{{prompt}}`
- `{{plan_path}}`

If `mode` is omitted, it defaults to `yolo`.

`steps.yaml` is intentionally editable. The scaffolded file is comment-only guidance, so leaving it untouched preserves the default no-step behavior. Uncomment or replace the example steps to opt into stepped execution, then make plans reference those step names exactly.

## Execution Semantics

Pipeline processes tasks sequentially in plan order.

For each run:

1. Resolve the plan path
2. Resolve step definitions
3. Acquire a lock on the plan file
4. Select the next runnable task or step
5. Spawn one agent execution
6. Persist the new status after the agent exits cleanly
7. Continue until a stop condition is hit

Stop conditions:

- all eligible work is complete
- a task or step fails
- cancellation occurs
- `maxRuns` is reached

Blocking behavior:

- a stepless task with `status: failed` blocks later tasks
- a stepped task with any `failed` step blocks later steps and later tasks

## Cancellation

Cancellation is designed to avoid leaving the plan in a dirty intermediate state.

- Pipeline does not write an in-progress status before spawn
- if the active execution is aborted, the child agent process is terminated
- because no intermediate status was persisted, the current task or step remains at its prior value
- the lock is always released

The spawn stack supports abort propagation for:

- CLI non-streaming agent runs
- CLI streaming ACP runs
- the in-process `poe-agent` runtime

## Plan Discovery

When no explicit plan path is provided, resolution is:

1. `~/.poe-code/pipeline/config.yaml` and `.poe-code/pipeline/config.yaml` via `planPath`
2. scan `.poe-code/pipeline/plans/` for `plan*.yaml` and `plan*.yml`
3. if one plan exists, use it
4. if multiple exist, prompt with completion stats
5. if none exist, prompt for a path in interactive mode
6. if none exist and `assumeYes` is true, fail

## Package API

```ts
import { runPipeline } from "@poe-code/pipeline";

const result = await runPipeline({
  agent: "claude-code",
  cwd: process.cwd(),
  homeDir: "/home/test",
  plan: ".poe-code/pipeline/plans/plan-auth.yaml",
  maxRuns: 5,
  runAgent: async ({ agent, prompt, mode, cwd, model, signal }) => {
    // Adapter provided by the caller
    return {
      stdout: "",
      stderr: "",
      exitCode: 0
    };
  }
});
```

Primary exports:

- `runPipeline(options)`
- `resolvePlanPath(options)`
- `parsePlan(yaml, options?)`
- `writeTaskStatus(options)`
- `loadPipelineConfig(options)`
- `loadResolvedSteps(options)`
- `selectNextExecution(plan, taskId?)`
- `buildExecutionPrompt(input)`

## CLI Surface

The package powers this CLI:

```bash
poe-code pipeline install --local
poe-code pipeline install --agent codex --global
poe-code pipeline run
poe-code pipeline run --plan path/to/plan.yaml
poe-code pipeline run --task auth-hardening
poe-code pipeline run --agent codex --model gpt-5.2 --max-runs 3
```

Supported flags:

- `install`: `--agent`, `--local`, `--global`, `--force`
- `--agent <name>`
- `--model <model>`
- `--task <id>`
- `--plan <path>`
- `--max-runs <n>`

## Testing Helper

The package includes an in-memory simulation helper for unit tests.

```ts
import {
  createPipelineSimulation,
  successTurn,
  failTurn
} from "@poe-code/pipeline/testing";

const sim = createPipelineSimulation({
  projectSteps: {
    implement: {
      mode: "edit",
      mode: "yolo",
      instruction: "Implement {{id}}"
    }
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

Simulation utilities:

- create memfs-backed plan and step config files
- capture prompts sent to the agent
- apply fake file changes per turn
- assert final task state through `readPlan()` and `getTask()`
- use `successTurn()` and `failTurn()` helpers for concise tests

## Notes

- Pipeline itself is provider-agnostic
- step definitions are declarative and externalized in YAML
- task progress is derived solely from persisted plan state
- agents do not read or write the plan file directly
