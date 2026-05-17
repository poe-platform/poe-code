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
active_states:
  - planned
  - in-progress
terminal_states:
  - done
  - archived
step_overrides: {}
---
{{ task.qualifiedId }}: {{ task.name }}

{{ task.description }}
