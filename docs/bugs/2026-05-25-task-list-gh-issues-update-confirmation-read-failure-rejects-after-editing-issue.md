# Task List Gh Issues Update Confirmation Read Failure Rejects After Editing Issue

## Summary

The `gh-issues` task-list backend updates a GitHub issue's title or body and then rereads the task through `fetchIssueTask()` to return its updated representation. If that confirmation read fails for an otherwise valid board task, `update()` rejects after the issue edit is already committed, so the caller cannot distinguish an unapplied edit from a completed edit with a failed refresh.

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

describe("ghIssuesBackend update confirmation read failure probe", () => {
  it("rejects after successfully editing an on-list issue", async () => {
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
      graphqlResponse({ repository: { issue: { id: "issue-node-482" } } }),
      graphqlResponse({ updateIssue: { issue: { id: "issue-node-482" } } }),
      new Response(JSON.stringify({ errors: [{ message: "updated task refresh failed" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").update("482", { name: "Renamed" })).rejects.toThrow(
      "updated task refresh failed"
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

The probe passes, showing that the `updateIssue` mutation succeeds before the fourth GraphQL request rejects during task refresh. Remove the disposable probe afterward.

## Observed Behavior

`update("482", { name: "Renamed" })` rejects with `updated task refresh failed` after GitHub has already accepted the `updateIssue` mutation for `issue-node-482`. The new issue title remains remotely committed, but the caller receives no updated task object or committed-result indication.

## Expected Behavior

An issue edit that has successfully persisted should not be reported as an ordinary failed update solely because a subsequent readback fails. The backend should surface a committed-but-unrefreshed result, construct an adequate returned task from known data, or otherwise give callers a safe way to reconcile without blindly retrying edits.

## Impact

Clients may retry apparently failed title or body updates even though GitHub already applied them, overwriting intervening user changes or producing misleading audit/activity noise. The API's rejection prevents automation from deciding whether recovery should retry the mutation or merely refresh the task view.
