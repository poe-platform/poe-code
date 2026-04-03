---
name: poe-code-pipeline-plan
description: 'Generate a Pipeline plan (YAML) from a user request. Triggers on: create a pipeline plan, write plan for, plan this feature, pipeline plan.'
---

## If The Request Is Empty

Ask the user for a one-sentence description of what they want to build.

## Goal

Write a YAML pipeline plan. Before writing, determine where to place it:

1. Run `poe-code pipeline plan-path` to get the plans directory.
2. Write the plan to `<plan-path>/plan-<name>.yaml`. If the plan path is under the global `~/.poe-code` directory, prefix the filename with the project name: `plan-<project>-<name>.yaml`.
3. Check if a `steps.yaml` exists next to the plans directory (i.e. `<plan-path>/../steps.yaml`). If it does, read it to determine available steps and note any `setup`/`teardown` hooks defined there. If not, use stepless tasks.
4. If the user has an existing Markdown plan document (e.g. in `docs/plans/`), link it via `vars` so it is available in every prompt without repeating the path.

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
- If the user has an existing Markdown plan document, add a `vars` block and reference it as `{{plan_doc}}` in prompts instead of inlining or repeating `{{file '...'}}` in every task.
- `vars` values are plain strings. Use `{{file 'path'}}` inside a value to load a file at runtime (path relative to project root).

## Output Format

```yaml
# vars: define named values available as {{var_name}} in every prompt.
# Use {{file 'path'}} inside a value to load a file (path relative to project root).
# Omit if there are no shared values.
#
# vars:
#   plan_doc: "{{file 'docs/plans/my-feature.md'}}"
#   env: production

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
      # {{plan_doc}} is available here if vars is defined above
      Improve auth validation and session handling.
    # scalar when no steps.yaml steps are defined:
    status: open
    # stepped when steps.yaml defines steps:
    # status:
    #   implement: open
    #   test: open
    #   commit: open
```

## After Writing

Run `poe-code pipeline validate <path>` to check the plan is valid before running it.

## Notes

- Match the uncommented step names and order from whichever `steps.yaml` file you find.
- If `poe-code` is not available as a global command, use `npx poe-code` instead.
