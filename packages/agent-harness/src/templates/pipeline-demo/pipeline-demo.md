---
$schema: https://poe-platform.github.io/poe-code/schemas/harnesses/pipeline-demo.schema.json
kind: pipeline-demo
version: 1
agents:
  builder:
    agent: claude-code
    mode: edit
    prompt: |
      Implement the task with tests first.
  reviewer:
    agent: claude-code
    mode: read
    prompt: |
      Review the diff for correctness and coverage.
tasks:
  - id: inspect-worktree
    title: Inspect worktree
    prompt: Summarize the current repository state before making changes.
  - id: review-diff
    title: Review diff
    prompt: Review the resulting diff and call out follow-up work.
---

# Pipeline Demo

Run the tasks in order. For each task, let the builder produce the change or
analysis, then let the reviewer inspect the result.
