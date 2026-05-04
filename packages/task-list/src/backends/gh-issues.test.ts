import { describe, expect, it, vi } from "vitest";
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
      fetch: createFetchMock([projectResponse()])
    });

    await expect(taskList.allTasks({ state: "Todo" })).rejects.toThrow("not yet implemented");
    await expect(taskList.get("octo-org/7/123")).rejects.toThrow("not yet implemented");
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
});

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
    field: null | Record<string, never> | {
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
