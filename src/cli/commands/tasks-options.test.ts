import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { resolveTasksOptions, TasksOptionsError } = await import("./tasks-options.js");

function seedWorkflow(frontmatter: string): void {
  vol.fromJSON(
    {
      "/repo/WORKFLOW.md": ["---", frontmatter.trim(), "---", "# Workflow", ""].join("\n")
    },
    "/"
  );
}

describe("resolveTasksOptions", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("--states overrides frontmatter", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
tasks:
  repo: frontmatter/repo
`);

    await expect(
      resolveTasksOptions("acme/12", {
        workflow: "/repo/WORKFLOW.md",
        states: "triage, blocked ,done",
        repo: "flag/repo"
      })
    ).resolves.toEqual({
      owner: "acme",
      number: 12,
      requiredStates: ["triage", "blocked", "done"],
      repo: "flag/repo",
      workflowPath: "/repo/WORKFLOW.md"
    });
  });

  it("reads required states from the maestro active and terminal union", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
    - agent-running
    - queued
  terminal_states:
    - done
    - failed
tasks:
  repo: frontmatter/repo
`);

    await expect(
      resolveTasksOptions("acme/12", {
        workflow: "/repo/WORKFLOW.md"
      })
    ).resolves.toEqual({
      owner: "acme",
      number: 12,
      requiredStates: ["queued", "agent-running", "done", "failed"],
      repo: "frontmatter/repo",
      workflowPath: "/repo/WORKFLOW.md"
    });
  });

  it("expands maestroTaskStateMachine references", async () => {
    seedWorkflow(`
maestro:
  state_machine: maestroTaskStateMachine
`);

    await expect(
      resolveTasksOptions("acme/12", {
        workflow: "/repo/WORKFLOW.md"
      })
    ).resolves.toMatchObject({
      requiredStates: ["queued", "agent-running", "human-review", "done", "failed", "archived"]
    });
  });

  it("--project overrides the positional list", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
`);

    await expect(
      resolveTasksOptions("positional/1", {
        workflow: "/repo/WORKFLOW.md",
        project: "flagged/42"
      })
    ).resolves.toMatchObject({
      owner: "flagged",
      number: 42
    });
  });

  it("throws missing_workflow when WORKFLOW.md does not exist", async () => {
    await expect(
      resolveTasksOptions("acme/12", {
        workflow: "/repo/WORKFLOW.md"
      })
    ).rejects.toMatchObject({
      code: "missing_workflow"
    });
  });

  it("throws missing_required_states when no source defines states", async () => {
    seedWorkflow(`
tasks:
  repo: frontmatter/repo
`);

    await expect(
      resolveTasksOptions("acme/12", {
        workflow: "/repo/WORKFLOW.md"
      })
    ).rejects.toMatchObject({
      code: "missing_required_states"
    });
  });

  it("throws missing_required_states when --states has no states", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
`);

    await expect(
      resolveTasksOptions("acme/12", {
        workflow: "/repo/WORKFLOW.md",
        states: " , "
      })
    ).rejects.toMatchObject({
      code: "missing_required_states"
    });
  });

  it("trims --repo before overriding the frontmatter repo", async () => {
    seedWorkflow(`
maestro:
  active_states:
    - queued
  terminal_states:
    - done
tasks:
  repo: frontmatter/repo
`);

    await expect(
      resolveTasksOptions("acme/12", {
        workflow: "/repo/WORKFLOW.md",
        repo: " flag/repo "
      })
    ).resolves.toMatchObject({
      repo: "flag/repo"
    });
  });

  it("uses TasksOptionsError for missing required states", async () => {
    seedWorkflow("{}");

    await expect(
      resolveTasksOptions("acme/12", {
        workflow: "/repo/WORKFLOW.md"
      })
    ).rejects.toBeInstanceOf(TasksOptionsError);
  });
});
