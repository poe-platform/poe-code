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
      requirements: [],
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
customField: hello
anotherField: world
stories: []
`;

    const prd = parsePlan(yaml);
    expect(prd._extra).toEqual({
      customField: "hello",
      anotherField: "world"
    });
  });

  it("parses structured requirements with scenarios", () => {
    const yaml = `
version: 1
project: Req test
requirements:
  - id: R-001
    title: Tool namespacing
    description: |
      Tools SHALL be namespaced.
    scenarios:
      - name: Basic
        when: namespace("srv", "tool") is called
        then: Returns "mcp__srv__tool"
      - name: Special chars
        when: namespace("srv", "v2.0") is called
        then: Returns "mcp__srv__v2.0"
  - id: R-002
    title: Conversion
    scenarios:
      - name: Full conversion
        when: convert is called
        then: Returns converted object
stories: []
`;

    const prd = parsePlan(yaml);
    expect(prd.requirements).toEqual([
      {
        id: "R-001",
        title: "Tool namespacing",
        description: "Tools SHALL be namespaced.\n",
        scenarios: [
          { name: "Basic", when: 'namespace("srv", "tool") is called', then: 'Returns "mcp__srv__tool"' },
          { name: "Special chars", when: 'namespace("srv", "v2.0") is called', then: 'Returns "mcp__srv__v2.0"' }
        ],
        status: "pending",
        verifiedAt: undefined
      },
      {
        id: "R-002",
        title: "Conversion",
        description: undefined,
        scenarios: [
          { name: "Full conversion", when: "convert is called", then: "Returns converted object" }
        ],
        status: "pending",
        verifiedAt: undefined
      }
    ]);
  });

  it("normalizes missing or null requirement status to pending", () => {
    const yaml = `
version: 1
project: Req status
requirements:
  - id: R-001
    title: No status
    scenarios: []
  - id: R-002
    title: Null status
    status: null
    scenarios: []
  - id: R-003
    title: Passed
    status: passed
    scenarios: []
stories: []
`;

    const prd = parsePlan(yaml);
    expect(prd.requirements.map(r => r.status)).toEqual(["pending", "pending", "passed"]);
  });

  it("defaults missing requirements to empty array", () => {
    const yaml = `
version: 1
project: No reqs
stories: []
`;

    const prd = parsePlan(yaml);
    expect(prd.requirements).toEqual([]);
  });

  it("captures unknown requirement-level fields in requirement _extra", () => {
    const yaml = `
version: 1
project: Req extras
requirements:
  - id: R-001
    title: With extras
    scenarios: []
    customNote: important
stories: []
`;

    const prd = parsePlan(yaml);
    expect(prd.requirements[0]!._extra).toEqual({ customNote: "important" });
  });

  it("requirements field no longer goes to plan _extra", () => {
    const yaml = `
version: 1
project: Req not extra
requirements:
  - id: R-001
    title: Req
    scenarios: []
stories: []
`;

    const prd = parsePlan(yaml);
    expect(prd._extra).toBeUndefined();
    expect(prd.requirements).toHaveLength(1);
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

