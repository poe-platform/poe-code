import { describe, expect, it } from "vitest";
import {
  GhProjectSyncError,
  syncGhProject,
  verifyGhProject
} from "./gh-issues-sync.js";
import type { GhClient } from "./gh-issues-client.js";
import { createFetchMock, graphqlResponse, MockGhClient } from "./test-helpers.js";

const DEFAULT_OPTIONS = {
  owner: "octo-org",
  number: 7,
  requiredStates: ["Todo", "Doing", "Done"]
};

describe("syncGhProject idempotency and errors", () => {
  it("runs idempotently after creating the project and field", async () => {
    const client = new StatefulProjectClient();

    await expect(syncGhProject({ ...DEFAULT_OPTIONS, client })).resolves.toMatchObject({
      ok: true,
      missingOptions: [],
      created: ["project", "field"]
    });

    const firstRunCalls = client.calls.length;

    await expect(syncGhProject({ ...DEFAULT_OPTIONS, client })).resolves.toEqual({
      ok: true,
      project: { id: "new-project-id", number: 7, owner: "octo-org" },
      statusField: { id: "new-status-field", options: ["Todo", "Doing", "Done"] },
      missingProject: false,
      missingStatusField: false,
      missingOptions: [],
      created: [],
      updated: []
    });

    const secondRunCalls = client.calls.slice(firstRunCalls);
    expect(secondRunCalls).toHaveLength(1);
    expect(secondRunCalls[0]?.query).not.toContain("mutation");
  });

  it("keeps sync resumable when an option mutation fails mid-run", async () => {
    const client = new FailingOptionOnceClient();

    await expect(syncGhProject({ ...DEFAULT_OPTIONS, client })).rejects.toMatchObject({
      name: "GhProjectSyncError",
      op: "createOption",
      target: "Done",
      message: "permission denied"
    } satisfies Partial<GhProjectSyncError>);

    await expect(syncGhProject({ ...DEFAULT_OPTIONS, client })).resolves.toEqual({
      ok: true,
      project: { id: "project-id", number: 7, owner: "octo-org" },
      statusField: { id: "status-field", options: ["Todo", "Doing", "Done"] },
      missingProject: false,
      missingStatusField: false,
      missingOptions: [],
      created: ["option:Done"],
      updated: []
    });

    expect(client.calls.filter((call) => call.query.includes("createProjectV2Field"))).toHaveLength(
      0
    );
    expect(
      client.calls.filter((call) =>
        call.query.includes("createProjectV2SingleSelectFieldOption")
      )
    ).toHaveLength(3);
  });

  it("throws the same missing-auth lookup error from sync as verify", async () => {
    await expect(verifyGhProject(DEFAULT_OPTIONS)).rejects.toMatchObject({
      name: "GhProjectSyncError",
      op: "lookup",
      target: "auth",
      message: "missing_auth"
    } satisfies Partial<GhProjectSyncError>);

    await expect(syncGhProject(DEFAULT_OPTIONS)).rejects.toMatchObject({
      name: "GhProjectSyncError",
      op: "lookup",
      target: "auth",
      message: "missing_auth"
    } satisfies Partial<GhProjectSyncError>);
  });

  it("wraps project lookup 5xx failures with the original error as cause", async () => {
    const fetchMock = createFetchMock([graphqlResponse({ message: "server error" }, 500)]);

    await expect(
      syncGhProject({ ...DEFAULT_OPTIONS, auth: { token: "secret" }, fetch: fetchMock })
    ).rejects.toMatchObject({
      name: "GhProjectSyncError",
      op: "lookup",
      target: "project:octo-org/7",
      cause: expect.any(Error)
    } satisfies Partial<GhProjectSyncError>);
  });

  it("wraps createProjectV2 failures with the GitHub message", async () => {
    const client = new MockGhClient([
      projectResponse({ organization: null }),
      projectResponse({ user: null }),
      ownerResponse({ organization: { id: "owner-id" } }),
      new Error("permission denied")
    ]);

    await expect(syncGhProject({ ...DEFAULT_OPTIONS, client })).rejects.toMatchObject({
      name: "GhProjectSyncError",
      op: "createProject",
      target: "octo-org/7",
      message: "permission denied"
    } satisfies Partial<GhProjectSyncError>);
  });

  it("wraps createProjectV2Field failures with the GitHub message", async () => {
    const client = new MockGhClient([
      projectResponse({
        organization: {
          projectV2: project({ field: null })
        }
      }),
      new Error("field limit reached")
    ]);

    await expect(syncGhProject({ ...DEFAULT_OPTIONS, client })).rejects.toMatchObject({
      name: "GhProjectSyncError",
      op: "createField",
      target: "Status",
      message: "field limit reached"
    } satisfies Partial<GhProjectSyncError>);
  });

  it("wraps createProjectV2SingleSelectFieldOption failures with the GitHub message", async () => {
    const client = new MockGhClient([
      projectResponse({
        organization: {
          projectV2: project({
            options: [{ id: "status-todo", name: "Todo" }]
          })
        }
      }),
      new Error("option already exists")
    ]);

    await expect(syncGhProject({ ...DEFAULT_OPTIONS, client })).rejects.toMatchObject({
      name: "GhProjectSyncError",
      op: "createOption",
      target: "Doing",
      message: "option already exists"
    } satisfies Partial<GhProjectSyncError>);
  });
});

