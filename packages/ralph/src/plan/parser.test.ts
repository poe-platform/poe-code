import { describe, it, expect } from "vitest";
import { parsePlan } from "./parser.js";

describe("parsePlan", () => {
  it("parses valid YAML into a typed plan object", () => {
    const yaml = `
version: 1
project: Example Project
overview: Example overview
goals:
  - Goal 1
nonGoals:
  - Non-goal 1
qualityGates:
  - npm run test
  - npm run lint
stories:
  - id: US-001
    title: Example story
    status: IN_PROGRESS
    dependsOn: [US-000]
    description: As a user, I want something.
    acceptanceCriteria:
      - Criterion 1
    startedAt: 2026-02-01T00:00:00.000Z
    updatedAt: 2026-02-02T00:00:00.000Z
`;

    const prd = parsePlan(yaml);

    expect(prd).toEqual({
      version: 1,
      project: "Example Project",
      overview: "Example overview",
      goals: ["Goal 1"],
      nonGoals: ["Non-goal 1"],
      qualityGates: ["npm run test", "npm run lint"],
      stories: [
        {
          id: "US-001",
          title: "Example story",
          status: "in_progress",
          dependsOn: ["US-000"],
          description: "As a user, I want something.",
          acceptanceCriteria: ["Criterion 1"],
          startedAt: "2026-02-01T00:00:00.000Z",
          completedAt: undefined,
          updatedAt: "2026-02-02T00:00:00.000Z"
        }
      ]
    });
  });

  it("normalizes missing or null status to open", () => {
    const yaml = `
version: 1
project: Status defaults
stories:
  - id: US-001
    title: Missing status
  - id: US-002
    title: Null status
    status: null
`;

    const prd = parsePlan(yaml);
    expect(prd.stories.map(s => s.status)).toEqual(["open", "open"]);
  });

  it("throws a descriptive error for invalid YAML", () => {
    expect(() => parsePlan("version: [")).toThrow(/Invalid plan YAML/i);
  });

  it("captures unknown top-level fields in _extra", () => {
    const yaml = `
version: 1
project: Extra fields
requirements:
  - Must support Node 20
  - Must use TypeScript
customField: hello
stories: []
`;

    const prd = parsePlan(yaml);
    expect(prd._extra).toEqual({
      requirements: ["Must support Node 20", "Must use TypeScript"],
      customField: "hello"
    });
  });

  it("captures unknown story-level fields in story _extra", () => {
    const yaml = `
version: 1
project: Story extras
stories:
  - id: US-001
    title: Story with extras
    status: open
    dependsOn: []
    acceptanceCriteria:
      - Criterion 1
    requirements:
      - Requirement A
    notes: Some implementation notes
`;

    const prd = parsePlan(yaml);
    expect(prd.stories[0]!._extra).toEqual({
      requirements: ["Requirement A"],
      notes: "Some implementation notes"
    });
  });
});

