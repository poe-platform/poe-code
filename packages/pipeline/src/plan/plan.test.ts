import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { resolvePlanDirectory, resolvePlanPath } from "./discovery.js";
import { parsePlan } from "./parser.js";
import { readPlanFile, writeTaskStatus } from "./writer.js";

type TestFs = ReturnType<typeof createFsFromVolume>["promises"];

function createFs(files: Record<string, string> = {}): TestFs {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises;
}

describe("resolvePlanPath", () => {
  it("returns the explicit --plan path without discovery", async () => {
    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/custom.yaml": "tasks: []\n"
      }),
      plan: "custom.yaml"
    });

    expect(result).toBe("custom.yaml");
  });

  it("uses config planPath when present", async () => {
    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/config.yaml": "planPath: local-plan.yaml\n",
        "/repo/local-plan.yaml": "tasks: []\n"
      })
    });

    expect(result).toBe("local-plan.yaml");
  });

  it("prompts for selection even with a single discovered plan", async () => {
    const select = vi.fn().mockResolvedValue(".poe-code/pipeline/plans/plan-demo.yaml");

    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/plans/plan-demo.yaml": "tasks: []\n"
      }),
      selectPlan: select
    });

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          { label: ".poe-code/pipeline/plans/plan-demo.yaml (0/0)", value: ".poe-code/pipeline/plans/plan-demo.yaml" }
        ]
      })
    );
    expect(result).toBe(".poe-code/pipeline/plans/plan-demo.yaml");
  });

  it("returns null with a single plan when no selectPlan callback is provided", async () => {
    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/plans/plan-demo.yaml": "tasks: []\n"
      })
    });

    expect(result).toBeNull();
  });

  it("auto-selects the only discovered plan with --yes", async () => {
    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      assumeYes: true,
      fs: createFs({
        "/repo/.poe-code/pipeline/plans/plan-demo.yaml": "tasks: []\n"
      })
    });

    expect(result).toBe(".poe-code/pipeline/plans/plan-demo.yaml");
  });

  it("selects the first plan alphabetically with --yes", async () => {
    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      assumeYes: true,
      fs: createFs({
        "/repo/.poe-code/pipeline/plans/plan-beta.yaml": "tasks: []\n",
        "/repo/.poe-code/pipeline/plans/plan-alpha.yaml": "tasks: []\n"
      })
    });

    expect(result).toBe(".poe-code/pipeline/plans/plan-alpha.yaml");
  });

  it("prompts when multiple plans exist", async () => {
    const select = vi.fn().mockResolvedValue(".poe-code/pipeline/plans/plan-beta.yaml");

    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/plans/plan-beta.yaml": [
          "tasks:",
          "  - id: one",
          "    title: One",
          "    prompt: One",
          "    status: open",
          ""
        ].join("\n"),
        "/repo/.poe-code/pipeline/plans/plan-alpha.yaml": [
          "tasks:",
          "  - id: one",
          "    title: One",
          "    prompt: One",
          "    status: done",
          "  - id: two",
          "    title: Two",
          "    prompt: Two",
          "    status: open",
          ""
        ].join("\n")
      }),
      selectPlan: select
    });

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          { label: ".poe-code/pipeline/plans/plan-alpha.yaml (1/2)", value: ".poe-code/pipeline/plans/plan-alpha.yaml" },
          { label: ".poe-code/pipeline/plans/plan-beta.yaml (0/1)", value: ".poe-code/pipeline/plans/plan-beta.yaml" }
        ]
      })
    );
    expect(result).toBe(".poe-code/pipeline/plans/plan-beta.yaml");
  });

  it("returns null when no plans exist and interactive mode can prompt for a path", async () => {
    const promptForPath = vi.fn().mockResolvedValue("manual-plan.yaml");

    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs(),
      promptForPath
    });

    expect(promptForPath).toHaveBeenCalled();
    expect(result).toBe("manual-plan.yaml");
  });

  it("throws when no plans exist and --yes is set", async () => {
    await expect(
      resolvePlanPath({
        cwd: "/repo",
        homeDir: "/home/test",
        assumeYes: true,
        fs: createFs()
      })
    ).rejects.toThrow(/no plan found/i);
  });

  it("discovers plans from global ~/.poe-code/pipeline/plans/", async () => {
    const select = vi.fn().mockResolvedValue("~/.poe-code/pipeline/plans/plan-global.yaml");

    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/pipeline/plans/plan-global.yaml": "tasks: []\n"
      }),
      selectPlan: select
    });

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          { label: "~/.poe-code/pipeline/plans/plan-global.yaml (0/0)", value: "~/.poe-code/pipeline/plans/plan-global.yaml" }
        ]
      })
    );
    expect(result).toBe("~/.poe-code/pipeline/plans/plan-global.yaml");
  });

  it("merges project and global plans, project first", async () => {
    const select = vi.fn().mockResolvedValue(".poe-code/pipeline/plans/plan-local.yaml");

    await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/plans/plan-local.yaml": "tasks: []\n",
        "/home/test/.poe-code/pipeline/plans/plan-global.yaml": "tasks: []\n"
      }),
      selectPlan: select
    });

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          { label: ".poe-code/pipeline/plans/plan-local.yaml (0/0)", value: ".poe-code/pipeline/plans/plan-local.yaml" },
          { label: "~/.poe-code/pipeline/plans/plan-global.yaml (0/0)", value: "~/.poe-code/pipeline/plans/plan-global.yaml" }
        ]
      })
    );
  });

  it("auto-selects from global plans with --yes when no project plans exist", async () => {
    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      assumeYes: true,
      fs: createFs({
        "/home/test/.poe-code/pipeline/plans/plan-global.yaml": "tasks: []\n"
      })
    });

    expect(result).toBe("~/.poe-code/pipeline/plans/plan-global.yaml");
  });

  it("scans only the custom planDirectory when provided", async () => {
    const select = vi.fn().mockResolvedValue("custom-plans/plan-custom.yaml");

    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "custom-plans",
      fs: createFs({
        "/repo/custom-plans/plan-custom.yaml": "tasks: []\n",
        "/repo/.poe-code/pipeline/plans/plan-default.yaml": "tasks: []\n"
      }),
      selectPlan: select
    });

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          { label: "custom-plans/plan-custom.yaml (0/0)", value: "custom-plans/plan-custom.yaml" }
        ]
      })
    );
    expect(result).toBe("custom-plans/plan-custom.yaml");
  });

  it("auto-selects from custom planDirectory with --yes", async () => {
    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "/abs/plans",
      assumeYes: true,
      fs: createFs({
        "/abs/plans/plan-one.yaml": "tasks: []\n"
      })
    });

    expect(result).toBe("/abs/plans/plan-one.yaml");
  });

  it("resolves tilde planDirectory paths", async () => {
    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "~/my-plans",
      assumeYes: true,
      fs: createFs({
        "/home/test/my-plans/plan-tilde.yaml": "tasks: []\n"
      })
    });

    expect(result).toBe("~/my-plans/plan-tilde.yaml");
  });
});

