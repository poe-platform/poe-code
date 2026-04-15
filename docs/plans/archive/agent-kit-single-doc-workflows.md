# Agent Kit for Single-Document Autonomous Workflows

## Problem

`pipeline`, `ralph`, and `experiment-loop` all solve adjacent workflow problems, but each package currently reimplements core execution concerns:

- agent normalization and agent prompting rules
- autonomous spawn timeout / retry behavior
- path and document discovery
- abort handling
- setup-like and teardown-like execution
- stateful workflow execution over a file
- ad hoc locking or no locking

This duplication keeps recreating the same bugs when a new workflow is added:

- aliases are not normalized consistently
- one workflow prompts for an agent while another silently defaults
- retry behavior drifts across workflows
- document discovery rules diverge
- multi-run workflows can be started concurrently without a shared lock model

We need a shared foundation for autonomous workflows while keeping each package small and specialized.

## Goals

1. Add a shared `spawn.autonomous()` entry point for autonomous agent runs.
2. Introduce an `agent-kit` package for reusable autonomous workflow runtime pieces.
3. Make it easy to build new workflows from a single markdown document with frontmatter.
4. Support multiple named participants with declarative capabilities.
5. Support shared setup and teardown across all autonomous workflows.
6. Add lock files across autonomous workflows.
7. Remove pipeline-specific blocked/retry state semantics from workflow persistence.
8. Keep `pipeline`, `ralph`, and `experiment-loop` as thin workflow packages instead of moving all logic into core.

## Non-goals

- Do not create one giant engine that erases the differences between pipeline, ralph, and experiment-loop.
- Do not move interactive CLI prompting into runtime packages.
- Do not push autonomous retry policy into the lowest-level spawn primitive.
- Do not encode workflow behavior with hardcoded branching by workflow name or participant name.

## Design principles

### Keep low-level spawn primitive simple

Low-level spawn should remain a single-attempt primitive. Autonomous policy belongs in a higher-level wrapper.

### Keep CLI concerns separate from runtime concerns

CLI should own interaction flow, using prompt primitives from the design system:

- `select()` prompts
- `promptText()` prompts
- formatting and summaries
- cancellation messaging

Runtime packages should own:

- normalized config
- path resolution
- locking
- setup / teardown execution
- loop orchestration
- autonomous execution defaults

### Prefer declarative workflow config

A workflow document should describe:

- participants
- capabilities
- execution stages
- limits
- setup / teardown
- status

The runtime should interpret configuration rather than branch on workflow names.

## Proposed architecture

### 1. `spawn.autonomous()`

Add a high-level SDK entry point that wraps current spawn behavior for autonomous workflows.

Responsibilities:

- activity timeout defaults
- timeout retry policy
- ACP event rendering
- shared autonomous defaults
- reusable `runAgent` adapter for workflow packages

Suggested shape:

```ts
spawn.autonomous(service, {
  prompt,
  cwd,
  model,
  mode,
  signal,
  mcpServers,
  logDir
});
```

Or as an adapter factory:

```ts
const runAgent = createAutonomousRunAgent();
```

The important part is centralizing the policy now duplicated in:

- `src/sdk/pipeline.ts`
- `src/sdk/ralph.ts`
- `src/sdk/experiment.ts`

### 2. `@poe-code/agent-kit`

Add a new package for reusable autonomous workflow runtime components.

Initial scope:

- agent resolution via shared helpers from `@poe-code/agent-defs`
- absolute path resolution
- document/discovery helpers
- workflow lock files
- setup/teardown execution
- participant selection helpers built on normalized agent definitions
- stage execution helpers
- common abort helpers
- shared document workflow types

This package should be runtime-oriented, not CLI-oriented.

### 3. Thin workflow packages on top

- `@poe-code/ralph` becomes a thin preset built on `agent-kit`
- `@poe-code/experiment-loop` becomes a thin preset built on `agent-kit`
- `@poe-code/pipeline` reuses shared pieces where they fit, while keeping task/step logic local

