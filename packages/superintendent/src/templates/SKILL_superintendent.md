---
name: poe-code-superintendent-plan
description: 'Create a superintendent markdown document for the autonomous build-inspect-review loop. Triggers on: create superintendent, superintendent plan, superintendent doc, autonomous loop.'
---

## If The Request Is Empty

Ask the user for a one-sentence description of what they want to build autonomously.

## Goal

Create a superintendent markdown document at `.poe-code/superintendent/<name>.md` with YAML frontmatter and a Task Board.

## Document Shape

The document has two parts:

1. **YAML frontmatter** — wires the runtime (agents, prompts, MCP servers)
2. **Markdown body** — contains the `## Task Board` with checkbox tasks

## Frontmatter Format

```yaml
---
kind: superintendent
version: 1

builder:
  agent: claude-code
  prompt: |
    Work on the highest-priority open task from {{plan.path}}.
    Read the plan file directly and make concrete progress.
    Leave a concise summary and build log.

inspectors:
  code-quality:
    agent: claude-code
    prompt: |
      Inspect the current state for correctness, code quality, architecture,
      and missed edge cases.
      Read {{plan.path}} directly as the source of truth.

superintendent:
  agent: claude-code
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

    Update the markdown Task Board directly.
    If more work is needed, add or reopen tasks.
    If the task board is complete, produce a completion summary for the owner
    and call the workflow MCP tool to request review.

owner:
  agent: claude-code
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

## Task Board

The markdown body must contain a `## Task Board` section with checkbox tasks:

```markdown
## Task Board

- [ ] First task to accomplish
- [ ] Second task to accomplish
- [ ] Third task to accomplish
```

Priority is top-to-bottom: the first unchecked item is the highest priority.

Use `- [ ]` for open tasks and `- [x]` for completed tasks.

## Available Prompt Variables

Use Mustache syntax in agent prompts:

| Variable | Description |
|---|---|
| `{{plan.path}}` | Path to the superintendent document |
| `{{builder.summary}}` | Short builder outcome |
| `{{builder.log}}` | Builder execution log |
| `{{inspectors.<name>}}` | Summary from a named inspector |
| `{{superintendent.summary}}` | Superintendent's completion or review summary |
| `{{owner.feedback}}` | Owner's decline feedback |

## Agent Roles

| Role | Purpose |
|---|---|
| `builder` | Does the actual work on the highest-priority task |
| `inspectors` | One-off evaluators that review the builder's work |
| `superintendent` | Reviews all outputs, updates the Task Board, requests owner review when done |
| `owner` | Decides whether to approve completion or send work back |

## Optional: MCP Servers

Add MCP servers that agents can use:

```yaml
mcp:
  my-server:
    command: npx
    args: [my-server]
```

Reference them in agent configs with `tools.mcp`:

```yaml
superintendent:
  agent: claude-code
  mode: read
  tools:
    mcp:
      - my-server
  prompt: ...
```

## Optional: Agent Specifiers

Pin a specific model using the agent specifier notation:

```yaml
builder:
  agent: claude-code:anthropic/claude-opus-4.6
```

## Rules

- The `builder` role is required.
- The `superintendent` role is required.
- The `owner` role is required.
- `inspectors` is optional but recommended.
- Each inspector is a named entry under `inspectors`.
- `max_rounds` defaults to 100 if omitted.
- `status` must start with `state: in_progress`, `round: 0`, `review_turn: 0`.
- Agents read `{{plan.path}}` directly as the source of truth.
- Summaries are handoffs between agents, not the only source of truth.
- Keep prompts self-contained with all context the agent needs.

## After Writing

Run `poe-code superintendent validate <path>` to check the document is valid.

## Output

```text
Created:
  .poe-code/superintendent/<name>.md

Run with:
  poe-code superintendent run .poe-code/superintendent/<name>.md
```
