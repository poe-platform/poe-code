# Task list gh-issues create leaves orphan issue when project attachment fails

## Summary

The `gh-issues` backend implements `Tasks.create()` by first creating a new GitHub issue, then attaching that issue to the configured Project v2 board, then setting its initial status. If project-item attachment fails or returns no item identifier, `create()` rejects after the repository issue has already been created, with no rollback or recoverable result exposing the orphan issue.

## Reproduction

From the repository root, run a disposable Vitest probe that makes issue creation succeed but makes the subsequent project attachment return no created item:

```sh
cat > packages/task-list/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { ghIssuesBackend } from "./backends/gh-issues.js";
function response(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200 });
}
describe("gh-issues partial task creation", () => {
  it("creates an issue before project attachment failure rejects the task", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const query = JSON.parse(String(init?.body)).query as string;
      calls.push(query.includes("CreateIssue") ? "createIssue" : query.includes("AddProjectItem") ? "addProjectItem" : query.includes("Repository") ? "repository" : "project");
      if (query.includes("query Project")) return response({ organization: { projectV2: { id: "project-id", field: { id: "status", options: [{ id: "todo", name: "Todo" }] } } } });
      if (query.includes("query Repository")) return response({ repository: { id: "repo-id" } });
      if (query.includes("mutation CreateIssue")) return response({ createIssue: { issue: { id: "new-issue", number: 123 } } });
      if (query.includes("mutation AddProjectItem")) return response({ addProjectV2ItemById: { item: null } });
      throw new Error("unexpected query");
    });
    const taskList = await ghIssuesBackend({
      repo: "octo/repo", project: { owner: "octo-org", number: 7 }, defaults: { metadata: {} },
      token: "secret", endpoint: "https://github.example.test/api/graphql", fetch: fetchMock as unknown as typeof fetch,
    });
    const outcome = await taskList.list("octo-org/7").create({ name: "New task" }).then(
      () => ({ created: true }),
      (error: Error) => ({ rejected: error.message }),
    );
    console.log(JSON.stringify({ outcome, calls }));
    expect(outcome).toEqual({ rejected: "GitHub addProjectV2ItemById response did not include project item id." });
    expect(calls).toEqual(["project", "repository", "createIssue", "addProjectItem"]);
  });
});
EOF
trap 'rm -f packages/task-list/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/task-list/src/__probe__.test.ts --reporter verbose
nl -ba packages/task-list/src/backends/gh-issues.ts | sed -n '494,527p'
```

## Observed Behavior

The issue mutation succeeds before the project-item mutation fails, but `create()` returns only a rejection rather than a created task or a compensated deletion:

```text
{"outcome":{"rejected":"GitHub addProjectV2ItemById response did not include project item id."},"calls":["project","repository","createIssue","addProjectItem"]}
✓ packages/task-list/src/__probe__.test.ts > gh-issues partial task creation > creates an issue before project attachment failure rejects the task
```

`Tasks.create()` submits `CREATE_ISSUE_MUTATION`, caches the new issue identifier, then submits `ADD_PROJECT_ITEM_MUTATION` and throws if no project-item ID is returned in `packages/task-list/src/backends/gh-issues.ts:494` through `packages/task-list/src/backends/gh-issues.ts:527`. There is no compensating issue deletion or partial-success result after issue creation has already completed.

## Expected Behavior

Task creation should not leave an invisible repository issue when adding it to the configured task board fails. The operation should compensate for the created issue, or return a structured partial-failure result identifying the created issue so callers can recover deterministically.

## Impact

Transient GitHub Project failures or permissions mismatches can make a failed task creation silently leave repository issues that are absent from the configured task list. Retries may create duplicates, projects accumulate orphan work items, and users cannot identify the side effect from the rejected `create()` result alone.
