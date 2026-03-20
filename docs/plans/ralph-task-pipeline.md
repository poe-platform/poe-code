# Pipeline: Ralph Replacement

## Summary

Remove Ralph entirely. Replace it with **Pipeline**, a step executor. Each task runs through a sequence of user-defined steps instead of unbounded agent iterations. No extensive prompt templates — just minimal instructions per step.

The command becomes `poe-code pipeline`.

## Motivation

- Iterations are unpredictable — the agent decides when it's "done" via heuristics and overbake detection
- Prompt templates carry too much workflow logic that should live in code
- The current model (stories, iterations, overbake detection, completion signals) is over-engineered for what users actually need
- A fixed step sequence is more legible, resumable, and debuggable than an iteration count

## Target State

### Core Concept: Steps

A **step** is a named execution stage with a fixed purpose. Steps are entirely optional — when no steps are defined, Pipeline runs each task as a single agent execution with just the task prompt.

When steps are defined, each step = one agent execution, run in sequence. No inner loop.

Example steps a user might define:

| Step | Mode | Purpose |
|------|------|---------|
| `implement` | edit | Make the requested code change, narrowly |
| `security_review` | read | Review changed area for auth, injection, secrets, validation |
| `refactor` | edit | Improve structure without changing behavior |
| `test` | edit | Add/fix tests, run them |
| `bug_sweep` | read | Hunt regressions, edge cases, remaining bugs |
| `commit` | edit | Commit changes with a conventional commit message |

### Step Resolution (Project Override + Task Selection)

Step definitions resolve from two config levels. Project config can override or add to global config. Tasks then select which resolved steps to run and in what order. All levels are optional.

```
global (~)  ←  project
                  ↓
             task selection
```

1. **Global** (`~/.poe-code/pipeline/steps.yaml`) — user-wide step definitions. Optional.
2. **Project** (`.poe-code/pipeline/steps.yaml`) — project-specific overrides or additions. Optional.
3. **Task** — a task in the plan file can list specific steps in its `status` map, selecting only those and determining their order.

When no steps are defined in config, the task runs as a single agent execution with the task prompt directly. A task can also opt into stepless mode explicitly by using a scalar task status instead of a step-status map, even when step config exists.

#### Step definition shape

Each step has a `mode` (`edit` or `read`) and an `instruction` (markdown string with `{{id}}`, `{{title}}`, `{{prompt}}`, `{{plan_path}}` placeholders).

```yaml
# ~/.poe-code/pipeline/steps.yaml or .poe-code/pipeline/steps.yaml
steps:
  step_name:
    mode: edit | read
    instruction: |
      Markdown instruction with {{id}}, {{title}}, {{prompt}}, {{plan_path}} placeholders.
```

#### Override and selection semantics

- Steps are resolved by name. A project step with the same name as a global step replaces it entirely.
- Resolved step definitions provide the `mode` and `instruction` for each step.
- A task listing specific step names in its `status` map selects only those steps and determines order.
- A task referencing a step name that does not exist in the resolved config is invalid and must fail validation.

#### Examples

**No steps** — task runs as a single agent execution with just the prompt:
```yaml
tasks:
  - id: auth-hardening
    title: Harden auth flow
    prompt: Improve auth validation and session handling.
    status: open
```

**Global steps** — user defines a step sequence for all projects:
```yaml
# ~/.poe-code/pipeline/steps.yaml
steps:
  implement:
    mode: edit
    instruction: |
      {{id}}: {{title}}
      {{prompt}}
      Follow TDD. Write the test first, then implement.
```

**Project override** — this project adds a custom step:
```yaml
# .poe-code/pipeline/steps.yaml
steps:
  lint:
    mode: edit
    instruction: |
      Run the project linter and fix all issues.
```

**Task step selection** — one task only needs two steps:
```yaml
tasks:
  - id: hotfix-timeout
    title: Fix session timeout regression
    prompt: Fix the timeout regression in session refresh.
    status:
      implement: open
      test: open
```

### Recommended Steps for Repo Owners

Pipeline ships no hardcoded steps. Repo owners define their step sequence in `.poe-code/pipeline/steps.yaml`. Below are recommended steps that can be used as-is or customized.