describe("resolvePlanDirectory", () => {
  it("returns project plans path when local .poe-code directory exists", async () => {
    const result = await resolvePlanDirectory({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({ "/repo/.poe-code/config.json": "{}" })
    });

    expect(result).toBe("/repo/.poe-code/pipeline/plans");
  });

  it("returns global plans path when local .poe-code directory does not exist", async () => {
    const result = await resolvePlanDirectory({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs()
    });

    expect(result).toBe("/home/test/.poe-code/pipeline/plans");
  });

  it("uses custom planDirectory when provided", async () => {
    const result = await resolvePlanDirectory({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "custom-plans"
    });

    expect(result).toBe("/repo/custom-plans");
  });

  it("resolves tilde in custom planDirectory", async () => {
    const result = await resolvePlanDirectory({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "~/my-plans"
    });

    expect(result).toBe("/home/test/my-plans");
  });

  it("uses absolute custom planDirectory as-is", async () => {
    const result = await resolvePlanDirectory({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "/abs/plans"
    });

    expect(result).toBe("/abs/plans");
  });
});

describe("parsePlan", () => {
  it("parses a stepless task plan", () => {
    const plan = parsePlan([
      "tasks:",
      "  - id: task-1",
      "    title: Fix timeout",
      "    prompt: Fix the timeout regression",
      "    status: open",
      ""
    ].join("\n"));

    expect(plan).toEqual({
      tasks: [
        {
          id: "task-1",
          title: "Fix timeout",
          prompt: "Fix the timeout regression",
          status: "open"
        }
      ]
    });
  });

  it("parses a stepped task plan and preserves step order", () => {
    const plan = parsePlan(
      [
        "tasks:",
        "  - id: task-1",
        "    title: Harden auth",
        "    prompt: Improve auth validation",
        "    status:",
        "      implement: done",
        "      test: open",
        "      commit: open",
        ""
      ].join("\n"),
      {
        availableSteps: {
          implement: { mode: "edit", prompt: "Implement" },
          test: { mode: "edit", prompt: "Test" },
          commit: { mode: "edit", prompt: "Commit" }
        }
      }
    );

    expect(plan.tasks[0]?.status).toEqual({
      implement: "done",
      test: "open",
      commit: "open"
    });
  });

  it("allows mixed scalar and stepped tasks", () => {
    const plan = parsePlan(
      [
        "tasks:",
        "  - id: one",
        "    title: One",
        "    prompt: First",
        "    status: done",
        "  - id: two",
        "    title: Two",
        "    prompt: Second",
        "    status:",
        "      implement: open",
        ""
      ].join("\n"),
      {
        availableSteps: {
          implement: { mode: "edit", prompt: "Implement" }
        }
      }
    );

    expect(plan.tasks).toHaveLength(2);
  });

  it("rejects duplicate task ids", () => {
    expect(() =>
      parsePlan([
        "tasks:",
        "  - id: dup",
        "    title: One",
        "    prompt: A",
        "    status: open",
        "  - id: dup",
        "    title: Two",
        "    prompt: B",
        "    status: done",
        ""
      ].join("\n"))
    ).toThrow(/duplicate task id/i);
  });

  it("rejects invalid scalar task statuses", () => {
    expect(() =>
      parsePlan([
        "tasks:",
        "  - id: task-1",
        "    title: Invalid",
        "    prompt: Invalid",
        "    status: maybe",
        ""
      ].join("\n"))
    ).toThrow(/invalid task status/i);
  });

  it("rejects unknown steps referenced by task status maps", () => {
    expect(() =>
      parsePlan(
        [
          "tasks:",
          "  - id: task-1",
          "    title: Harden auth",
          "    prompt: Improve auth validation",
          "    status:",
          "      unknown_step: open",
          ""
        ].join("\n"),
        {
          availableSteps: {
            implement: { mode: "edit", prompt: "Implement" }
          }
        }
      )
    ).toThrow(/unknown step "unknown_step"/i);
  });

  it("accepts an empty tasks array", () => {
    const plan = parsePlan("tasks: []\n");
    expect(plan.tasks).toEqual([]);
  });

  it("parses mcp block with command, args, and env", () => {
    const plan = parsePlan([
      "mcp:",
      "  my-server:",
      "    command: npx",
      "    args:",
      "      - my-server",
      "    env:",
      "      FOO: bar",
      "tasks: []",
      ""
    ].join("\n"));

    expect(plan.mcp).toEqual({
      "my-server": { command: "npx", args: ["my-server"], env: { FOO: "bar" } }
    });
  });

  it("parses mcp block with command only", () => {
    const plan = parsePlan([
      "mcp:",
      "  minimal:",
      "    command: my-tool",
      "tasks: []",
      ""
    ].join("\n"));

    expect(plan.mcp).toEqual({ minimal: { command: "my-tool" } });
  });

  it("omits mcp when not present", () => {
    const plan = parsePlan("tasks: []\n");
    expect(plan.mcp).toBeUndefined();
  });

  it("rejects mcp that is not an object", () => {
    expect(() =>
      parsePlan([
        "mcp: not-an-object",
        "tasks: []",
        ""
      ].join("\n"))
    ).toThrow(/mcp.*must be an object/i);
  });

  it("rejects mcp server entry missing command", () => {
    expect(() =>
      parsePlan([
        "mcp:",
        "  bad-server:",
        "    args: [foo]",
        "tasks: []",
        ""
      ].join("\n"))
    ).toThrow(/command.*non-empty string/i);
  });

  it("parses setup and teardown from plan", () => {
    const plan = parsePlan([
      "setup:",
      "  prompt: Prepare workspace",
      "teardown:",
      "  mode: read",
      "  prompt: Run final checks",
      "tasks:",
      "  - id: task-1",
      "    title: Fix",
      "    prompt: Fix it",
      "    status: open",
      ""
    ].join("\n"));

    expect(plan.setup).toEqual({ mode: "yolo", prompt: "Prepare workspace" });
    expect(plan.teardown).toEqual({ mode: "read", prompt: "Run final checks" });
  });

  it("omits setup and teardown when not present", () => {
    const plan = parsePlan("tasks: []\n");
    expect(plan.setup).toBeUndefined();
    expect(plan.teardown).toBeUndefined();
  });

  it("rejects setup missing instruction", () => {
    expect(() =>
      parsePlan([
        "setup:",
        "  mode: read",
        "tasks: []",
        ""
      ].join("\n"))
    ).toThrow(/setup.*missing a prompt/i);
  });

  it("maps setup: false to null (disabled)", () => {
    const plan = parsePlan([
      "setup: false",
      "tasks: []",
      ""
    ].join("\n"));

    expect(plan.setup).toBeNull();
  });

  it("maps teardown: false to null (disabled)", () => {
    const plan = parsePlan([
      "teardown: false",
      "tasks: []",
      ""
    ].join("\n"));

    expect(plan.teardown).toBeNull();
  });

  it("parses vars as a string record", () => {
    const plan = parsePlan([
      "vars:",
      "  plan_doc: docs/plans/my-feature.md",
      "  env: production",
      "tasks: []",
      ""
    ].join("\n"));

    expect(plan.vars).toEqual({
      plan_doc: "docs/plans/my-feature.md",
      env: "production"
    });
  });

  it("omits vars when not defined", () => {
    const plan = parsePlan("tasks: []\n");
    expect(plan.vars).toBeUndefined();
  });

  it("throws when vars is not an object", () => {
    expect(() =>
      parsePlan("vars: just-a-string\ntasks: []\n")
    ).toThrow(/"vars" must be an object/i);
  });

  it("throws when a var value is not a string", () => {
    expect(() =>
      parsePlan("vars:\n  bad: 123\ntasks: []\n")
    ).toThrow(/vars\["bad"\] must be a string/i);
  });
});

