import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    default: fs.promises
  };
});

describe("loadWorkflow", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
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
      code: "invalid_yaml"
    });
    await expect(loadWorkflow("/repo/WORKFLOW.md")).rejects.toBeInstanceOf(WorkflowLoadError);
  });

  it("rejects invalid YAML frontmatter with a stable code", async () => {
    const { loadWorkflow } = await import("./load.js");
    vol.fromJSON({
      "/repo/WORKFLOW.md": ["---", "title: demo: broken", "---", "", "Body"].join("\n")
    });

    await expect(loadWorkflow("/repo/WORKFLOW.md")).rejects.toMatchObject({
      code: "invalid_yaml"
    });
  });

  it("rejects missing workflow files with a typed stable error", async () => {
    const { loadWorkflow, WorkflowLoadError } = await import("./load.js");

    await expect(loadWorkflow("/repo/missing.md")).rejects.toMatchObject({
      code: "file_not_found"
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

  it("loads frontmatter with an empty prompt template", async () => {
    const { loadWorkflow } = await import("./load.js");
    vol.fromJSON({
      "/repo/WORKFLOW.md": [
        "---",
        "states:",
        "  planned:",
        "    prompt: Plan",
        "  done:",
        "    terminal: true",
        "---"
      ].join("\n")
    });

    await expect(loadWorkflow("/repo/WORKFLOW.md")).resolves.toMatchObject({
      config: {
        states: {
          planned: { prompt: "Plan" },
          done: { terminal: true }
        }
      },
      promptTemplate: ""
    });
  });

  it("pins env var expansion syntax after loading workflow config", async () => {
    process.env.MAESTRO_LIST = "backlog";
    const { loadWorkflow } = await import("./load.js");
    const { resolveConfig } = await import("./schema.js");
    vol.fromJSON({
      "/repo/WORKFLOW.md": [
        "---",
        "tasks:",
        "  type: markdown-dir",
        "  path: ./tasks",
        "states:",
        "  planned:",
        "    prompt: Plan",
        "  done:",
        "    terminal: true",
        "agent:",
        "  list: $MAESTRO_LIST",
        "---",
        "",
        "Body"
      ].join("\n")
    });

    const workflow = await loadWorkflow("/repo/WORKFLOW.md");

    expect(resolveConfig(workflow.config, "/repo").agent.list).toBe("backlog");

    vol.fromJSON({
      "/repo/WORKFLOW.md": [
        "---",
        "states:",
        "  planned:",
        "    prompt: Plan",
        "  done:",
        "    terminal: true",
        "agent:",
        "  list: ${MAESTRO_LIST}",
        "---",
        "",
        "Body"
      ].join("\n")
    });

    const mixedSyntax = await loadWorkflow("/repo/WORKFLOW.md");

    expect(resolveConfig(mixedSyntax.config, "/repo").agent.list).toBe("${MAESTRO_LIST}");
  });

  it("leaves invalid env var names literal after loading workflow config", async () => {
    process.env.MAESTRO_LIST = "backlog";
    const { loadWorkflow } = await import("./load.js");
    const { resolveConfig } = await import("./schema.js");
    vol.fromJSON({
      "/repo/WORKFLOW.md": [
        "---",
        "states:",
        "  planned:",
        "    prompt: Plan",
        "  done:",
        "    terminal: true",
        "agent:",
        "  list: $MAESTRO-LIST",
        "---",
        "",
        "Body"
      ].join("\n")
    });

    const workflow = await loadWorkflow("/repo/WORKFLOW.md");

    expect(resolveConfig(workflow.config, "/repo").agent.list).toBe("$MAESTRO-LIST");
  });
});
