---
tasks:
  type: markdown-dir
  path: ./tasks
states:
  in-progress:
    prompt: Continue the implementation and leave a concise handoff.
  planned:
    prompt: Turn the task brief into an implementation plan.
  draft:
    prompt: Clarify the task until it is ready to plan.
  done:
    terminal: true
  archived:
    terminal: true
agent:
  list: tasks
---

Visual validation fixture for the Maestro TUI.
