# Superintendent

## Summary

This is a single tightly-coupled feature:

- superintendent markdown document format
- runtime loop
- cmdkit CLI
- MCP surface

So this plan combines both the document design and the CLI/MCP design.

The agreed agents are:

- `builder`
- `inspectors`
- `superintendent`
- `owner`

The high-level flow is:

`builder -> inspectors -> superintendent -> owner -> repeat/finish`

## Where tasks are stored

Tasks live in the **markdown body** of the superintendent document, under `## Task Board`.

They are **not** stored in a separate YAML block or a separate task file.

Example:

```markdown
## Task Board

- [ ] Build the first end-to-end superintendent loop
- [ ] Add inspector execution before superintendent review
- [ ] Pass builder and inspector outputs into the superintendent prompt
- [ ] Let the superintendent create follow-up tasks from inspector feedback
```

That means:

- the body is the source of truth for tasks
- agents edit the markdown body directly
- the runtime only needs to read it consistently

## Task Board contract

For v1, keep the task board simple:

- tasks live under `## Task Board`
- use normal markdown checkboxes
- `[ ]` means still open
- `[x]` means done
- no hidden task IDs

Recommended task format:

```markdown
- [ ] Add inspector execution
- [x] Validate the Task Board shape
```

Priority is **top-to-bottom**: the first unchecked item is the highest priority.

The owner should read the actual task list and decide whether the work is done.
We do not need machine-stable task identifiers for v1.

## Goals

1. single markdown doc with frontmatter
2. one builder
3. inspectors as one-off evaluators
4. superintendent consumes the plan plus summary handoffs
5. owner decides whether completion is accepted
6. rich CLI via cmdkit
7. same operations exposed through MCP
8. keep package boundaries clean

## Proposed v1 document shape

```yaml
---
kind: superintendent
version: 1
mcp:
  delegate:
    command: poe-superintendent-mcp
  plan_browser:
    command: poe-code
    args: [plan, list, --source, ralph]

builder:
  agent: claude-code
  mode: yolo
  prompt: |
    Work on the highest-priority open task from {{plan.path}}.
    Read the plan file directly and make concrete progress.
    Leave a concise summary and build log.

inspectors:
  code-quality:
    agent: codex
    mode: read
    prompt: |
      Inspect the current state for correctness, code quality, architecture,
      and missed edge cases.
      Read {{plan.path}} directly as the source of truth.

  manual-qa:
    agent: claude-code
    mode: read
    prompt: |
      Run the manual verification steps described in {{plan.path}}.
      Read the plan file directly and leave a concise summary.

  developer-experience:
    agent: claude-code
    mode: read
    prompt: |
      Review the current developer experience for agents working from {{plan.path}}.
      Use the builder build log below to identify friction in tooling, validation,
      setup, docs, or workflow ergonomics. Suggest concrete improvements that
      would help the agent operate more effectively.

      Build log:
      {{builder.log}}

superintendent:
  agent: claude-code
  mode: read
  tools:
    mcp:
      - delegate
      - plan_browser
  prompt: |
    You are the superintendent.

    Plan: {{plan.path}}

    Builder summary:
    {{builder.summary}}

    Builder log:
    {{builder.log}}

    Inspector summaries:

    ## Code quality
    {{inspectors.code-quality}}

    ## Manual QA
    {{inspectors.manual-qa}}

    ## Developer experience
    {{inspectors.developer-experience}}

    Update the markdown Task Board directly.
    If more work is needed, add or reopen tasks.
    If the task board is complete, produce a completion summary for the owner
    and call the workflow MCP tool to request review.

owner:
  agent: claude-code
  mode: read
  prompt: |
    You are the owner.

    Plan: {{plan.path}}

    Superintendent summary:
    {{superintendent.summary}}

    Decide whether the work is done.

    - If done, call the workflow MCP tool to approve completion.
    - If not done, call the workflow MCP tool to send the plan back to in_progress
      with feedback for the superintendent.

max_rounds: 100

status:
  state: in_progress
  round: 0
  review_turn: 0
---
```

## Built-in workflow tool

The workflow transition MCP should be **automatically baked in by the runtime**.

So:

- it should **not** be configured in frontmatter
- it should **not** need to be explicitly listed in `tools`
- the runtime injects it automatically for the roles that need it

For v1, that means:

- `superintendent` gets workflow transitions relevant to its current state
- `owner` gets workflow transitions relevant to its current state

