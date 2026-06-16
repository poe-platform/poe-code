import { describe, expect, it, vi } from "vitest";
import { GhProjectSyncError, syncGhProject, verifyGhProject } from "./gh-issues-sync.js";

describe("verifyGhProject", () => {
  it("rejects blank required states before looking up the project", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network should not be called");
    }) as unknown as typeof fetch;

    await expect(
      verifyGhProject({
        owner: "octo-org",
        number: 7,
        requiredStates: ["draft", "   ", ""],
        auth: { token: "secret" },
        fetch: fetchMock
      })
    ).rejects.toThrow("requiredStates must not contain empty state names.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns missingProject when GitHub responds with NOT_FOUND on the project lookup", async () => {
    const fetchMock = createFetchMock([
      notFoundProjectResponse("organization"),
      notFoundProjectResponse("user")
    ]);

    const report = await verifyGhProject({
      owner: "octo-org",
      number: 999,
      requiredStates: ["draft", "fix"],
      auth: { token: "secret" },
      fetch: fetchMock
    });

    expect(report).toEqual({
      ok: false,
      project: null,
      statusField: null,
      missingProject: true,
      missingStatusField: true,
      missingOptions: ["draft", "fix"]
    });
  });

  it("falls back to user lookup when organization response is NOT_FOUND but user owns the project", async () => {
    const fetchMock = createFetchMock([
      notFoundProjectResponse("organization"),
      userProjectResponse({
        id: "project-id",
        statusField: {
          id: "status-field",
          options: ["draft", "fix"]
        }
      })
    ]);

    const report = await verifyGhProject({
      owner: "octo-user",
      number: 42,
      requiredStates: ["draft", "fix"],
      auth: { token: "secret" },
      fetch: fetchMock
    });

    expect(report).toEqual({
      ok: true,
      project: { id: "project-id", number: 42, owner: "octo-user" },
      statusField: { id: "status-field", options: ["draft", "fix"] },
      missingProject: false,
      missingStatusField: false,
      missingOptions: []
    });
  });

  it("wraps unexpected GraphQL failures as lookup_failed", async () => {
    const fetchMock = vi.fn(
      async () => new Response("boom", { status: 500 })
    ) as unknown as typeof fetch;

    await expect(
      verifyGhProject({
        owner: "octo-org",
        number: 7,
        requiredStates: ["draft"],
        auth: { token: "secret" },
        fetch: fetchMock
      })
    ).rejects.toBeInstanceOf(GhProjectSyncError);
  });
});

describe("syncGhProject", () => {
  it("rejects blank required states before mutating project options", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network should not be called");
    }) as unknown as typeof fetch;

    await expect(
      syncGhProject({
        owner: "octo-org",
        number: 7,
        requiredStates: ["draft", "   ", ""],
        yes: true,
        auth: { token: "secret" },
        fetch: fetchMock
      })
    ).rejects.toThrow("requiredStates must not contain empty state names.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates the project, then adopts the auto-created Status field and adds missing options", async () => {
    const fetchMock = createFetchMock([
      notFoundProjectResponse("organization"),
      notFoundProjectResponse("user"),
      ownerLookupOrganizationResponse("owner-id"),
      createProjectResponse({ id: "new-project-id", number: 17 }),
      organizationProjectResponse({
        id: "new-project-id",
        statusField: {
          id: "auto-status-field",
          options: [
            { id: "opt-todo", name: "Todo", color: "GREEN", description: "" },
            { id: "opt-progress", name: "In Progress", color: "YELLOW", description: "" },
            { id: "opt-done", name: "Done", color: "PURPLE", description: "" }
          ]
        }
      }),
      updateStatusFieldResponse({
        id: "auto-status-field",
        options: ["Todo", "In Progress", "Done", "draft", "fix"]
      })
    ]);

    const report = await syncGhProject({
      owner: "octo-org",
      number: 0,
      title: "Bugs",
      requiredStates: ["draft", "fix"],
      yes: true,
      auth: { token: "secret" },
      fetch: fetchMock
    });

    expect(report.ok).toBe(true);
    expect(report.missingProject).toBe(false);
    expect(report.project).toEqual({ id: "new-project-id", number: 17, owner: "octo-org" });
    expect(report.statusField).toEqual({
      id: "auto-status-field",
      options: ["Todo", "In Progress", "Done", "draft", "fix"]
    });
    expect(report.created).toEqual(["project", "option:draft", "option:fix"]);

    const updateCall = readGraphqlCall(fetchMock, 5);
    expect(updateCall).toMatchObject({
      variables: {
        input: {
          fieldId: "auto-status-field",
          singleSelectOptions: [
            { id: "opt-todo", name: "Todo", color: "GREEN", description: "" },
            { id: "opt-progress", name: "In Progress", color: "YELLOW", description: "" },
            { id: "opt-done", name: "Done", color: "PURPLE", description: "" },
            { name: "draft", color: "GRAY", description: "" },
            { name: "fix", color: "GRAY", description: "" }
          ]
        }
      }
    });
  });

  it("creates the project and the Status field when the project has none after creation", async () => {
    const fetchMock = createFetchMock([
      notFoundProjectResponse("organization"),
      notFoundProjectResponse("user"),
      ownerLookupOrganizationResponse("owner-id"),
      createProjectResponse({ id: "new-project-id", number: 17 }),
      organizationProjectResponse({
        id: "new-project-id",
        statusField: null
      }),
      createStatusFieldResponse({ id: "new-status-field-id" }),
      updateStatusFieldResponse({
        id: "new-status-field-id",
        options: ["draft", "fix"]
      })
    ]);

    const report = await syncGhProject({
      owner: "octo-org",
      number: 0,
      title: "Bugs",
      requiredStates: ["draft", "fix"],
      yes: true,
      auth: { token: "secret" },
      fetch: fetchMock
    });

    expect(report.ok).toBe(true);
    expect(report.project).toEqual({ id: "new-project-id", number: 17, owner: "octo-org" });
    expect(report.statusField).toEqual({ id: "new-status-field-id", options: ["draft", "fix"] });
    expect(report.created).toEqual(["project", "field", "option:draft", "option:fix"]);
  });
});

