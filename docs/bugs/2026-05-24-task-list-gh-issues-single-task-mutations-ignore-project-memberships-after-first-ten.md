# Task list gh-issues single-task mutations ignore project memberships after first ten

## Summary

The `gh-issues` task-list backend resolves a single issue's membership in the configured GitHub Project v2 board using `projectItems(first: 10)` without pagination. If an issue belongs to more than ten projects and the configured task board is not present in the first ten returned items, `fire()`, `delete()`, and `move()` treat the task as absent from the list even though it is a valid member of the configured project.

## Reproduction

From the repository root, run a disposable Vitest probe that initializes the backend for `target-project` and supplies an issue whose queried first ten project items belong to other boards:

```sh
cat > packages/task-list/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { TaskNotFoundError } from "./types.js";
import { ghIssuesBackend } from "./backends/gh-issues.js";
function response(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200 });
}
describe("gh-issues issue membership lookup", () => {
  it("cannot find the configured project when it is beyond the first ten memberships", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ organization: { projectV2: {
        id: "target-project", field: { id: "status", options: [{ id: "todo", name: "Todo" }] },
      } } }))
      .mockResolvedValueOnce(response({ repository: { issue: {
        id: "issue-482",
        projectItems: { nodes: Array.from({ length: 10 }, (_, index) => ({ id: `other-${index}`, project: { id: `project-${index}` } })) },
      } } }));
    const taskList = await ghIssuesBackend({
      repo: "octo/repo", project: { owner: "octo-org", number: 7 }, defaults: { metadata: {} },
      token: "secret", endpoint: "https://github.example.test/api/graphql", fetch: fetchMock,
    });
    const outcome = await taskList.list("octo-org/7").delete("482").then(
      () => ({ deleted: true }),
      (error: Error) => ({ error: error.name, message: error.message }),
    );
    console.log(JSON.stringify(outcome));
    expect(outcome).toEqual({ error: "TaskNotFoundError", message: 'Task "octo-org/7/482" not found.' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(TaskNotFoundError).toBeDefined();
  });
});
EOF
trap 'rm -f packages/task-list/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/task-list/src/__probe__.test.ts --reporter verbose
nl -ba packages/task-list/src/backends/gh-issues.ts | sed -n '103,155p'
nl -ba packages/task-list/src/backends/gh-issues.ts | sed -n '549,593p;683,710p'
```

## Observed Behavior

The issue is treated as missing from the configured list after only the first ten project memberships are inspected:

```text
{"error":"TaskNotFoundError","message":"Task \"octo-org/7/482\" not found."}
✓ packages/task-list/src/__probe__.test.ts > gh-issues issue membership lookup > cannot find the configured project when it is beyond the first ten memberships
```

The single-issue GraphQL selection requests only `projectItems(first: 10)` in `packages/task-list/src/backends/gh-issues.ts:103` through `packages/task-list/src/backends/gh-issues.ts:155`. Mutation methods including `fire()`, `delete()`, and `move()` depend on `resolveProjectItemId()` in `packages/task-list/src/backends/gh-issues.ts:549` through `packages/task-list/src/backends/gh-issues.ts:593`, which searches only those returned nodes and throws `TaskNotFoundError` when the configured project is not found in `packages/task-list/src/backends/gh-issues.ts:683` through `packages/task-list/src/backends/gh-issues.ts:710`.

## Expected Behavior

Single-task operations should identify membership in the configured project regardless of how many other projects also contain the issue. The query should target the configured board directly or paginate project memberships until the board is found or membership is conclusively absent.

## Impact

Issues participating in many project boards can be listed through the configured project view yet become impossible to transition, move, or remove through the task-list backend. Users receive false not-found failures for valid tasks, blocking workflow state changes and cleanup in busy GitHub organizations.
