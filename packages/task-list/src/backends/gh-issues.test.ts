import { describe, expect, it, vi } from "vitest";
import { TaskNotFoundError } from "../types.js";
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
    await expect(taskList.get("octo-org/7/482")).resolves.toMatchObject({
      qualifiedId: "octo-org/7/482",
      name: "Ship GitHub issue backend"
    });
  });

  it("uses the cached state machine for events and canFire without refetching", async () => {
    const fetchMock = createFetchMock([projectResponse()]);
    const taskList = await ghIssuesBackend({
      ...DEFAULT_DEPS,
      fetch: fetchMock
    });
    const tasks = taskList.list("octo-org/7");

    await expect(tasks.events("Todo")).resolves.toEqual(["Done"]);
    await expect(tasks.canFire("Todo", "Done")).resolves.toBe(true);
    await expect(tasks.canFire("Done", "Done")).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

    await expect(taskList.moveBetweenLists("octo-org/7/123", "octo-org/7")).rejects.toThrow(
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

    await expect(taskList.list("octo-org/7").all()).resolves.toEqual([
      {
        list: "octo-org/7",
        id: "482",
        qualifiedId: "octo-org/7/482",
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
        qualifiedId: "octo-org/7/17",
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
        qualifiedId: "octo-org/7/88",
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
      qualifiedId: "octo-org/7/482",
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
  assignees?: string[];
  milestone?: string | null;
  projectId?: string;
  projectItemId?: string;
  createdAt?: string;
}): Response {
  return graphqlResponse({
    repository: {
      issue: {
        ...issue(options),
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
          ]
        }
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
      nodes: (options.labels ?? []).map((name) => ({ name }))
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