## Runtime prompt variables

Use Mustache semantics.

Runtime variables should be scoped like this:

```yaml
plan:
  path: <path to the superintendent markdown doc>

builder:
  summary: <short builder outcome>
  log: <builder build log / execution log>

inspectors:
  code-quality: <summary from inspector code-quality>
  manual-qa: <summary from inspector manual-qa>
  developer-experience: <summary from inspector developer-experience>

superintendent:
  summary: <completion summary or review reply>

owner:
  feedback: <owner decline feedback>
```

Recommended name is `plan.path`. Agents should read the file directly rather than receive duplicated body content as a variable.

So prompts can use:

```mustache
{{plan.path}}
{{builder.summary}}
{{builder.log}}
{{inspectors.code-quality}}
{{inspectors.developer-experience}}
{{superintendent.summary}}
{{owner.feedback}}
```

## Communication model

Summaries alone are **not** enough.

Use both:

- `plan.path` as the canonical shared artifact handle
- summaries as handoff/compression between agents

So decisions should always be grounded in the actual plan file, not only summaries.

## Fixed runtime state machine

Keep the state machine fixed in runtime.
Do **not** make it configurable in frontmatter.

States:

- `in_progress`
- `review`
- `completed`

## Runtime-managed status

The `status` block is **runtime-managed state**.

Agents should not be responsible for manually editing low-level workflow state fields.
Their job is to:

- read `{{plan.path}}`
- update the markdown body
- update the Task Board
- produce summaries / feedback

The runtime is responsible for updating:

```yaml
status:
  state: in_progress | review | completed
  round: 0
  review_turn: 0
```

Specifically:

- increment `round` when a new main-loop pass starts
- set `state: review` when the superintendent requests owner review
- increment `review_turn` during bounded superintendent/owner review exchanges
- set `state: completed` when the owner calls the workflow MCP tool to approve completion, or when the operator runs `superintendent complete`

So tasks do **not** encode how workflow state changes.
Workflow state changes happen behind the scenes in the runtime.

### `in_progress`

Runtime order:

1. builder
2. inspectors
3. superintendent

The superintendent edits the Task Board directly.

When the superintendent believes the work is done, it requests review from the owner.
Otherwise it keeps planning more work in `in_progress`.

### `review`

In review, only:

- `superintendent`
- `owner`

The superintendent suggests completion.
The owner either:

- approves via MCP transition -> `completed`
- sends back to `in_progress` via MCP transition with feedback -> superintendent replans tasks and continues

Allow bounded back-and-forth between superintendent and owner, but keep it fixed in runtime:

- review is capped at **5 turns**
- this cap is runtime behavior, not frontmatter config
- if the cap is reached without owner approval, the **superintendent loses the review**: the runtime automatically transitions back to `in_progress` and the superintendent must continue working
- if sent back (by owner or by cap), the superintendent updates the Task Board and the loop continues

### `completed`

The loop is done.

## Review exchange and approval signal

The runtime should **not** guess approval from prose like "looks good" or from the task list alone.

Approval should be explicit.

Use a dedicated runtime MCP tool for workflow transitions.
This tool is injected automatically by the runtime.

Example tool:

```text
workflow.transition
```

The tool should expose only valid transitions for the current role and state.

Recommended transitions:

- superintendent in `in_progress`
  - `request_review`
- owner in `review`
  - `approve_completion`
  - `request_changes`

Review exchange:

1. superintendent decides the work may be done
2. superintendent calls `workflow.transition` with `request_review`
3. runtime sets `status.state: review`
4. runtime invokes the owner with:
   - `{{plan.path}}`
   - `{{superintendent.summary}}`
5. owner decides:
   - call `approve_completion` -> runtime sets `status.state: completed`
   - call `request_changes` with feedback -> runtime stores that feedback as `{{owner.feedback}}` and sets `status.state: in_progress`
6. if sent back, runtime invokes the superintendent again with `{{owner.feedback}}`
7. superintendent updates the Task Board in `{{plan.path}}` and produces a new summary

So the runtime knows approval because the owner explicitly calls the workflow MCP transition:

- `workflow.transition(approve_completion)`

Not because of a structured text return.

## Loop completion

Autonomous completion should stay simple and **not be configurable**.

The loop finishes only when:

- the workflow reaches `completed`
- or the `max_rounds` safeguard is reached (default 100, configurable in frontmatter)

