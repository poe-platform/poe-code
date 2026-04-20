---
name: poe-code-pipeline-plan
description: 'Generate a Pipeline plan markdown file with YAML frontmatter from a user request. Triggers on: create a pipeline plan, write plan for, plan this feature, pipeline plan.'
---

## If The Request Is Empty

Ask the user for a one-sentence description of what they want to build.

## Goal

Write a markdown pipeline plan with YAML frontmatter. Before writing, determine where to place it:

1. Write the plan to `docs/plans/plan-<name>.md` by default.
2. Find the `steps.yaml` file. Check these locations in order and use the first one found:
   a. `<project-root>/.poe-code/pipeline/steps.yaml` (project-level)
   b. `~/.poe-code/pipeline/steps.yaml` (user-global)
   If found, read it to determine available steps and note any `setup`/`teardown` hooks defined there. If not found in either location, use stepless tasks.
3. Decide what belongs in the markdown body. If the user already has a Markdown design/context doc (for example in `docs/plans/`), use that content as the plan body when it makes sense. If they want to keep the source doc separate, link it via `vars` so it is available in every prompt without repeating the path.

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
- To override an inherited hook, define the full block with an `prompt` field.
- If the user keeps an existing Markdown plan document as a separate file, add a `vars` block with a `plan_doc` key pointing to the file path. The pipeline runtime reads the file and makes its contents available as a named placeholder in every prompt.
- `vars` values are plain strings. Use the `file` include syntax inside a value to load a file at runtime (path relative to project root): write `var_name: "` followed by the file include tag and a closing `"`.
- Each var name becomes a double-curly-brace placeholder usable in any task, step, setup, or teardown prompt.
- The markdown body is for context, notes, acceptance criteria, or the design doc. Keep executable pipeline config in the YAML frontmatter.
- Do not rely on the body alone for runtime context. Each task prompt must still include everything it needs directly or via `vars` placeholders.
- Start the frontmatter with canonical metadata: `$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json`, `kind: pipeline`, and `version: 1`.

## Output Format

```markdown
---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

# vars: optional. Define named values available as double-curly-brace placeholders in every prompt.
# Each value is a plain string. To load a file at runtime, write the value using the
# file include syntax: double-curly-brace file followed by a quoted path.
# Omit this block if there are no shared values to inject.
#
# vars:
#   plan_doc: "(file include for docs/plans/my-feature.md)"  # loaded at runtime
#   env: production                                           # literal string

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
      # If vars defines plan_doc, reference it here using the double-curly-brace placeholder syntax.
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
Any context needed at runtime must still appear in each task prompt or via vars placeholders.
```

## After Writing

Run `poe-code pipeline validate <path>` to check the plan is valid before running it.

## Notes

- Match the uncommented step names and order from whichever `steps.yaml` file you find.
- If `poe-code` is not available as a global command, use `npx poe-code` instead.
