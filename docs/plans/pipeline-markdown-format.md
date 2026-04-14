# Pipeline Markdown Format

## Summary

Change pipeline plans from standalone YAML files to markdown files with YAML frontmatter, following the Ralph Wiggum pattern.

## Current Format

Separate files:
- Design doc: `docs/plans/e2e-sandbox-runner.md`
- Plan YAML: `.poe-code/pipeline/plans/plan-e2e-sandbox-runner.yaml` (references doc via `vars`)

## New Format

Single `.md` file with frontmatter containing all plan config:

```markdown
---
vars:
  plan_doc: "{{file 'docs/plans/e2e-sandbox-runner.md'}}"
tasks:
  - id: task-1
    title: Fix timeout
    prompt: Fix the timeout regression
    status: open
---
# Context

The design document body lives here as markdown...
```

Frontmatter holds: `tasks`, `vars`, `setup`, `teardown`, `mcp` (same fields as current YAML).
Body is the context document (design doc, notes, etc).

## Changes

### packages/pipeline

1. **parser.ts** - Extract frontmatter YAML, parse it, return `PipelinePlan` (same output type). Body is ignored by parser (it's context for the skill/agent, not the runner).
2. **writer.ts** - Split frontmatter from body, edit frontmatter YAML structurally, reassemble.
3. **discovery.ts** - Match `plan*.md` instead of `plan*.yaml`/`plan*.yml`.

### src/cli/commands/pipeline.ts

4. Update placeholder text from `.yaml` to `.md`.
5. Update validate command description.

### src/templates/pipeline/SKILL_plan.md

6. Update skill to output markdown with frontmatter instead of pure YAML.

### Init flow (future)

`pipeline init <doc.md>` runs agent with the plan skill, agent reads the doc and outputs a plan `.md` with frontmatter + body.
