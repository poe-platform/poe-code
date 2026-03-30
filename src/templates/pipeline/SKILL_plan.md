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
3. Check if a `steps.yaml` exists next to the plans directory (i.e. `<plan-path>/../steps.yaml`). If it does, read it to determine available steps. If not, use stepless tasks.

## Rules

- Each task must be self-contained. Put all context needed to execute the task inside that task's `prompt`.
- Do not create tasks that depend on hidden state from previous tasks.
- Use short kebab-case ids.
- Keep titles concise and descriptive.
- The available steps come from the `steps.yaml` file you found (project or global). Use the current step names instead of inventing hardcoded ones.
- If no step configuration is present, use stepless tasks with scalar `status: open`.
- If step configuration is present, start every configured step status at `open`.

## Output Format

Stepless tasks:

```yaml
tasks:
  - id: auth-hardening
    title: Harden auth flow
    prompt: |
      Improve auth validation and session handling.
    status: open
```

Stepped tasks when `.poe-code/pipeline/steps.yaml` defines steps:

```yaml
tasks:
  - id: auth-hardening
    title: Harden auth flow
    prompt: |
      Improve auth validation and session handling.
    status:
      implement: open
      test: open
      review: open
```

## After Writing

Run `poe-code pipeline validate <path>` to check the plan is valid before running it.

## Notes

- Match the uncommented step names and order from whichever `steps.yaml` file you find.
- If `poe-code` is not available as a global command, use `npx poe-code` instead.