## Package boundaries

### `@poe-code/agent-kit`

Owns:

- workflow runtime helpers
- participant and stage config parsing helpers
- lock helpers
- shared execution helpers
- document workflow orchestration

Does not own:

- CLI prompts
- design-system rendering
- canonical agent normalization rules
- task-specific persistence details for pipeline
- experiment journal / git logic

### `@poe-code/agent-defs`

Owns:

- canonical agent normalization rules
- alias -> canonical id resolution
- `agent:model` parsing and formatting
- shared agent list normalization helpers

Does not own:

- workflow semantics
- spawn capability checks

### `@poe-code/agent-spawn`

Owns:

- low-level spawn primitives
- ACP streaming and adapters
- argument building
- spawn capability checks and spawn config lookup

Does not own:

- canonical agent normalization rules
- autonomous retry policy
- workflow semantics

### `src/sdk/*`

Owns:

- public SDK wrappers
- `spawn.autonomous()`
- wiring workflow packages to SDK spawn behavior

## Shared concepts

### Participant

A participant is a named execution identity in a workflow.

Suggested shape:

```ts
interface WorkflowParticipant {
  id: string;
  agent: string | string[];
  mode?: "read" | "edit" | "yolo";
  model?: string;
  prompt?: string;
}
```

Notes:

- `id` is a workflow-local identifier.
- `agent` may be a single agent or a round-robin list.
- `mode` is capability-oriented and should drive write permissions.
- participant names must not carry hardcoded behavior in runtime code.

### Stage

A stage is a declarative execution unit.

Suggested shape:

```ts
interface WorkflowStage {
  id: string;
  participant: string;
  prompt?: string;
  mode?: "read" | "edit" | "yolo";
  onFailure?: "stop" | "continue";
}
```

This lets workflows compose sequences without branching on workflow type.

### Setup / teardown

All autonomous workflows should support shared setup and teardown.

Suggested shape:

```ts
interface WorkflowHook {
  participant?: string;
  mode?: "read" | "edit" | "yolo";
  prompt: string;
}
```

Rules:

- `setup` runs before the main workflow loop.
- `teardown` runs after the main workflow loop when appropriate.
- hook failure stops the workflow unless explicitly configured otherwise.

### Lock file

All autonomous workflows should use a shared lock model.

Suggested behavior:

- lock path is derived from the workflow document path
- lock is acquired before mutable execution starts
- lock is released in `finally`
- lock prevents concurrent runs of the same workflow document

This should be shared across document workflows and pipeline plans.

## Single-document workflow model

The target should support a single markdown file with frontmatter as the main source of truth.

### Frontmatter is machine config

Frontmatter should contain:

- participants
- stages
- limits
- setup / teardown
- status
- optional extends/base configuration

### Body is human context

Markdown body should contain:

- task description
- constraints
- acceptance criteria
- notes and checklists
- reusable prompt sections

This split makes the file both ergonomic for humans and stable for runtime parsing.

`$schema`, `kind`, and `version` should be treated as lightweight hints for editors, agents, and tooling.

## Schema strategy

Schemas should be generated from code automatically.

### Goals for schemas

- help editors with autocomplete and validation
- give agents a strong hint about document shape
- stay intentionally loose and forward-compatible
- avoid drift between runtime parsing and published schemas

### Source of truth

The source of truth should be code-level runtime schema definitions, not handwritten JSON Schema files and not plain TypeScript interfaces by themselves.

Recommended approach:

- define runtime schemas in code for each document type
- keep those schemas permissive
- generate JSON Schema artifacts from those runtime schemas
- publish generated schema files to GitHub Pages

This gives us one place to maintain:

- field names
- descriptions
- examples
- defaults where helpful
- document kind / version hints

### Suggested ownership

Each package should own its own code-first schema definitions:

