import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    default: fs.promises
  };
});

describe("loadWorkflow", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("splits YAML frontmatter from the prompt body", async () => {
    const { loadWorkflow } = await import("./load.js");
    vol.fromJSON({
      "/repo/WORKFLOW.md": [
        "---",
        "tasks:",
        "  type: markdown-dir",
        "  path: ./tasks",
        "agent:",
        "  list: backlog",
        "---",
        "",
        "Implement {{ task.name }}."
      ].join("\n")
    });

    await expect(loadWorkflow("/repo/WORKFLOW.md")).resolves.toEqual({
      sourcePath: "/repo/WORKFLOW.md",
      config: {
        tasks: { type: "markdown-dir", path: "./tasks" },
        agent: { list: "backlog" }
      },
      promptTemplate: "Implement {{ task.name }}."
    });
  });

  it("rejects non-map YAML frontmatter", async () => {
    const { loadWorkflow, WorkflowLoadError } = await import("./load.js");
    vol.fromJSON({
      "/repo/WORKFLOW.md": ["---", "- nope", "---", "", "Body"].join("\n")
    });

    await expect(loadWorkflow("/repo/WORKFLOW.md")).rejects.toMatchObject({
      code: "invalid_frontmatter"
    });
    await expect(loadWorkflow("/repo/WORKFLOW.md")).rejects.toBeInstanceOf(WorkflowLoadError);
  });

  it("rejects missing workflow files with a typed error", async () => {
    const { loadWorkflow, WorkflowLoadError } = await import("./load.js");

    await expect(loadWorkflow("/repo/missing.md")).rejects.toMatchObject({
      code: "missing_workflow"
    });
    await expect(loadWorkflow("/repo/missing.md")).rejects.toBeInstanceOf(WorkflowLoadError);
  });

  it("loads a body-only file with empty config", async () => {
    const { loadWorkflow } = await import("./load.js");
    vol.fromJSON({
      "/repo/WORKFLOW.md": "Body only\n"
    });

    await expect(loadWorkflow("/repo/WORKFLOW.md")).resolves.toEqual({
      sourcePath: "/repo/WORKFLOW.md",
      config: {},
      promptTemplate: "Body only\n"
    });
  });
});
