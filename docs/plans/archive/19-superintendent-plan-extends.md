# Superintendent Plan Extends

Let superintendent plan documents inherit frontmatter from a project-local base file so authors stop retyping ~60 lines of boilerplate per plan.

## 1. Problem

Every superintendent plan in this repo today duplicates the same builder / superintendent / owner role definitions. Comparing the 5 existing plans in `docs/plans/` (`pipeline-markdown-format.md`, `poe-agent-agentic-features.md`, `dashboard-loop-integration.md`, `pi-mono-coding-agent-integration.md`, plus the archived one) shows:

- `builder.prompt` is usually one line and nearly identical across plans.
- `superintendent.prompt` varies only in which inspectors it cites.
- `owner.prompt` usually has one feature-specific question appended to a common body.
- `max_rounds`, `status`, and `version` are always the same defaults.

Only the inspectors and the owner's feature-specific question actually change per plan. Authors copy a prior plan and edit a few fields — so changing a convention (e.g. adding a new required inspector) means editing every plan, and new plans drift.

**Evidence this is worth solving now.** `packages/config-extends` already exists and is wired into pipeline, experiment-loop, ralph, github-workflows, and poe-code-config. Superintendent is the outlier — adopting it costs less than inventing a parallel mechanism.

**Out of scope.**

- Shipping curated bases with the `poe-code` package. Project-local only.
- Runtime overrides from CLI flags / env vars.
- Changes to the markdown body or `## Task Board` — bases contribute frontmatter only.
- Pipeline, experiment, or ralph plan kinds — those already use `config-extends`.
- A UI to scaffold bases.

**Direction — explicit paths (decided).**

`extends:` takes a relative path: `extends: ./_bases/coding.md`. No name-based discovery, no implicit search directories. The path is resolved literally from the plan file's directory. This requires a small addition to `config-extends` so a path-valued `extends` short-circuits the `findBase` discovery step.

## 2. User-facing shape

### Base file

A base lives at any path inside the repo. Convention: `docs/plans/_bases/<name>.md`. A base is a superintendent plan without a status block and without a Task Board — everything else looks the same.

`docs/plans/_bases/coding.md`:

```markdown
---
kind: superintendent-base
version: 1

builder:
  agent: claude-code
  prompt: |
    Build the highest-priority open task from {{plan.path}}.

inspectors:
  code-quality:
    agent: claude-code
    prompt: |
      Make sure this code follows convention and good architecture. Outline any issues.
  testing:
    agent: claude-code
    prompt: |
      Verify tests exist and pass.

superintendent:
  agent: claude-code
  prompt: |
    Review builder + inspectors, update Task Board in {{plan.path}}, request owner review when done.

owner:
  agent: claude-code
  prompt: |
    Approve or send back with feedback.

max_rounds: 100
---
```

No body, no `## Task Board`, no `status:` block.

### Plan file (child)

The child plan declares the base path and overrides only what differs. Everything not set in the child is inherited.

```markdown
---
kind: superintendent
version: 1
extends: ./_bases/coding.md

inspectors:
  developer-experience:
    agent: claude-code
    prompt: |
      Replay the builder's session with `npm run replay -- {{builder.log_path}}`
      and suggest DX improvements.

owner:
  prompt: |
    Would a pipeline author discover the `.md` format naturally, and does every
    code path (parse, write, discover, skill, docs) agree on it?

status:
  state: in_progress
  round: 0
  review_turn: 0
---

# Pipeline Markdown Format

## Summary
...

## Task Board

- [ ] ...
```

After merge:

- `builder` from base.
- `inspectors.code-quality`, `inspectors.testing` from base; `inspectors.developer-experience` from child.
- `superintendent` from base.
- `owner.agent` from base; `owner.prompt` from child (replaced, not concatenated).
- `max_rounds` from base.
- `status` from child (required — bases have no status).

### Removing an inherited entry

Child writes `null` to drop a key from a map:

```yaml
inspectors:
  testing: null
```

After merge, `inspectors.testing` is absent.

### Chaining

A base can itself declare `extends:` relative to its own directory. Cycles and depth > 5 error out (inherits `MAX_EXTENDS_DEPTH` from `config-extends`).

### `poe-code superintendent validate`

Resolves `extends:`, deep-merges, validates the merged result.

Happy path:

```text
$ poe-code superintendent validate docs/plans/pipeline-markdown-format.md

✓ docs/plans/pipeline-markdown-format.md
  extends: docs/plans/_bases/coding.md
  merged: builder, inspectors (code-quality, testing, developer-experience),
          superintendent, owner, max_rounds, status
```

Missing base:

```text
✗ docs/plans/pipeline-markdown-format.md
  extends: ./_bases/coding.md
  error: base file not found at /abs/path/docs/plans/_bases/coding.md
```

Cycle:

```text
✗ docs/plans/a.md
  error: circular extends
    docs/plans/a.md
    → docs/plans/_bases/b.md
    → docs/plans/a.md
```

Required field missing after merge:

```text
✗ docs/plans/x.md
  extends: ./_bases/coding.md
  error: required field "superintendent.prompt" missing after merge
```

### What does not change

- `poe-code superintendent run <path>` — same command, same behavior; it just reads the merged frontmatter.
- Markdown body and `## Task Board` live in the child only. Bases cannot contribute body content.
- `/poe-code-superintendent-plan` still writes a self-contained plan by default. Scaffolding a base-using plan from the skill is out of scope for this doc.