describe("writeTaskStatus", () => {
  it("updates a stepless task status to done", async () => {
    const fs = createFs({
      "/repo/plan.yaml": [
        "tasks:",
        "  - id: task-1",
        "    title: One",
        "    prompt: First",
        "    status: open",
        ""
      ].join("\n")
    });

    await writeTaskStatus({
      fs,
      planPath: "/repo/plan.yaml",
      taskId: "task-1",
      status: "done"
    });

    await expect(readPlanFile(fs, "/repo/plan.yaml")).resolves.toContain("status: done");
  });

  it("updates only a single step status", async () => {
    const fs = createFs({
      "/repo/plan.yaml": [
        "tasks:",
        "  - id: task-1",
        "    title: One",
        "    prompt: First",
        "    status:",
        "      implement: done",
        "      test: open",
        "      commit: open",
        ""
      ].join("\n")
    });

    await writeTaskStatus({
      fs,
      planPath: "/repo/plan.yaml",
      taskId: "task-1",
      stepName: "test",
      status: "failed"
    });

    const contents = await readPlanFile(fs, "/repo/plan.yaml");
    expect(contents).toContain("implement: done");
    expect(contents).toContain("test: failed");
    expect(contents).toContain("commit: open");
  });

  it("preserves prior changes across multiple writes", async () => {
    const fs = createFs({
      "/repo/plan.yaml": [
        "tasks:",
        "  - id: task-1",
        "    title: One",
        "    prompt: First",
        "    status:",
        "      implement: open",
        "      test: open",
        ""
      ].join("\n")
    });

    await writeTaskStatus({
      fs,
      planPath: "/repo/plan.yaml",
      taskId: "task-1",
      stepName: "implement",
      status: "done"
    });
    await writeTaskStatus({
      fs,
      planPath: "/repo/plan.yaml",
      taskId: "task-1",
      stepName: "test",
      status: "done"
    });

    const contents = await readPlanFile(fs, "/repo/plan.yaml");
    expect(contents).toContain("implement: done");
    expect(contents).toContain("test: done");
  });
});
