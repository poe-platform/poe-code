---
tasks:
  type: gh-issues
  repo: poe-platform/poe-code
  filter: label:bug
  state:
    labelPrefix: "status:"
  auth:
    token: $MAESTRO_GH_TOKEN
agent:
  service: codex
  list: poe-platform/poe-code
  max_concurrent_agents: 1
polling:
  interval_ms: 30000
workspace:
  root: ./.poe-code/maestro/bugs-workspaces
states:
  draft:
    agent: claude
    prompt: "Triage {{ task.qualifiedId }} ({{ task.url }}) against open label:bug issues; if duplicate, comment its link and run: poe-code tasks set-state {{ task.id }} wontfix\nOtherwise refine the title, confirm reproducibility, then run: poe-code tasks next {{ task.id }}\n"

  confirmed:
    prompt: "Scope the fix for {{ task.qualifiedId }} ({{ task.url }}); apply severity sev:1, sev:2, or sev:3 and identify the package/area.\nAdvance when scoped: poe-code tasks next {{ task.id }}\n"

  fix:
    prompt: "Implement the fix for {{ task.qualifiedId }} ({{ task.url }}), with a test that fails before and passes after; open a PR linking the issue.\nAfter merge, advance: poe-code tasks next {{ task.id }}\n"

  released:
    terminal: true
  wontfix:
    terminal: true
---

{{ task.qualifiedId }}: {{ task.name }}

{{ task.description }}
