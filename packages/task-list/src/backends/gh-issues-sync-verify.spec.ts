import { describe, expect, it } from "vitest";
import { GhProjectSyncError, verifyGhProject } from "./gh-issues-sync.js";
import { createFetchMock, graphqlResponse, MockGhClient } from "./test-helpers.js";

const DEFAULT_OPTIONS = {
  owner: "octo-org",
  number: 7,
  requiredStates: ["Todo", "Doing", "Done"]
};

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
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

describe("verifyGhProject", () => {
  it("reports a missing project", async () => {
    const client = new MockGhClient([
      projectResponse({ organization: null, user: null }),
      projectResponse({ organization: null, user: null })
    ]);

    await expect(verifyGhProject({ ...DEFAULT_OPTIONS, client })).resolves.toEqual({
      ok: false,
      project: null,
      statusField: null,
      missingProject: true,
      missingStatusField: true,
      missingOptions: DEFAULT_OPTIONS.requiredStates
    });
  });

  it("reports a missing Status field", async () => {
    const client = new MockGhClient([
      projectResponse({
        organization: {
          projectV2: project({ field: null })
        },
        user: null
      })
    ]);

    await expect(verifyGhProject({ ...DEFAULT_OPTIONS, client })).resolves.toEqual({
      ok: false,
      project: { id: "project-id", number: 7, owner: "octo-org" },
      statusField: null,
      missingProject: false,
      missingStatusField: true,
      missingOptions: DEFAULT_OPTIONS.requiredStates
    });
  });

  it("reports missing Status options", async () => {
    const client = new MockGhClient([
      projectResponse({
        organization: {
          projectV2: project({
            options: [
              { id: "status-todo", name: "Todo" },
              { id: "status-done", name: "Done" }
            ]
          })
        },
        user: null
      })
    ]);

    await expect(verifyGhProject({ ...DEFAULT_OPTIONS, client })).resolves.toMatchObject({
      ok: false,
      missingProject: false,
      missingStatusField: false,
      missingOptions: ["Doing"]
    });
  });

  it("reports ok when the project Status field contains every required option", async () => {
    const client = new MockGhClient([
      projectResponse({
        organization: {
          projectV2: project()
        },
        user: null
      })
    ]);

    await expect(verifyGhProject({ ...DEFAULT_OPTIONS, client })).resolves.toEqual({
      ok: true,
      project: { id: "project-id", number: 7, owner: "octo-org" },
      statusField: { id: "status-field", options: ["Todo", "Doing", "Done"] },
      missingProject: false,
      missingStatusField: false,
      missingOptions: []
    });
  });

  it("ignores inherited Status field and option fields", async () => {
    const client = new MockGhClient([
      projectResponse({
        organization: {
          projectV2: project({
            field: {} as never
          })
        },
        user: null
      })
    ]);

    await withObjectPrototypeProperties(
      {
        id: "polluted-id",
        name: "Status",
        options: [{ id: "polluted-option", name: "Todo" }]
      },
      async () => {
        await expect(verifyGhProject({ ...DEFAULT_OPTIONS, client })).resolves.toMatchObject({
          ok: false,
          statusField: null,
          missingStatusField: true,
          missingOptions: DEFAULT_OPTIONS.requiredStates
        });
      }
    );
  });

  it("treats lowercase status as a missing Status field", async () => {
    const client = new MockGhClient([
      projectResponse({
        organization: {
          projectV2: project({
            field: null,
            fields: [
              {
                id: "lower-status-field",
                name: "status",
                options: [{ id: "status-todo", name: "Todo" }]
              }
            ]
          })
        },
        user: null
      })
    ]);

    await expect(verifyGhProject({ ...DEFAULT_OPTIONS, client })).resolves.toMatchObject({
      ok: false,
      statusField: null,
      missingStatusField: true,
      missingOptions: DEFAULT_OPTIONS.requiredStates
    });
  });

  it("treats lowercase status in the direct field lookup as a missing Status field", async () => {
    const client = new MockGhClient([
      projectResponse({
        organization: {
          projectV2: project({
            field: {
              id: "lower-status-field",
              name: "status",
              options: [{ id: "status-todo", name: "Todo" }]
            }
          })
        },
        user: null
      })
    ]);

    await expect(verifyGhProject({ ...DEFAULT_OPTIONS, client })).resolves.toMatchObject({
      ok: false,
      statusField: null,
      missingStatusField: true,
      missingOptions: DEFAULT_OPTIONS.requiredStates
    });
  });

  it("picks the exact Status field when other single-select fields are present", async () => {
    const client = new MockGhClient([
      projectResponse({
        organization: {
          projectV2: project({
            field: null,
            fields: [
              {
                id: "lower-status-field",
                name: "status",
                options: [{ id: "status-todo", name: "Todo" }]
              },
              {
                id: "status-field",
                name: "Status",
                options: [
                  { id: "status-todo", name: "Todo" },
                  { id: "status-doing", name: "Doing" },
                  { id: "status-done", name: "Done" }
                ]
              }
            ]
          })
        },
        user: null
      })
    ]);

    await expect(verifyGhProject({ ...DEFAULT_OPTIONS, client })).resolves.toMatchObject({
      ok: true,
      statusField: { id: "status-field", options: ["Todo", "Doing", "Done"] },
      missingOptions: []
    });
  });

  it("compares Status option names case-sensitively", async () => {
    const client = new MockGhClient([
      projectResponse({
        organization: {
          projectV2: project({
            options: [{ id: "status-done", name: "Done" }]
          })
        },
        user: null
      })
    ]);

    await expect(
      verifyGhProject({ ...DEFAULT_OPTIONS, requiredStates: ["done"], client })
    ).resolves.toMatchObject({
      ok: false,
      missingOptions: ["done"]
    });
  });

  it("throws a typed lookup error when no gh auth token is available", async () => {
    await expect(verifyGhProject(DEFAULT_OPTIONS)).rejects.toMatchObject({
      name: "GhProjectSyncError",
      op: "lookup",
      target: "auth",
      message: "missing_auth"
    } satisfies Partial<GhProjectSyncError>);
  });

  it("wraps project lookup failures in a typed lookup error", async () => {
    const client = new MockGhClient([new Error("network failed")]);

    await expect(verifyGhProject({ ...DEFAULT_OPTIONS, client })).rejects.toMatchObject({
      name: "GhProjectSyncError",
      op: "lookup",
      target: "project:octo-org/7",
      message: "lookup_failed"
    } satisfies Partial<GhProjectSyncError>);
  });

  it("uses a fetch-backed GhClient when an auth token is provided", async () => {
    const fetchMock = createFetchMock([
      graphqlResponse(
        projectResponse({
          organization: {
            projectV2: project()
          },
          user: null
        })
      )
    ]);

    await expect(
      verifyGhProject({ ...DEFAULT_OPTIONS, auth: { token: "secret" }, fetch: fetchMock })
    ).resolves.toMatchObject({
      ok: true
    });
  });

  it("wraps fetch-backed GitHub 5xx responses in a typed lookup error", async () => {
    const fetchMock = createFetchMock([graphqlResponse({ message: "server error" }, 500)]);

    await expect(
      verifyGhProject({ ...DEFAULT_OPTIONS, auth: { token: "secret" }, fetch: fetchMock })
    ).rejects.toMatchObject({
      name: "GhProjectSyncError",
      op: "lookup",
      target: "project:octo-org/7",
      message: "lookup_failed"
    } satisfies Partial<GhProjectSyncError>);
  });
});

function projectResponse(data: unknown): unknown {
  return data;
}

function project(
  overrides: Partial<{
    id: string;
    field: null | { id: string; name?: string; options: Array<{ id: string; name: string }> };
    fields: Array<{ id: string; name: string; options: Array<{ id: string; name: string }> }>;
    options: Array<{ id: string; name: string }>;
  }> = {}
) {
  return {
    id: overrides.id ?? "project-id",
    title: "Roadmap",
    field:
      "field" in overrides
        ? overrides.field
        : {
            id: "status-field",
            options: overrides.options ?? [
              { id: "status-todo", name: "Todo" },
              { id: "status-doing", name: "Doing" },
              { id: "status-done", name: "Done" }
            ]
          },
    fields:
      overrides.fields === undefined
        ? undefined
        : {
            nodes: overrides.fields
          }
  };
}
