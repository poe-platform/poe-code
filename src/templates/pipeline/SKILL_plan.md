---
name: poe-code-pipeline-plan
description: 'Generate a Pipeline plan markdown file with YAML frontmatter from a user request. Triggers on: create a pipeline plan, write plan for, plan this feature, pipeline plan.'
---

## If The Request Is Empty

Ask the user for a one-sentence description of what they want to build.

## Goal

Write a markdown pipeline plan with YAML frontmatter. Before writing, decide where it goes:

1. If the user points you at an existing source Markdown doc, add the frontmatter to that file in place. Leave the existing body as the context section below the frontmatter. Do not create a second plan file.
2. Otherwise write a new file at `docs/plans/plan-<name>.md`.
3. Find the `steps.yaml` file. Check these locations in order and use the first one found:
   a. `<project-root>/.poe-code/pipeline/steps.yaml` (project-level)
   b. `~/.poe-code/pipeline/steps.yaml` (user-global)
   If found, read it to determine available steps and note any `setup`/`teardown` hooks defined there. If not found in either location, use stepless tasks.

## Rules

- Each task must be self-contained. Put all context needed to execute the task inside that task's `prompt`.
- Do not create tasks that depend on hidden state from previous tasks.
- Use short kebab-case ids.
- Keep titles concise and descriptive.
- The available steps come from the `steps.yaml` file you found (project or global). Use the current step names instead of inventing hardcoded ones.
- If no step configuration is present, use stepless tasks with scalar `status: open`.
- If step configuration is present, start every configured step status at `open`.
- `setup` and `teardown` defined in `steps.yaml` are inherited automatically.
- To disable an inherited hook for a specific plan, set `setup: false` or `teardown: false`.
- To override an inherited hook, define the full block with a `prompt` field.
- The markdown body is for context, notes, acceptance criteria, or the design doc. Keep executable pipeline config in the YAML frontmatter.
- Do not rely on the body alone for runtime context. Each task prompt must still include everything it needs directly.
- Start the frontmatter with canonical metadata: `$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json`, `kind: pipeline`, and `version: 1`.

## Output Format

```markdown
---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

# setup/teardown are inherited from steps.yaml automatically.
# Include them only to disable or override:
#
# setup: false              # disable the inherited setup hook
# teardown: false           # disable the inherited teardown hook
# setup:                    # override with a different prompt
#   prompt: Custom setup
#   mode: yolo

tasks:
  - id: auth-hardening
    title: Harden auth flow
    prompt: |
      Improve auth validation and session handling.
    # scalar when no steps.yaml steps are defined:
    status: open
    # stepped when steps.yaml defines steps:
    # status:
    #   implement: open
    #   test: open
    #   commit: open
---

# Context

Paste the design doc, notes, acceptance criteria, or implementation details here.
This body is for human-readable context and future tooling.
Any context needed at runtime must still appear in each task prompt.
```

## After Writing

Run `poe-code pipeline validate <path>` to check the plan is valid before running it.

## Notes

- Match the uncommented step names and order from whichever `steps.yaml` file you find.
- If `poe-code` is not available as a global command, use `npx poe-code` instead.
