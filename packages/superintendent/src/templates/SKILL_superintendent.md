---
name: poe-code-superintendent-plan
description: 'Create a superintendent markdown document for the autonomous build-inspect-review loop. Triggers on: create superintendent, superintendent plan, superintendent doc, autonomous loop.'
---

## If The Request Is Empty

Ask the user for a one-sentence description of what they want to build autonomously.

## Goal

There is exactly **one plan document per feature**, at `docs/plans/<name>.md`. The superintendent frontmatter and Task Board live in that same file alongside the feature plan body.

If `docs/plans/<name>.md` already exists (e.g. drafted by `/poe-code-plan`), augment it in place by adding the YAML frontmatter at the top and a `## Task Board` section at the bottom. Do not create a second file.

## Document Shape

1. **YAML frontmatter** — wires the runtime (agents, prompts, MCP servers).
2. **Markdown body** — the feature plan plus a `## Task Board` with checkbox tasks.

## Frontmatter Format

Role prompts are one line. Do not repeat anything that lives in `CLAUDE.md` (TDD, SOLID, project conventions). The plan file is the source of truth — agents read it.

```yaml
---
kind: superintendent
version: 1

builder:
  agent: claude-code
  prompt: |
    Build the highest-priority open task from {{plan.path}}.

inspectors:
  code-quality:
    agent: claude-code
    prompt: |
      Make sure this code follows convention and good architecture.

superintendent:
  agent: claude-code
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

Priority is top-to-bottom: the first unchecked item is the highest priority. Use `- [ ]` for open tasks and `- [x]` for completed tasks.

## Available Prompt Variables

Use Mustache syntax in agent prompts:

| Variable | Description |
|---|---|
| `{{plan.path}}` | Path to the plan document |
| `{{builder.summary}}` | Short builder outcome |
| `{{builder.log}}` | Builder execution log (text) |
| `{{builder.log_path}}` | Path to the builder's spawn log file (for `npm run replay`) |
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
  agent: claude-code:anthropic/claude-opus-4.6
```

## Rules

- One plan document per feature: `docs/plans/<name>.md`. Do not create a second file in `.poe-code/superintendent/`.
- Role prompts are one line where possible. Do not restate CLAUDE.md.
- Do not link the plan path inside every prompt — `{{plan.path}}` is in the template context.
- `builder`, `superintendent`, and `owner` roles are required. `inspectors` is optional.
- `max_rounds` defaults to 100 if omitted.
- `status` must start with `state: in_progress`, `round: 0`, `review_turn: 0`.

## After Writing

Run `poe-code superintendent validate <path>` to check the document is valid.

## Output

```text
Created (or augmented):
  docs/plans/<name>.md

Run with:
  poe-code superintendent run docs/plans/<name>.md
```
