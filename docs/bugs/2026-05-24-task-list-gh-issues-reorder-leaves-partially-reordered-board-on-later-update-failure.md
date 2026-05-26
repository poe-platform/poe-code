# Task list gh-issues reorder leaves partially reordered board on later update failure

## Summary

The `gh-issues` backend implements `Tasks.reorder(ids)` by issuing one `updateProjectV2ItemPosition` mutation per task in the requested order. If a later remote position update fails after earlier updates have succeeded, `reorder()` rejects without restoring the prior order or returning the partially applied result. The configured GitHub Project board is therefore left partially reordered after an operation reported as failed.

## Reproduction

From the repository root, run a disposable Vitest probe with two existing project items where the first position mutation succeeds and the second returns a GraphQL error:

```sh
cat > packages/task-list/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { ghIssuesBackend } from "./backends/gh-issues.js";
function response(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200 });
}
describe("gh-issues reorder partial updates", () => {
  it("moves the first item before a later position mutation fails", async () => {
    let positionCall = 0;
    const operations: string[] = [];
    const projectItems = ["1", "2"].map((id) => ({
      id: `item-${id}`,
      content: { __typename: "Issue", number: Number(id), title: `Task ${id}`, body: "", url: `https://example.test/${id}`, createdAt: "2026-01-01T00:00:00Z", labels: { nodes: [] }, assignees: { nodes: [] }, milestone: null },
      fieldValueByName: { name: "Todo" },
    }));
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const query = JSON.parse(String(init?.body)).query as string;
      if (query.includes("query Project")) return response({ organization: { projectV2: { id: "project-id", field: { id: "status", options: [{ id: "todo", name: "Todo" }] } } } });
      if (query.includes("query Items")) return response({ node: { items: { nodes: projectItems, pageInfo: { hasNextPage: false, endCursor: null } } } });
      if (query.includes("mutation UpdateProjectItemPosition")) {
        positionCall += 1;
        operations.push(`move-${positionCall}`);
        if (positionCall === 2) return new Response(JSON.stringify({ errors: [{ message: "position rejected" }] }), { status: 200 });
        return response({ updateProjectV2ItemPosition: { clientMutationId: null } });
      }
      throw new Error("unexpected query");
    });
    const taskList = await ghIssuesBackend({
      repo: "octo/repo", project: { owner: "octo-org", number: 7 }, defaults: { metadata: {} },
      token: "secret", endpoint: "https://github.example.test/api/graphql", fetch: fetchMock as unknown as typeof fetch,
    });
    const outcome = await taskList.list("octo-org/7").reorder(["2", "1"]).then(
      () => ({ reordered: true }), (error: Error) => ({ rejected: error.message }),
    );
    console.log(JSON.stringify({ outcome, operations }));
    expect(outcome).toEqual({ rejected: "position rejected" });
    expect(operations).toEqual(["move-1", "move-2"]);
  });
});
EOF
trap 'rm -f packages/task-list/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/task-list/src/__probe__.test.ts --reporter verbose
nl -ba packages/task-list/src/backends/gh-issues.ts | sed -n '594,634p;739,751p'
```

## Observed Behavior

The backend has already submitted and accepted the first position update before the second mutation fails and the public `reorder()` promise rejects:

```text
{"outcome":{"rejected":"position rejected"},"operations":["move-1","move-2"]}
✓ packages/task-list/src/__probe__.test.ts > gh-issues reorder partial updates > moves the first item before a later position mutation fails
```

`reorder()` validates the ID set, then iterates the requested sequence and awaits a separate `updateProjectItemPosition()` call for each item in `packages/task-list/src/backends/gh-issues.ts:594` through `packages/task-list/src/backends/gh-issues.ts:634`. Each helper invocation directly sends its mutation in `packages/task-list/src/backends/gh-issues.ts:739` through `packages/task-list/src/backends/gh-issues.ts:751`; no transaction, rollback, or partial-result reporting exists when a later update rejects.

## Expected Behavior

A failed reordering operation should not silently leave a board in a partially changed sequence. The backend should provide atomic/recoverable reordering semantics, compensate earlier changes on failure, or return an explicit partial-application result that allows callers to reconcile state.

## Impact

Network interruptions, permissions failures, or GitHub mutation errors during multi-item reorder can leave the task board in an unintended intermediate order while callers receive only a failure. Retrying from stale assumptions can compound ordering changes and disrupt workflow prioritization or automated task selection.
