---
tasks:
  type: gh-issues
  repo: poe-platform/poe-code
  project:
    owner: poe-platform
    number: 7
  auth:
    token: $MAESTRO_GH_TOKEN
agent:
  service: codex
  list: poe-platform/7
  max_concurrent_agents: 1
  max_retry_backoff_ms: 300000
polling:
  interval_ms: 30000
workspace:
  root: ../../.poe-code/maestro/gh-issues/workspaces
states:
  idea:
    agent: claude
    prompt: |
      Task: {{ task.qualifiedId }} ({{ task.url }})

      Read {{ task.description }}. Run /poe-code-plan to draft a plan.
      Write the plan back with:
        poe-code tasks set {{ task.id }} --description-file <plan> --workflow maestro/github-issues/WORKFLOW.md

      Advance when the plan is ready:
        poe-code tasks next {{ task.id }} --workflow maestro/github-issues/WORKFLOW.md

  planned:
    prompt: |
      Task: {{ task.qualifiedId }} ({{ task.url }})

      Read {{ task.description }} for the plan. Implement it, keep the project conventions, and open a PR.

      Advance when the PR is open:
        poe-code tasks next {{ task.id }} --workflow maestro/github-issues/WORKFLOW.md

  in-review:
    prompt: |
      Task: {{ task.qualifiedId }} ({{ task.url }})

      Check review state:
        gh pr view --json reviews,comments

      Address any unaddressed feedback, push, and rebase if needed.
      If approved and merged, advance:
        poe-code tasks next {{ task.id }} --workflow maestro/github-issues/WORKFLOW.md

      Otherwise exit; maestro will re-check next tick.

  done:
    terminal: true
  archived:
    terminal: true
---
{{ task.qualifiedId }}: {{ task.name }}

{{ task.description }}