- `@poe-code/ralph` -> Ralph document schema
- `@poe-code/experiment-loop` -> Experiment document schema
- `@poe-code/pipeline` -> pipeline plan schema and pipeline steps schema
- `@poe-code/agent-kit` -> shared schema fragments and helpers where useful

### Recommended implementation shape

A good fit is a code-first schema library that can:

- validate at runtime
- emit JSON Schema
- attach descriptions/examples
- remain permissive

For example, we can define workflow schemas in code and generate JSON Schema during codegen/build.

Important rule: these schemas should be advisory, not overly strict. In practice that means:

- few required fields beyond discriminators like `kind` and maybe `version`
- allow unknown fields in many objects
- prefer descriptive metadata over rigid constraints
- let runtime normalization stay more flexible than the published schema

### Published schema layout

Keep generated schema artifacts in-repo and publish them to GitHub Pages.

Suggested layout:

```txt
docs/schemas/
  ralph.schema.json
  experiment.schema.json
  pipeline-plan.schema.json
  pipeline-steps.schema.json
  shared/
    participant.schema.json
    hook.schema.json
    stage.schema.json
```

Documents can then reference published URLs:

```yaml
$schema: https://<org>.github.io/<repo>/schemas/ralph.schema.json
kind: ralph
version: 1
```

### Generation workflow

Suggested workflow:

1. define/update code-first runtime schema
2. run codegen script
3. emit JSON Schema files into `docs/schemas/`
4. publish those files via GitHub Pages
5. optionally verify in CI that generated schemas are up to date

This keeps schemas useful as hints without making them the only parser contract.

## Proposed generic frontmatter shape

This is intentionally generic enough to support multiple single-document workflows.

```yaml
---
extends: false
participants:
  builder:
    agent: claude-code
    mode: yolo
  reviewer:
    agent:
      - codex
      - kimi
    mode: read
setup:
  participant: builder
  mode: yolo
  prompt: Prepare the workspace before the workflow starts.
teardown:
  participant: reviewer
  mode: read
  prompt: Summarize the final state and list any open risks.
run:
  max_iterations: 3
  stages:
    - id: build
      participant: builder
      prompt: |
        Work on the task described in the markdown body.
      onFailure: stop
    - id: review
      participant: reviewer
      mode: read
      prompt: |
        Review the current changes and report issues.
      onFailure: stop
status:
  state: open
  iteration: 0
  last_stage: null
---
# Workflow brief

Human-readable instructions go here.
```

This schema is not final, but it captures the key shape we want to support.

## Minimal `agent-kit` API

### Path and document helpers

```ts
resolveWorkflowPath(path, cwd, homeDir)
discoverWorkflowDocs({ cwd, homeDir, planDirectory, fs })
readWorkflowDocument({ docPath, cwd, homeDir, fs })
```

### Participant normalization (built on `@poe-code/agent-defs`)

```ts
normalizeParticipantConfig(value)
selectParticipantAgent(participant, iteration)
```

Responsibilities:

- consume canonical agent helpers from `@poe-code/agent-defs`
- support workflow-level participant config shapes
- support round-robin selection
- reject empty arrays and empty strings consistently

### Lock helpers

```ts
lockWorkflow(docPath, { fs })
```

### Setup / teardown helpers

```ts
runWorkflowHook(hook, context)
```

### Stage helpers

```ts
runWorkflowStage(stage, context)
```

### Shared document workflow runner

Potential shape:

```ts
runDocumentWorkflow({
  cwd,
  homeDir,
  docPath,
  fs,
  runAgent,
  readConfig,
  executeIteration,
  setup,
  teardown,
  signal
})
```

The runner should provide shared orchestration, while each workflow package provides its own domain-specific state transitions.

For sequential multi-document execution (as now implemented in pipeline), the runner should also support:

```ts
runDocumentWorkflowSequence({
  docPaths: string[];
  // ...same options as single runner
  onSequenceProgress?: (index: number, total: number, docPath: string) => void;
  stopOnFailure?: boolean; // default true
})
```

