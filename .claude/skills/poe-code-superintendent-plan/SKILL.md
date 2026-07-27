---
name: poe-code-superintendent-plan
description: "Create a superintendent markdown document for the autonomous build-inspect-review loop. Triggers on: create superintendent, superintendent plan, superintendent doc, autonomous loop."
---

## If The Request Is Empty

Ask the user for a one-sentence description of what they want to build autonomously.

## Goal

There is exactly **one plan document per feature**, at `<plan-directory>/<name>.md` (see Plan Directory section below). The superintendent frontmatter and Task Board live in that same file alongside the feature plan body.

Use canonical frontmatter metadata at the top of the document:

If a plan file already exists (e.g. drafted by `/poe-code-plan`), augment it in place by adding the YAML frontmatter at the top and a `## Task Board` section at the bottom. Do not create a second file.

## Before Writing: Study Existing Plans

Before drafting a new plan, find existing superintendent plans in this repo and use them as a reference for inspector choices, prompt phrasing, Task Board granularity, and MCP wiring.

1. Run `rg -l "^kind: superintendent" <plan-directory>/` to list existing plans (use the resolved plan directory).
2. Read the most recent one or two plans, preferring ones whose scope resembles the current task.
3. Reuse inspector names, role phrasing, and structural conventions from those plans unless the new task clearly warrants deviation. Do not copy body content; only reuse patterns.

If no existing plans are found, fall back to the template below.

## Document Shape

1. **YAML frontmatter**: wires the runtime (agents, prompts, MCP servers).
2. **Markdown body**: the feature plan plus a `## Task Board` with checkbox tasks.

## Frontmatter Format

Role prompts are one line. Do not repeat project instructions such as TDD, SOLID, or repo conventions. The plan file is the source of truth; agents read it.

```yaml
---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/superintendent.schema.json
kind: superintendent
version: 1
readiness: draft

builder:
  prompt: |
    Build the highest-priority open task from {{plan.path}}.

inspectors:
  code-quality:
    prompt: |
      Make sure this code follows convention and good architecture.

superintendent:
  prompt: |
    Review the builder and inspector output, update the Task Board in {{plan.path}},
    and request owner review when the board is complete.

    Builder summary:
    {{builder.summary}}

    Inspector summaries:

    ## Code quality
    {{inspectors.code-quality}}

owner:
  agent: claude-code
  prompt: |
    Decide whether the work is done. Approve or send back with feedback.

    Superintendent summary:
    {{superintendent.summary}}

max_rounds: 50

status:
  state: in_progress
  round: 0
  review_turn: 0
---
```

## Optional: Frontmatter Bases

Plans are self-contained by default. If this repository already uses superintendent base files, or the user asks for one, a plan may inherit frontmatter from a project-local relative path:

```yaml
---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/superintendent.schema.json
kind: superintendent
version: 1
extends: ./_bases/coding.md

owner:
  prompt: |
    Decide whether this feature-specific work is done.

status:
  state: in_progress
  round: 0
  review_turn: 0
---
```

Base files use `kind: superintendent-base` and contribute frontmatter only. They do not carry the child plan body or runtime `status`:

```yaml
---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/superintendent-base.schema.json
kind: superintendent-base
version: 1

builder:
  prompt: |
    Build the highest-priority open task from {{plan.path}}.

superintendent:
  prompt: |
    Review the builder output and update the Task Board.

owner:
  prompt: |
    Decide whether the work is complete.
---
```

`extends` must be a non-empty relative path resolved from the current document's directory. Bases may extend other bases. Cycles and overly deep chains are invalid.

Child frontmatter deep-merges over the base. Set an inherited map entry to `null` to remove it:

```yaml
inspectors:
  testing: null
```

## Task Board

The markdown body must contain a `## Task Board` section with checkbox tasks:

```markdown
## Task Board

- [ ] First task to accomplish
- [ ] Second task to accomplish
- [ ] Third task to accomplish
```

Priority is top-to-bottom: the first unchecked item is the highest priority. Use `- [ ]` for open tasks and `- [x]` for completed tasks.

## Available Prompt Variables

Use template syntax in agent prompts:

| Variable                     | Description                                                 |
| ---------------------------- | ----------------------------------------------------------- |
| `{{plan.path}}`              | Path to the plan document                                   |
| `{{builder.summary}}`        | Short builder outcome                                       |
| `{{builder.log}}`            | Builder execution log (text)                                |
| `{{builder.log_path}}`       | Path to the builder's spawn log file (for `npm run replay`) |
| `{{inspectors.<name>}}`      | Summary from a named inspector                              |
| `{{superintendent.summary}}` | Superintendent's completion or review summary               |
| `{{owner.feedback}}`         | Owner's decline feedback                                    |

## Agent Roles

| Role             | Purpose                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| `builder`        | Does the actual work on the highest-priority task                            |
| `inspectors`     | One-off evaluators that review the builder's work                            |
| `superintendent` | Reviews all outputs, updates the Task Board, requests owner review when done |
| `owner`          | Decides whether to approve completion or send work back                      |

## Optional: MCP Servers

Declare MCP servers globally (all roles get them) or inline on a single role.

Global (every role can use it):

```yaml
mcp:
  my-server:
    command: npx
    args: [my-server]
```

Per-role (only that role gets it):

```yaml
inspectors:
  testing:
    agent: claude-code
    mcp:
      terminal-pilot:
        command: npx
        args: [terminal-pilot-mcp]
    prompt: |
      Test it.
```

## Optional: Agent Specifiers

Pin a specific model:

```yaml
builder:
  agent: claude-code:<model-id>
```

## Optional: Working Directory

Any role may set `cwd` to override the default (the directory containing the plan doc). Absolute paths are used as-is; relative paths resolve against the plan doc's directory.

```yaml
builder:
  agent: claude-code
  cwd: ../../packages/agent-harness-tools
  prompt: |
    Build the next task.
```

## Auto-Run vs On-Demand Inspectors

An inspector auto-runs each round only if its summary is referenced in the superintendent prompt via `{{inspectors.<name>}}`. If an auto-run inspector's own prompt references another inspector, that inspector also auto-runs. Inspectors configured but not referenced remain available: the superintendent can invoke them mid-round via the `inspector_run` MCP tool.

## Rules

- One plan document per feature: `<plan-directory>/<name>.md`. Do not create a second file in `.poe-code/superintendent/`.
- Superintendent docs must start with `$schema`, `kind: superintendent`, and `version: 1`; if present, put `extends` directly after `version`.
- Role prompts are one line where possible. Do not restate project instructions.
- Do not link the plan path inside every prompt; `{{plan.path}}` is in the template context.
- `builder`, `superintendent`, and `owner` roles are required after inheritance. `inspectors` is optional.
- `max_rounds` defaults to 100 if omitted.
- `status` lives in the child plan and must start with `state: in_progress`, `round: 0`, `review_turn: 0`.

## After Writing

Run `poe-code superintendent validate <path>` to check the document is valid.

## Output

```text
Created (or augmented):
  <plan-directory>/<name>.md

Run with:
  poe-code superintendent run <plan-directory>/<name>.md
```
