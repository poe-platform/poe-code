# Task List Gh Issues Fire Confirmation Read Failure Rejects After Status Transition

## Summary

The `gh-issues` task-list backend writes a requested GitHub Project v2 Status transition and only then rereads the issue through `fetchIssueTask()` to construct its result. If that confirmation read fails, `fire()` rejects after the destination Status has already been persisted remotely, so callers observe a failed transition even though the task has advanced.

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

describe("ghIssuesBackend fire confirmation read failure probe", () => {
  it("rejects after persisting the destination Status", async () => {
    const fetchMock = createFetchMock([
      graphqlResponse({
        organization: {
          projectV2: {
            id: "project-id",
            title: "Roadmap",
            field: {
              id: "status-field",
              options: [
                { id: "status-todo", name: "Todo" },
                { id: "status-done", name: "Done" }
              ]
            }
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
      graphqlResponse({ updateProjectV2ItemFieldValue: { projectV2Item: { id: "item-482" } } }),
      new Response(JSON.stringify({ errors: [{ message: "transition confirmation failed" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").fire("482", "Done")).rejects.toThrow(
      "transition confirmation failed"
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

The probe passes, showing that the fourth GraphQL request fails only after `updateProjectV2ItemFieldValue` has successfully written the `Done` Status. Remove the disposable probe afterward.

## Observed Behavior

`fire("482", "Done")` rejects with `transition confirmation failed` after a successful Status mutation for item `item-482`. The backend makes no attempt to restore the prior Status, so the remote project item remains transitioned to `Done` while the public transition promise reports failure.

## Expected Behavior

A confirmed Status write should not become an indistinguishable failed transition merely because the follow-up result read fails. The backend should return a committed/refresh-failed outcome, safely construct the known transitioned result, or otherwise expose enough success state for callers to avoid incorrectly retrying the transition.

## Impact

Workflow runners can retry or escalate a transition they believe did not occur even though GitHub already records the destination state. This creates contradictory local and remote state, may trigger invalid later transitions or duplicate downstream behavior, and forces callers to manually reconcile every rejected `fire()` call.