Pipeline's sequential loop (iterate `docPaths`, stop on failure/cancellation/max_runs, continue on nothing_to_run) is the reference implementation for this pattern.

## Agent resolution strategy

Today agent resolution is duplicated in several CLI and runtime files. Canonical normalization should move into shared helpers in `@poe-code/agent-defs`, while spawn-specific capability checks should remain in `@poe-code/agent-spawn`.

Rules:

1. Accept aliases like `claude` and normalize to canonical ids in `@poe-code/agent-defs`.
2. Preserve inline model syntax like `claude-code:anthropic/claude-opus-4.6`.
3. Support arrays for round-robin workflows.
4. Support comma-separated CLI input only in CLI helpers, then convert to normalized runtime input.
5. Keep spawn capability checks in `@poe-code/agent-spawn`, not in workflow packages.
6. Reject invalid empty values consistently.

Important split:

- `@poe-code/agent-defs` gets canonical agent normalization helpers
- `@poe-code/agent-spawn` gets spawn capability helpers
- runtime packages consume those helpers
- CLI gets `promptForAgent()` and `resolveAgentSelection()` wrappers built on top

## CLI extraction

We should extract shared CLI helpers for autonomous workflows.

Suggested shared helpers:

```ts
resolveConfiguredPlanDirectory(scope, container)
resolveAbsoluteUserPath(path, cwd, homeDir)
promptForAgent({ message, assumeYes, defaultAgent })
resolveAgentSelection({ provided, configured, prompt })
formatDuration(ms)
```

Pipeline already extracts `resolvePlanPaths()` into `@poe-code/pipeline` with multiselect support via a `selectPlans` callback. This pattern (runtime resolution returning `string[]`, CLI providing the prompt callback) should be the template for ralph and experiment discovery helpers.

This should remove duplicated logic from:

- `src/cli/commands/pipeline.ts`
- `src/cli/commands/ralph.ts`
- `src/cli/commands/experiment.ts`

## Pipeline changes

Pipeline should reuse shared helpers, but keep its own task/step model.

### Keep

- task list
- step definitions
- task status persistence
- setup/teardown semantics
- plan validation

### Remove

- blocked semantics as persisted workflow state
- retry-via-status-reset behavior

New pipeline failure model:

- a step run fails
- the pipeline stops
- user reruns explicitly
- autonomous retry is limited to spawn-level transient failures, not workflow-level blocked state

This simplifies state and aligns pipeline with other workflows.

### Sequential multi-plan execution (implemented)

Pipeline now supports running multiple plans sequentially in a single invocation.

CLI interface:

- `--plans <paths...>` accepts multiple plan file paths to run in order
- `--plan` and `--plans` are mutually exclusive
- interactive mode uses `multiselect()` for plan discovery, allowing users to pick multiple plans

Runtime behavior:

- `resolvePlanPaths()` in `@poe-code/pipeline` returns `string[]` instead of a single path
- plans execute sequentially in the order provided or selected
- failure or cancellation on any plan stops the sequence immediately
- `nothing_to_run` continues to the next plan in the sequence
- `max_runs` stops the entire sequence
- each plan gets its own `onPlanResolved` / `onTaskStart` / `onTaskComplete` callbacks
- sequence progress is shown in logs (`Plan 1/3: ...`, `Sequence: 1/3` in config output)

This is relevant for `agent-kit` because sequential multi-document execution is now a proven pattern in pipeline. The shared document workflow runner should support a similar sequential execution model rather than only single-document runs.

## Ralph changes

Ralph should become a thin single-document loop on top of `agent-kit`.

Ralph-specific logic should mainly be:

- frontmatter shape for simple iteration workflows
- iteration status persistence
- archive-on-completion behavior

Everything else should move to shared helpers where possible.

## Experiment loop changes

Experiment loop should become a thin single-document loop on top of `agent-kit` plus its own experiment-specific logic.

