# Task list gh-issues update and comment mutate repository issues outside selected list

## Summary

The `gh-issues` backend represents one selected GitHub Project v2 board as a task list, but `update()` and `comment()` resolve only the repository issue ID and do not verify that the issue belongs to that configured project. As a result, `comment()` succeeds against off-list repository issues, while `update()` first modifies an off-list issue and only afterward rejects when its result-fetch notices that the issue is not a member of the selected board.

## Reproduction

From the repository root, run a disposable Vitest probe that configures `project-id` as the list but exposes issue `999` only in a different project:

```sh
cat > packages/task-list/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { ghIssuesBackend } from "./backends/gh-issues.js";
function response(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200 });
}
describe("gh-issues off-list repository mutations", () => {
  it("updates and comments on an existing issue outside the configured project", async () => {
    const operations: string[] = [];
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const query = JSON.parse(String(init?.body)).query as string;
      if (query.includes("query Project")) return response({ organization: { projectV2: { id: "project-id", field: { id: "status", options: [{ id: "todo", name: "Todo" }] } } } });
      if (query.includes("query IssueId")) { operations.push("issueId"); return response({ repository: { issue: { id: "issue-999" } } }); }
      if (query.includes("mutation UpdateIssue")) { operations.push("updateIssue"); return response({ updateIssue: { issue: { id: "issue-999" } } }); }
      if (query.includes("mutation AddComment")) { operations.push("addComment"); return response({ addComment: { commentEdge: { node: { id: "comment" } } } }); }
      if (query.includes("query Issue")) return response({ repository: { issue: {
        number: 999, title: "Renamed", body: "", url: "https://example.test/999", createdAt: "2026-01-01T00:00:00Z",
        labels: { nodes: [] }, assignees: { nodes: [] }, milestone: null,
        projectItems: { nodes: [{ id: "foreign-item", project: { id: "foreign-project" }, fieldValueByName: { name: "Todo" } }] },
      } } });
      throw new Error("unexpected query");
    });
    const taskList = await ghIssuesBackend({
      repo: "octo/repo", project: { owner: "octo-org", number: 7 }, defaults: { metadata: {} },
      token: "secret", endpoint: "https://github.example.test/api/graphql", fetch: fetchMock as unknown as typeof fetch,
    });
    const update = await taskList.list("octo-org/7").update("999", { name: "Renamed" }).then(
      () => ({ updated: true }), (error: Error) => ({ rejected: error.message }),
    );
    const comment = await taskList.list("octo-org/7").comment("999", "note").then(
      () => ({ commented: true }), (error: Error) => ({ rejected: error.message }),
    );
    console.log(JSON.stringify({ update, comment, operations }));
    expect(update).toEqual({ rejected: 'Task "octo-org/7/999" not found.' });
    expect(comment).toEqual({ commented: true });
    expect(operations).toEqual(["issueId", "updateIssue", "addComment"]);
  });
});
EOF
trap 'rm -f packages/task-list/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/task-list/src/__probe__.test.ts --reporter verbose
nl -ba packages/task-list/src/backends/gh-issues.ts | sed -n '528,585p;658,710p;840,871p'
```

## Observed Behavior

Even though issue `999` is present only in `foreign-project`, the backend submits both issue-level mutation operations. `update()` rejects only after the issue has already been renamed, and `comment()` resolves successfully:

```text
{"update":{"rejected":"Task \"octo-org/7/999\" not found."},"comment":{"commented":true},"operations":["issueId","updateIssue","addComment"]}
✓ packages/task-list/src/__probe__.test.ts > gh-issues off-list repository mutations > updates and comments on an existing issue outside the configured project
```

`update()` and `comment()` call `resolveIssueId()` and issue repository-level mutations in `packages/task-list/src/backends/gh-issues.ts:528` through `packages/task-list/src/backends/gh-issues.ts:585` and `packages/task-list/src/backends/gh-issues.ts:658` through `packages/task-list/src/backends/gh-issues.ts:681`. Unlike `fire()`, `delete()`, and `move()`, they do not call `resolveProjectItemId()` before mutation. After updating, `update()` calls `fetchIssueTask()`, which then rejects off-list membership in `packages/task-list/src/backends/gh-issues.ts:840` through `packages/task-list/src/backends/gh-issues.ts:871`; `comment()` performs no post-mutation membership check at all.

## Expected Behavior

Operations through a selected task-list view should mutate only issues that are members of that configured project list. The backend should verify project membership before submitting either issue updates or comments, and must never apply a mutation before returning a not-found error for the selected list.

## Impact

A mistyped issue ID or repository issue that is intentionally outside the workflow board can be renamed or commented on through the task-list API. Worse, `update()` reports failure after causing the side effect, encouraging retries and duplicate or unintended edits while callers reasonably believe no selected-list task was mutated.
