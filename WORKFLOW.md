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
  root: ./.poe-code/maestro/workspaces
states:
  idea:
    agent: claude
    prompt: |
      Task: {{ task.qualifiedId }} ({{ task.url }})

      Read {{ task.description }}. Run /poe-code-plan to draft a plan.
      Write the plan back with:
        poe-code tasks set {{ task.id }} --description-file <plan>

      When the plan is ready, submit it for approval:
        poe-code tasks next {{ task.id }}

  awaiting-build:
    gate: true

  build:
    prompt: |
      Task: {{ task.qualifiedId }} ({{ task.url }})

      Read {{ task.description }} for the plan. Implement it, keep the project conventions, and open a PR.

      Advance when the PR is open:
        poe-code tasks next {{ task.id }}

  review:
    prompt: |
      Task: {{ task.qualifiedId }} ({{ task.url }})

      Review the PR:
        gh pr view --json reviews,comments

      Address any unaddressed feedback, push, and rebase if needed.
      When the review is clean, advance:
        poe-code tasks next {{ task.id }}

      Otherwise exit; maestro will re-check next tick.

  qa:
    prompt: |
      Task: {{ task.qualifiedId }} ({{ task.url }})

      Run QA for the change: execute the relevant QA steps and verify it works.

      When QA passes, submit it for release approval:
        poe-code tasks next {{ task.id }}

      Otherwise exit; maestro will re-check next tick.

  awaiting-release:
    gate: true

  release:
    prompt: |
      Task: {{ task.qualifiedId }} ({{ task.url }})

      Merge the PR, then watch the release publish to completion. If the release
      build fails, fix it and re-run until it is green.

      When the release is published successfully, advance:
        poe-code tasks next {{ task.id }}

  archive:
    terminal: true
---
{{ task.qualifiedId }}: {{ task.name }}

{{ task.description }}
