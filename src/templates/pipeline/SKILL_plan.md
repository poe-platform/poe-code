---
name: poe-code-pipeline-plan
description: 'Generate a Pipeline plan (YAML) from a user request. Triggers on: create a pipeline plan, write plan for, plan this feature, pipeline plan.'
---

## If The Request Is Empty

Ask the user for a one-sentence description of what they want to build.

## Goal

Write a YAML pipeline plan for `.poe-code/pipeline/plans/plan-<name>.yaml`

## Rules

- Each task must be self-contained. Put all context needed to execute the task inside that task's `prompt`.
- Do not create tasks that depend on hidden state from previous tasks.
- Use short kebab-case ids.
- Keep titles concise and descriptive.
- The available steps come from `.poe-code/pipeline/steps.yaml`, and that file is meant to be edited by the user. Use the current step names instead of inventing hardcoded ones.
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

## Notes

- If the repository already has `.poe-code/pipeline/steps.yaml`, match its uncommented step names and order.
