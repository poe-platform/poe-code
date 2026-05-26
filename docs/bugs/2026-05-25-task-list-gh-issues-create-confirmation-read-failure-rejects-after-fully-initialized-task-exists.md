# Task List Gh Issues Create Confirmation Read Failure Rejects After Fully Initialized Task Exists

## Summary

The `gh-issues` task-list backend publishes a new GitHub issue, attaches it to the configured Project v2 board, and assigns its initial Status before making a final confirmation read through `fetchIssueTask()`. If that read fails, `create()` rejects even though a fully initialized task already exists remotely, and the caller receives no created task identity to recover or deduplicate a retry.

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

describe("ghIssuesBackend create confirmation read failure probe", () => {
  it("rejects after issue creation, attachment, and initial status succeeded", async () => {
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
      graphqlResponse({ repository: { id: "repo-node" } }),
      graphqlResponse({ createIssue: { issue: { id: "issue-node-482", number: 482 } } }),
      graphqlResponse({ addProjectV2ItemById: { item: { id: "item-482" } } }),
      graphqlResponse({ updateProjectV2ItemFieldValue: { projectV2Item: { id: "item-482" } } }),
      new Response(JSON.stringify({ errors: [{ message: "confirmation read failed" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").create({ name: "Created" })).rejects.toThrow(
      "confirmation read failed"
    );
    expect(fetchMock).toHaveBeenCalledTimes(6);
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

The probe passes, confirming that the sixth GraphQL operation is attempted only after successful issue creation, project attachment, and initial Status assignment. Remove the disposable probe afterward.

## Observed Behavior

`create({ name: "Created" })` rejects with `confirmation read failed` after the mocked sequence has already returned successful `createIssue`, `addProjectV2ItemById`, and `updateProjectV2ItemFieldValue` mutations. No rollback occurs, so issue `482` remains attached to the board with the initialized `Todo` state even though the create call reports failure and does not return its task identifier.

## Expected Behavior

Once creation and initialization have succeeded, a failed confirmation read should not be surfaced as an indistinguishable failed create. The backend should either return the already known created task identity with an explicit read-refresh warning, provide a recoverable partial-success result, or otherwise make retries safe from duplicating the fully initialized task.

## Impact

Transient GitHub query failures after successful mutations cause callers to retry a task that already exists and is usable on the project board. Automation can create duplicate issues and duplicate initialized project items because the rejected operation hides the GitHub-assigned issue number and provides no durable success signal for reconciliation.
