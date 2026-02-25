import { describe, it, expect } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { parsePlan } from "./parser.js";
import type { FileSystem } from "../../../../src/utils/file-system.js";
import { writePlan } from "./writer.js";

type LockRelease = () => Promise<void>;
type LockFn = (path: string) => Promise<LockRelease>;

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const vol = Volume.fromJSON(files, "/");
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function createInMemoryLock(): LockFn {
  const tailByPath = new Map<string, Promise<void>>();
  return async (path: string) => {
    const previous = tailByPath.get(path) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    tailByPath.set(path, previous.then(() => current));

    await previous;

    return async () => {
      release();
      if (tailByPath.get(path) === current) {
        tailByPath.delete(path);
      }
    };
  };
}

describe("writePlan", () => {
  it("writes YAML with stable field order when updating story status", async () => {
    const path = "/agents/tasks/plan.yaml";
    const initial = `
version: 1
project: Example Project
qualityGates:
  - npm run test
  - npm run lint
stories:
  - id: US-001
    title: Example story
    status: in_progress
    dependsOn: []
    acceptanceCriteria:
      - Criterion 1
`;

    const prd = parsePlan(initial);
    prd.stories[0]!.status = "done";

    const fs = createMemFs({
      "/agents/tasks/plan.yaml": initial
    });

    await writePlan(path, prd, { fs, lock: createInMemoryLock() });

    const nextYaml = await fs.readFile(path, "utf8");

    expect(nextYaml.indexOf("version:")).toBeLessThan(nextYaml.indexOf("project:"));
    expect(nextYaml.indexOf("project:")).toBeLessThan(nextYaml.indexOf("qualityGates:"));
    expect(nextYaml.indexOf("qualityGates:")).toBeLessThan(nextYaml.indexOf("stories:"));

    expect(nextYaml.indexOf("id:")).toBeLessThan(nextYaml.indexOf("title:"));
    expect(nextYaml.indexOf("title:")).toBeLessThan(nextYaml.indexOf("status:"));
    expect(nextYaml).toContain("status: done");
  });

  it("preserves unknown top-level fields through a round-trip", async () => {
    const path = "/agents/tasks/plan.yaml";
    const initial = `
version: 1
project: Extras
requirements:
  - Must support Node 20
customField: hello
goals:
  - Goal 1
nonGoals: []
qualityGates:
  - npm run test
stories:
  - id: US-001
    title: Example
    status: open
    dependsOn: []
    acceptanceCriteria:
      - Criterion 1
`;

    const prd = parsePlan(initial);
    prd.stories[0]!.status = "done";

    const fs = createMemFs({
      [path]: initial
    });

    await writePlan(path, prd, { fs, lock: createInMemoryLock() });

    const nextYaml = await fs.readFile(path, "utf8");
    expect(nextYaml).toContain("requirements:");
    expect(nextYaml).toContain("Must support Node 20");
    expect(nextYaml).toContain("customField: hello");
    expect(nextYaml).toContain("status: done");
  });

  it("preserves unknown story-level fields through a round-trip", async () => {
    const path = "/agents/tasks/plan.yaml";
    const initial = `
version: 1
project: Story Extras
stories:
  - id: US-001
    title: Story with extras
    status: open
    dependsOn: []
    acceptanceCriteria:
      - Criterion 1
    requirements:
      - Requirement A
    notes: Some notes
`;

    const prd = parsePlan(initial);
    prd.stories[0]!.status = "done";

    const fs = createMemFs({
      [path]: initial
    });

    await writePlan(path, prd, { fs, lock: createInMemoryLock() });

    const nextYaml = await fs.readFile(path, "utf8");
    expect(nextYaml).toContain("requirements:");
    expect(nextYaml).toContain("Requirement A");
    expect(nextYaml).toContain("notes: Some notes");
    expect(nextYaml).toContain("status: done");
  });

  it("does not corrupt the YAML when multiple writes happen concurrently", async () => {
    const path = "/agents/tasks/plan.yaml";
    const fs = createMemFs({
      "/agents/tasks/plan.yaml": "version: 1\nproject: Concurrency\nstories: []\n"
    });

    const lock = createInMemoryLock();

    const writes = Array.from({ length: 25 }, (_, i) => {
      const prd = {
        version: 1,
        project: "Concurrency",
        overview: `run ${i}`,
        goals: [],
        nonGoals: [],
        qualityGates: [],
        stories: []
      };
      return writePlan(path, prd, { fs, lock });
    });

    await Promise.all(writes);

    const nextYaml = await fs.readFile(path, "utf8");
    expect(() => parsePlan(nextYaml)).not.toThrow();
  });
});

