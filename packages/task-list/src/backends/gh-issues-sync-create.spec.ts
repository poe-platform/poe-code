import { describe, expect, it } from "vitest";
import { syncGhProject } from "./gh-issues-sync.js";
import { MockGhClient } from "./test-helpers.js";

const DEFAULT_OPTIONS = {
  owner: "octo-org",
  number: 7,
  requiredStates: ["Todo", "Doing", "Done"]
};

describe("syncGhProject create mutations", () => {
  it("returns immediately without mutations when the project is already converged", async () => {
    const client = new MockGhClient([
      projectResponse({
        organization: {
          projectV2: project()
        }
      })
    ]);

    await expect(syncGhProject({ ...DEFAULT_OPTIONS, client })).resolves.toEqual({
      ok: true,
      project: { id: "project-id", number: 7, owner: "octo-org" },
      statusField: { id: "status-field", options: ["Todo", "Doing", "Done"] },
      missingProject: false,
      missingStatusField: false,
      missingOptions: [],
      created: [],
      updated: []
    });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.query).not.toContain("mutation");
  });

  it("creates a missing project with the resolved owner id", async () => {
    const client = new MockGhClient([
      projectResponse({ organization: null }),
      projectResponse({ user: null }),
      ownerResponse({ organization: { id: "owner-id" } }),
      createProjectResponse({ id: "new-project-id", number: 42 }),
      projectResponse({
        organization: {
          projectV2: project({ id: "new-project-id", field: null })
        }
      }),
      createFieldResponse({
        id: "new-status-field",
        options: []
      }),
      updateFieldResponse({
        id: "new-status-field",
        options: [
          { id: "status-todo", name: "Todo" },
          { id: "status-doing", name: "Doing" },
          { id: "status-done", name: "Done" }
        ]
      })
    ]);

    await expect(syncGhProject({ ...DEFAULT_OPTIONS, client })).resolves.toEqual({
      ok: true,
      project: { id: "new-project-id", number: 42, owner: "octo-org" },
      statusField: { id: "new-status-field", options: ["Todo", "Doing", "Done"] },
      missingProject: false,
      missingStatusField: false,
      missingOptions: [],
      created: ["project", "field", "option:Todo", "option:Doing", "option:Done"],
      updated: []
    });

    expect(client.calls[2]?.variables).toEqual({ owner: "octo-org" });
    expect(client.calls[3]?.query).toContain("createProjectV2");
    expect(client.calls[3]?.variables).toEqual({
      input: {
        ownerId: "owner-id",
        title: "octo-org/7"
      }
    });
  });

  it("falls back to a user owner id and honors a custom project title", async () => {
    const client = new MockGhClient([
      projectResponse({ organization: null }),
      projectResponse({ user: null }),
      ownerResponse({ organization: null }),
      ownerResponse({ user: { id: "user-owner-id" } }),
      createProjectResponse({ id: "new-project-id", number: 42 }),
      projectResponse({ organization: null }),
      projectResponse({
        user: {
          projectV2: project({ id: "new-project-id", field: null })
        }
      }),
      createFieldResponse({
        id: "new-status-field",
        options: []
      }),
      updateFieldResponse({
        id: "new-status-field",
        options: [
          { id: "status-todo", name: "Todo" },
          { id: "status-doing", name: "Doing" },
          { id: "status-done", name: "Done" }
        ]
      })
    ]);

    await expect(
      syncGhProject({ ...DEFAULT_OPTIONS, title: "Delivery Board", client })
    ).resolves.toMatchObject({
      ok: true,
      project: { id: "new-project-id", number: 42, owner: "octo-org" },
      created: ["project", "field", "option:Todo", "option:Doing", "option:Done"]
    });

    expect(client.calls[4]?.query).toContain("createProjectV2");
    expect(client.calls[4]?.variables).toEqual({
      input: {
        ownerId: "user-owner-id",
        title: "Delivery Board"
      }
    });
  });

  it("uses the newly created project's id when creating the Status field", async () => {
    const client = new MockGhClient([
      projectResponse({ organization: null }),
      projectResponse({ user: null }),
      ownerResponse({ organization: { id: "owner-id" } }),
      createProjectResponse({ id: "new-project-id", number: 42 }),
      projectResponse({
        organization: {
          projectV2: project({ id: "new-project-id", field: null })
        }
      }),
      createFieldResponse({
        id: "new-status-field",
        options: []
      }),
      updateFieldResponse({
        id: "new-status-field",
        options: [
          { id: "status-todo", name: "Todo" },
          { id: "status-doing", name: "Doing" },
          { id: "status-done", name: "Done" }
        ]
      })
    ]);

    await expect(syncGhProject({ ...DEFAULT_OPTIONS, client })).resolves.toMatchObject({
      ok: true,
      project: { id: "new-project-id", number: 42, owner: "octo-org" },
      statusField: { id: "new-status-field", options: ["Todo", "Doing", "Done"] },
      created: ["project", "field", "option:Todo", "option:Doing", "option:Done"]
    });

    expect(client.calls[5]?.variables).toMatchObject({
      input: {
        projectId: "new-project-id"
      }
    });
  });

  it("creates a missing Status field and then adds each required option in one bulk update", async () => {
    const client = new MockGhClient([
      projectResponse({
        organization: {
          projectV2: project({ field: null })
        }
      }),
      createFieldResponse({
        id: "new-status-field",
        options: []
      }),
      updateFieldResponse({
        id: "new-status-field",
        options: [
          { id: "status-todo", name: "Todo" },
          { id: "status-doing", name: "Doing" },
          { id: "status-done", name: "Done" }
        ]
      })
    ]);

    await expect(syncGhProject({ ...DEFAULT_OPTIONS, client })).resolves.toEqual({
      ok: true,
      project: { id: "project-id", number: 7, owner: "octo-org" },
      statusField: { id: "new-status-field", options: ["Todo", "Doing", "Done"] },
      missingProject: false,
      missingStatusField: false,
      missingOptions: [],
      created: ["field", "option:Todo", "option:Doing", "option:Done"],
      updated: []
    });

    expect(client.calls).toHaveLength(3);
    expect(client.calls[1]?.query).toContain("createProjectV2Field");
    expect(client.calls[1]?.variables).toEqual({
      input: {
        projectId: "project-id",
        dataType: "SINGLE_SELECT",
        name: "Status",
        singleSelectOptions: []
      }
    });
    expect(client.calls[2]?.query).toContain("updateProjectV2Field");
    expect(client.calls[2]?.variables).toEqual({
      input: {
        fieldId: "new-status-field",
        singleSelectOptions: [
          { name: "Todo", color: "GRAY", description: "" },
          { name: "Doing", color: "GRAY", description: "" },
          { name: "Done", color: "GRAY", description: "" }
        ]
      }
    });
  });

  it("preserves existing options' color/description when adding missing options", async () => {
    const client = new MockGhClient([
      projectResponse({
        organization: {
          projectV2: project({
            options: [
              { id: "status-todo", name: "Todo", color: "GREEN", description: "Existing item" }
            ]
          })
        }
      }),
      updateFieldResponse({
        id: "status-field",
        options: [
          { id: "status-todo", name: "Todo" },
          { id: "status-doing", name: "Doing" },
          { id: "status-done", name: "Done" }
        ]
      })
    ]);

    await expect(syncGhProject({ ...DEFAULT_OPTIONS, client })).resolves.toEqual({
      ok: true,
      project: { id: "project-id", number: 7, owner: "octo-org" },
      statusField: { id: "status-field", options: ["Todo", "Doing", "Done"] },
      missingProject: false,
      missingStatusField: false,
      missingOptions: [],
      created: ["option:Doing", "option:Done"],
      updated: []
    });

    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]?.query).toContain("updateProjectV2Field");
    expect(client.calls[1]?.variables).toEqual({
      input: {
        fieldId: "status-field",
        singleSelectOptions: [
          { id: "status-todo", name: "Todo", color: "GREEN", description: "Existing item" },
          { name: "Doing", color: "GRAY", description: "" },
          { name: "Done", color: "GRAY", description: "" }
        ]
      }
    });
  });
});