```yaml
steps:
  implement:
    mode: edit
    instruction: |
      {{id}}: {{title}}
      {{prompt}}
      Follow TDD. Add or update focused tests first, then implement.
      Keep changes narrow. No refactors.

  security_review:
    mode: read
    instruction: |
      {{id}}: {{title}}
      Review changed code for auth, injection, secrets, and validation issues.

  refactor:
    mode: edit
    instruction: |
      {{id}}: {{title}}
      Improve structure without changing behavior. No scope expansion.

  test:
    mode: edit
    instruction: |
      {{id}}: {{title}}
      {{prompt}}
      Run the relevant test suites and fix any failures without expanding scope.

  bug_sweep:
    mode: read
    instruction: |
      {{id}}: {{title}}
      Find regressions, edge cases, and remaining bugs. Fix them.

  commit:
    mode: edit
    instruction: |
      {{id}}: {{title}}
      Commit only the files changed for this task with a conventional commit message.
```

### Plan File

The plan file contains only tasks:

```yaml
tasks:
  # Stepless task — single execution
  - id: quick-fix
    title: Fix timeout bug
    prompt: Fix the timeout regression in session refresh.
    status: open

  # Stepless task — already done
  - id: done-task
    title: Already completed
    prompt: Was already done.
    status: done

  # Task with steps
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

#### `status` field

The `status` field is polymorphic:

- **Scalar task status** — stepless task. The value is `open`, `done`, or `failed`. Pipeline runs `open` tasks once with the task prompt directly.
- **Map of step names → status** — task with steps. Each step is `open`, `done`, or `failed`. Pipeline runs steps in the order they appear in the map. Task is done when all steps are `done`.

Failed statuses are blocking in V1:

- A stepless task with `status: failed` is incomplete and blocks further progress until the user edits the plan state.
- A task with any step marked `failed` is incomplete and blocks further steps in that task and later tasks in the plan until the user edits the plan state.

#### Task fields

- `id` — unique identifier (required)
- `title` — short description (required)
- `prompt` — the task prompt passed to the agent (required)
- `status` — task status string or step status map (required)

### Prompt Assembly

For each step execution, Pipeline interpolates `{{id}}`, `{{title}}`, `{{prompt}}`, and `{{plan_path}}` into the resolved step's `instruction`. That's the entire prompt.

For stepless tasks, the prompt is just the task's `prompt` field directly.

### Status Management

**Code manages all status, not the agent.** The agent is unaware of the pipeline — it receives a prompt, does work, and exits. Pipeline decides what the exit means.

- Exit code 0 → step/task marked `done`
- Exit code != 0 → step/task marked `failed`
- Cancellation (SIGINT/SIGTERM) → status restored to previous value (typically `open`)

The agent never reads or writes the plan file. No completion signals, no status markers in agent output.

### Cancellation

Pipeline must handle cancellation gracefully:

1. Before spawning agent: write no status change. Clean exit.
2. During agent execution: trap SIGINT/SIGTERM. Kill agent process. Restore step/task status to its value before this run (e.g. `open`). Release lock. Exit.
3. After agent exits, before status write: same as (1), no change persisted yet.

The key invariant: **a cancelled run never leaves the plan file in a dirty state.** Status is only written on clean completion or failure, never mid-execution.

Implementation: read the current status before spawning, only write the new status after the agent exits cleanly. Use a signal handler to ensure lock release and no partial writes. Non-zero exit marks the current task or step as `failed`. Cancellation restores the prior state instead.

### Execution Semantics

Tasks are processed sequentially in plan file order.

Each `poe-code pipeline run` invocation processes a single plan file from top to bottom until one of these conditions is met:

- all eligible work is complete
- a stepless task or step fails
- cancellation occurs
- `--max-runs` is reached

For each agent execution:

1. Resolve step definitions (global → project)
2. Load plan file
3. Acquire lock
4. Pick the next incomplete task (first in order)
5. Read current status (for cancellation restore)
6. If the selected stepless task has `status: failed`, stop the run and report the blocking failure
7. If the selected task has a step map and any step is `failed`, stop the run and report the blocking failure
8. If `status` is a map: pick the next `open` step in map order, interpolate task fields into the step instruction, spawn agent
9. If `status` is `open`: spawn agent with the task prompt directly
10. If agent exits 0: update status in the plan file (`done` for steps or stepless tasks)
11. If agent exits non-zero: update status in the plan file (`failed` for the current step or stepless task) and stop the run
12. If cancelled: restore status to pre-run value
13. Release lock
14. Move to the next eligible step or task unless the run has hit a stop condition

### Plan file discovery

When `--plan` is not provided:

1. Check config for `planPath` setting
2. Scan `.poe-code/pipeline/plans/` for `plan*.yaml` files
3. If multiple found: prompt user with interactive select showing completion stats (done/total)
4. If one found: use it
5. If none found + interactive: prompt for path
6. If none found + `--yes`: error

### CLI

```bash
poe-code pipeline run                           # run the selected plan until done, failed, cancelled, or capped
poe-code pipeline run --task auth-hardening     # run specific task
poe-code pipeline run --plan path/to/plan.yaml  # specify plan file
```

**Flags:**
```bash
--agent <name>
--model <model>
--task <id>
--plan <path>
--max-runs <n>           # safety cap on total agent executions
```

### `/plan` skill

The existing `/plan` skill is adapted for Pipeline. It explains the new plan format and validates plan YAML. It does not generate plans via agent — users write plans by hand.

The skill should:
- Describe the plan YAML schema (tasks with id, title, prompt, status)
- Describe step config format and override semantics
- Validate a plan file against the schema
- Show recommended steps for repo owners

## What Gets Removed (all of Ralph)

All Ralph code, config, prompts, and state files are deleted:

- `packages/ralph/` — entire package
- `.agents/poe-code-ralph/` — prompts, plans, references, config
- `.poe-code-ralph/` — state directory (progress.md, guardrails.md, errors.log, activity.log, worktrees, runs/)
- Ralph CLI commands (`ralph build`, `ralph install`, `ralph agent log`, `ralph agent validate-plan`, `ralph worktree`)

The worktrees package is kept as a standalone package — Pipeline may use it later but not in V1.

## What Pipeline Reuses

- YAML parser (already in the project)
- Agent spawning infrastructure
- Lock file implementation
- Git utilities
- `/plan` skill (adapted)

## Implementation Order

### Phase 1: Pipeline package scaffolding

1. Create `packages/pipeline/` with package.json, tsconfig
2. Define TypeScript types: `Step`, `Task`, `Plan`, `StepConfig`
3. Export public API from `packages/pipeline/src/index.ts`

### Phase 2: Step config loader

1. Implement config file discovery: `~/.poe-code/pipeline/steps.yaml` (global), `.poe-code/pipeline/steps.yaml` (project)
2. Implement YAML parsing for step config files
3. Implement project-overrides-global resolution plus task step selection
4. Handle missing config files gracefully (no steps = stepless mode)

### Phase 3: Plan file parser and writer

1. Implement plan YAML parser: validate `tasks` array, each task has `id`, `title`, `prompt`, `status` (task status string or step map)
2. Implement plan YAML writer: update status in place without clobbering other fields
3. Validation: reject duplicate task ids, reject unknown task or step statuses, reject steps not found in config
4. Implement plan file discovery (scan for `plan*.yaml`, interactive select with completion stats)

### Phase 4: Step executor

1. Implement task selector: pick first incomplete task in plan order
2. Implement step selector: pick first `open` step in task's status map (ordered by map order)
3. Implement prompt assembly: interpolate `{{id}}`, `{{title}}`, `{{prompt}}`, `{{plan_path}}` into step instruction
4. Implement stepless execution: when task `status` is `open`, use task prompt directly
5. Implement agent spawn: call existing spawn infrastructure with assembled prompt and step mode
6. Implement status update: mark step or stepless task `done` on exit code 0, `failed` otherwise
7. Implement cancellation handling: trap SIGINT/SIGTERM, kill agent, restore status to pre-run value, release lock
8. Wrap execution in lock acquire/release — status is only written after clean agent exit, never mid-execution

### Phase 5: Simulation test framework

1. Implement `createPipelineSimulation()` following the `createRalphSimulation()` pattern
2. Memfs setup: plan file + global/project step config files + user files
3. Mocked spawn with `vi.fn()`: capture prompts, apply file changes, return turn output
4. Turn helpers: `successTurn()`, `failTurn()`
5. Result helpers: `readPlan()`, `getTask()`, `readFile()`
6. Signal simulation for cancellation tests

### Phase 6: CLI commands

1. `poe-code pipeline run` — main execution command that processes a plan until completion, first failure, cancellation, or `--max-runs`
2. Wire up flags: `--agent`, `--model`, `--task`, `--plan`, `--max-runs`
3. SDK parity: expose the same options programmatically

### Phase 7: Screenshot verification

Verify all CLI output looks correct using `npm run screenshot-poe-code`:

1. `npm run screenshot-poe-code -- pipeline run --help`
2. `npm run screenshot-poe-code -- pipeline run` (with plan discovery prompt)
3. `npm run screenshot-poe-code -- pipeline run --plan plan.yaml` (mid-execution output showing step progress)
4. `npm run screenshot-poe-code -- pipeline run --plan plan.yaml` (all tasks done — "nothing to run" output)
5. `npm run screenshot-poe-code -- pipeline run --plan plan.yaml` (failure output — step marked failed, run stops)

### Phase 8: `/plan` skill adaptation

1. Update skill to describe new plan format
2. Add plan validation command
3. Document recommended steps

## Testing

### Unit tests — step config loader

- **No config files exist** → returns empty steps map
- **Global only** → returns global steps
- **Project only** → returns project steps
- **Global + project** → project overrides global by step name, resolved result contains inherited and added steps
- **Invalid YAML** → throws descriptive error
- **Missing mode** → defaults to `edit`
- **Missing instruction** → throws error

### Unit tests — plan parser

- **Valid plan with scalar task status** → parses stepless tasks correctly
- **Valid plan with step map status** → parses step statuses correctly
- **Mixed plan (scalar + map tasks)** → both parsed correctly
- **`status: done`** → stepless task is done
- **`status: open`** → stepless task is open
- **`status: failed`** → stepless task is failed
- **Duplicate task ids** → throws error
- **Invalid task or step status value** → throws error
- **Empty tasks array** → valid, no tasks to run

### Unit tests — plan writer

- **Update stepless task to done** → `status: open` becomes `status: done`
- **Update stepless task to failed** → `status: open` becomes `status: failed`
- **Update one step status** → only that step changes, rest of file preserved
- **Multiple updates** → each write preserves previous changes
- **Concurrent writes with lock** → no data corruption (use memfs)

### Unit tests — step resolution per task

- **Task with step map + config steps** → task step names select from config, only those run
- **Task with step map referencing unknown step** → throws validation error
- **Task with scalar status + config steps** → stepless mode, config steps ignored
- **Task with scalar status + no config** → stepless mode, single execution

### Unit tests — task selector

- **All stepless tasks done (`status: done`)** → returns null (nothing to run)
- **First task `status: open`** → selects it
- **First task `status: done`, second `status: open`** → selects second
- **First task `status: failed`** → returns blocking failure and stops selection
- **Task with all steps `done`** → treated as done, skipped
- **Task with any step `failed`** → returns blocking failure and stops selection

### Unit tests — step selector

- **All steps done** → task is complete, move to next task
- **First step open** → selects it
- **First step done, second open** → selects second
- **Step failed** → step selection is blocked and the run stops

### Unit tests — prompt assembly

- **Step with all placeholders** → `{{id}}`, `{{title}}`, `{{prompt}}`, `{{plan_path}}` replaced correctly
- **Step with no placeholders** → instruction used as-is
- **Task with multiline prompt** → preserved in interpolation
- **Stepless task** → prompt is task's `prompt` field directly

### Unit tests — plan discovery

- **No plan files exist** → returns null
- **One plan file** → auto-selects it
- **Multiple plan files + `--yes`** → selects first alphabetically
- **Config `planPath` set** → uses that path
- **`--plan` flag** → overrides everything

### Simulation test framework

Following the existing pattern from `packages/ralph/src/testing/simulation.ts`, Pipeline gets its own `createPipelineSimulation()` helper.

```ts
type TurnSpec = {
  assertPrompt?: (prompt: string, ctx: TurnContext) => void | Promise<void>;
  fileChanges?: Record<string, string>;
  output: { stdout: string; stderr?: string; exitCode?: number };
};

