import { describe, expect, it } from "vitest";
import { GhProjectSyncError, syncGhProject } from "./gh-issues-sync.js";
import { MockGhClient } from "./test-helpers.js";

const DEFAULT_OPTIONS = {
  owner: "octo-org",
  number: 7,
  requiredStates: ["Todo", "Doing", "Done"]
};

describe("syncGhProject idempotency", () => {
  it("does not issue mutations on a second sync after creating everything", async () => {
    const client = createStatefulProjectClient({
      projectExists: false,
      fieldExists: false,
      options: []
    });

    await expect(syncGhProject({ ...DEFAULT_OPTIONS, client })).resolves.toEqual({
      ok: true,
      project: { id: "project-id", number: 7, owner: "octo-org" },
      statusField: { id: "status-field", options: ["Todo", "Doing", "Done"] },
      missingProject: false,
      missingStatusField: false,
      missingOptions: [],
      created: ["project", "field", "option:Todo", "option:Doing", "option:Done"],
      updated: []
    });

    const firstRunCallCount = client.calls.length;

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

    const secondRunCalls = client.calls.slice(firstRunCallCount);
    expect(secondRunCalls.every((call) => !call.query.includes("mutation"))).toBe(true);
  });

  it("resumes option creation after a mid-sync network failure without recreating the field", async () => {
    const client = createStatefulProjectClient({
      projectExists: true,
      fieldExists: false,
      options: [],
      failOptionOnce: "Doing"
    });

    await expect(syncGhProject({ ...DEFAULT_OPTIONS, client })).rejects.toMatchObject({
      name: "GhProjectSyncError",
      op: "createOption",
      target: "Doing",
      message: "network failed"
    } satisfies Partial<GhProjectSyncError>);

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

    expect(mutationCalls(client, "createProjectV2Field")).toHaveLength(1);
    expect(mutationCalls(client, "createProjectV2SingleSelectFieldOption")).toHaveLength(4);
  });
});

function createStatefulProjectClient(state: {
  projectExists: boolean;
  fieldExists: boolean;
  options: string[];
  failOptionOnce?: string;
}): MockGhClient {
  const response = (query: string, variables: Record<string, unknown>): unknown => {
    if (query.includes("createProjectV2SingleSelectFieldOption")) {
      const input = variables.input as { name: string };
      if (input.name === state.failOptionOnce) {
        state.failOptionOnce = undefined;
        throw new Error("network failed");
      }

      state.options.push(input.name);
      return createOptionResponse({ id: optionId(input.name), name: input.name });
    }

    if (query.includes("createProjectV2Field")) {
      state.fieldExists = true;
      return createFieldResponse({ id: "status-field", options: [] });
    }

    if (query.includes("mutation CreateProject")) {
      state.projectExists = true;
      return createProjectResponse({ id: "project-id", number: 7 });
    }

    if (query.includes("query ProjectOwner")) {
      return { organization: { id: "owner-id" } };
    }

    if (query.includes("organization(")) {
      return {
        organization: {
          projectV2: state.projectExists ? project(state) : null
        }
      };
    }

    return { user: { projectV2: null } };
  };

  return new MockGhClient(Array.from({ length: 20 }, () => response));
}

function mutationCalls(client: MockGhClient, name: string) {
  return client.calls.filter((call) => call.query.includes(name));
}

function project(state: { fieldExists: boolean; options: string[] }) {
  return {
    id: "project-id",
    field: state.fieldExists
      ? {
          id: "status-field",
          options: state.options.map((name) => ({ id: optionId(name), name }))
        }
      : null
  };
}

function optionId(name: string): string {
  return `status-${name.toLowerCase()}`;
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
