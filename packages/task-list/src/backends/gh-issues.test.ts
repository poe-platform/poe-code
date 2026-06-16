import { describe, expect, it, vi } from "vitest";
import {
  AnchorNotFoundError,
  InvalidTransitionError,
  OrderMismatchError,
  TaskNotFoundError
} from "../types.js";
import { ghIssuesBackend, type GhIssuesBackendDeps } from "./gh-issues.js";

const DEFAULT_DEPS = {
  repo: "octo/repo",
  project: {
    owner: "octo-org",
    number: 7
  },
  defaults: {
    metadata: {}
  },
  token: "secret",
  endpoint: "https://github.example.test/api/graphql"
} satisfies Omit<GhIssuesBackendDeps, "fetch">;

describe("ghIssuesBackend", () => {
  it("reads repository issues through label-backed state without a project", async () => {
    const fetchMock = createFetchMock([
      repositoryIssuesResponse([
        issue({
          number: 482,
          title: "Label driven",
          labels: ["bug", "status:fix"]
        })
      ])
    ]);
    const taskList = await ghIssuesBackend({
      repo: "octo/repo",
      filter: "label:bug",
      state: { labelPrefix: "status:" },
      stateMachine: {
        initial: "draft",
        states: ["draft", "fix", "released"],
        events: {
          draft: { from: "*", to: "draft" },
          fix: { from: "*", to: "fix" },
          released: { from: "*", to: "released" }
        }
      },
      defaults: { metadata: {} },
      token: "test-token",
      endpoint: "https://api.github.test/graphql",
      fetch: fetchMock
    });

    await expect(taskList.lists()).resolves.toEqual(["octo/repo"]);
    await expect(taskList.allTasks()).resolves.toEqual([
      expect.objectContaining({
        qualifiedId: "octo/repo#482",
        state: "fix"
      })
    ]);
    expect(readGraphqlCall(fetchMock, 0)).toEqual(
      expect.objectContaining({ variables: expect.objectContaining({ labels: ["bug"] }) })
    );
  });

  it("writes repository-only label-backed transitions without a project", async () => {
    const fetchMock = createFetchMock([
      issueResponse({ number: 482, title: "Label driven", labels: ["status:draft"] }),
      issueResponse({
        number: 482,
        title: "Label driven",
        labels: ["status:draft"],
        labelIds: ["label-draft"]
      }),
      repositoryLabelResponse("label-fix"),
      addLabelsResponse(),
      removeLabelsResponse(),
      issueResponse({ number: 482, title: "Label driven", labels: ["status:fix"] })
    ]);
    const taskList = await ghIssuesBackend({
      repo: "octo/repo",
      state: { labelPrefix: "status:" },
      stateMachine: {
        initial: "draft",
        states: ["draft", "fix", "released"],
        events: {
          draft: { from: "*", to: "draft" },
          fix: { from: "*", to: "fix" },
          released: { from: "*", to: "released" }
        }
      },
      defaults: { metadata: {} },
      token: "test-token",
      endpoint: "https://api.github.test/graphql",
      fetch: fetchMock
    });

    await expect(taskList.list("octo/repo").fire("482", "fix")).resolves.toMatchObject({
      state: "fix"
    });
    expect(readMutationCalls(fetchMock)).toEqual([
      expect.objectContaining({ query: expect.stringContaining("mutation AddLabels") }),
      expect.objectContaining({ query: expect.stringContaining("mutation RemoveLabels") })
    ]);
  });

  it("creates filtered label-backed issues without requesting project fields", async () => {
    const fetchMock = createFetchMock([
      repositoryResponse("repo-node"),
      repositoryLabelResponse("label-bug"),
      createIssueResponse({ issueId: "issue-node-573", number: 573 }),
      repositoryLabelResponse("label-draft"),
      addLabelsResponse(),
      issueResponse({
        number: 573,
        title: "Imported bug",
        labels: ["bug", "status:draft"]
      })
    ]);
    const taskList = await ghIssuesBackend({
      repo: "octo/repo",
      filter: "label:bug",
      state: { labelPrefix: "status:" },
      stateMachine: {
        initial: "draft",
        states: ["draft", "fix", "released"],
        events: {
          draft: { from: "*", to: "draft" },
          fix: { from: "*", to: "fix" },
          released: { from: "*", to: "released" }
        }
      },
      defaults: { metadata: {} },
      token: "test-token",
      endpoint: "https://api.github.test/graphql",
      fetch: fetchMock
    });

    await expect(
      taskList.list("octo/repo").create({ name: "Imported bug" })
    ).resolves.toMatchObject({
      id: "573",
      state: "draft",
      metadata: { labels: ["bug", "status:draft"] }
    });
    expect(readMutationCalls(fetchMock)).toEqual([
      expect.objectContaining({
        query: expect.stringContaining("mutation CreateIssue"),
        variables: {
          input: {
            repositoryId: "repo-node",
            title: "Imported bug",
            body: "",
            labelIds: ["label-bug"]
          }
        }
      }),
      expect.objectContaining({ query: expect.stringContaining("mutation AddLabels") })
    ]);
    expect(readGraphqlCalls(fetchMock).map((call) => JSON.stringify(call))).not.toEqual(
      expect.arrayContaining([expect.stringContaining("projectItems")])
    );
  });

  it("closes repository-only issues when rolling back label-backed creates", async () => {
    const fetchMock = createFetchMock([
      issueNodeIdResponse("issue-node-573"),
      updateIssueResponse()
    ]);
    const taskList = await ghIssuesBackend({
      repo: "octo/repo",
      state: { labelPrefix: "status:" },
      stateMachine: {
        initial: "draft",
        states: ["draft", "fix", "released"],
        events: {
          draft: { from: "*", to: "draft" },
          fix: { from: "*", to: "fix" },
          released: { from: "*", to: "released" }
        }
      },
      defaults: { metadata: {} },
      token: "test-token",
      endpoint: "https://api.github.test/graphql",
      fetch: fetchMock
    });

    await expect(taskList.list("octo/repo").delete("573")).resolves.toBeUndefined();
    expect(readMutationCalls(fetchMock)).toEqual([
      expect.objectContaining({
        query: expect.stringContaining("mutation UpdateIssue"),
        variables: { input: { id: "issue-node-573", state: "CLOSED" } }
      })
    ]);
  });

  it("fetches the project Status field and builds a state machine from display ordered options", async () => {
    const fetchMock = createFetchMock([
      projectResponse({
        organization: {
          projectV2: project({
            options: [
              { id: "status-todo", name: "Todo" },
              { id: "status-doing", name: "Doing" },
              { id: "status-done", name: "Done" }
            ]
          })
        },
        user: null
      })
    ]);

    const taskList = await ghIssuesBackend({
      ...DEFAULT_DEPS,
      fetch: fetchMock
    });

    expect(taskList.list("octo-org/7").stateMachine).toEqual({
      states: ["Todo", "Doing", "Done"],
      initial: "Todo",
      events: {
        Todo: { from: "*", to: "Todo" },
        Doing: { from: "*", to: "Doing" },
        Done: { from: "*", to: "Done" }
      }
    });
  });

  it("reads state from prefixed labels when label mode is configured", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({
        number: 482,
        title: "Label driven",
        status: "Todo",
        labels: ["status:Done"]
      })
    ]);
    const taskList = await ghIssuesBackend({
      ...DEFAULT_DEPS,
      state: { labelPrefix: "status:" },
      fetch: fetchMock
    });

    await expect(taskList.list("octo-org/7").get("482")).resolves.toMatchObject({
      state: "Done"
    });
  });

  it("uses the initial declared state when label mode has no state label", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({
        number: 482,
        title: "Unlabelled state",
        status: "Done",
        labels: ["backend"]
      })
    ]);
    const taskList = await ghIssuesBackend({
      ...DEFAULT_DEPS,
      state: { labelPrefix: "status:" },
      fetch: fetchMock
    });

    await expect(taskList.list("octo-org/7").get("482")).resolves.toMatchObject({
      state: "Todo"
    });
  });

  it("uses the first declared state when multiple prefixed labels are present", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({
        number: 482,
        title: "Conflicted labels",
        labels: ["status:Done", "status:Todo"]
      })
    ]);
    const taskList = await ghIssuesBackend({
      ...DEFAULT_DEPS,
      state: { labelPrefix: "status:" },
      fetch: fetchMock
    });

    await expect(taskList.list("octo-org/7").get("482")).resolves.toMatchObject({
      state: "Todo"
    });
  });

  it("rejects an empty labelPrefix instead of matching every issue label", async () => {
    await expect(
      ghIssuesBackend({
        ...DEFAULT_DEPS,
        state: { labelPrefix: "" },
        fetch: createFetchMock([projectResponse()])
      })
    ).rejects.toThrow("gh-issues state.labelPrefix must be a non-empty string when configured.");
  });

  it("throws when the project has no Status field", async () => {
    const fetchMock = createFetchMock([
      projectResponse({
        organization: {
          projectV2: project({
            field: null
          })
        },
        user: null
      })
    ]);

    await expect(
      ghIssuesBackend({
        ...DEFAULT_DEPS,
        fetch: fetchMock
      })
    ).rejects.toThrow("Project octo-org/7 has no Status field; gh-issues requires one.");
  });

  it("throws when Status is not a single-select field", async () => {
    const fetchMock = createFetchMock([
      projectResponse({
        organization: {
          projectV2: project({
            field: {}
          })
        },
        user: null
      })
    ]);

    await expect(
      ghIssuesBackend({
        ...DEFAULT_DEPS,
        fetch: fetchMock
      })
    ).rejects.toThrow("Project octo-org/7 has no Status field; gh-issues requires one.");
  });

  it("throws when the Status field has no options", async () => {
    const fetchMock = createFetchMock([
      projectResponse({
        organization: {
          projectV2: project({
            options: []
          })
        },
        user: null
      })
    ]);

    await expect(
      ghIssuesBackend({
        ...DEFAULT_DEPS,
        fetch: fetchMock
      })
    ).rejects.toThrow("Project octo-org/7 Status field has no options.");
  });

  it("throws when the project is not found", async () => {
    const fetchMock = createFetchMock([
      projectResponse({
        organization: null,
        user: null
      }),
      projectResponse({
        organization: null,
        user: null
      })
    ]);

    await expect(
      ghIssuesBackend({
        ...DEFAULT_DEPS,
        fetch: fetchMock
      })
    ).rejects.toThrow("Project octo-org/7 not found or inaccessible.");
  });

  it("falls back from organization to user for personal projects", async () => {
    const fetchMock = createFetchMock([
      projectResponse({
        organization: null,
        user: null
      }),
      projectResponse({
        organization: null,
        user: {
          projectV2: project({
            id: "user-project"
          })
        }
      })
    ]);

    const taskList = await ghIssuesBackend({
      ...DEFAULT_DEPS,
      fetch: fetchMock
    });

    expect(taskList.list("octo-org/7").stateMachine.initial).toBe("Todo");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not query the user project when the organization project is found", async () => {
    const fetchMock = createFetchMock([projectResponse()]);

    await ghIssuesBackend({
      ...DEFAULT_DEPS,
      fetch: fetchMock
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the single project name from lists", async () => {
    const taskList = await ghIssuesBackend({
      ...DEFAULT_DEPS,
      fetch: createFetchMock([projectResponse()])
    });

    await expect(taskList.lists()).resolves.toEqual(["octo-org/7"]);
  });

  it("throws when requesting any other list name", async () => {
    const taskList = await ghIssuesBackend({
      ...DEFAULT_DEPS,
      fetch: createFetchMock([projectResponse()])
    });

    expect(() => taskList.list("wrong-name")).toThrow(
      "gh-issues backend has a single list octo-org/7"
    );
  });

  it("delegates allTasks and get through the single project list", async () => {
    const taskList = await ghIssuesBackend({
      ...DEFAULT_DEPS,
      fetch: createFetchMock([
        projectResponse(),
        itemsResponse({
          nodes: [
            projectIssueItem({
              id: "item-482",
              issue: issue({
                number: 482,
                title: "Ship GitHub issue backend"
              }),
              status: "Todo"
            })
          ]
        }),
        issueResponse({
          number: 482,
          title: "Ship GitHub issue backend",
          status: "Todo"
        })
      ])
    });

    await expect(taskList.allTasks({ state: "Todo" }).then(ids)).resolves.toEqual(["482"]);
    const task = await taskList.get("octo-org/7#482");
    expect(task).toMatchObject({
      qualifiedId: "octo-org/7#482",
      name: "Ship GitHub issue backend"
    });
    expect(task.sourcePath).toBeUndefined();
  });

  it("loads the current task state for events and canFire", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({ number: 482, title: "Todo task", status: "Todo", projectItemId: "item-482" }),
      issueResponse({ number: 482, title: "Todo task", status: "Todo", projectItemId: "item-482" }),
      issueResponse({ number: 482, title: "Todo task", status: "Todo", projectItemId: "item-482" })
    ]);
    const taskList = await ghIssuesBackend({
      ...DEFAULT_DEPS,
      fetch: fetchMock
    });
    const tasks = taskList.list("octo-org/7");

    await expect(tasks.events("482")).resolves.toEqual(["Done"]);
    await expect(tasks.canFire("482", "Done")).resolves.toBe(true);
    await expect(tasks.canFire("482", "Todo")).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("freezes the derived state machine at open time", async () => {
    const taskList = await ghIssuesBackend({
      ...DEFAULT_DEPS,
      fetch: createFetchMock([projectResponse()])
    });
    const tasks = taskList.list("octo-org/7");

    expect(Object.isFrozen(tasks.stateMachine)).toBe(true);
    expect(Object.isFrozen(tasks.stateMachine.states)).toBe(true);
    expect(Object.isFrozen(tasks.stateMachine.events)).toBe(true);
    expect(Object.isFrozen(tasks.stateMachine.events.Todo)).toBe(true);
  });

  it("throws the single-list error when moving between lists", async () => {
    const taskList = await ghIssuesBackend({
      ...DEFAULT_DEPS,
      fetch: createFetchMock([projectResponse()])
    });

    await expect(taskList.moveBetweenLists("octo-org/7#123", "octo-org/7")).rejects.toThrow(
      "gh-issues backend has a single list octo-org/7"
    );
  });

  it("keeps the project GraphQL request wire shape stable", async () => {
    const fetchMock = createFetchMock([projectResponse()]);

    await ghIssuesBackend({
      ...DEFAULT_DEPS,
      fetch: fetchMock
    });

    expect(readGraphqlCall(fetchMock, 0)).toMatchSnapshot();
  });

  it("all returns project issue items in project view order", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      itemsResponse({
        nodes: projectItemsFixture()
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    const tasks = await taskList.list("octo-org/7").all();
    expect(tasks.map((task) => task.sourcePath)).toEqual([undefined, undefined, undefined]);
    expect(tasks).toEqual([
      {
        list: "octo-org/7",
        id: "482",
        qualifiedId: "octo-org/7#482",
        name: "Write backend",
        description: "Implement GitHub issues.",
        state: "In progress",
        metadata: {
          url: "https://github.example.test/octo/repo/issues/482",
          labels: ["backend", "task-list"],
          assignees: ["mona"],
          milestone: "v1",
          projectItemId: "item-482",
          created: "2026-01-03T00:00:00Z"
        }
      },
      {
        list: "octo-org/7",
        id: "17",
        qualifiedId: "octo-org/7#17",
        name: "Document workflow",
        description: "",
        state: "Todo",
        metadata: {
          url: "https://github.example.test/octo/repo/issues/17",
          labels: [],
          assignees: [],
          milestone: null,
          projectItemId: "item-17",
          created: "2026-01-01T00:00:00Z"
        }
      },
      {
        list: "octo-org/7",
        id: "88",
        qualifiedId: "octo-org/7#88",
        name: "Close loop",
        description: "Finalize.",
        state: "Done",
        metadata: {
          url: "https://github.example.test/octo/repo/issues/88",
          labels: ["release"],
          assignees: ["hubot", "octocat"],
          milestone: null,
          projectItemId: "item-88",
          created: "2026-01-02T00:00:00Z"
        }
      }
    ]);
    expect(readGraphqlCall(fetchMock, 1)).toMatchSnapshot();
  });

  it("all({ order: 'alphabetical' }) sorts by qualifiedId", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      itemsResponse({
        nodes: projectItemsFixture()
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(
      taskList.list("octo-org/7").all({ order: "alphabetical" }).then(ids)
    ).resolves.toEqual(["17", "482", "88"]);
    expect(readGraphqlCall(fetchMock, 1)).toMatchSnapshot();
  });

  it("all({ order: 'created' }) sorts by createdAt", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      itemsResponse({
        nodes: projectItemsFixture()
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").all({ order: "created" }).then(ids)).resolves.toEqual([
      "17",
      "88",
      "482"
    ]);
    expect(readGraphqlCall(fetchMock, 1)).toMatchSnapshot();
  });

  it("all({ state }) filters by Status name", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      itemsResponse({
        nodes: projectItemsFixture()
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(
      taskList.list("octo-org/7").all({ state: "In progress" }).then(ids)
    ).resolves.toEqual(["482"]);
    expect(readGraphqlCall(fetchMock, 1)).toMatchSnapshot();
  });

  it("all({ includeArchived: true }) returns empty without querying items", async () => {
    const fetchMock = createFetchMock([projectResponse()]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").all({ includeArchived: true })).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("all merges paginated project items in project view order", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      itemsResponse({
        nodes: [
          projectIssueItem({
            id: "item-482",
            issue: issue({ number: 482, title: "First page" })
          })
        ],
        hasNextPage: true,
        endCursor: "cursor-one"
      }),
      itemsResponse({
        nodes: [
          projectIssueItem({
            id: "item-17",
            issue: issue({ number: 17, title: "Second page" })
          })
        ],
        hasNextPage: false,
        endCursor: null
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").all().then(ids)).resolves.toEqual(["482", "17"]);
    expect(readGraphqlCall(fetchMock, 1)).toMatchSnapshot();
    expect(readGraphqlCall(fetchMock, 2)).toMatchSnapshot();
  });

  it('get("482") returns the mapped task', async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({
        number: 482,
        title: "Write backend",
        body: "Implement GitHub issues.",
        status: "In progress",
        labels: ["backend", "task-list"],
        assignees: ["mona"],
        milestone: "v1",
        projectItemId: "item-482",
        createdAt: "2026-01-03T00:00:00Z"
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").get("482")).resolves.toEqual({
      list: "octo-org/7",
      id: "482",
      qualifiedId: "octo-org/7#482",
      name: "Write backend",
      description: "Implement GitHub issues.",
      state: "In progress",
      metadata: {
        url: "https://github.example.test/octo/repo/issues/482",
        labels: ["backend", "task-list"],
        assignees: ["mona"],
        milestone: "v1",
        projectItemId: "item-482",
        created: "2026-01-03T00:00:00Z"
      }
    });
    expect(readGraphqlCall(fetchMock, 1)).toMatchSnapshot();
  });

  it("rejects issue ids that are not canonical decimal issue numbers", async () => {
    const fetchMock = createFetchMock([projectResponse()]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").get("1e2")).rejects.toBeInstanceOf(
      TaskNotFoundError
    );
    await expect(taskList.list("octo-org/7").get("0x10")).rejects.toBeInstanceOf(
      TaskNotFoundError
    );
    await expect(taskList.list("octo-org/7").get("001")).rejects.toBeInstanceOf(
      TaskNotFoundError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('get("999") throws TaskNotFoundError when the issue is not in this project', async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({
        number: 999,
        projectId: "other-project",
        projectItemId: "other-item"
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").get("999")).rejects.toBeInstanceOf(TaskNotFoundError);
    expect(readGraphqlCall(fetchMock, 1)).toMatchSnapshot();
  });

  it('get("404") throws TaskNotFoundError when the issue does not exist', async () => {
    const fetchMock = createFetchMock([projectResponse(), missingIssueResponse()]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").get("404")).rejects.toBeInstanceOf(TaskNotFoundError);
    expect(readGraphqlCall(fetchMock, 1)).toMatchSnapshot();
  });

  it("create({ name, description }) issues the GitHub issue and project mutations", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      repositoryResponse("repo-node"),
      createIssueResponse({
        issueId: "issue-node-573",
        number: 573
      }),
      addProjectItemResponse("item-573"),
      updateStatusResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    const task = await taskList.list("octo-org/7").create({
      name: "New issue",
      description: "Created from task-list."
    });

    expect(task).toMatchObject({
      id: "573",
      name: "New issue",
      description: "Created from task-list.",
      state: "Todo"
    });
    expect(readMutationCalls(fetchMock)).toMatchSnapshot();
  });

  it("closes a created issue when project attachment fails", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      repositoryResponse("repo-node"),
      createIssueResponse({ issueId: "issue-node-573", number: 573 }),
      graphqlResponse({ addProjectV2ItemById: { item: null } }),
      updateIssueResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").create({ name: "New issue" })).rejects.toThrow(
      "did not include project item id"
    );
    expect(readMutationCalls(fetchMock).at(-1)).toEqual(
      expect.objectContaining({
        query: expect.stringContaining("mutation UpdateIssue"),
        variables: { input: { id: "issue-node-573", state: "CLOSED" } }
      })
    );
  });

  it("removes an attached item and closes its issue when initial Status fails", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      repositoryResponse("repo-node"),
      createIssueResponse({ issueId: "issue-node-573", number: 573 }),
      addProjectItemResponse("item-573"),
      graphqlErrorResponse("initial status failed"),
      deleteProjectItemResponse(),
      updateIssueResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").create({ name: "New issue" })).rejects.toThrow(
      "initial status failed"
    );
    expect(readMutationCalls(fetchMock).slice(-2)).toEqual([
      expect.objectContaining({ query: expect.stringContaining("mutation DeleteProjectItem") }),
      expect.objectContaining({
        query: expect.stringContaining("mutation UpdateIssue"),
        variables: { input: { id: "issue-node-573", state: "CLOSED" } }
      })
    ]);
  });

  it("returns a fully initialized created task without a confirmation read", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      repositoryResponse("repo-node"),
      createIssueResponse({ issueId: "issue-node-573", number: 573 }),
      addProjectItemResponse("item-573"),
      updateStatusResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").create({ name: "Created" })).resolves.toMatchObject({
      id: "573",
      name: "Created",
      state: "Todo"
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("create ignores a passed id and uses the GitHub-assigned issue number", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      repositoryResponse("repo-node"),
      createIssueResponse({
        issueId: "issue-node-914",
        number: 914
      }),
      addProjectItemResponse("item-914"),
      updateStatusResponse(),
      issueResponse({
        number: 914,
        title: "Server id wins",
        status: "Todo",
        projectItemId: "item-914"
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    const task = await taskList.list("octo-org/7").create({
      id: "client-id",
      name: "Server id wins"
    });

    expect(task.id).toBe("914");
    expect(readMutationCalls(fetchMock)).toMatchSnapshot();
  });

  it("create adds the initial state label instead of writing Status in label mode", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      repositoryResponse("repo-node"),
      createIssueResponse({ issueId: "issue-node-573", number: 573 }),
      addProjectItemResponse("item-573"),
      repositoryLabelResponse("label-todo"),
      addLabelsResponse(),
      issueResponse({
        number: 573,
        title: "Label created",
        status: "Done",
        labels: ["status:Todo"],
        projectItemId: "item-573"
      })
    ]);
    const taskList = await ghIssuesBackend({
      ...DEFAULT_DEPS,
      state: { labelPrefix: "status:" },
      fetch: fetchMock
    });

    await expect(
      taskList.list("octo-org/7").create({ name: "Label created" })
    ).resolves.toMatchObject({
      id: "573",
      state: "Todo"
    });
    expect(readMutationCalls(fetchMock)).toEqual([
      expect.objectContaining({ query: expect.stringContaining("mutation CreateIssue") }),
      expect.objectContaining({ query: expect.stringContaining("mutation AddProjectItem") }),
      expect.objectContaining({
        query: expect.stringContaining("mutation AddLabels"),
        variables: { input: { labelableId: "issue-node-573", labelIds: ["label-todo"] } }
      })
    ]);
  });

  it("create fetches the repository id lazily and caches it for later creates", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      repositoryResponse("repo-node"),
      createIssueResponse({
        issueId: "issue-node-101",
        number: 101
      }),
      addProjectItemResponse("item-101"),
      updateStatusResponse(),
      createIssueResponse({
        issueId: "issue-node-102",
        number: 102
      }),
      addProjectItemResponse("item-102"),
      updateStatusResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });
    const tasks = taskList.list("octo-org/7");

    await expect(tasks.create({ name: "First issue" })).resolves.toMatchObject({ id: "101" });
    await expect(tasks.create({ name: "Second issue" })).resolves.toMatchObject({ id: "102" });

    expect(readGraphqlCalls(fetchMock).filter(isRepositoryQuery)).toHaveLength(1);
    expect(readMutationCalls(fetchMock)).toMatchSnapshot();
  });

  it("update uses the issue id cached by create", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      repositoryResponse("repo-node"),
      createIssueResponse({
        issueId: "issue-node-573",
        number: 573
      }),
      addProjectItemResponse("item-573"),
      updateStatusResponse(),
      issueResponse({
        number: 573,
        title: "Original",
        status: "Todo",
        projectItemId: "item-573"
      }),
      issueResponse({
        number: 573,
        title: "Original",
        status: "Todo",
        projectItemId: "item-573"
      }),
      updateIssueResponse(),
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });
    const tasks = taskList.list("octo-org/7");

    const created = await tasks.create({ name: "Original" });
    await expect(tasks.update(created.id, { name: "Renamed" })).resolves.toMatchObject({
      id: "573",
      name: "Renamed"
    });

    expect(readGraphqlCalls(fetchMock).filter(isIssueIdQuery)).toHaveLength(0);
    expect(readMutationCalls(fetchMock)).toMatchSnapshot();
  });

  it('update("482", { name: "new" }) issues only updateIssue with title', async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({ number: 482, title: "Original", status: "Todo" }),
      updateIssueResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").update("482", { name: "new" })).resolves.toMatchObject(
      {
        id: "482",
        name: "new"
      }
    );
    expect(readMutationCalls(fetchMock)).toMatchSnapshot();
  });

  it('update("482", { description: "new body" }) issues only updateIssue with body', async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({ number: 482, title: "Keep title", body: "before", status: "Todo" }),
      updateIssueResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(
      taskList.list("octo-org/7").update("482", { description: "new body" })
    ).resolves.toMatchObject({
      id: "482",
      name: "Keep title",
      description: "new body"
    });
    expect(readMutationCalls(fetchMock)).toMatchSnapshot();
  });

  it('update("482", { metadata: { labels: ["x"] } }) is a no-op mutation', async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({
        number: 482,
        title: "Read only metadata",
        status: "Todo"
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    // metadata writes are out of scope for v1 on gh-issues, so labels are read-only here.
    await expect(
      taskList.list("octo-org/7").update("482", { metadata: { labels: ["x"] } })
    ).resolves.toMatchObject({
      id: "482",
      name: "Read only metadata"
    });
    expect(readMutationCalls(fetchMock)).toEqual([]);
  });

  it("rejects update and comment mutations for issues outside the configured project", async () => {
    const updateFetch = createFetchMock([
      projectResponse(),
      issueResponse({ number: 999, title: "Outside", projectId: "other-project" })
    ]);
    const updateTasks = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: updateFetch });

    await expect(updateTasks.list("octo-org/7").update("999", { name: "Renamed" })).rejects.toBeInstanceOf(
      TaskNotFoundError
    );
    expect(readMutationCalls(updateFetch)).toEqual([]);

    const commentFetch = createFetchMock([
      projectResponse(),
      issueResponse({ number: 999, title: "Outside", projectId: "other-project" })
    ]);
    const commentTasks = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: commentFetch });

    await expect(commentTasks.list("octo-org/7").comment?.("999", "note")).rejects.toBeInstanceOf(
      TaskNotFoundError
    );
    expect(readMutationCalls(commentFetch)).toEqual([]);
  });

  it("returns an updated task without a post-mutation confirmation read", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({ number: 482, title: "Original", body: "Before", status: "Todo" }),
      updateIssueResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(
      taskList.list("octo-org/7").update("482", { name: "Renamed", description: "After" })
    ).resolves.toMatchObject({ name: "Renamed", description: "After", state: "Todo" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fire("482", "<known-state>") sets the matching Status option', async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({ number: 482, title: "Move me", status: "Todo", projectItemId: "item-482" }),
      issueProjectItemResponse({
        issueId: "issue-node-482",
        projectItemId: "item-482"
      }),
      updateStatusResponse(),
      issueResponse({
        number: 482,
        title: "Move me",
        status: "Done",
        projectItemId: "item-482"
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").fire("482", "Done")).resolves.toMatchObject({
      id: "482",
      state: "Done"
    });
    expect(readMutationCalls(fetchMock)).toMatchSnapshot();
  });

  it('fire("482", "<known-state>") adds and removes state labels in label mode', async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({
        number: 482,
        title: "Move me",
        status: "Todo",
        labels: ["backend", "status:Todo", "status:Doing"],
        labelIds: ["label-backend", "label-todo", "label-doing"]
      }),
      issueResponse({
        number: 482,
        title: "Move me",
        status: "Todo",
        labels: ["backend", "status:Todo", "status:Doing"],
        labelIds: ["label-backend", "label-todo", "label-doing"]
      }),
      repositoryLabelResponse("label-done"),
      addLabelsResponse(),
      removeLabelsResponse(),
      issueResponse({
        number: 482,
        title: "Move me",
        status: "Todo",
        labels: ["backend", "status:Done"],
        labelIds: ["label-backend", "label-done"]
      })
    ]);
    const taskList = await ghIssuesBackend({
      ...DEFAULT_DEPS,
      state: { labelPrefix: "status:" },
      fetch: fetchMock
    });

    await expect(taskList.list("octo-org/7").fire("482", "Done")).resolves.toMatchObject({
      id: "482",
      state: "Done"
    });
    expect(readGraphqlCall(fetchMock, 2)).toEqual(
      expect.objectContaining({ query: expect.stringContaining("query IssueStateLabels") })
    );
    expect(readMutationCalls(fetchMock)).toEqual([
      expect.objectContaining({
        query: expect.stringContaining("mutation AddLabels"),
        variables: { input: { labelableId: "issue-node-482", labelIds: ["label-done"] } }
      }),
      expect.objectContaining({
        query: expect.stringContaining("mutation RemoveLabels"),
        variables: {
          input: { labelableId: "issue-node-482", labelIds: ["label-todo", "label-doing"] }
        }
      })
    ]);
  });

  it("does not write state labels for issues outside the configured project", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({
        number: 482,
        title: "Outside project",
        labels: ["status:Todo"],
        projectId: "another-project"
      })
    ]);
    const taskList = await ghIssuesBackend({
      ...DEFAULT_DEPS,
      state: { labelPrefix: "status:" },
      fetch: fetchMock
    });

    await expect(taskList.list("octo-org/7").fire("482", "Done")).rejects.toBeInstanceOf(
      TaskNotFoundError
    );
    expect(readMutationCalls(fetchMock)).toEqual([]);
  });

  it("keeps Status-field transitions when labelPrefix is unset", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({ number: 482, title: "Move me", status: "Todo", projectItemId: "item-482" }),
      issueProjectItemResponse({
        issueId: "issue-node-482",
        projectItemId: "item-482"
      }),
      updateStatusResponse(),
      issueResponse({
        number: 482,
        title: "Move me",
        status: "Done",
        labels: ["status:Todo"],
        projectItemId: "item-482"
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").fire("482", "Done")).resolves.toMatchObject({
      state: "Done"
    });
    expect(readMutationCalls(fetchMock)).toHaveLength(1);
    expect(readMutationCalls(fetchMock)[0]).toEqual(
      expect.objectContaining({
        query: expect.stringContaining("mutation UpdateProjectItemStatus")
      })
    );
  });

  it("rejects a Status-field transition to the current state without mutating", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({
        number: 482,
        title: "Already todo",
        status: "Todo",
        projectItemId: "item-482"
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").fire("482", "Todo")).rejects.toBeInstanceOf(
      InvalidTransitionError
    );
    expect(readMutationCalls(fetchMock)).toEqual([]);
  });

  it("returns a transitioned Status task without a post-mutation confirmation read", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({ number: 482, title: "Move me", status: "Todo", projectItemId: "item-482" }),
      issueProjectItemResponse({ issueId: "issue-node-482", projectItemId: "item-482" }),
      updateStatusResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").fire("482", "Done")).resolves.toMatchObject({
      id: "482",
      state: "Done"
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fire ignores metadataPatch and only writes the Status field", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({
        number: 482,
        title: "Move without metadata writes",
        status: "Todo",
        projectItemId: "item-482"
      }),
      issueProjectItemResponse({
        issueId: "issue-node-482",
        projectItemId: "item-482"
      }),
      updateStatusResponse(),
      issueResponse({
        number: 482,
        title: "Move without metadata writes",
        status: "Done",
        projectItemId: "item-482"
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(
      taskList.list("octo-org/7").fire("482", "Done", {
        metadataPatch: { labels: ["x"], milestone: "v2" }
      })
    ).resolves.toMatchObject({
      id: "482",
      state: "Done"
    });
    expect(readMutationCalls(fetchMock)).toMatchSnapshot();
  });

  it('fire("482", "<unknown>") throws InvalidTransitionError', async () => {
    const fetchMock = createFetchMock([projectResponse()]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").fire("482", "Blocked")).rejects.toBeInstanceOf(
      InvalidTransitionError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('move("482", { before: "100" }) positions after the anchor predecessor', async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({
        number: 482,
        title: "Issue 482",
        projectItemId: "item-482"
      }),
      issueProjectItemResponse({
        issueId: "issue-node-100",
        projectItemId: "item-100"
      }),
      itemsResponse({
        nodes: projectOrderingFixture()
      }),
      updateProjectItemPositionResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").move("482", { before: "100" })).resolves.toMatchObject(
      {
        id: "482"
      }
    );
    expect(readMutationCalls(fetchMock)).toMatchSnapshot();
  });

  it('move("482", { after: "100" }) positions after the anchor item', async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({
        number: 482,
        title: "Issue 482",
        projectItemId: "item-482"
      }),
      issueProjectItemResponse({
        issueId: "issue-node-100",
        projectItemId: "item-100"
      }),
      updateProjectItemPositionResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").move("482", { after: "100" })).resolves.toMatchObject({
      id: "482"
    });
    expect(readMutationCalls(fetchMock)).toMatchSnapshot();
  });

  it('move("482", { position: "top" }) positions at the top', async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({
        number: 482,
        title: "Issue 482",
        projectItemId: "item-482"
      }),
      updateProjectItemPositionResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(
      taskList.list("octo-org/7").move("482", { position: "top" })
    ).resolves.toMatchObject({
      id: "482"
    });
    expect(readMutationCalls(fetchMock)).toMatchSnapshot();
  });

  it("returns a moved task without a post-position confirmation read", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({ number: 482, title: "Move me", status: "Todo", projectItemId: "item-482" }),
      updateProjectItemPositionResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").move("482", { position: "top" })).resolves.toMatchObject({
      id: "482",
      state: "Todo"
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("moves a task whose configured project membership is on a later page", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({
        number: 482,
        title: "Move me",
        projectId: "other-project",
        projectItemId: "item-other",
        hasNextProjectItemPage: true,
        projectItemEndCursor: "page-one"
      }),
      issueResponse({ number: 482, title: "Move me", projectItemId: "item-482" }),
      updateProjectItemPositionResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").move("482", { position: "top" })).resolves.toMatchObject({
      id: "482"
    });
    expect(readGraphqlCall(fetchMock, 2)).toEqual(
      expect.objectContaining({ variables: expect.objectContaining({ after: "page-one" }) })
    );
  });

  it('move("482", { position: "bottom" }) positions after the last item', async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({
        number: 482,
        title: "Issue 482",
        projectItemId: "item-482"
      }),
      itemsResponse({
        nodes: [
          projectIssueItem({ id: "item-200", issue: issue({ number: 200 }) }),
          projectIssueItem({ id: "item-482", issue: issue({ number: 482 }) }),
          projectIssueItem({ id: "item-100", issue: issue({ number: 100 }) })
        ]
      }),
      updateProjectItemPositionResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(
      taskList.list("octo-org/7").move("482", { position: "bottom" })
    ).resolves.toMatchObject({
      id: "482"
    });
    expect(readMutationCalls(fetchMock)).toMatchSnapshot();
  });

  it('move("482", { position: "bottom" }) does not position an item after itself', async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({
        number: 482,
        title: "Issue 482",
        projectItemId: "item-482"
      }),
      itemsResponse({
        nodes: projectOrderingFixture()
      }),
      updateProjectItemPositionResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(
      taskList.list("octo-org/7").move("482", { position: "bottom" })
    ).resolves.toMatchObject({
      id: "482"
    });
    expect(readMutationCalls(fetchMock)).toMatchSnapshot();
  });

  it('move("482", { before: "missing" }) throws AnchorNotFoundError', async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueResponse({
        number: 482,
        title: "Issue 482",
        projectItemId: "item-482"
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(
      taskList.list("octo-org/7").move("482", { before: "missing" })
    ).rejects.toBeInstanceOf(AnchorNotFoundError);
  });

  it("removes a task whose configured project membership is on a later page", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueProjectItemResponse({
        issueId: "issue-node-482",
        projectItemId: "item-other",
        projectId: "other-project",
        hasNextProjectItemPage: true,
        projectItemEndCursor: "page-one"
      }),
      issueProjectItemResponse({ issueId: "issue-node-482", projectItemId: "item-482" }),
      deleteProjectItemResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").delete("482")).resolves.toBeUndefined();
    expect(readGraphqlCall(fetchMock, 2)).toEqual(
      expect.objectContaining({ variables: expect.objectContaining({ after: "page-one" }) })
    );
  });

  it('reorder(["100", "200", "482"]) issues sequential position mutations', async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      itemsResponse({
        nodes: projectOrderingFixture()
      }),
      updateProjectItemPositionResponse(),
      updateProjectItemPositionResponse(),
      updateProjectItemPositionResponse(),
      itemsResponse({
        nodes: [
          projectIssueItem({ id: "item-100", issue: issue({ number: 100 }) }),
          projectIssueItem({ id: "item-200", issue: issue({ number: 200 }) }),
          projectIssueItem({ id: "item-482", issue: issue({ number: 482 }) })
        ]
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(
      taskList.list("octo-org/7").reorder(["100", "200", "482"]).then(ids)
    ).resolves.toEqual(["100", "200", "482"]);
    expect(readMutationCalls(fetchMock)).toMatchSnapshot();
  });

  it("restores the previous ordering when a later reorder mutation fails", async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      itemsResponse({ nodes: projectOrderingFixture() }),
      updateProjectItemPositionResponse(),
      graphqlErrorResponse("position rejected"),
      updateProjectItemPositionResponse(),
      updateProjectItemPositionResponse(),
      updateProjectItemPositionResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").reorder(["100", "200", "482"])).rejects.toThrow(
      "position rejected"
    );
    expect(
      readMutationCalls(fetchMock).map((call) => call.variables.input)
    ).toEqual([
      { projectId: "project-id", itemId: "item-100", afterId: null },
      { projectId: "project-id", itemId: "item-200", afterId: "item-100" },
      { projectId: "project-id", itemId: "item-200", afterId: null },
      { projectId: "project-id", itemId: "item-100", afterId: "item-200" },
      { projectId: "project-id", itemId: "item-482", afterId: "item-100" }
    ]);
  });

  it('reorder(["100", "200"]) throws OrderMismatchError for missing items', async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      itemsResponse({
        nodes: projectOrderingFixture()
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").reorder(["100", "200"])).rejects.toBeInstanceOf(
      OrderMismatchError
    );
  });

  it('reorder(["100", "200", "482", "999"]) throws OrderMismatchError for extra items', async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      itemsResponse({
        nodes: projectOrderingFixture()
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(
      taskList.list("octo-org/7").reorder(["100", "200", "482", "999"])
    ).rejects.toBeInstanceOf(OrderMismatchError);
  });

  it('delete("482") deletes the project item only', async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueProjectItemResponse({
        issueId: "issue-node-482",
        projectItemId: "item-482"
      }),
      deleteProjectItemResponse()
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").delete("482")).resolves.toBeUndefined();
    expect(readMutationCalls(fetchMock)).toMatchSnapshot();
  });

  it('delete("999") throws TaskNotFoundError when the issue is not in this project', async () => {
    const fetchMock = createFetchMock([
      projectResponse(),
      issueProjectItemResponse({
        issueId: "issue-node-999",
        projectItemId: "other-item",
        projectId: "other-project"
      })
    ]);
    const taskList = await ghIssuesBackend({ ...DEFAULT_DEPS, fetch: fetchMock });

    await expect(taskList.list("octo-org/7").delete("999")).rejects.toBeInstanceOf(
      TaskNotFoundError
    );
  });
});

