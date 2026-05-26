# Task List Gh Issues Move Confirmation Read Failure Rejects After Reordering Item

## Summary

The `gh-issues` task-list backend updates a GitHub Project v2 item's position and then rereads the issue through `fetchIssueTask()` to return the moved task. If that final read fails, `move()` rejects after the board order has already changed, leaving callers with a failed move result for a remotely committed reorder.

## Reproduction

Create a disposable probe at `packages/task-list/src/backends/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ghIssuesBackend, type GhIssuesBackendDeps } from "./gh-issues.js";

const DEFAULT_DEPS = {
  repo: "octo/repo",
  project: { owner: "octo-org", number: 7 },
  defaults: { metadata: {} },
  token: "secret",
  endpoint: "https://github.example.test/api/graphql"
} satisfies Omit<GhIssuesBackendDeps, "fetch">;

describe("ghIssuesBackend move confirmation read failure probe", () => {
  it("rejects after persisting a project-item position update", async () => {
    const fetchMock = createFetchMock([
      graphqlResponse({
        organization: {
          projectV2: {
            id: "project-id",
            title: "Roadmap",
            field: { id: "status-field", options: [{ id: "status-todo", name: "Todo" }] }
          }
        },
        user: null
      }),
      graphqlResponse({
        repository: {
          issue: {
            id: "issue-node-482",
            projectItems: { nodes: [{ id: "item-482", project: { id: "project-id" } }] }
          }
        }
      }),
      graphqlResponse({ updateProjectV2ItemPosition: { items: { totalCount: 3 } } }),
      new Response(JSON.stringify({ errors: [{ message: "move confirmation failed" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").move("482", { position: "top" })).rejects.toThrow(
      "move confirmation failed"
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

function createFetchMock(responses: Response[]): typeof fetch {
  return vi.fn(async () => {
    const response = responses.shift();
    if (response === undefined) {
      throw new Error("Unexpected fetch call.");
    }
    return response;
  }) as unknown as typeof fetch;
}

function graphqlResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
```

Run:

```sh
npm exec -- vitest run packages/task-list/src/backends/__probe__.test.ts --reporter verbose
```

The probe passes, proving that `updateProjectV2ItemPosition` succeeds before the fourth GraphQL request fails while refreshing the returned task. Remove the disposable probe afterward.

## Observed Behavior

`move("482", { position: "top" })` rejects with `move confirmation failed` after the successful project-item position mutation has placed `item-482` at the board's top. No rollback is attempted, so the visible ordering is modified despite the rejected API result.

## Expected Behavior

Once a reorder mutation succeeds, a subsequent readback failure should not be represented as an ordinary failed move without exposing the committed outcome. The backend should return a recoverable committed-result state, avoid requiring a post-write read to signal success, or otherwise make retry behavior safe.

## Impact

Transient GitHub read failures can make drag-and-drop or automation clients retry moves that have already executed. Repeated retries can reorder items unpredictably relative to concurrent board edits, while callers cannot tell whether the requested ordering change committed without issuing separate reconciliation reads.
