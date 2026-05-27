import { describe, expect, it } from "vitest";
import { GhProjectSyncError, syncGhProject, verifyGhProject } from "./gh-issues-sync.js";
import { createFetchMock, graphqlResponse, MockGhClient } from "./test-helpers.js";

const DEFAULT_OPTIONS = {
  owner: "octo-org",
  number: 7,
  requiredStates: ["Todo", "Doing", "Done"]
};

describe("syncGhProject errors", () => {
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
    const verifyFetchMock = createFetchMock([graphqlResponse({ message: "server error" }, 500)]);
    const syncFetchMock = createFetchMock([graphqlResponse({ message: "server error" }, 500)]);

    await expect(
      verifyGhProject({ ...DEFAULT_OPTIONS, auth: { token: "secret" }, fetch: verifyFetchMock })
    ).rejects.toMatchObject({
      name: "GhProjectSyncError",
      op: "lookup",
      target: "project:octo-org/7",
      cause: expect.objectContaining({
        message: expect.stringContaining("server error")
      })
    } satisfies Partial<GhProjectSyncError>);

    await expect(
      syncGhProject({ ...DEFAULT_OPTIONS, auth: { token: "secret" }, fetch: syncFetchMock })
    ).rejects.toMatchObject({
      name: "GhProjectSyncError",
      op: "lookup",
      target: "project:octo-org/7",
      cause: expect.objectContaining({
        message: expect.stringContaining("server error")
      })
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

  it("wraps updateProjectV2Field failures with the GitHub message when adding options", async () => {
    const client = new MockGhClient([
      projectResponse({
        organization: {
          projectV2: project({
            options: [{ id: "status-todo", name: "Todo" }]
          })
        }
      }),
      new Error("option update rejected")
    ]);

    await expect(syncGhProject({ ...DEFAULT_OPTIONS, client })).rejects.toMatchObject({
      name: "GhProjectSyncError",
      op: "createOption",
      target: "Doing,Done",
      message: "option update rejected"
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
