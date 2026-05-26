# Task list gh-issues fire submits no-op status transition without current-state validation

## Summary

The `gh-issues` task-list backend implements `fire(id, event)` by accepting any configured GitHub Project Status option and immediately writing it to the project item. It does not read the task's current Status or apply the shared state-machine transition rules before mutating. Consequently, a task already in `Todo` accepts and sends a `Todo` status mutation even though the wildcard state machine deliberately treats same-state transitions as non-fireable.

## Reproduction

From the repository root, run a disposable Vitest probe that simulates a project item already in `Todo`, calls `fire("482", "Todo")`, and records GraphQL status mutations:

```sh
cat > packages/task-list/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { ghIssuesBackend } from "./backends/gh-issues.js";

function response(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200 });
}

describe("gh-issues fire transition validation", () => {
  it("submits a no-op Todo transition without checking the task is already Todo", async () => {
    const mutations: string[] = [];
    const issue = {
      number: 482, title: "Task", body: "", url: "https://example.test/482",
      createdAt: "2026-01-01T00:00:00Z", labels: { nodes: [] },
      assignees: { nodes: [] }, milestone: null
    };
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const query = JSON.parse(String(init?.body)).query as string;
      if (query.includes("query Project")) return response({ organization: { projectV2: {
        id: "project-id",
        field: { id: "status", options: [{ id: "todo", name: "Todo" }, { id: "done", name: "Done" }] }
      } } });
      if (query.includes("query IssueProjectItem")) return response({ repository: { issue: {
        id: "issue-482",
        projectItems: { nodes: [{ id: "item-482", project: { id: "project-id" } }] }
      } } });
      if (query.includes("mutation UpdateProjectItemStatus")) {
        mutations.push("updateStatus");
        return response({ updateProjectV2ItemFieldValue: { projectV2Item: { id: "item-482" } } });
      }
      if (query.includes("query Issue")) return response({ repository: { issue: {
        ...issue,
        projectItems: { nodes: [{ id: "item-482", project: { id: "project-id" }, fieldValueByName: { name: "Todo" } }] }
      } } });
      throw new Error("unexpected query");
    });
    const taskList = await ghIssuesBackend({
      repo: "octo/repo", project: { owner: "octo-org", number: 7 }, defaults: { metadata: {} },
      token: "secret", endpoint: "https://github.example.test/api/graphql",
      fetch: fetchMock as unknown as typeof fetch
    });
    const result = await taskList.list("octo-org/7").fire("482", "Todo");
    console.log(JSON.stringify({ state: result.state, mutations }));
    expect(result.state).toBe("Todo");
    expect(mutations).toEqual(["updateStatus"]);
  });
});
EOF
trap 'rm -f packages/task-list/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/task-list/src/__probe__.test.ts --reporter verbose
nl -ba packages/task-list/src/backends/gh-issues.ts | sed -n '549,561p;713,728p'
nl -ba packages/task-list/src/state-machine.ts | sed -n '25,31p;98,110p'
```

## Observed Behavior

The probe returns the task in its existing `Todo` state after recording that `fire("482", "Todo")` submitted one status update mutation:

```text
{"state":"Todo","mutations":["updateStatus"]}
✓ packages/task-list/src/__probe__.test.ts > gh-issues fire transition validation > submits a no-op Todo transition without checking the task is already Todo
```

`fire()` checks only whether the requested destination exists in `session.statusOptions`, resolves the project item, then unconditionally calls `updateProjectItemStatus()` in `packages/task-list/src/backends/gh-issues.ts:549` through `packages/task-list/src/backends/gh-issues.ts:561`. The update helper likewise validates only that the destination option exists before writing in `packages/task-list/src/backends/gh-issues.ts:713` through `packages/task-list/src/backends/gh-issues.ts:728`. In contrast, the shared state-machine logic excludes wildcard no-op transitions when `event.to === fromState` in `packages/task-list/src/state-machine.ts:25` through `packages/task-list/src/state-machine.ts:31` and exposes that validation through `findEvent()` in `packages/task-list/src/state-machine.ts:98` through `packages/task-list/src/state-machine.ts:110`.

## Expected Behavior

`fire(id, event)` should evaluate the requested transition from the task's current Status before submitting a GitHub mutation, consistently with the state-machine rules used to determine whether a transition is actionable. Calling `fire("482", "Todo")` for a task already in `Todo` should reject as a non-fireable no-op and should not send a status update mutation.

## Impact

Callers cannot rely on `fire()` to enforce the backend's declared transition semantics. No-op workflow actions perform avoidable remote writes, can trigger Project update activity and integrations without a real state change, and diverge from any UI or automation that uses state-machine transition availability to decide which actions are valid.