So:

- `stop_when` should not exist in frontmatter
- review turn limits should not exist in frontmatter
- `max_rounds` **is** configurable in frontmatter for cost/safety control
- the owner checks the actual task list and decides whether the work is done

There should still be a manual operator fallback:

```bash
poe-code superintendent complete <doc>
```

That command is for forced/manual completion from CLI or MCP.

## Recommended output contracts

For v1, keep outputs simple.

### Builder output

- summary
- build log

### Inspector output

- summary only
- inspectors run **sequentially**, not in parallel

### Superintendent output

- updated markdown body
- summary for the owner when entering review
- reply summary during review when the owner asks for clarification

### Owner output

The owner should not need a structured text return.

Instead, the owner uses the workflow MCP tool to:

- approve completion
- or send the loop back to `in_progress` with feedback

If the owner sends it back, the superintendent uses that feedback to update the Task Board and continue the loop.
The owner is responsible for checking whether the task list is actually done.

## Validation

`superintendent validate <doc>` should validate both:

1. frontmatter/runtime config
2. Task Board presence and basic shape

Minimum checks:

- markdown + frontmatter parse correctly
- required roles exist: builder, superintendent, owner
- inspectors parse as a dictionary
- `## Task Board` exists
- the task board uses recognizable markdown checkbox items
- prompt variables are known/allowed

## CLI + MCP design

Build this as a **cmdkit-first** package.

Recommended package:

`packages/superintendent`

Recommended structure:

```text
packages/superintendent/
  src/
    commands/
      index.ts
      superintendent-group.ts
      builder-group.ts
      inspector-group.ts
    runtime/
      run-builder.ts
      run-inspector.ts
      run-superintendent.ts
      run-owner-review.ts
    document/
      parse.ts
      write.ts   # writes runtime-managed status block only; agents edit the markdown body directly
      tasks.ts
    state/
    cli.ts
    mcp.ts
    index.ts
  README.md
```

Use one cmdkit command tree and expose it via:

- `@poe-code/cmdkit/cli`
- `@poe-code/cmdkit/mcp`
- SDK helpers where useful

## Recommended command tree

```text
superintendent
  run
  validate
  complete
  builder
    run
  inspector
    run
    list
```

## Command intent

### `superintendent run`

Run the full loop until stopped.

### `superintendent validate`

Validate frontmatter, prompt-variable usage, state-machine assumptions, and Task Board presence/basic shape.

### `superintendent complete`

Manual operator fallback to finish the loop.

Behavior:

- set `status.state: completed`
- optionally record a reason
- do not silently rewrite all remaining tasks

### `superintendent builder run`

Run the configured builder directly.

### `superintendent inspector list`

List configured inspectors.

### `superintendent inspector run`

Run one inspector or all inspectors.

Inspector outputs are **ephemeral** in v1:

- they are passed to the superintendent immediately
- returned in command results
- not persisted as a separate report system
- inspector outputs are **only visible to the superintendent**, not the owner — the owner relies on the superintendent's summary

### Task Board editing

For v1, do **not** add a dedicated task CRUD CLI/MCP surface.

Agents and operators should edit the markdown Task Board directly.
The runtime only needs to parse and validate it reliably.

## Cmdkit scope

Default most commands to:

```ts
scope: ["cli", "mcp", "sdk"]
```

## Rich CLI behavior

Use cmdkit rich renderers and design-system output.

Support:

- validation output
- warning / completion notes
- `--output json`
- `--output markdown`

Interactive prompting is fine when args are missing, but all configuration must also work via args.

Respect repo convention:

- defaults are only auto-accepted under `--yes`

## Dashboard UI for `superintendent run`

`superintendent run` uses the `createDashboard` design element for a live terminal UI during the loop.

### Layout mapping

**Left pane — "Superintendent":**

Agent lifecycle events as timestamped output items:

| Event                              | Kind      |
| ---------------------------------- | --------- |
| Builder starting                   | `status`  |
| Builder tool calls / streaming     | `tool`    |
| Builder completed                  | `success` |
| Builder failed                     | `error`   |
| Inspector `<name>` starting        | `status`  |
| Inspector `<name>` completed       | `info`    |
| Inspector `<name>` failed          | `error`   |
| Superintendent reviewing           | `status`  |
| Superintendent requesting review   | `info`    |
| Owner reviewing                    | `status`  |
| Owner approved                     | `success` |
| Owner requesting changes           | `info`    |
| Round completed                    | `success` |
| Loop completed                     | `success` |

