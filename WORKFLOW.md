---
tasks:
  type: markdown-dir
  path: ./docs/plans
  singleList: plans
  frontmatterMode: passthrough
  create: false
  lockStaleMs: 30000
  lockRetries: 20
agent:
  service: codex
  list: plans
  max_concurrent_agents: 1
  max_turns: 20
  max_retry_backoff_ms: 300000
polling:
  interval_ms: 30000
workspace:
  root: ./.poe-code/maestro/workspaces
states:
  idea:
    agent: claude
    prompt: "Task: {{ task.qualifiedId }} ({{ task.url }})\n\nRead {{ task.description }}. Run /poe-code-plan to draft a plan.\nWrite the plan back with:\n  poe-code tasks set {{ task.id }} --description-file <plan>\n\nAdvance when the plan is ready:\n  poe-code tasks next {{ task.id }}\n"

  planned:
    prompt: "Task: {{ task.qualifiedId }} ({{ task.url }})\n\nRead {{ task.description }} for the plan. Implement it, keep the project conventions, and open a PR.\n\nAdvance when the PR is open:\n  poe-code tasks next {{ task.id }}\n"

  in-review:
    prompt: "Task: {{ task.qualifiedId }} ({{ task.url }})\n\nCheck review state:\n  gh pr view --json reviews,comments\n\nAddress any unaddressed feedback, push, and rebase if needed.\nIf approved and merged, advance:\n  poe-code tasks next {{ task.id }}\n\nOtherwise exit; maestro will re-check next tick.\n"

  done:
    terminal: true
  archived:
    terminal: true
---
{{ task.qualifiedId }}: {{ task.name }}

{{ task.description }}
