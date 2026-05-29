import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFetchMock,
  createFs,
  flushMicrotasks,
  graphqlResponse
} from "./backends/test-helpers.js";
import { moveTasks, openTaskList, type MoveProgressEvent } from "./index.js";
import { TaskNotFoundError } from "./types.js";

function markdownOptions(path: string, fs: ReturnType<typeof createFs>["fs"]) {
  return { type: "markdown-dir" as const, path, create: true, fs };
}

async function createPlannedTask(path: string, fs: ReturnType<typeof createFs>["fs"], id: string) {
  const taskList = await openTaskList(markdownOptions(path, fs));
  const tasks = taskList.list("planning");
  await tasks.create({ id, name: id, description: `${id} description`, metadata: { source: id } });
  await tasks.fire(id, "plan");
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("moveTasks", () => {
  it("moves markdown tasks with mapped state and reports dry runs without writing", async () => {
    const { fs, rawFs } = createFs();
    await createPlannedTask("/source", fs, "mapped");
    const events: MoveProgressEvent[] = [];

    await expect(
      moveTasks({
        source: markdownOptions("/source", fs),
        target: markdownOptions("/target", fs),
        stateMap: { planned: "done" },
        onProgress: (event) => events.push(event)
      })
    ).resolves.toEqual({ created: 1, skipped: 0, errors: [] });

    const target = await openTaskList(markdownOptions("/target", fs));
    await expect(target.list("planning").get("mapped")).resolves.toMatchObject({
      name: "mapped",
      description: "mapped description",
      metadata: { source: "mapped" },
      state: "done"
    });
    expect(events.map((event) => event.type)).toEqual(["created"]);

    await createPlannedTask("/dry-source", fs, "dry");
    const dryEvents: MoveProgressEvent[] = [];
    await expect(
      moveTasks({
        source: markdownOptions("/dry-source", fs),
        target: markdownOptions("/dry-target", fs),
        dryRun: true,
        stateMap: { planned: "done" },
        onProgress: (event) => dryEvents.push(event)
      })
    ).resolves.toEqual({ created: 0, skipped: 1, errors: [] });
    expect(dryEvents).toEqual([
      expect.objectContaining({
        type: "skipped",
        id: "dry",
        targetList: "planning",
        targetState: "done"
      })
    ]);
    await expect(rawFs.stat("/dry-target")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses the target initial state when unmapped and honors limit", async () => {
    const { fs } = createFs();
    await createPlannedTask("/source", fs, "one");
    await createPlannedTask("/source", fs, "two");

    await expect(
      moveTasks({
        source: markdownOptions("/source", fs),
        target: markdownOptions("/target", fs),
        limit: 1
      })
    ).resolves.toEqual({ created: 1, skipped: 0, errors: [] });

    const targetTasks = (await openTaskList(markdownOptions("/target", fs))).list("planning");
    const migrated = await targetTasks.all();
    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toMatchObject({ state: "draft" });
  });

  it("does not initialize the target when the limit moves no tasks", async () => {
    const { fs, rawFs } = createFs();
    await createPlannedTask("/source", fs, "not-selected");

    await expect(
      moveTasks({
        source: markdownOptions("/source", fs),
        target: markdownOptions("/target", fs),
        limit: 0
      })
    ).resolves.toEqual({ created: 0, skipped: 0, errors: [] });

    await expect(rawFs.stat("/target")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not initialize a missing source while trying to read it", async () => {
    const { fs, rawFs } = createFs();

    await expect(
      moveTasks({
        source: markdownOptions("/missing-source", fs),
        target: markdownOptions("/target", fs)
      })
    ).rejects.toThrow();

    await expect(rawFs.stat("/missing-source")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(rawFs.stat("/target")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects invalid migration controls before moving tasks", async () => {
    const { fs } = createFs();
    await createPlannedTask("/source", fs, "invalid-options");

    await expect(
      moveTasks({
        source: markdownOptions("/source", fs),
        target: markdownOptions("/target", fs),
        rate: 0
      })
    ).rejects.toThrow("rate must be a positive number");
    await expect(
      moveTasks({
        source: markdownOptions("/source", fs),
        target: markdownOptions("/target", fs),
        limit: -1
      })
    ).rejects.toThrow("limit must be a non-negative integer");

    await expect(openTaskList({ type: "markdown-dir", path: "/target", fs })).rejects.toThrow();
  });

  it("creates gh-issues tasks using label-backed mapped state", async () => {
    const { fs } = createFs();
    await createPlannedTask("/source", fs, "to-github");
    const fetchMock = createFetchMock([
      projectResponse(),
      graphqlResponse({ repository: { id: "repo-node" } }),
      graphqlResponse({ createIssue: { issue: { id: "issue-node-573", number: 573 } } }),
      graphqlResponse({ addProjectV2ItemById: { item: { id: "item-573" } } }),
      graphqlResponse({ repository: { label: { id: "label-todo" } } }),
      graphqlResponse({ addLabelsToLabelable: { clientMutationId: null } }),
      issueResponse(["status:Todo"]),
      issueResponse(["status:Todo"]),
      issueStateResponse([{ id: "label-todo", name: "status:Todo" }]),
      graphqlResponse({ repository: { label: { id: "label-done" } } }),
      graphqlResponse({ addLabelsToLabelable: { clientMutationId: null } }),
      graphqlResponse({ removeLabelsFromLabelable: { clientMutationId: null } }),
      issueResponse(["status:Done"])
    ]);

    await expect(
      moveTasks({
        source: markdownOptions("/source", fs),
        target: {
          type: "gh-issues",
          repo: "octo/repo",
          project: { owner: "octo-org", number: 7 },
          state: { labelPrefix: "status:" },
          auth: { token: "secret" },
          fetch: fetchMock
        },
        stateMap: { planned: "Done" }
      })
    ).resolves.toEqual({ created: 1, skipped: 0, errors: [] });

    const requests = vi
      .mocked(fetchMock)
      .mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as { query: string });
    expect(requests.some((request) => request.query.includes("mutation AddLabels"))).toBe(true);
    expect(requests.some((request) => request.query.includes("mutation RemoveLabels"))).toBe(true);
  });

  it("throttles creations using a token bucket", async () => {
    vi.useFakeTimers();
    const { fs } = createFs();
    await createPlannedTask("/source", fs, "one");
    await createPlannedTask("/source", fs, "two");
    await createPlannedTask("/source", fs, "three");
    const target = await openTaskList(markdownOptions("/target", fs));

    const moving = moveTasks({
      source: markdownOptions("/source", fs),
      target: markdownOptions("/target", fs),
      rate: 2
    });
    for (let attempt = 0; attempt < 20 && (await target.allTasks()).length < 2; attempt += 1) {
      await flushMicrotasks();
    }
    await expect(target.allTasks()).resolves.toHaveLength(2);
    await vi.advanceTimersByTimeAsync(29_999);
    await expect(target.allTasks()).resolves.toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(moving).resolves.toEqual({ created: 3, skipped: 0, errors: [] });
    await expect(target.allTasks()).resolves.toHaveLength(3);
  });

  it("keeps failed source tasks and continues deleting successful moves", async () => {
    const { fs } = createFs();
    await createPlannedTask("/source", fs, "fails");
    await createPlannedTask("/source", fs, "passes");
    const target = await openTaskList(markdownOptions("/target", fs));
    await target.list("planning").create({ id: "fails", name: "Already exists" });

    await expect(
      moveTasks({
        source: markdownOptions("/source", fs),
        target: markdownOptions("/target", fs),
        deleteSource: true
      })
    ).resolves.toMatchObject({
      created: 1,
      skipped: 0,
      errors: [{ id: "fails", error: expect.any(String) }]
    });

    const source = await openTaskList(markdownOptions("/source", fs));
    await expect(source.list("planning").get("fails")).resolves.toMatchObject({ id: "fails" });
    await expect(source.list("planning").get("passes")).rejects.toBeInstanceOf(TaskNotFoundError);
    await expect(target.list("planning").get("passes")).resolves.toMatchObject({ id: "passes" });
  });

  it("rolls back the target when deleting the source fails", async () => {
    const { fs } = createFs();
    await createPlannedTask("/source", fs, "delete-fails");
    const sourceFs = {
      ...fs,
      unlink: vi.fn(async () => {
        throw new Error("source delete failed");
      })
    };

    await expect(
      moveTasks({
        source: markdownOptions("/source", sourceFs),
        target: markdownOptions("/target", fs),
        deleteSource: true
      })
    ).resolves.toMatchObject({
      created: 0,
      skipped: 0,
      errors: [{ id: "delete-fails", error: "source delete failed" }]
    });

    const source = await openTaskList(markdownOptions("/source", fs));
    const target = await openTaskList(markdownOptions("/target", fs));
    await expect(source.list("planning").get("delete-fails")).resolves.toMatchObject({
      id: "delete-fails"
    });
    await expect(target.list("planning").get("delete-fails")).rejects.toBeInstanceOf(
      TaskNotFoundError
    );
  });

  it("does not let progress callback failures undo completed moves", async () => {
    const { fs } = createFs();
    await createPlannedTask("/source", fs, "observer-fails");

    await expect(
      moveTasks({
        source: markdownOptions("/source", fs),
        target: markdownOptions("/target", fs),
        deleteSource: true,
        onProgress: () => {
          throw new Error("observer failed");
        }
      })
    ).resolves.toEqual({ created: 1, skipped: 0, errors: [] });

    const source = await openTaskList(markdownOptions("/source", fs));
    const target = await openTaskList(markdownOptions("/target", fs));
    await expect(source.list("planning").get("observer-fails")).rejects.toBeInstanceOf(
      TaskNotFoundError
    );
    await expect(target.list("planning").get("observer-fails")).resolves.toMatchObject({
      id: "observer-fails"
    });
  });

  it("fires no transitions when source state already matches the target initial in a from-* state machine", async () => {
    const { fs } = createFs();
    const sourceTaskList = await openTaskList(markdownOptions("/source", fs));
    await sourceTaskList
      .list("planning")
      .create({ id: "stable", name: "stable", description: "stable body" });

    // Label-backed gh-issues target whose state machine has only from:"*" events.
    // Every state can be reached from any other state via a single event — the
    // pattern produced by createAnyToAnyStateMachine in the workflow loader.
    const targetStateMachine = {
      initial: "draft",
      states: ["draft", "confirmed"],
      events: {
        draft: { from: "*" as const, to: "draft" },
        confirmed: { from: "*" as const, to: "confirmed" }
      }
    };

    // Only the responses needed for the happy path: repo id → create → resolve
    // status:draft → add label → fetch back. If the bug returns and a spurious
    // "status:confirmed" fire happens, fetchMock runs out and throws.
    const fetchMock = createFetchMock([
      graphqlResponse({ repository: { id: "repo-node" } }),
      graphqlResponse({ createIssue: { issue: { id: "issue-node-1", number: 1 } } }),
      graphqlResponse({ repository: { label: { id: "label-draft" } } }),
      graphqlResponse({ addLabelsToLabelable: { clientMutationId: null } }),
      repositoryIssueResponse(["status:draft"])
    ]);

    await expect(
      moveTasks({
        source: markdownOptions("/source", fs),
        target: {
          type: "gh-issues",
          repo: "octo/repo",
          state: { labelPrefix: "status:" },
          stateMachine: targetStateMachine,
          auth: { token: "secret" },
          fetch: fetchMock
        }
      })
    ).resolves.toEqual({ created: 1, skipped: 0, errors: [] });

    const labelLookups = vi
      .mocked(fetchMock)
      .mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as { variables?: { name?: string } })
      .filter((req) => typeof req.variables?.name === "string")
      .map((req) => req.variables!.name);
    expect(labelLookups).toEqual(["status:draft"]);
  });

  it("rolls back a created target when mapped state cannot be applied", async () => {
    const { fs } = createFs();
    await createPlannedTask("/source", fs, "bad-state");

    await expect(
      moveTasks({
        source: markdownOptions("/source", fs),
        target: markdownOptions("/target", fs),
        deleteSource: true,
        stateMap: { planned: "missing" }
      })
    ).resolves.toMatchObject({
      created: 0,
      errors: [{ id: "bad-state", error: expect.any(String) }]
    });

    const source = await openTaskList(markdownOptions("/source", fs));
    const target = await openTaskList(markdownOptions("/target", fs));
    await expect(source.list("planning").get("bad-state")).resolves.toMatchObject({
      id: "bad-state"
    });
    await expect(target.list("planning").get("bad-state")).rejects.toBeInstanceOf(
      TaskNotFoundError
    );
  });
});

function projectResponse(): Response {
  return graphqlResponse({
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
  });
}

function issueResponse(labels: string[]): Response {
  return graphqlResponse({
    repository: {
      issue: {
        __typename: "Issue",
        id: "issue-node-573",
        number: 573,
        title: "to-github",
        body: "to-github description",
        url: "https://example.test/issues/573",
        createdAt: "2026-05-26T00:00:00Z",
        labels: { nodes: labels.map((name) => ({ name })) },
        assignees: { nodes: [] },
        milestone: null,
        projectItems: {
          nodes: [
            { id: "item-573", project: { id: "project-id" }, fieldValueByName: { name: "Todo" } }
          ]
        }
      }
    }
  });
}

function repositoryIssueResponse(labels: string[]): Response {
  return graphqlResponse({
    repository: {
      issue: {
        __typename: "Issue",
        id: "issue-node-1",
        number: 1,
        title: "stable",
        body: "stable body",
        url: "https://example.test/issues/1",
        createdAt: "2026-05-26T00:00:00Z",
        labels: { nodes: labels.map((name) => ({ name })) },
        assignees: { nodes: [] },
        milestone: null
      }
    }
  });
}

function issueStateResponse(labels: Array<{ id: string; name: string }>): Response {
  return graphqlResponse({
    repository: {
      issue: {
        id: "issue-node-573",
        labels: { nodes: labels },
        projectItems: { nodes: [{ id: "item-573", project: { id: "project-id" } }] }
      }
    }
  });
}