**Right pane — "Loop":**

| Stat           | Source                                                       |
| -------------- | ------------------------------------------------------------ |
| Status         | State machine: `in_progress` → Running, `review` → Review, `completed` → Done |
| Round          | `status.round`                                               |
| Review Turn    | `status.review_turn` (only shown during `review` state)      |
| Elapsed        | Wall clock since loop start                                  |
| Tokens In      | Aggregate across all agent invocations                       |
| Tokens Out     | Aggregate across all agent invocations                       |
| Total          | Sum                                                          |
| Current Action | Which agent is running, e.g. "builder", "inspector: code-quality" |

### Keyboard commands

| Key       | Command  | Behavior                                              |
| --------- | -------- | ----------------------------------------------------- |
| `q`       | quit     | Graceful stop after current agent finishes             |
| `p`       | pause    | Pause after current agent finishes, resume with `p`    |
| `e`       | edit     | Open the plan file in `$EDITOR`                        |
| `Ctrl+C`  | quit     | Same as `q`                                            |
| `↑/↓`    | scroll   | Scroll output pane                                     |

### Pre-dashboard flow

Before the dashboard starts, `superintendent run` presents two interactive prompts:

1. **Plan selection** — pick which superintendent document to run
2. **Agent selection** — pick or confirm the builder agent

These use the standard design-system interactive prompts (not the dashboard).
Once selections are confirmed, the dashboard takes over the terminal for the duration of the loop.

As with all interactive CLI, both can be skipped via args:

```bash
superintendent run <doc> --agent claude-code
```

### Scope

The dashboard is **only** for `superintendent run`. All other commands (`validate`, `complete`, `builder run`, `inspector run`, `inspector list`) use standard cmdkit output.

## MCP behavior

Thin entrypoint:

```ts
import { runMCP } from "@poe-code/cmdkit/mcp";
import { superintendentGroup } from "./commands/index.js";

runMCP(superintendentGroup, {
  name: "superintendent",
  version: "0.0.1",
});
```

Tool names should be things like:

- `superintendent.run`
- `superintendent.validate`
- `superintendent.complete`
- `superintendent.inspector.run`

## Results shape

Commands should return structured data first, then render it.

Examples:

- `inspector.run` -> inspector output summary + metadata
- `validate` -> validation result + problems
- `complete` -> updated completion state + optional reason

## Reusing the existing markdown parser

The existing markdown parser in `@poe-code/design-system` already uses an AST and is good enough for:

- finding `## Task Board`
- recognizing markdown checkbox tasks
- validating the basic task board shape

So for v1, reuse it.

We do **not** need hidden task IDs or deep task parsing for the initial version.
Longer term, if this parser becomes shared workflow infrastructure, extract it from `design-system` into a more neutral package.

## Phases

### Phase 1 — document model + validation

- parser/writer for superintendent doc
- task board parser/writer
- `validate`

### Phase 2 — builder + inspector execution

- `builder run`
- `inspector list`
- `inspector run`
- add `developer-experience` inspector
- runtime variable assembly for `plan.path`, `builder.*`, `inspectors.*`, `superintendent.*`, and `owner.*`

### Phase 3 — superintendent + owner orchestration

- `run`
- fixed state machine: `in_progress -> review -> completed`
- 5-turn bounded review between superintendent and owner
- owner workflow-transition flow based on the actual task list
- dashboard UI for `superintendent run` using `createDashboard`

### Phase 4 — MCP exposure

- standalone MCP entrypoint
- compose into main `poe-code mcp`
- verify tool names and schemas

## Failure handling

Agent failures (builder crash, inspector timeout, superintendent not calling a transition) are handled by `spawn.autonomous` retry behavior.

The superintendent runtime does **not** implement its own retry logic. It delegates agent execution to `spawn.autonomous`, which already handles:

- retries on transient failures
- timeout management
- error reporting

If an agent fails after retries are exhausted, the runtime should surface the error and halt the current round, leaving the document in its last valid state.

## Recommendation

Treat this as one feature and one plan.

- tasks live in the markdown body
- frontmatter wires the runtime
- the shared artifact handle is `plan.path`
- summaries are handoffs, not the only source of truth
- superintendent suggests completion
- owner uses workflow transitions to approve or send work back
- CLI and MCP come from one cmdkit command tree
