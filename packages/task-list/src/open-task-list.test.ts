import { afterEach, describe, expect, it, vi } from "vitest";
import type { StateMachineDef } from "./state-machine.js";
import { backendFactories, openTaskList } from "./open.js";
import { defaultStateMachine } from "./state.js";
import { createFs } from "./backends/test-helpers.js";
import type { OpenTaskListOptions, TaskList } from "./types.js";

const BACKENDS = [
  {
    name: "markdown-dir",
    type: "markdown-dir",
    path: "/repo/tasks"
  },
  {
    name: "yaml-file",
    type: "yaml-file",
    path: "/repo/tasks.yaml"
  }
] as const satisfies ReadonlyArray<{
  name: string;
  type: OpenTaskListOptions["type"];
  path: string;
}>;

type ApprovalState = "pending" | "running" | "done";
type ApprovalEvent = "start" | "finish";

function createApprovalMachine(): StateMachineDef<ApprovalState, ApprovalEvent> {
  return {
    initial: "pending",
    states: ["pending", "running", "done"],
    events: {
      start: { from: ["pending"], to: "running" },
      finish: { from: ["running"], to: "done" }
    }
  };
}

function createTaskList(): TaskList {
  return {
    list: () => {
      throw new Error("unused in test");
    },
    lists: async () => [],
    allTasks: async () => [],
    get: async () => {
      throw new Error("unused in test");
    }
  };
}

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T>
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openTaskList", () => {
  it('routes "markdown-dir" to the markdown backend factory', async () => {
    const taskList = createTaskList();
    const { fs } = createFs();
    const spy = vi.spyOn(backendFactories, "markdown-dir").mockResolvedValue(taskList);

    await expect(
      openTaskList({
        type: "markdown-dir",
        path: "/repo/tasks",
        fs
      })
    ).resolves.toBe(taskList);

    expect(spy).toHaveBeenCalledWith({
      path: "/repo/tasks",
      defaults: {
        metadata: {}
      },
      singleList: undefined,
      frontmatterMode: "strict",
      create: false,
      fs,
      stateMachine: defaultStateMachine
    });
  });

  it('routes "yaml-file" to the yaml backend factory', async () => {
    const taskList = createTaskList();
    const spy = vi.spyOn(backendFactories, "yaml-file").mockResolvedValue(taskList);

    await expect(
      openTaskList({
        type: "yaml-file",
        path: "/repo/tasks.yaml"
      })
    ).resolves.toBe(taskList);

    expect(spy).toHaveBeenCalledWith({
      path: "/repo/tasks.yaml",
      defaults: {
        metadata: {}
      },
      singleList: undefined,
      frontmatterMode: "strict",
      create: false,
      fs: expect.any(Object),
      stateMachine: defaultStateMachine
    });
  });

  it("throws for an unknown backend type", async () => {
    await expect(
      openTaskList({
        type: "sqlite" as never,
        path: "/repo/tasks.db"
      })
    ).rejects.toThrow('Unknown task list backend type "sqlite".');
  });

  it('routes "gh-issues" through auth and endpoint resolution to the GitHub Issues backend', async () => {
    const previousGhHost = process.env.GH_HOST;
    process.env.GH_HOST = "github.example.test";
    const fetchMock: typeof fetch = vi.fn(async () =>
      createJsonResponse({
        data: {
          organization: {
            projectV2: {
              id: "project-1",
              title: "Roadmap",
              field: {
                id: "status-field",
                options: [{ id: "status-todo", name: "Todo" }]
              }
            }
          }
        }
      })
    );

    try {
      const taskList = await openTaskList({
        type: "gh-issues",
        repo: "owner/name",
        project: {
          owner: "owner",
          number: 1
        },
        auth: {
          token: "explicit-token"
        },
        fetch: fetchMock
      });

      expect(await taskList.lists()).toEqual(["owner/1"]);
      expect(taskList.list("owner/1").stateMachine).toEqual({
        initial: "Todo",
        states: ["Todo"],
        events: {
          Todo: { from: "*", to: "Todo" }
        }
      });
      expect(fetchMock).toHaveBeenCalledWith("https://github.example.test/api/graphql", {
        method: "POST",
        headers: {
          Authorization: "Bearer explicit-token",
          "Content-Type": "application/json",
          "User-Agent": "poe-code-task-list/0.0.1"
        },
        body: expect.any(String)
      });
      const request = fetchMock.mock.calls[0]?.[1];
      const body = JSON.parse(String(request?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      expect(body.query).toContain("organization(login: $owner)");
      expect(body.variables).toEqual({
        owner: "owner",
        number: 1
      });
    } finally {
      if (previousGhHost === undefined) {
        delete process.env.GH_HOST;
      } else {
        process.env.GH_HOST = previousGhHost;
      }
    }
  });

  it("passes gh-issues state.labelPrefix through to label-backed reads", async () => {
    const fetchMock: typeof fetch = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          data: {
            organization: {
              projectV2: {
                id: "project-1",
                title: "Roadmap",
                field: {
                  id: "status-field",
                  options: [
                    { id: "status-todo", name: "Todo" },
                    { id: "status-done", name: "Done" }
                  ]
                }
              }
            }
          }
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          data: {
            repository: {
              issue: {
                number: 1,
                title: "Ship",
                body: "",
                url: "https://github.example.test/owner/name/issues/1",
                createdAt: "2026-01-01T00:00:00Z",
                labels: { nodes: [{ name: "status:Done" }] },
                assignees: { nodes: [] },
                milestone: null,
                projectItems: {
                  nodes: [
                    {
                      id: "item-1",
                      project: { id: "project-1" },
                      fieldValueByName: { name: "Todo" }
                    }
                  ]
                }
              }
            }
          }
        })
      ) as unknown as typeof fetch;

    const taskList = await openTaskList({
      type: "gh-issues",
      repo: "owner/name",
      project: { owner: "owner", number: 1 },
      state: { labelPrefix: "status:" },
      auth: { token: "explicit-token" },
      fetch: fetchMock
    });

    await expect(taskList.list("owner/1").get("1")).resolves.toMatchObject({ state: "Done" });
  });

  it("validates custom gh-issues state machines before network access", async () => {
    const fetchMock: typeof fetch = vi.fn(async () => {
      throw new Error("network should not be called");
    }) as unknown as typeof fetch;

    await expect(
      openTaskList({
        type: "gh-issues",
        repo: "owner/name",
        state: { labelPrefix: "status:" },
        stateMachine: {
          initial: "missing",
          states: ["todo"],
          events: {
            finish: { from: ["todo"], to: "done" }
          }
        },
        auth: { token: "explicit-token" },
        fetch: fetchMock
      })
    ).rejects.toThrow('Initial state "missing" is not declared.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes missing defaults", async () => {
    const taskList = createTaskList();
    const { fs } = createFs();
    const spy = vi.spyOn(backendFactories, "markdown-dir").mockResolvedValue(taskList);

    await openTaskList({
      type: "markdown-dir",
      path: "/repo/tasks",
      defaults: {},
      fs
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: {
          metadata: {}
        }
      })
    );
  });

  it("preserves provided defaults", async () => {
    const taskList = createTaskList();
    const { fs } = createFs();
    const spy = vi.spyOn(backendFactories, "yaml-file").mockResolvedValue(taskList);
    const metadata = {
      owner: "kj"
    };

    await openTaskList({
      type: "yaml-file",
      path: "/repo/tasks.yaml",
      defaults: {
        metadata
      },
      fs
    });

    metadata.owner = "changed";

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: {
          metadata: {
            owner: "kj"
          }
        }
      })
    );
  });

  it("passes through explicit create", async () => {
    const taskList = createTaskList();
    const { fs } = createFs();
    const spy = vi.spyOn(backendFactories, "markdown-dir").mockResolvedValue(taskList);

    await openTaskList({
      type: "markdown-dir",
      path: "/repo/tasks",
      create: true,
      fs
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        create: true
      })
    );
  });

  it("does not pass inherited create to file backends", async () => {
    const taskList = createTaskList();
    const { fs } = createFs();
    const spy = vi.spyOn(backendFactories, "markdown-dir").mockResolvedValue(taskList);

    await withObjectPrototypeProperties({ create: true }, async () => {
      await openTaskList({
        type: "markdown-dir",
        path: "/repo/tasks",
        fs
      });
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        create: false
      })
    );
  });

  it("does not route options whose backend type is only inherited", async () => {
    const taskList = createTaskList();
    const { fs } = createFs();
    const spy = vi.spyOn(backendFactories, "markdown-dir").mockResolvedValue(taskList);
    const options = Object.create({
      type: "markdown-dir",
      path: "/repo/tasks",
      fs
    }) as OpenTaskListOptions;

    await expect(openTaskList(options)).rejects.toThrow(
      'Unknown task list backend type "undefined".'
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("opens markdown-dir in single-list passthrough-frontmatter mode", async () => {
    const taskList = createTaskList();
    const { fs } = createFs();
    const spy = vi.spyOn(backendFactories, "markdown-dir").mockResolvedValue(taskList);

    await expect(
      openTaskList({
        type: "markdown-dir",
        path: "/repo/tasks",
        singleList: "plans",
        frontmatterMode: "passthrough",
        fs
      })
    ).resolves.toBe(taskList);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        singleList: "plans",
        frontmatterMode: "passthrough"
      })
    );
  });

  for (const backend of BACKENDS) {
    it(`uses the default state machine for ${backend.name} when none is passed`, async () => {
      const { fs } = createFs();
      const taskList = await openTaskList({
        type: backend.type,
        path: backend.path,
        create: true,
        fs
      });
      const tasks = taskList.list("planning");

      expect(tasks.stateMachine).toBe(defaultStateMachine);

      await expect(
        tasks.create({
          id: "ship",
          name: "Ship"
        })
      ).resolves.toMatchObject({
        state: "draft"
      });

      await expect(tasks.fire("ship", "plan")).resolves.toMatchObject({
        state: "planned"
      });
      await expect(tasks.fire("ship", "start")).resolves.toMatchObject({
        state: "in-progress"
      });
      await expect(tasks.fire("ship", "complete")).resolves.toMatchObject({
        state: "done"
      });
      await expect(tasks.events("ship")).resolves.toEqual(["archive"]);
      await expect(tasks.fire("ship", "archive")).resolves.toMatchObject({
        state: "archived"
      });
    });

    it(`uses the provided state machine for ${backend.name} and exposes it by reference`, async () => {
      const { fs } = createFs();
      const stateMachine = createApprovalMachine();
      const taskList = await openTaskList({
        type: backend.type,
        path: backend.path,
        create: true,
        fs,
        stateMachine
      });
      const tasks = taskList.list("approvals");

      expect(tasks.stateMachine).toBe(stateMachine);

      await expect(
        tasks.create({
          id: "approval",
          name: "Approval"
        })
      ).resolves.toMatchObject({
        state: "pending"
      });

      await expect(tasks.events("approval")).resolves.toEqual(["start"]);
      await expect(tasks.fire("approval", "start")).resolves.toMatchObject({
        state: "running"
      });
      await expect(tasks.fire("approval", "finish")).resolves.toMatchObject({
        state: "done"
      });
    });

    it(`starts new tasks at the configured machine initial state for ${backend.name}`, async () => {
      const defaultFs = createFs();
      const defaultTaskList = await openTaskList({
        type: backend.type,
        path: backend.path,
        create: true,
        fs: defaultFs.fs
      });

      await expect(
        defaultTaskList.list("planning").create({
          id: "invalid-default",
          name: "Invalid default"
        })
      ).resolves.toMatchObject({
        state: "draft"
      });

      const customFs = createFs();
      const customMachine = createApprovalMachine();
      const customTaskList = await openTaskList({
        type: backend.type,
        path: backend.path,
        create: true,
        fs: customFs.fs,
        stateMachine: customMachine
      });

      await expect(
        customTaskList.list("approvals").create({
          id: "valid-custom",
          name: "Valid custom"
        })
      ).resolves.toMatchObject({
        state: "pending"
      });
    });

    it(`uses the configured machine states for fire() in ${backend.name}`, async () => {
      const { fs } = createFs();
      const stateMachine = createApprovalMachine();
      const taskList = await openTaskList({
        type: backend.type,
        path: backend.path,
        create: true,
        fs,
        stateMachine
      });
      const tasks = taskList.list("approvals");

      await expect(
        tasks.create({
          id: "approval",
          name: "Approval"
        })
      ).resolves.toMatchObject({
        state: "pending"
      });

      await expect(tasks.fire("approval", "start")).resolves.toMatchObject({
        state: "running"
      });
      await expect(tasks.fire("approval", "archive")).rejects.toThrow(
        'Cannot fire event "archive" from task state "running".'
      );
    });
  }
});

function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" }
  });
}