function createFetchMock(responses: Response[]): typeof fetch {
  return vi.fn(async () => {
    const response = responses.shift();
    if (response === undefined) {
      throw new Error("Unexpected fetch call.");
    }
    return response;
  }) as unknown as typeof fetch;
}

function notFoundProjectResponse(ownerKey: "organization" | "user"): Response {
  return new Response(
    JSON.stringify({
      data: { [ownerKey]: { projectV2: null } },
      errors: [
        {
          type: "NOT_FOUND",
          path: [ownerKey, "projectV2"],
          message: `Could not resolve to a ProjectV2 with the number 999.`
        }
      ]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function userProjectResponse(options: {
  id: string;
  statusField: { id: string; options: string[] };
}): Response {
  return jsonResponse({
    data: {
      user: {
        projectV2: projectV2Payload(options.id, options.statusField)
      }
    }
  });
}

function organizationProjectResponse(options: {
  id: string;
  statusField: { id: string; options: string[] } | null;
}): Response {
  return jsonResponse({
    data: {
      organization: {
        projectV2: projectV2Payload(options.id, options.statusField)
      }
    }
  });
}

function projectV2Payload(
  id: string,
  statusField: {
    id: string;
    options: Array<string | { id: string; name: string; color: string; description: string }>;
  } | null
): unknown {
  return {
    id,
    fields: {
      nodes:
        statusField === null
          ? []
          : [
              {
                id: statusField.id,
                name: "Status",
                options: statusField.options.map((option, index) =>
                  typeof option === "string"
                    ? { id: `option-${index}`, name: option, color: "GRAY", description: "" }
                    : option
                )
              }
            ]
    }
  };
}

function ownerLookupOrganizationResponse(id: string): Response {
  return jsonResponse({ data: { organization: { id } } });
}

function createProjectResponse(options: { id: string; number: number }): Response {
  return jsonResponse({
    data: {
      createProjectV2: {
        projectV2: { id: options.id, number: options.number }
      }
    }
  });
}

function createStatusFieldResponse(options: { id: string }): Response {
  return jsonResponse({
    data: {
      createProjectV2Field: {
        projectV2Field: {
          id: options.id,
          name: "Status",
          options: []
        }
      }
    }
  });
}

function updateStatusFieldResponse(options: { id: string; options: string[] }): Response {
  return jsonResponse({
    data: {
      updateProjectV2Field: {
        projectV2Field: {
          id: options.id,
          name: "Status",
          options: options.options.map((name, index) => ({
            id: `opt-${index}`,
            name,
            color: "GRAY",
            description: ""
          }))
        }
      }
    }
  });
}

function readGraphqlCall(fetchMock: typeof fetch, callIndex: number): unknown {
  const mock = fetchMock as unknown as { mock: { calls: unknown[][] } };
  const call = mock.mock.calls[callIndex];
  if (call === undefined) {
    throw new Error(`No fetch call at index ${callIndex}`);
  }
  const init = call[1] as { body: string };
  return JSON.parse(init.body);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
