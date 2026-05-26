# Task List Gh Issues Create Status Failure Leaves Attached Item Without Initial State

## Summary

The `gh-issues` task-list backend creates a repository issue, attaches it to the selected GitHub Project v2 board, and only then writes the initial Status field. If that final Status mutation fails, `create()` rejects after leaving both the issue and its project item created without the backend's required initial task state.

## Reproduction

Create a disposable probe at `packages/task-list/src/backends/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ghIssuesBackend } from "./gh-issues.js";
import { createFetchMock, graphqlResponse } from "./test-helpers.js";

describe("gh-issues create status assignment failure probe", () => {
  it("rejects after creating and attaching the issue when initial Status write fails", async () => {
    const fetchMock = createFetchMock([
      graphqlResponse({
        organization: {
          projectV2: {
            id: "project-7",
            title: "Project",
            field: { id: "status-field", options: [{ id: "status-todo", name: "Todo" }] }
          }
        },
        user: null
      }),
      graphqlResponse({ repository: { id: "repo-id" } }),
      graphqlResponse({ createIssue: { issue: { id: "issue-node-482", number: 482 } } }),
      graphqlResponse({ addProjectV2ItemById: { item: { id: "item-482" } } }),
      new Response(JSON.stringify({ errors: [{ message: "status write failed" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ]);
    const taskList = await ghIssuesBackend({
      repo: "octo/repo",
      project: { owner: "octo-org", number: 7 },
      defaults: { metadata: {} },
      token: "secret",
      endpoint: "https://github.example.test/api/graphql",
      fetch: fetchMock
    });

    await expect(
      taskList.list("octo-org/7").create({ id: "ignored", name: "Created" })
    ).rejects.toThrow("status write failed");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/task-list/src/backends/__probe__.test.ts --reporter verbose
```

The probe passes, showing that the backend reaches the fifth GraphQL operation—the failed initial Status assignment—after the issue and project item have been created. Remove the disposable probe afterward.

## Observed Behavior

`create({ name: "Created" })` rejects with `status write failed` after the mocked sequence has already returned successful `createIssue` and `addProjectV2ItemById` mutations. The new item is therefore attached to the selected Project board, but assignment of the initial `Todo` Status has failed and no rollback is attempted.

## Expected Behavior

Creating a GitHub-backed task should either publish a fully initialized project item with its required initial Status, roll back the newly attached item and issue when initialization fails, or return a recoverable partial-result description. A rejected create should not leave an attached but uninitialized board item behind.

## Impact

Transient GitHub mutation failures can leave visible project-board entries that the task backend could not successfully initialize or return to the caller. Users may see items with blank or inconsistent workflow status, while retries create duplicate issues/items because the first rejected operation exposed no successful task identity for recovery.
