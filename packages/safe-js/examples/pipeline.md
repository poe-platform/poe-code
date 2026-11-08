---
kind: pipeline
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

# Single-file pipeline

This is a minimal pipeline plan where the markdown frontmatter carries the task
data and the script block orchestrates the run.

```js
import { spawn } from "agent";
import { tasks, agents, meta } from "harness";
import { event, info } from "log";

const runTask = async (index) => {
  if (index >= tasks.length) {
    return [];
  }

  const task = tasks[index];
  event("task.started", { id: task.id, title: task.title });
  const build = await spawn(agents.builder, {
    check: true,
    prompt: `${task.id}: ${task.title}\n\n${task.prompt}`
  });
  const review = await spawn(agents.reviewer, {
    check: true,
    prompt: `Review ${task.id}\n\n${build.summary}`
  });
  info(task.id, build.summary, review.summary);
  event("task.completed", { id: task.id });
  return [task.id].concat(await runTask(index + 1));
};

const taskIds = await runTask(0);

return {
  kind: meta.kind,
  taskIds
};
```