type SimulationOptions = {
  plan: { tasks: PartialTask[] };
  globalSteps?: Record<string, StepDefinition>;
  projectSteps?: Record<string, StepDefinition>;
  turns: TurnSpec[];
  files?: Record<string, string>;
  config?: { maxRuns?: number };
};

type SimulationResult = {
  result: PipelineResult;
  prompts: string[];
  fs: SimulationFileSystem;
  readFile: (path: string) => Promise<string>;
  readPlan: () => Promise<Plan>;
  getTask: (taskId: string) => Promise<Task | undefined>;
};

// Helpers
function successTurn(assertPrompt?, fileChanges?): TurnSpec;
function failTurn(stderr, assertPrompt?): TurnSpec;
```

Key differences from Ralph simulation:
- No overbake/completion signal machinery
- `globalSteps` and `projectSteps` instead of prompt templates
- `getTask()` instead of `getStory()`
- No run logs/metadata helpers (removed)
- Turn helpers: `successTurn()` (exit 0) and `failTurn()` (exit 1) — no `incompleteTurn()` since there's no completion signal

The simulation sets up memfs with plan file + step config files, mocks spawn with `vi.fn()`, captures prompts, applies file changes per turn, and returns the final state for assertions.

### Simulation tests — full pipeline execution

#### Simulation: stepless task completes in one run
1. Plan with one task, `status: open`, no steps defined anywhere
2. Mock agent spawn returns exit code 0
3. Assert: task `status` is now `done` in plan file
4. Assert: `pipeline run` again returns "nothing to run"

#### Simulation: task with steps runs through all steps in sequence
1. Plan with one task, project config defines 3 steps (implement, test, commit)
2. Task `status: { implement: open, test: open, commit: open }`
3. Run pipeline once, mock agent returns exit code 0 for each spawned step execution
4. Assert after the run: each step is marked `done` in order
5. Assert: task is complete
6. Assert: spawned agent received correct interpolated prompt for each step
7. Assert: spawned agent received correct mode for each step

#### Simulation: step failure marks step as failed
1. Plan with one task, 3 steps
2. Mock agent returns exit code 0 for the first step execution and exit code 1 for the second
3. Assert: first step is marked `done`
4. Assert: second step is marked `failed`
5. Assert: run stops immediately and later steps are not executed

#### Simulation: task-level step override restricts steps
1. Project config defines 5 steps
2. Plan has one task with `status: { implement: open, test: open }`
3. Run pipeline once (both step executions succeed)
4. Assert: only implement and test were executed, task is done
5. Assert: agent was never called with security_review/refactor/bug_sweep instructions

#### Simulation: project override precedence
1. Global config defines `implement` with instruction A
2. Project config defines `implement` with instruction B
3. Plan has one task with `status: { implement: open }`
4. Assert: agent receives instruction B (project wins)

#### Simulation: multiple tasks processed in order
1. Plan with 3 tasks, all `status: open` (stepless)
2. Run pipeline once
3. Assert: tasks processed in plan file order (first, second, third)

#### Simulation: max-runs cap stops execution
1. Plan with 5 stepless tasks
2. Run pipeline with `--max-runs 2`
3. Assert: only 2 tasks executed, remaining 3 still `status: open`

#### Simulation: lock prevents concurrent modification
1. Start two pipeline runs concurrently (same plan file)
2. Assert: second run waits for lock, no data corruption
3. Assert: both runs complete, statuses correctly updated

#### Simulation: cancellation restores stepless task status
1. Plan with one stepless task, `status: open`
2. Mock agent spawn, send SIGINT during execution
3. Assert: task `status` is still `open` in plan file
4. Assert: lock is released

#### Simulation: cancellation restores step status
1. Plan with one task, 3 steps, first step `done`, second `open`
2. Run pipeline (picks second step), send SIGINT during execution
3. Assert: second step is still `open` in plan file
4. Assert: first step is still `done` (untouched)
5. Assert: lock is released

#### Simulation: cancellation before agent spawn leaves plan unchanged
1. Plan with one task, `status: open`
2. Send SIGINT before agent is spawned (e.g. during lock acquisition)
3. Assert: plan file unchanged
4. Assert: lock is released (or was never acquired)

#### Simulation: mixed plan with scalar and step tasks
1. Plan with 3 tasks: first stepless (`open`), second with steps, third stepless (`open`)
2. Run pipeline once with enough successful turns to complete the plan
3. Assert: tasks are picked in order based on status and step order
4. Assert: first task becomes `done`, then the stepped task completes, then the third task runs

#### Simulation: failed stepless task blocks later tasks
1. Plan with 3 stepless tasks, all `status: open`
2. First task exits non-zero
3. Assert: first task is marked `failed`
4. Assert: second and third tasks are not executed in that run