function ids(tasks: { id: string }[]): string[] {
  return tasks.map((task) => task.id);
}

function projectResponse(data = defaultProjectData()): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function defaultProjectData() {
  return {
    organization: {
      projectV2: project()
    },
    user: null
  };
}

function project(
  overrides: Partial<{
    id: string;
    title: string;
    field:
      | null
      | Record<string, never>
      | {
          id: string;
          options: Array<{ id: string; name: string }>;
        };
    options: Array<{ id: string; name: string }>;
  }> = {}
) {
  return {
    id: overrides.id ?? "project-id",
    title: overrides.title ?? "Roadmap",
    field:
      "field" in overrides
        ? overrides.field
        : {
            id: "status-field",
            options: overrides.options ?? [
              { id: "status-todo", name: "Todo" },
              { id: "status-done", name: "Done" }
            ]
          }
  };
}

function createFetchMock(responses: Response[]): typeof fetch {
  return vi.fn(async () => {
    const response = responses.shift();
    if (response === undefined) {
      throw new Error("Unexpected fetch call.");
    }
    return response;
  }) as unknown as typeof fetch;
}

function itemsResponse(options: {
  nodes: unknown[];
  hasNextPage?: boolean;
  endCursor?: string | null;
}): Response {
  return graphqlResponse({
    node: {
      items: {
        nodes: options.nodes,
        pageInfo: {
          hasNextPage: options.hasNextPage ?? false,
          endCursor: options.endCursor ?? null
        }
      }
    }
  });
}

