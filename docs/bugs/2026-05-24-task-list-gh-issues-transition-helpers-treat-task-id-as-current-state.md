# Task list gh-issues transition helpers treat task ID as current state

## Summary

The `gh-issues` backend's public `canFire(id, event)` and `events(id)` methods receive a task identifier, as required by the shared `Tasks` interface, but pass that identifier directly to state-machine helpers as if it were the task's current state. They never load the task or its GitHub Status value. For a real task currently in `Todo`, `canFire("482", "Todo")` incorrectly returns `true` and `events("482")` incorrectly includes the current-state transition.

## Reproduction

From the repository root, run a disposable Vitest probe that reads a GitHub task whose actual project Status is `Todo`, then asks for transitions by task ID:

```sh
cat > packages/task-list/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { ghIssuesBackend } from "./backends/gh-issues.js";
function response(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200 });
}
describe("gh-issues transition helpers", () => {
  it("uses the task id as a state after reading a task whose real Status is Todo", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ organization: { projectV2: {
        id: "project-id", field: { id: "status", options: [{ id: "todo", name: "Todo" }, { id: "done", name: "Done" }] },
      } } }))
      .mockResolvedValueOnce(response({ repository: { issue: {
        number: 482, title: "Task", body: "", url: "https://example.test/482", createdAt: "2026-01-01T00:00:00Z",
        labels: { nodes: [] }, assignees: { nodes: [] }, milestone: null,
        projectItems: { nodes: [{ id: "item-482", project: { id: "project-id" }, fieldValueByName: { name: "Todo" } }] },
      } } }));
    const taskList = await ghIssuesBackend({
      repo: "octo/repo", project: { owner: "octo-org", number: 7 }, defaults: { metadata: {} },
      token: "secret", endpoint: "https://github.example.test/api/graphql", fetch: fetchMock,
    });
    const tasks = taskList.list("octo-org/7");
    const task = await tasks.get("482");
    const result = {
      taskState: task.state,
      canFireTodo: await tasks.canFire("482", "Todo"),
      events: await tasks.events("482"),
      fetchCalls: fetchMock.mock.calls.length,
    };
    console.log(JSON.stringify(result));
    expect(result).toEqual({
      taskState: "Todo",
      canFireTodo: true,
      events: ["Todo", "Done"],
      fetchCalls: 2,
    });
  });
});
EOF
trap 'rm -f packages/task-list/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/task-list/src/__probe__.test.ts --reporter verbose
nl -ba packages/task-list/src/types.ts | sed -n '48,61p'
nl -ba packages/task-list/src/backends/gh-issues.ts | sed -n '433,450p;549,576p;840,871p'
nl -ba packages/task-list/src/state-machine.ts | sed -n '75,112p'
```

## Observed Behavior

The task read confirms current state `Todo`, but transition lookup does not issue another task query and reports the `Todo` status as an available transition because it evaluates from the string task ID `"482"`:

```text
{"taskState":"Todo","canFireTodo":true,"events":["Todo","Done"],"fetchCalls":2}
✓ packages/task-list/src/__probe__.test.ts > gh-issues transition helpers > uses the task id as a state after reading a task whose real Status is Todo
```

The shared interface defines `canFire(id, event)` and `events(id)` in `packages/task-list/src/types.ts:48` through `packages/task-list/src/types.ts:61`. The GitHub backend builds its wildcard status state machine in `packages/task-list/src/backends/gh-issues.ts:433` through `packages/task-list/src/backends/gh-issues.ts:450`, but its transition methods pass `id` directly as the `fromState` argument in `packages/task-list/src/backends/gh-issues.ts:549` through `packages/task-list/src/backends/gh-issues.ts:576` instead of loading the task state through `fetchIssueTask()` at `packages/task-list/src/backends/gh-issues.ts:840` through `packages/task-list/src/backends/gh-issues.ts:871`. Since wildcard transitions are excluded only when `event.to === fromState` in `packages/task-list/src/state-machine.ts:75` through `packages/task-list/src/state-machine.ts:112`, a numeric ID never matches `Todo` or `Done`.

## Expected Behavior

`canFire(id, event)` and `events(id)` should resolve the identified task and evaluate transitions from its current Project Status value. For a task already in `Todo`, a wildcard status transition back to `Todo` should not be exposed as fireable when the common state-machine behavior excludes no-op transitions.

## Impact

Interactive task UIs and automation using transition discovery can offer invalid or misleading no-op actions for every GitHub-backed task, regardless of its real status. The helpers also return results for nonexistent numeric IDs without checking task existence, so callers cannot rely on them to describe actionable transitions for actual selected tasks.