Experiment-specific logic should remain local:

- metric evaluation
- journal management
- git reset / keep / discard behavior
- baseline derivation

But it should stop owning its own versions of:

- path resolution
- ad hoc agent resolution logic
- lock model
- setup/teardown readiness

## Document discovery

Experiment doc discovery should move out of CLI-local code and into package/shared helpers, matching the pattern already used by pipeline and ralph.

Pipeline discovery now supports multiselect via `resolvePlanPaths()` with a `selectPlans` callback, which is the pattern other workflows should follow for multi-document selection.

Important UX rule: when a workflow is interactive and `--yes` is not set, we should still prompt for doc selection even if discovery finds exactly one document. Auto-selecting the only doc has been a recurring source of inconsistent behavior and should be treated as a bug. The only time silent auto-selection is acceptable is under `--yes` or a fully non-interactive code path.

That gives us one predictable story for:

- project dir
- home dir
- configured custom dir
- selection order
- assume-yes behavior

## Persistence model

### Config vs runtime state

We should keep config and runtime state conceptually separate.

For simple workflows, frontmatter status is acceptable.
For more complex workflows, adjacent state files may be cleaner than ever-growing frontmatter.

Recommended rule:

- config lives in frontmatter
- lightweight progress can live in frontmatter
- heavier runtime state should move to adjacent machine files when complexity grows

This keeps the single markdown file ergonomic without forcing all state into it forever.

## Migration plan

### Phase 1 — autonomous spawn extraction

- add `spawn.autonomous()`
- update pipeline, ralph, and experiment SDK wrappers to use it
- remove duplicated retry loops from SDK files

### Phase 2 — shared normalization and path helpers

- add runtime normalization helpers in `agent-kit`
- add shared CLI selection helpers
- migrate ralph and experiment first
- move experiment discovery out of CLI-local code

### Phase 3 — locking and setup/teardown

- add shared workflow lock helper
- add shared setup/teardown execution helper
- adopt in ralph and experiment
- migrate pipeline to shared lock / hook helpers where sensible

### Phase 4 — pipeline simplification

- remove blocked semantics
- stop resetting failed task state through interactive retry flow
- rely on explicit rerun instead

### Phase 5 — document workflow foundation

- add generic participant and stage types to `agent-kit`
- extract a reusable document workflow runner
- extract a sequential multi-document runner based on pipeline's `resolvePlanPaths` + sequential loop pattern
- migrate ralph to it first
- migrate experiment-loop to it second

## Risks

### Over-abstraction

Risk: trying to unify pipeline, ralph, and experiment-loop too aggressively.

Mitigation:

- only extract truly shared concerns
- keep task/step logic in pipeline
- keep experiment git/journal logic local

### Frontmatter bloat

Risk: putting too much runtime state into frontmatter.

Mitigation:

- treat frontmatter as config-first
- allow adjacent state files for heavier runtime state

### Mixed CLI/runtime concerns

Risk: putting prompt logic into runtime packages.

Mitigation:

- keep prompts in CLI shared helpers only
- keep runtime helpers pure and reusable

## Open questions

1. Should `spawn.autonomous()` be a direct SDK API, a builder variant, or a factory for `runAgent` adapters?
2. Should lock files live next to docs/plans or under a shared `.poe-code/locks/` directory?
3. For complex document workflows, when should we move from frontmatter status to adjacent state files?
4. Should setup/teardown support stage lists from day one, or only a single hook each initially?
5. Should participant prompt templates live only in frontmatter, or also support named markdown sections later?

## Recommendation

Proceed with:

1. `spawn.autonomous()`
2. `@poe-code/agent-kit`
3. shared agent normalization
4. shared lock + setup/teardown helpers
5. pipeline blocked-state removal
6. generic single-document workflow support

This keeps the architecture simple, removes current duplication, and makes future single-document autonomous workflows much easier to build.