function issueResponse(options: {
  number: number;
  title?: string;
  body?: string | null;
  status?: string | null;
  labels?: string[];
  labelIds?: string[];
  assignees?: string[];
  milestone?: string | null;
  projectId?: string;
  projectItemId?: string;
  hasNextProjectItemPage?: boolean;
  projectItemEndCursor?: string | null;
  createdAt?: string;
}): Response {
  return graphqlResponse({
    repository: {
      issue: {
        ...issue(options),
        id: `issue-node-${options.number}`,
        projectItems: {
          nodes: [
            {
              id: options.projectItemId ?? `item-${options.number}`,
              project: {
                id: options.projectId ?? "project-id"
              },
              fieldValueByName:
                options.status === null
                  ? null
                  : {
                      name: options.status ?? "Todo"
                    }
            }
          ],
          pageInfo: {
            hasNextPage: options.hasNextProjectItemPage ?? false,
            endCursor: options.projectItemEndCursor ?? null
          }
        }
      }
    }
  });
}

function repositoryIssuesResponse(nodes: unknown[]): Response {
  return graphqlResponse({
    repository: {
      issues: {
        nodes,
        pageInfo: { hasNextPage: false, endCursor: null }
      }
    }
  });
}

function missingIssueResponse(): Response {
  return graphqlResponse({
    repository: {
      issue: null
    }
  });
}