function projectResponse(data: unknown): unknown {
  return data;
}

function ownerResponse(data: unknown): unknown {
  return data;
}

function createProjectResponse(projectV2: { id: string; number: number }): unknown {
  return {
    createProjectV2: {
      projectV2
    }
  };
}

function createFieldResponse(field: {
  id: string;
  options: Array<{ id: string; name: string }>;
}): unknown {
  return {
    createProjectV2Field: {
      projectV2Field: field
    }
  };
}

function updateFieldResponse(field: {
  id: string;
  options: Array<{ id: string; name: string; color?: string; description?: string }>;
}): unknown {
  return {
    updateProjectV2Field: {
      projectV2Field: {
        id: field.id,
        name: "Status",
        options: field.options.map((option) => ({
          id: option.id,
          name: option.name,
          color: option.color ?? "GRAY",
          description: option.description ?? ""
        }))
      }
    }
  };
}

function project(
  overrides: Partial<{
    id: string;
    field:
      | null
      | {
          id: string;
          name?: string;
          options: Array<{
            id: string;
            name: string;
            color?: string;
            description?: string;
          }>;
        };
    options: Array<{ id: string; name: string; color?: string; description?: string }>;
  }> = {}
) {
  const defaultOptions = [
    { id: "status-todo", name: "Todo" },
    { id: "status-doing", name: "Doing" },
    { id: "status-done", name: "Done" }
  ];
  return {
    id: overrides.id ?? "project-id",
    title: "Roadmap",
    field:
      "field" in overrides
        ? overrides.field
        : {
            id: "status-field",
            options: (overrides.options ?? defaultOptions).map((option) => ({
              id: option.id,
              name: option.name,
              color: option.color ?? "GRAY",
              description: option.description ?? ""
            }))
          }
  };
}