function projectResponse(data: unknown): unknown {
  return data;
}

function ownerResponse(data: unknown): unknown {
  return data;
}

function project(
  overrides: Partial<{
    id: string;
    field: null | { id: string; name?: string; options: Array<{ id: string; name: string }> };
    options: Array<{ id: string; name: string }>;
  }> = {}
) {
  return {
    id: overrides.id ?? "project-id",
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
          }
  };
}

class StatefulProjectClient implements GhClient {
  readonly calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  private projectExists = false;
  private fieldExists = false;

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    this.calls.push({ query, variables });

    if (query.includes("createProjectV2Field")) {
      this.fieldExists = true;
      return createFieldResponse({
        id: "new-status-field",
        options: [
          { id: "status-todo", name: "Todo" },
          { id: "status-doing", name: "Doing" },
          { id: "status-done", name: "Done" }
        ]
      }) as T;
    }

    if (query.includes("createProjectV2")) {
      this.projectExists = true;
      return createProjectResponse({ id: "new-project-id", number: 7 }) as T;
    }

    if (query.includes("query ProjectOwner")) {
      return ownerResponse({ organization: { id: "owner-id" } }) as T;
    }

    if (query.includes("query Project(")) {
      return projectResponse({
        organization: {
          projectV2: this.projectExists
            ? project({
                id: "new-project-id",
                field: this.fieldExists
                  ? {
                      id: "new-status-field",
                      options: [
                        { id: "status-todo", name: "Todo" },
                        { id: "status-doing", name: "Doing" },
                        { id: "status-done", name: "Done" }
                      ]
                    }
                  : null
              })
            : null
        }
      }) as T;
    }

    return projectResponse({ user: null }) as T;
  }
}

class FailingOptionOnceClient implements GhClient {
  readonly calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  private options = ["Todo"];
  private failedDone = false;

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    this.calls.push({ query, variables });

    if (query.includes("createProjectV2SingleSelectFieldOption")) {
      const input = variables.input as { name: string };
      if (input.name === "Done" && !this.failedDone) {
        this.failedDone = true;
        throw new Error("permission denied");
      }

      this.options.push(input.name);
      return createOptionResponse({
        id: `status-${input.name.toLowerCase()}`,
        name: input.name
      }) as T;
    }

    return projectResponse({
      organization: {
        projectV2: project({
          options: this.options.map((name) => ({
            id: `status-${name.toLowerCase()}`,
            name
          }))
        })
      }
    }) as T;
  }
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

function createOptionResponse(option: { id: string; name: string }): unknown {
  return {
    createProjectV2SingleSelectFieldOption: {
      singleSelectFieldOption: option
    }
  };
}