function repositoryResponse(id: string): Response {
  return graphqlResponse({
    repository: {
      id
    }
  });
}

function createIssueResponse(options: { issueId: string; number: number }): Response {
  return graphqlResponse({
    createIssue: {
      issue: {
        id: options.issueId,
        number: options.number,
        title: "Created issue",
        body: "",
        url: `https://example.test/issues/${options.number}`,
        createdAt: "2026-05-26T00:00:00Z",
        labels: { nodes: [] },
        assignees: { nodes: [] },
        milestone: null
      }
    }
  });
}

function graphqlErrorResponse(message: string): Response {
  return new Response(JSON.stringify({ errors: [{ message }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function addProjectItemResponse(projectItemId: string): Response {
  return graphqlResponse({
    addProjectV2ItemById: {
      item: {
        id: projectItemId
      }
    }
  });
}

function updateStatusResponse(): Response {
  return graphqlResponse({
    updateProjectV2ItemFieldValue: {
      projectV2Item: {
        id: "updated-item"
      }
    }
  });
}

function repositoryLabelResponse(id: string): Response {
  return graphqlResponse({
    repository: {
      label: { id }
    }
  });
}

function addLabelsResponse(): Response {
  return graphqlResponse({ addLabelsToLabelable: { clientMutationId: null } });
}

function removeLabelsResponse(): Response {
  return graphqlResponse({ removeLabelsFromLabelable: { clientMutationId: null } });
}

function issueNodeIdResponse(issueId: string): Response {
  return graphqlResponse({
    repository: {
      issue: {
        id: issueId
      }
    }
  });
}

function updateIssueResponse(): Response {
  return graphqlResponse({
    updateIssue: {
      issue: {
        id: "updated-issue"
      }
    }
  });
}

function issueProjectItemResponse(options: {
  issueId: string;
  projectItemId: string;
  projectId?: string;
  hasNextProjectItemPage?: boolean;
  projectItemEndCursor?: string | null;
}): Response {
  return graphqlResponse({
    repository: {
      issue: {
        id: options.issueId,
        projectItems: {
          nodes: [
            {
              id: options.projectItemId,
              project: {
                id: options.projectId ?? "project-id"
              }
            }
          ],
          pageInfo: {
            hasNextPage: options.hasNextProjectItemPage ?? false,
            endCursor: options.projectItemEndCursor ?? null
          }
        }
      }
    }
  });
}

function updateProjectItemPositionResponse(): Response {
  return graphqlResponse({
    updateProjectV2ItemPosition: {
      items: {
        totalCount: 3
      }
    }
  });
}

function deleteProjectItemResponse(): Response {
  return graphqlResponse({
    deleteProjectV2Item: {
      deletedItemId: "item-482"
    }
  });
}

function graphqlResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function projectItemsFixture(): unknown[] {
  return [
    projectIssueItem({
      id: "item-482",
      issue: issue({
        number: 482,
        title: "Write backend",
        body: "Implement GitHub issues.",
        labels: ["backend", "task-list"],
        assignees: ["mona"],
        milestone: "v1",
        createdAt: "2026-01-03T00:00:00Z"
      }),
      status: "In progress"
    }),
    {
      id: "draft-item",
      content: {
        __typename: "DraftIssue",
        title: "Draft item"
      },
      fieldValueByName: {
        name: "Todo"
      }
    },
    projectIssueItem({
      id: "item-17",
      issue: issue({
        number: 17,
        title: "Document workflow",
        body: null,
        labels: [],
        assignees: [],
        milestone: null,
        createdAt: "2026-01-01T00:00:00Z"
      }),
      status: null
    }),
    projectIssueItem({
      id: "item-88",
      issue: issue({
        number: 88,
        title: "Close loop",
        body: "Finalize.",
        labels: ["release"],
        assignees: ["hubot", "octocat"],
        milestone: null,
        createdAt: "2026-01-02T00:00:00Z"
      }),
      status: "Done"
    })
  ];
}

function projectOrderingFixture(): unknown[] {
  return [
    projectIssueItem({ id: "item-200", issue: issue({ number: 200 }) }),
    projectIssueItem({ id: "item-100", issue: issue({ number: 100 }) }),
    projectIssueItem({ id: "item-482", issue: issue({ number: 482 }) })
  ];
}

function projectIssueItem(options: {
  id: string;
  issue: unknown;
  status?: string | null;
}): unknown {
  return {
    id: options.id,
    content: options.issue,
    fieldValueByName:
      options.status === null
        ? null
        : {
            name: options.status ?? "Todo"
          }
  };
}

function issue(options: {
  number: number;
  title?: string;
  body?: string | null;
  labels?: string[];
  labelIds?: string[];
  assignees?: string[];
  milestone?: string | null;
  createdAt?: string;
}) {
  return {
    __typename: "Issue",
    number: options.number,
    title: options.title ?? `Issue ${options.number}`,
    body: options.body ?? "",
    url: `https://github.example.test/octo/repo/issues/${options.number}`,
    createdAt: options.createdAt ?? "2026-01-01T00:00:00Z",
    labels: {
      nodes: (options.labels ?? []).map((name, index) => ({
        id: options.labelIds?.[index] ?? `label-${name}`,
        name
      }))
    },
    assignees: {
      nodes: (options.assignees ?? []).map((login) => ({ login }))
    },
    milestone:
      options.milestone === undefined
        ? null
        : options.milestone === null
          ? null
          : { title: options.milestone }
  };
}

function readGraphqlCall(fetchMock: typeof fetch, callIndex: number): unknown {
  const call = vi.mocked(fetchMock).mock.calls[callIndex];
  if (call === undefined) {
    throw new Error(`Missing fetch call ${callIndex}.`);
  }

  const [, init] = call;
  if (init === undefined || typeof init.body !== "string") {
    throw new Error(`Fetch call ${callIndex} did not include a JSON body.`);
  }

  return JSON.parse(init.body);
}

function readGraphqlCalls(fetchMock: typeof fetch): unknown[] {
  return vi.mocked(fetchMock).mock.calls.map((_, index) => readGraphqlCall(fetchMock, index));
}

function readMutationCalls(fetchMock: typeof fetch): unknown[] {
  return readGraphqlCalls(fetchMock).filter((call): call is { query: string; variables: unknown } =>
    isGraphqlOperation(call, "mutation")
  );
}

function isRepositoryQuery(call: unknown): boolean {
  return isGraphqlOperation(call, "query Repository");
}

function isIssueIdQuery(call: unknown): boolean {
  return isGraphqlOperation(call, "query IssueId");
}

function isGraphqlOperation(call: unknown, operationStart: string): call is { query: string } {
  return (
    typeof call === "object" &&
    call !== null &&
    "query" in call &&
    typeof call.query === "string" &&
    call.query.trimStart().startsWith(operationStart)
  );
}
