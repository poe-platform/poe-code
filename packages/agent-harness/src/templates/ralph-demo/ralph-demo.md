---
$schema: https://poe-platform.github.io/poe-code/schemas/harnesses/ralph-demo.schema.json
kind: ralph-demo
version: 1
agent:
  agent: claude-code
  mode: edit
  prompt: |
    Work through the plan one focused iteration at a time.
steps:
  - id: inspect
    prompt: Inspect the plan and repository state.
  - id: improve
    prompt: Make one focused improvement and summarize the result.
goal: Improve the current repository state while preserving tests.
---

# Ralph Demo

Review the repository, make one focused improvement, then summarize what changed
and what should happen next.
